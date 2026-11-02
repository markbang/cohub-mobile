package io.github.markbang.cohubmobile.chattimeline

import android.animation.Animator
import android.animation.AnimatorListenerAdapter
import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Rect
import android.os.SystemClock
import android.view.View
import android.view.ViewGroup
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsAnimationCompat
import androidx.core.view.WindowInsetsCompat
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import kotlin.math.max
import kotlin.math.roundToInt

/**
 * The Chat timeline as a RecyclerView. Native owns what has to happen inside a frame: recycling,
 * keeping the reading position when rows change above it, pinning the tail while following,
 * scrolling to a row, lifting with the keyboard, and the send flight. JS owns everything else:
 * what rows exist and what they look like (node trees), thresholds, and the reactions to the
 * events below.
 */
class ChatTimelineView(
  context: Context,
  appContext: AppContext,
) : ExpoView(context, appContext) {
  private val onTimelineScroll by EventDispatcher<Map<String, Any?>>()
  private val onScrollPhase by EventDispatcher<Map<String, Any?>>()
  private val onFollowingChange by EventDispatcher<Map<String, Any?>>()
  private val onVisibleRows by EventDispatcher<Map<String, Any?>>()
  private val onNearEdge by EventDispatcher<Map<String, Any?>>()
  private val onRowAction by EventDispatcher<Map<String, Any?>>()
  private val onTimelineLoad by EventDispatcher<Map<String, Any?>>()
  private val onFlightEnd by EventDispatcher<Map<String, Any?>>()
  private val onKeyboardLift by EventDispatcher<Map<String, Any?>>()

  private val density = resources.displayMetrics.density
  private val layoutManager = TimelineLayoutManager(context)
  private val adapter = TimelineAdapter()
  private val list = TimelineRecyclerView(context)

  // Props, in points unless noted; defaults match the JS timeline.
  private var insetTop = 0f
  private var insetBottom = 0f
  private var viewportTop = 0f
  private var viewportBottom = 0f
  private var followThreshold = 60f
  private var pageThreshold = 180f
  private var visibleFraction = 0.2f
  private var scrollThrottleMs = 100L
  private var detached = false
  private var keyboardEnabled = true
  private var keyboardCoveredInset = 0f
  private var initialTarget: Map<String, Any?>? = null

  private var following = true
  private var dragging = false
  private var flinging = false
  private var commandScrolling = false
  private var loaded = false
  private var lastScrollEmit = 0L
  private var nearOlder = false
  private var nearNewer = false
  private var visibleKeys: List<String> = emptyList()
  private var lift = 0
  private var liftPadding = 0
  private var pendingTarget: Target? = null
  private val flights = mutableMapOf<String, PendingFlight>()
  private val runningFlights = mutableMapOf<String, ValueAnimator>()

  private class Target(
    val key: String,
    val animated: Boolean,
    val viewPosition: Float,
    val viewOffset: Float,
  )

  private class PendingFlight(
    val flight: Flight,
    val expiresAt: Long,
  )

  init {
    clipChildren = false
    list.layoutManager = layoutManager
    list.adapter = adapter
    list.itemAnimator = null
    // Rows scrolled just out of view stay bound, so scrolling back does not lay out Markdown again.
    list.setItemViewCacheSize(ITEM_VIEW_CACHE)
    list.clipToPadding = false
    list.clipChildren = false
    list.overScrollMode = View.OVER_SCROLL_IF_CONTENT_SCROLLS
    list.isVerticalScrollBarEnabled = true
    list.layoutParams = LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT)
    layoutManager.stackFromEnd = true
    addView(list)
    list.addOnScrollListener(
      object : RecyclerView.OnScrollListener() {
        override fun onScrollStateChanged(
          recyclerView: RecyclerView,
          newState: Int,
        ) = handleScrollState(newState)

        override fun onScrolled(
          recyclerView: RecyclerView,
          dx: Int,
          dy: Int,
        ) = handleScrolled(dy)
      },
    )
    ViewCompat.setWindowInsetsAnimationCallback(
      this,
      object : WindowInsetsAnimationCompat.Callback(DISPATCH_MODE_CONTINUE_ON_SUBTREE) {
        override fun onProgress(
          insets: WindowInsetsCompat,
          runningAnimations: MutableList<WindowInsetsAnimationCompat>,
        ): WindowInsetsCompat {
          if (runningAnimations.any { it.typeMask and WindowInsetsCompat.Type.ime() != 0 }) applyKeyboard(insets, settled = false)
          return insets
        }

        override fun onEnd(animation: WindowInsetsAnimationCompat) {
          if (animation.typeMask and WindowInsetsCompat.Type.ime() == 0) return
          ViewCompat.getRootWindowInsets(this@ChatTimelineView)?.let { applyKeyboard(it, settled = true) }
        }
      },
    )
  }

  // region Props

  fun setContentInset(value: Map<String, Any?>) {
    insetTop = value.float("top") ?: 0f
    insetBottom = value.float("bottom") ?: 0f
    applyPadding()
  }

  fun setViewportInset(value: Map<String, Any?>) {
    viewportTop = value.float("top") ?: 0f
    viewportBottom = value.float("bottom") ?: 0f
    post { reportVisibleRows() }
  }

  fun setThresholds(value: Map<String, Any?>) {
    value.float("follow")?.let { followThreshold = it }
    value.float("page")?.let { pageThreshold = it }
    value.float("visibleFraction")?.let { visibleFraction = it }
    value.float("scrollEventThrottle")?.let { scrollThrottleMs = it.toLong() }
  }

  fun setDetached(value: Boolean) {
    detached = value
    if (value) setFollowing(false)
  }

  fun setKeyboard(value: Map<String, Any?>) {
    keyboardEnabled = value.bool("enabled") ?: true
    keyboardCoveredInset = value.float("coveredInset") ?: 0f
  }

  fun setInitialTarget(value: Map<String, Any?>?) {
    if (loaded) return
    initialTarget = value
  }

  // endregion

  // region Commands

  fun setRows(
    keys: List<String>,
    rows: Map<String, Map<String, Any?>>,
  ) {
    val previousKeys = adapter.keys
    val keysChanged = previousKeys != keys
    // Rows added or removed above the reader must not move what they are reading: the first
    // visible anchorable row keeps its place. While following, the tail pin decides instead.
    val reference = if (keysChanged && loaded && !following) readingReference() else null
    val previousSet = previousKeys.toHashSet()
    val changed = HashSet<String>()
    for ((key, raw) in rows) {
      val spec = RowSpec(raw)
      if (key !in previousSet && spec.appear.isNotEmpty()) adapter.pendingAppear += key
      spec.flight?.let { flight ->
        if (key !in adapter.flown) {
          adapter.flown += key
          flights[key] = PendingFlight(flight, SystemClock.uptimeMillis() + FLIGHT_WAIT_MS)
        }
      }
      if (adapter.specs[key] != null) changed += key
      adapter.specs[key] = spec
    }
    val nextSet = keys.toHashSet()
    adapter.specs.keys.retainAll(nextSet)
    adapter.pendingAppear.retainAll(nextSet)
    adapter.flown.retainAll(nextSet)
    val diff =
      DiffUtil.calculateDiff(
        object : DiffUtil.Callback() {
          override fun getOldListSize() = previousKeys.size

          override fun getNewListSize() = keys.size

          override fun areItemsTheSame(
            oldItemPosition: Int,
            newItemPosition: Int,
          ) = previousKeys[oldItemPosition] == keys[newItemPosition]

          override fun areContentsTheSame(
            oldItemPosition: Int,
            newItemPosition: Int,
          ) = previousKeys[oldItemPosition] !in changed
        },
        false,
      )
    adapter.keys = keys
    diff.dispatchUpdatesTo(adapter)
    reference?.let { (key, top) ->
      val position = keys.indexOf(key)
      if (position >= 0) layoutManager.scrollToPositionWithOffset(position, top - list.paddingTop)
    }
    if (keys.size != previousKeys.size || keys.firstOrNull() != previousKeys.firstOrNull()) {
      nearOlder = false
      nearNewer = false
    }
    if (!loaded) placeInitially()
  }

  fun scrollToEnd(animated: Boolean) {
    pendingTarget = null
    if (!detached) setFollowing(true)
    val last = adapter.itemCount - 1
    if (last < 0) return
    if (!animated) {
      list.stopScroll()
      val distance = distanceToLatestPx()
      if (distance != null) list.scrollBy(0, distance) else layoutManager.scrollToPosition(last)
      return
    }
    commandScrolling = true
    val distance = distanceToLatestPx()
    if (distance != null) {
      list.smoothScrollBy(0, distance)
    } else {
      list.smoothScrollToPosition(last)
    }
  }

  fun scrollToKey(
    key: String,
    animated: Boolean,
    viewPosition: Float,
    viewOffset: Float,
  ): Boolean {
    val position = adapter.keys.indexOf(key)
    if (position < 0) return false
    setFollowing(false)
    val target = Target(key, animated, viewPosition, viewOffset)
    if (list.measuredHeight == 0) {
      pendingTarget = target
      return true
    }
    performScrollTo(target, position)
    return true
  }

  fun scrollBy(
    delta: Float,
    animated: Boolean,
  ) {
    val pixels = (delta * density).roundToInt()
    if (animated) list.smoothScrollBy(0, pixels) else list.scrollBy(0, pixels)
  }

  fun setFollowingFromJs(value: Boolean) {
    setFollowing(value && !detached)
    if (following) list.post { pinTail() }
  }

  fun state(): Map<String, Any?> =
    mapOf(
      "following" to following,
      "dragging" to dragging,
      "momentum" to flinging,
      "distanceToLatest" to distanceToLatestPx()?.let { it / density },
      "distanceToOldest" to distanceToOldestPx()?.let { it / density },
      "visibleKeys" to visibleKeys,
      "keyboardLift" to lift / density,
    )

  /** A row node's frame in this view, in points; null when the row is not on screen. */
  fun measureNode(
    key: String,
    nodeId: String?,
  ): Map<String, Any?>? {
    val row = rowFor(key) ?: return null
    val view = if (nodeId == null) row else row.findNode(nodeId) ?: return null
    val rect = frameOf(view) ?: return null
    return mapOf("x" to rect.left / density, "y" to rect.top / density, "width" to rect.width() / density, "height" to rect.height() / density)
  }

  // endregion

  private fun performScrollTo(
    target: Target,
    position: Int,
  ) {
    val visibleHeight = list.measuredHeight - (insetTop + insetBottom) * density
    val top = (insetTop * density + visibleHeight * target.viewPosition + target.viewOffset * density).roundToInt() + liftPadding
    // A row already laid out glides to its place; a distant one is placed directly, since a seek
    // across rows nobody has measured cannot know where to stop.
    val attached = layoutManager.findViewByPosition(position)
    if (target.animated && attached != null) {
      commandScrolling = true
      list.smoothScrollBy(0, attached.top - top)
      return
    }
    list.stopScroll()
    layoutManager.scrollToPositionWithOffset(position, top - list.paddingTop)
  }

  private fun placeInitially() {
    if (adapter.itemCount == 0) return
    val target = initialTarget
    val key = target?.string("key")
    val position = key?.let { adapter.keys.indexOf(it) } ?: -1
    if (position >= 0) {
      setFollowing(false)
      pendingTarget = Target(key!!, false, target.float("viewPosition") ?: 0f, target.float("viewOffset") ?: 0f)
    } else {
      setFollowing(!detached)
      layoutManager.scrollToPosition(adapter.itemCount - 1)
    }
  }

  private fun applyPadding() {
    list.setPadding(0, ((insetTop) * density).roundToInt() + liftPadding, 0, (insetBottom * density).roundToInt())
  }

  private fun applyKeyboard(
    insets: WindowInsetsCompat,
    settled: Boolean,
  ) {
    if (!keyboardEnabled) return
    val ime = insets.getInsets(WindowInsetsCompat.Type.ime()).bottom
    val next = max(0, ime - (keyboardCoveredInset * density).roundToInt())
    if (next != lift) {
      lift = next
      list.translationY = -next.toFloat()
    }
    // The lift moves the list's top under the header; padding the top by the lift keeps the
    // oldest row reachable. Grown at once, shrunk only once the keyboard has settled.
    val padding = if (settled) next else max(liftPadding, next)
    if (padding != liftPadding) {
      liftPadding = padding
      applyPadding()
    }
    if (settled) {
      onKeyboardLift(mapOf("lift" to next / density))
      reportVisibleRows()
    }
  }

  private fun setFollowing(value: Boolean) {
    if (following == value) return
    following = value
    onFollowingChange(mapOf("following" to value))
    // Growth anchors at the tail while following and at the top otherwise, so expanding a row
    // mid-history pushes the rows below it rather than the ones being read. Toggled after the
    // current pass when one is running: the layout manager refuses changes during layout.
    if (list.isComputingLayout || inScrollCallback) {
      list.post { syncStackFromEnd() }
    } else {
      syncStackFromEnd()
    }
  }

  private fun syncStackFromEnd() {
    if (layoutManager.stackFromEnd != following) layoutManager.stackFromEnd = following
  }

  private fun handleScrollState(state: Int) {
    when (state) {
      RecyclerView.SCROLL_STATE_DRAGGING -> {
        dragging = true
        flinging = false
        commandScrolling = false
        pendingTarget = null
        onScrollPhase(mapOf("phase" to "dragBegin"))
      }
      RecyclerView.SCROLL_STATE_SETTLING -> {
        if (dragging) {
          dragging = false
          flinging = true
          onScrollPhase(mapOf("phase" to "dragEnd", "momentum" to true))
          onScrollPhase(mapOf("phase" to "momentumBegin"))
        }
      }
      RecyclerView.SCROLL_STATE_IDLE -> {
        val wasDragging = dragging
        val wasFlinging = flinging
        val wasCommand = commandScrolling
        dragging = false
        flinging = false
        commandScrolling = false
        if (wasDragging) onScrollPhase(mapOf("phase" to "dragEnd", "momentum" to false))
        if (wasFlinging) onScrollPhase(mapOf("phase" to "momentumEnd"))
        val distance = distanceToLatestPx()
        if ((wasDragging || wasFlinging) && !detached && distance != null && distance <= followThreshold * density) setFollowing(true)
        if (following && (wasCommand || wasDragging || wasFlinging)) pinTail()
        emitScroll(force = true)
      }
    }
  }

  private var inScrollCallback = false

  private fun handleScrolled(dy: Int) {
    inScrollCallback = true
    try {
      followScroll(dy)
    } finally {
      inScrollCallback = false
    }
    emitScroll(force = false)
    reportVisibleRows()
    checkEdges()
  }

  private fun followScroll(dy: Int) {
    if (dragging || flinging) {
      val distance = distanceToLatestPx()
      val near = !detached && distance != null && distance <= followThreshold * density
      if (dy < 0 && !near) {
        setFollowing(false)
      } else if (dy > 0 && near) {
        setFollowing(true)
      }
    }
  }

  private fun emitScroll(force: Boolean) {
    val now = SystemClock.uptimeMillis()
    if (!force && now - lastScrollEmit < scrollThrottleMs) return
    lastScrollEmit = now
    val toOldest = distanceToOldestPx()
    onTimelineScroll(
      mapOf(
        "offsetY" to (toOldest ?: list.computeVerticalScrollOffset()) / density,
        "contentHeight" to list.computeVerticalScrollRange() / density,
        "viewportHeight" to list.height / density,
        "distanceToLatest" to distanceToLatestPx()?.let { it / density },
        "distanceToOldest" to toOldest?.let { it / density },
        "dragging" to dragging,
        "momentum" to flinging,
        "following" to following,
      ),
    )
  }

  /** Exact when the last row is attached, which is whenever the distance is small enough to matter. */
  private fun distanceToLatestPx(): Int? {
    val count = adapter.itemCount
    if (count == 0) return 0
    val last = layoutManager.findViewByPosition(count - 1) ?: return null
    return max(0, last.bottom + list.paddingBottom - list.height)
  }

  private fun distanceToOldestPx(): Int? {
    if (adapter.itemCount == 0) return 0
    val first = layoutManager.findViewByPosition(0) ?: return null
    return max(0, list.paddingTop - first.top)
  }

  private fun pinTail() {
    if (!following || detached || dragging || flinging || commandScrolling) return
    val distance = distanceToLatestPx()
    if (distance == null) {
      layoutManager.scrollToPosition(adapter.itemCount - 1)
      return
    }
    if (distance > 0) list.scrollBy(0, distance)
  }

  private fun checkEdges() {
    val older = distanceToOldestPx()
    val newer = distanceToLatestPx()
    val threshold = pageThreshold * density
    val olderNear = older != null && older < threshold
    val newerNear = newer != null && newer < threshold
    if (olderNear && !nearOlder) onNearEdge(mapOf("edge" to "older", "distance" to older!! / density))
    if (newerNear && !nearNewer) onNearEdge(mapOf("edge" to "newer", "distance" to newer!! / density))
    nearOlder = olderNear
    nearNewer = newerNear
  }

  private fun readingReference(): Pair<String, Int>? {
    val top = viewportTop * density + lift
    for (index in 0 until list.childCount) {
      val child = list.getChildAt(index) as? RowView ?: continue
      val key = child.key ?: continue
      if (child.bottom <= top || adapter.specs[key]?.anchor == false) continue
      return key to child.top
    }
    return null
  }

  private fun reportVisibleRows() {
    if (list.height == 0) return
    // List coordinates: the list is translated by the keyboard lift, the chrome is not.
    val top = viewportTop * density + lift
    val bottom = list.height - viewportBottom * density
    val viewport = bottom - top
    if (viewport <= 0) return
    val keys = ArrayList<String>()
    for (index in 0 until list.childCount) {
      val child = list.getChildAt(index) as? RowView ?: continue
      val key = child.key ?: continue
      val height = child.height.toFloat()
      if (height <= 0f) continue
      val visible = minOf(child.bottom.toFloat(), bottom) - maxOf(child.top.toFloat(), top)
      if (visible > 0 && visible >= minOf(height * visibleFraction, viewport)) keys += key
    }
    keys.sortBy { adapter.keys.indexOf(it) }
    if (keys == visibleKeys) return
    visibleKeys = keys
    onVisibleRows(mapOf("keys" to keys))
  }

  // Applied before the list lays out in the same pass, so a deep-linked open paints at its turn.
  override fun onLayout(
    changed: Boolean,
    l: Int,
    t: Int,
    r: Int,
    b: Int,
  ) {
    pendingTarget?.let { target ->
      val position = adapter.keys.indexOf(target.key)
      if (list.measuredHeight > 0) {
        pendingTarget = null
        if (position >= 0) performScrollTo(target, position)
      }
    }
    super.onLayout(changed, l, t, r, b)
  }

  override val shouldUseAndroidLayout = true

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    ViewCompat.getRootWindowInsets(this)?.let { applyKeyboard(it, settled = true) }
  }

  internal fun afterLayout() {
    pinTail()
    startFlights()
    if (!loaded && adapter.itemCount > 0 && list.height > 0) {
      loaded = true
      initialTarget = null
      onTimelineLoad(mapOf("following" to following))
    }
    reportVisibleRows()
    checkEdges()
  }

  internal fun dispatchAction(
    rowKey: String?,
    action: String,
    nodeId: String?,
    payload: Map<String, Any?>?,
  ) {
    onRowAction(mapOf("key" to rowKey, "action" to action, "nodeId" to nodeId, "payload" to payload))
  }

  private fun rowFor(key: String): RowView? {
    for (index in 0 until list.childCount) {
      val child = list.getChildAt(index) as? RowView ?: continue
      if (child.key == key) return child
    }
    return null
  }

  /** `view`'s untransformed frame in this view's coordinates. */
  private fun frameOf(view: View): Rect? {
    if (!view.isLaidOut) return null
    val rect = Rect(0, 0, view.width, view.height)
    try {
      offsetDescendantRectToMyCoords(view, rect)
    } catch (_: IllegalArgumentException) {
      return null
    }
    return rect
  }

  private fun startFlights() {
    if (flights.isEmpty()) return
    val now = SystemClock.uptimeMillis()
    val iterator = flights.entries.iterator()
    while (iterator.hasNext()) {
      val (key, pending) = iterator.next()
      val target = rowFor(key)?.findNode(pending.flight.nodeId)
      if (target == null || !target.isLaidOut || target.width == 0) {
        if (now > pending.expiresAt) {
          iterator.remove()
          onFlightEnd(mapOf("key" to key, "finished" to false))
        }
        continue
      }
      iterator.remove()
      fly(key, target, pending.flight)
    }
  }

  /**
   * Moves the destination node from the source frame onto its own. The target is re-read every
   * frame, so the bubble lands where it is, not where it was when the tail pin started moving.
   */
  private fun fly(
    key: String,
    target: View,
    flight: Flight,
  ) {
    val sourceRight = (flight.x + flight.width) * density
    val sourceBottom = (flight.y + flight.height) * density
    val apply = { progress: Float ->
      target.translationX = 0f
      target.translationY = 0f
      frameOf(target)?.let { frame ->
        val remaining = 1f - progress
        val listShift = list.translationY
        target.translationX = (sourceRight - frame.right) * remaining
        target.translationY = (sourceBottom - (frame.bottom + listShift)) * remaining
      }
    }
    apply(0f)
    val animator =
      ValueAnimator.ofFloat(0f, 1f).apply {
        duration = flight.duration
        interpolator = flight.easing
        addUpdateListener { apply(it.animatedValue as Float) }
        addListener(
          object : AnimatorListenerAdapter() {
            private var cancelled = false

            override fun onAnimationCancel(animation: Animator) {
              cancelled = true
            }

            override fun onAnimationEnd(animation: Animator) {
              target.translationX = 0f
              target.translationY = 0f
              runningFlights.remove(key)
              onFlightEnd(mapOf("key" to key, "finished" to !cancelled))
            }
          },
        )
      }
    runningFlights[key] = animator
    animator.start()
  }

  internal fun cancelFlight(key: String?) {
    key ?: return
    runningFlights[key]?.cancel()
  }

  override fun onDetachedFromWindow() {
    super.onDetachedFromWindow()
    runningFlights.values.toList().forEach { it.cancel() }
  }

  // region List

  private inner class TimelineRecyclerView(
    context: Context,
  ) : RecyclerView(context) {
    override fun onLayout(
      changed: Boolean,
      l: Int,
      t: Int,
      r: Int,
      b: Int,
    ) {
      super.onLayout(changed, l, t, r, b)
      afterLayout()
    }

    // Selecting text focuses it; the timeline must not scroll to reveal the focused view.
    override fun requestChildRectangleOnScreen(
      child: View,
      rect: Rect,
      immediate: Boolean,
    ): Boolean = false
  }

  private inner class TimelineLayoutManager(
    context: Context,
  ) : LinearLayoutManager(context) {
    override fun requestChildRectangleOnScreen(
      parent: RecyclerView,
      child: View,
      rect: Rect,
      immediate: Boolean,
      focusedChildVisible: Boolean,
    ): Boolean = false

    override fun onRequestChildFocus(
      parent: RecyclerView,
      state: RecyclerView.State,
      child: View,
      focused: View?,
    ): Boolean = true
  }

  private class RowHolder(
    val row: RowView,
  ) : RecyclerView.ViewHolder(row)

  private inner class TimelineAdapter : RecyclerView.Adapter<RowHolder>() {
    var keys: List<String> = emptyList()
    val specs = HashMap<String, RowSpec>()
    val pendingAppear = HashSet<String>()
    val flown = HashSet<String>()
    private val types = HashMap<String, Int>()

    init {
      setHasStableIds(false)
    }

    override fun getItemCount() = keys.size

    override fun getItemViewType(position: Int): Int {
      val type = specs[keys[position]]?.type ?: "row"
      return types.getOrPut(type) { types.size }
    }

    override fun onCreateViewHolder(
      parent: ViewGroup,
      viewType: Int,
    ): RowHolder {
      lateinit var row: RowView
      row =
        RowView(
          context,
          object : NodeEvents {
            override fun onNodeAction(
              action: String,
              nodeId: String?,
              payload: Map<String, Any?>?,
            ) = dispatchAction(row.key, action, nodeId, payload)
          },
        )
      row.layoutParams = RecyclerView.LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT)
      return RowHolder(row)
    }

    override fun onBindViewHolder(
      holder: RowHolder,
      position: Int,
    ) {
      val key = keys[position]
      val spec = specs[key] ?: return
      val previousKey = holder.row.key
      if (previousKey != null && previousKey != key) cancelFlight(previousKey)
      holder.row.bind(key, spec)
      if (pendingAppear.remove(key)) {
        for (animation in spec.appear) startAnimation(holder.row, animation)
      }
    }

    override fun onViewRecycled(holder: RowHolder) {
      cancelFlight(holder.row.key)
    }
  }

  // endregion

  private companion object {
    const val FLIGHT_WAIT_MS = 1200L
    const val ITEM_VIEW_CACHE = 8
  }
}
