package io.github.markbang.cohubmobile.glassmenu

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RadialGradient
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.RenderEffect
import android.graphics.RenderNode
import android.graphics.Shader
import android.os.Build
import android.provider.Settings
import android.util.Log
import android.view.Choreographer
import android.view.MotionEvent
import android.view.View
import android.view.ViewTreeObserver
import androidx.annotation.RequiresApi
import com.facebook.react.uimanager.PointerEvents
import com.facebook.react.uimanager.ReactPointerEventsView
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import io.github.markbang.cohubmobile.glassmenu.motion.GlassJelly
import io.github.markbang.cohubmobile.glassmenu.motion.GlassMorphTuning
import io.github.markbang.cohubmobile.glassmenu.motion.GlassMotion
import io.github.markbang.cohubmobile.glassmenu.motion.GlassSpring
import io.github.markbang.cohubmobile.glassmenu.motion.GlassSpringSpec
import io.github.markbang.cohubmobile.glassmenu.records.GlassMenuConfigRecord
import io.github.markbang.cohubmobile.glassmenu.records.GlassPlateRecord
import io.github.markbang.cohubmobile.glassmenu.records.GlassRectRecord
import io.github.markbang.cohubmobile.glassmenu.records.GlassTriggerConfigRecord
import io.github.markbang.cohubmobile.glassmenu.render.GlassRenderer
import io.github.markbang.cohubmobile.glassmenu.render.GlassSurfaceState
import java.lang.reflect.Field
import kotlin.math.max
import kotlin.math.min

/**
 * Hosts one React Native child, the menu panel laid out where the menu settles, and draws it as upstream
 * expo-glass-custom-menu's overlay draws its menu (`GlassMenuSession.draw`): the trigger morphs into Liquid
 * Glass that refracts the backdrop, and the panel's views are zoomed, blurred and clipped through the glass.
 * It fills the menu's overlay so the morph can reach the trigger and the shadow can spread; touches pass
 * through it to the panel and to whatever lies under it. Upstream draws rows on a Canvas; here they stay
 * views, so text, scrolling, accessibility and test IDs keep working.
 */
@SuppressLint("ViewConstructor")
class GlassMenuView(context: Context, appContext: AppContext) :
  ExpoView(context, appContext), ReactPointerEventsView, Choreographer.FrameCallback {
  private val onStateChange by EventDispatcher<Map<String, Any?>>()

  internal var open = false
  internal var sourceRect = GlassRectRecord()
  internal var sourceTag: Int? = null
  internal var backdropTag: Int? = null
  internal var backdropColor = Color.BLACK
  internal var dark = true
  internal var cornerRadius = 34f
  internal var plateTag: Int? = null
  internal var plate = GlassPlateRecord()
  internal var config = GlassMenuConfigRecord()
  internal var triggerConfig = GlassTriggerConfigRecord()

  override val pointerEvents: PointerEvents
    get() = PointerEvents.BOX_NONE

  private val density = resources.displayMetrics.density
  private val supportsGlass = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU

  private var motion: GlassMotion? = null
  private var expanded = false
  private var animating = false
  /** The menu has run back into its trigger; its last frame stays drawn until React removes this view. */
  private var held = false
  private val target = RectF()
  private val source = RectF()
  private val shown = RectF()
  private val captureBounds = RectF()
  private var lockedFieldStep = 0f
  private val limits = Rect()
  private val state = GlassSurfaceState()

  private var renderer: Any? = null
  private var backdropNode: Any? = null
  private var rowsNode: Any? = null
  private var triggerNode: Any? = null
  private var plateNode: Any? = null
  private var warmed = false

  private val jelly = GlassJelly()
  private var touching = false
  private var scrolling = false
  private var freshTouch = false
  private val plateTop = GlassSpring(.25f, 8f)
  private val plateHeight = GlassSpring(.25f, 8f)
  private val plateAlpha = GlassSpring(.004f, .05f)
  private var plateRow: Int? = null
  private val plateRect = RectF()
  private val platePaint = Paint(Paint.ANTI_ALIAS_FLAG)

  private var framePending = false
  private var lastFrameNanos = 0L
  private var animationScale = 1f
  private var startupFrames = 0

  private var backdropView: View? = null
  private var backdropViewTag: Int? = null
  private var observedTree: ViewTreeObserver? = null
  private val backdropListener = ViewTreeObserver.OnPreDrawListener {
    // The backdrop may sit in another window (a menu in a Modal), which never redraws this one by itself.
    if (motion != null && backdropView?.isDirty == true) invalidate()
    true
  }
  private val location = IntArray(2)
  private val otherLocation = IntArray(2)
  private val panelListener = View.OnLayoutChangeListener { _, _, _, _, _, _, _, _, _ -> sync() }

  init {
    setWillNotDraw(false)
  }

  override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
    setMeasuredDimension(MeasureSpec.getSize(widthMeasureSpec), MeasureSpec.getSize(heightMeasureSpec))
  }

  // React Native lays out the panel; LinearLayout must not move it.
  override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) = Unit

  override fun onViewAdded(child: View) {
    super.onViewAdded(child)
    child.addOnLayoutChangeListener(panelListener)
    sync()
  }

  override fun onViewRemoved(child: View) {
    child.removeOnLayoutChangeListener(panelListener)
    super.onViewRemoved(child)
  }

  override fun onDetachedFromWindow() {
    Choreographer.getInstance().removeFrameCallback(this)
    framePending = false
    observeBackdrop(null)
    if (supportsGlass) releaseGraphics()
    super.onDetachedFromWindow()
  }

  @RequiresApi(Build.VERSION_CODES.TIRAMISU)
  private fun releaseGraphics() {
    (renderer as? GlassRenderer)?.release()
    renderer = null
    for (node in listOf(backdropNode, rowsNode, triggerNode, plateNode)) (node as? RenderNode)?.discardDisplayList()
  }

  private fun panel(): View? = if (childCount > 0) getChildAt(0) else null

  /** A view by React tag; null once it has unmounted (Fabric throws for an unknown tag). */
  private fun findView(tag: Int): View? = runCatching { appContext.findView<View>(tag) }.getOrNull()

  /** Applies the current props: starts, turns around, or retargets the morph. */
  fun sync() {
    if (held && open) {
      // Reopened before React removed the finished menu: start over from the trigger.
      motion = null
      held = false
    }
    val panel = panel()
    val active = motion
    if (panel == null || panel.width == 0 || panel.height == 0) {
      // Closed before it was ever laid out: there is nothing on screen to run back in.
      if (!open && active == null && !held) {
        held = true
        emit("closed")
      }
      return
    }
    if (active == null && !open) {
      if (!held) {
        held = true
        emit("closed")
      }
      return
    }
    val nextTarget = RectF(panel.left.toFloat(), panel.top.toFloat(), panel.right.toFloat(), panel.bottom.toFloat())
    source.set(
      sourceRect.x * density, sourceRect.y * density,
      (sourceRect.x + max(sourceRect.width, 1f)) * density, (sourceRect.y + max(sourceRect.height, 1f)) * density,
    )
    val radius = cornerRadius * density
    if (active == null) {
      target.set(nextTarget)
      updateCaptureBounds()
      val created = GlassMotion()
      created.initialize(source, target, radius, density, source, false, GlassMorphTuning(triggerConfig.shrink, triggerConfig.absorb))
      created.retarget(true)
      motion = created
      expanded = true
      animating = true
      startupFrames = StartupFrames
      plateAlpha.reset(0f)
      plateTop.reset(0f)
      plateHeight.reset(0f)
      plateRow = null
      emit("opening")
    } else if (!held) {
      if (nextTarget != target) {
        target.set(nextTarget)
        updateCaptureBounds()
        active.updateTarget(target, radius)
        animating = true
      }
      if (open != expanded) {
        expanded = open
        active.updateSource(source, source)
        if (!open) {
          plateRow = null
          plateAlpha.target(0f, PlateFade)
          touching = false
          jelly.release()
        }
        active.retarget(open)
        animating = true
        emit(if (open) "opening" else "closing")
      }
    }
    if (expanded) syncPlate()
    requestFrame()
    invalidate()
  }

  private fun updateCaptureBounds() {
    captureBounds.set(source)
    captureBounds.union(target)
    captureBounds.inset(-CaptureMargin * density, -CaptureMargin * density)
    lockedFieldStep = max(
      NeckSigma * density / FieldCellsPerSigma,
      max(captureBounds.width(), captureBounds.height()) / FieldCells,
    )
  }

  private fun emit(phase: String) {
    onStateChange(mapOf("state" to phase))
  }

  // Upstream `GlassMenuSession.highlight`, with the row named by JS. The selection haptic stays in JS.
  fun syncPlate() {
    val tag = plateTag
    if (tag == plateRow) return
    val hadRow = plateRow != null
    if (tag == null) {
      plateRow = null
      plateAlpha.target(0f, PlateFade)
      requestFrame()
      return
    }
    val row = rowBounds(tag) ?: return
    plateRow = tag
    if (!hadRow) {
      plateTop.reset(row.top)
      plateHeight.reset(row.height())
    } else {
      plateTop.target(row.top, PlateSlide)
      plateHeight.target(row.height(), PlateSlide)
    }
    if (freshTouch) {
      freshTouch = false
      plateAlpha.reset(1f)
    } else {
      plateAlpha.target(1f, PlateFade)
    }
    requestFrame()
  }

  /** The row's bounds in the panel. */
  private fun rowBounds(tag: Int): RectF? {
    val panel = panel() ?: return null
    val row = findView(tag) ?: return null
    row.getLocationInWindow(otherLocation)
    panel.getLocationInWindow(location)
    val top = (otherLocation[1] - location[1]).toFloat()
    return RectF(0f, top, panel.width.toFloat(), top + row.height)
  }

  private fun requestFrame() {
    if (framePending || !isAttachedToWindow) return
    framePending = true
    lastFrameNanos = 0L
    animationScale = Settings.Global.getFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f)
    Choreographer.getInstance().postFrameCallback(this)
  }

  private val needsFrame: Boolean
    get() = (animating && !held) || !jelly.isSettled || !plateAlpha.isSettled || !plateTop.isSettled || !plateHeight.isSettled

  // Upstream `GlassMenuOverlay.doFrame` with `GlassMenuSession.tick`.
  override fun doFrame(frameTimeNanos: Long) {
    framePending = false
    val scale = animationScale
    val interval = 1f / (display?.refreshRate ?: DefaultRefreshRate).coerceAtLeast(MinimumRefreshRate)
    val elapsed = if (lastFrameNanos == 0L) interval / 2f else (frameTimeNanos - lastFrameNanos) / 1_000_000_000f
    val limit = interval * (if (startupFrames > 0) 1f else MaxSkippedFrames)
    startupFrames = (startupFrames - 1).coerceAtLeast(0)
    val seconds = (if (scale == 0f) 10f else min(elapsed, limit) / scale) * config.speed
    lastFrameNanos = frameTimeNanos
    plateTop.advance(seconds)
    plateHeight.advance(seconds)
    plateAlpha.advance(seconds)
    jelly.advance(seconds)
    val active = motion
    if (active != null && animating && !held && active.advanceBy(seconds)) {
      animating = false
      if (expanded) {
        emit("open")
      } else {
        held = true
        emit("closed")
      }
    }
    invalidate()
    if (needsFrame) {
      framePending = true
      Choreographer.getInstance().postFrameCallback(this)
    }
  }

  override fun dispatchTouchEvent(event: MotionEvent): Boolean {
    when (event.actionMasked) {
      MotionEvent.ACTION_DOWN -> {
        touching = motion != null && expanded && !held && target.contains(event.x, event.y)
        scrolling = false
        if (touching) {
          freshTouch = true
          jelly.down(event.x, event.y)
          requestFrame()
        }
      }
      MotionEvent.ACTION_MOVE -> if (touching && !scrolling) {
        jelly.move(event.x, event.y)
        requestFrame()
      }
      MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> if (touching) {
        touching = false
        jelly.release()
        requestFrame()
      }
    }
    // Keep receiving a touch that began on the panel, whether or not a view in it takes the touch.
    return super.dispatchTouchEvent(event) || touching
  }

  // A scroll view in the panel claiming the drag: the glass lets go of the finger, as upstream does on scroll.
  override fun requestDisallowInterceptTouchEvent(disallowIntercept: Boolean) {
    if (disallowIntercept && touching && !scrolling) {
      scrolling = true
      jelly.releaseDrag()
      requestFrame()
    }
    super.requestDisallowInterceptTouchEvent(disallowIntercept)
  }

  override fun dispatchDraw(canvas: Canvas) {
    val active = motion ?: return
    limits.set(0, 0, width, height)
    if (!supportsGlass || !canvas.isHardwareAccelerated) {
      drawFallback(canvas, active)
      return
    }
    drawGlass(canvas, active)
  }

  private fun liveBounds(active: GlassMotion, out: RectF) {
    out.set(active.frame.bounds)
    val awayX = if (source.centerX() > target.centerX()) -1f else 1f
    val awayY = if (source.centerY() > target.centerY()) -1f else 1f
    jelly.deformMenu(out, awayX, awayY, density, config.jelly)
  }

  // Upstream `GlassMenuSession.draw`.
  @RequiresApi(Build.VERSION_CODES.TIRAMISU)
  private fun drawGlass(canvas: Canvas, active: GlassMotion) {
    val frame = active.frame
    val backdrop = recordBackdrop()
    liveBounds(active, shown)
    state.incoming.set(shown)
    state.captureBounds.set(captureBounds)
    state.lockedFieldStep = lockedFieldStep
    state.radiusX = frame.radiusX
    state.radiusY = frame.radiusY
    state.hasSource = true
    state.source.set(frame.sourceLobe)
    state.sourceRadius = min(state.source.width(), state.source.height()) / 2f
    state.smoothing = frame.smoothing
    state.lensHeight = frame.lensHeight
    state.lensAmount = frame.lensAmount
    state.materialProgress = frame.contentProgress
    state.surfaceOpacity = 1f
    state.dark = dark
    state.config = config
    state.trigger = triggerConfig
    applyLight(frame.contentProgress)
    val glass = renderer as? GlassRenderer ?: GlassRenderer(density, density * FieldStep).also { renderer = it }
    glass.prepare(state)
    glass.drawGlass(canvas, backdrop, state, limits)
    if (!warmed) {
      warmed = true
      if (glass.warmPipelines(canvas)) post { invalidate() }
    }

    val rows = recordRows()
    val zoom = frame.contentZoom
    rows.setPivotX(0f)
    rows.setPivotY(0f)
    rows.setScaleX(shown.width() / target.width() * zoom)
    rows.setScaleY(shown.height() / target.height() * zoom)
    rows.setTranslationX(shown.left + shown.width() * .5f * (1f - zoom))
    rows.setTranslationY(shown.top + shown.height() * .5f * (1f - zoom))
    rows.setAlpha(frame.rowsOpacity)
    rows.setRenderEffect(blur(frame.contentBlur * config.morphBlur / max(min(rows.scaleX, rows.scaleY), MinimumRowsScale)))

    val trigger = recordTrigger()
    if (trigger != null) {
      val lobe = state.source
      val triggerWidth = max(trigger.width, 1)
      val triggerHeight = max(trigger.height, 1)
      trigger.setPivotX(triggerWidth / 2f)
      trigger.setPivotY(triggerHeight / 2f)
      trigger.setScaleX(lobe.width() / triggerWidth * frame.sourceZoom)
      trigger.setScaleY(lobe.height() / triggerHeight * frame.sourceZoom)
      trigger.setTranslationX(lobe.centerX() - triggerWidth / 2f)
      trigger.setTranslationY(lobe.centerY() - triggerHeight / 2f)
      trigger.setAlpha(frame.sourceOpacity)
      trigger.setRenderEffect(blur(frame.sourceBlur))
    }

    val plateLayer = recordPlate()
    if (plateLayer != null) {
      plateLayer.setPivotX(0f)
      plateLayer.setPivotY(0f)
      plateLayer.setScaleX(rows.scaleX)
      plateLayer.setScaleY(rows.scaleY)
      plateLayer.setTranslationX(rows.translationX)
      plateLayer.setTranslationY(rows.translationY)
      plateLayer.setAlpha(frame.rowsOpacity)
    }
    glass.drawForeground(canvas, state, animating && !held, frame.portalBlur * config.morphBlur) { recording ->
      if (trigger != null && frame.sourceOpacity > .001f) recording.drawRenderNode(trigger)
      if (frame.rowsOpacity > .001f) {
        if (plateLayer != null) recording.drawRenderNode(plateLayer)
        recording.drawRenderNode(rows)
      }
    }
  }

  // Upstream `GlassMenuSession.applyLight`; the trigger here has no light of its own.
  private fun applyLight(progress: Float) {
    val glow = jelly.glowValue * config.shine * progress
    state.pressX = jelly.lightPositionX
    state.pressY = jelly.lightPositionY
    state.pressRadius = MenuLightRadius * density
    state.poolGain = MenuPool * glow
    state.pressLift = MenuLift * glow
    state.rimLift = MenuRimLift * glow
  }

  private fun blur(radius: Float): RenderEffect? =
    if (radius > .01f) RenderEffect.createBlurEffect(radius, radius, Shader.TileMode.DECAL) else null

  /** The page color under everything, then the screen content the menu floats over. */
  @RequiresApi(Build.VERSION_CODES.TIRAMISU)
  private fun recordBackdrop(): RenderNode {
    val node = backdropNode as? RenderNode ?: RenderNode("CohubGlassMenu.backdrop").also { backdropNode = it }
    node.setPosition(0, 0, width, height)
    val recording = node.beginRecording(width, height)
    recording.drawColor(backdropColor)
    val content = backdropContent()
    if (content != null) {
      val (view, contentNode) = content
      view.getLocationOnScreen(otherLocation)
      getLocationOnScreen(location)
      recording.translate((otherLocation[0] - location[0]).toFloat(), (otherLocation[1] - location[1]).toFloat())
      recording.drawRenderNode(contentNode)
    }
    node.endRecording()
    return node
  }

  /**
   * The content of the `BlurTargetView` named by `backdropTag`. The Dimezis `BlurTarget` inside it records its
   * children on a RenderNode (the one expo-blur's blur reads); drawing that node shows the content without
   * redrawing it, and JS guarantees this view is never inside it, so the node cannot contain itself.
   */
  @RequiresApi(Build.VERSION_CODES.TIRAMISU)
  private fun backdropContent(): Pair<View, RenderNode>? {
    val tag = backdropTag
    if (tag != backdropViewTag) {
      backdropViewTag = tag
      observeBackdrop(tag?.let { findView(it) })
    }
    val host = backdropView as? android.view.ViewGroup ?: return null
    // expo-blur's target view proxies its children to the BlurTarget, so a child's real parent is that target.
    val blurTarget = (if (host.childCount > 0) host.getChildAt(0)?.parent else null) as? View ?: return null
    val node = renderNodeField(blurTarget.javaClass)?.get(blurTarget) as? RenderNode ?: return null
    return blurTarget to node
  }

  private fun observeBackdrop(view: View?) {
    observedTree?.takeIf { it.isAlive }?.removeOnPreDrawListener(backdropListener)
    observedTree = null
    backdropView = view
    if (view != null) {
      observedTree = view.viewTreeObserver.also { it.addOnPreDrawListener(backdropListener) }
    }
  }

  @RequiresApi(Build.VERSION_CODES.TIRAMISU)
  private fun recordRows(): RenderNode {
    val node = rowsNode as? RenderNode ?: RenderNode("CohubGlassMenu.rows").also { rowsNode = it }
    val width = max(target.width().toInt(), 1)
    val height = max(target.height().toInt(), 1)
    node.setPosition(0, 0, width, height)
    val recording = node.beginRecording(width, height)
    recording.translate(-target.left, -target.top)
    super.dispatchDraw(recording)
    node.endRecording()
    return node
  }

  /** The trigger's content, drawn in its glass lobe while the trigger itself is hidden by JS. */
  @RequiresApi(Build.VERSION_CODES.TIRAMISU)
  private fun recordTrigger(): RenderNode? {
    val view = sourceTag?.let { findView(it) } ?: return null
    if (view.width == 0 || view.height == 0) return null
    val node = triggerNode as? RenderNode ?: RenderNode("CohubGlassMenu.trigger").also { triggerNode = it }
    node.setPosition(0, 0, view.width, view.height)
    node.setRenderEffect(null)
    val recording = node.beginRecording(view.width, view.height)
    view.draw(recording)
    node.endRecording()
    return node
  }

  @RequiresApi(Build.VERSION_CODES.TIRAMISU)
  private fun recordPlate(): RenderNode? {
    if (plateAlpha.value <= .001f) return null
    val node = plateNode as? RenderNode ?: RenderNode("CohubGlassMenu.plate").also { plateNode = it }
    val width = max(target.width().toInt(), 1)
    val height = max(target.height().toInt(), 1)
    node.setPosition(0, 0, width, height)
    val recording = node.beginRecording(width, height)
    updatePlateRect()
    drawPlate(recording, plateAlpha.value, jelly.lightPositionX - target.left, config.highlightOpacity, config.shine)
    node.endRecording()
    return node
  }

  private fun updatePlateRect() {
    val inset = plate.inset * density
    plateRect.set(inset, plateTop.value, target.width() - inset, plateTop.value + plateHeight.value)
  }

  // Upstream `GlassMenuContent.drawPlate`, its opacities from `plate`.
  private fun drawPlate(canvas: Canvas, alpha: Float, lightX: Float, strength: Float, shine: Float) {
    if (alpha <= .001f || plateRect.isEmpty) return
    val base = if (dark) plate.darkOpacity else plate.lightOpacity
    val edge = (base * alpha * strength).coerceIn(0f, 1f)
    val center = ((base + (if (dark) plate.darkShine else 0f) * shine) * alpha * strength).coerceIn(0f, 1f)
    val tone = if (dark) 235 else 60
    fun shade(opacity: Float) = Color.argb((opacity * 255f).toInt(), tone, tone, if (dark) 245 else 67)
    val radius = plateRect.height() / 2f
    platePaint.color = Color.BLACK
    platePaint.shader = RadialGradient(
      lightX.coerceIn(plateRect.left, plateRect.right), plateRect.centerY(), max(plateRect.width() * .62f, 1f),
      shade(center), shade(edge), Shader.TileMode.CLAMP,
    )
    canvas.drawRoundRect(plateRect, radius, radius, platePaint)
    platePaint.shader = null
  }

  // Upstream `GlassMenuSession.drawFallback`, for a canvas that is not hardware accelerated.
  private fun drawFallback(canvas: Canvas, active: GlassMotion) {
    val frame = active.frame
    liveBounds(active, shown)
    val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      color = if (dark) Color.rgb(30, 30, 32) else Color.rgb(245, 245, 247)
      alpha = (255 * frame.contentProgress).toInt()
    }
    val radius = min(frame.radiusX, frame.radiusY)
    canvas.drawRoundRect(shown, radius, radius, paint)
    val save = canvas.saveLayerAlpha(shown, (255 * frame.contentProgress).toInt())
    canvas.clipRect(shown)
    canvas.translate(shown.left, shown.top)
    canvas.scale(shown.width() / max(target.width(), 1f), shown.height() / max(target.height(), 1f))
    updatePlateRect()
    drawPlate(canvas, plateAlpha.value, plateRect.centerX(), config.highlightOpacity, 0f)
    canvas.translate(-target.left, -target.top)
    super.dispatchDraw(canvas)
    canvas.restoreToCount(save)
  }

  private companion object {
    const val TAG = "CohubGlassMenu"
    const val FieldStep = 4f
    const val CaptureMargin = 48f
    const val MinimumRowsScale = .25f
    const val NeckSigma = 20f
    const val FieldCellsPerSigma = 4f
    const val FieldCells = 64f
    const val MenuLightRadius = 80f
    const val MenuLift = .018f
    const val MenuPool = .03f
    const val MenuRimLift = .12f
    const val StartupFrames = 4
    const val DefaultRefreshRate = 60f
    const val MinimumRefreshRate = 30f
    const val MaxSkippedFrames = 2.5f
    val PlateSlide = GlassSpringSpec(.85f, .13f)
    val PlateFade = GlassSpringSpec(1f, .14f)

    private var renderNodeLookup: Field? = null
    private var renderNodeLookupDone = false

    /** Dimezis keeps `BlurTarget.renderNode` package-private; `proguard-rules.pro` keeps its name in release builds. */
    fun renderNodeField(type: Class<*>): Field? {
      if (renderNodeLookupDone) return renderNodeLookup
      renderNodeLookupDone = true
      var current: Class<*>? = type
      while (current != null) {
        val field = runCatching { current.getDeclaredField("renderNode") }.getOrNull()
        if (field != null && RenderNode::class.java.isAssignableFrom(field.type)) {
          field.isAccessible = true
          renderNodeLookup = field
          return field
        }
        current = current.superclass
      }
      Log.w(TAG, "${type.name} has no renderNode; the glass shows only the page color behind it")
      return null
    }
  }
}
