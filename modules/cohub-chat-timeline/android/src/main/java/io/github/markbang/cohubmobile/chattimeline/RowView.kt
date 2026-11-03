package io.github.markbang.cohubmobile.chattimeline

import android.content.Context
import android.view.View
import android.view.ViewGroup
import com.facebook.yoga.YogaConstants
import kotlin.math.roundToInt

/** One timeline row: a JS node tree laid out by Yoga at the list's width. */
internal class RowView(
  context: Context,
  events: NodeEvents,
) : ViewGroup(context) {
  private val reconciler = NodeReconciler(context, events)
  var root: Holder? = null
    private set
  var key: String? = null
  private var layoutWidth = -1
  private var dirty = true
  private var measuring = false

  init {
    clipChildren = false
    clipToPadding = false
  }

  fun bind(
    key: String,
    spec: RowSpec,
  ) {
    if (this.key != key) {
      this.key = key
      animate().cancel()
      alpha = 1f
      translationX = 0f
      translationY = 0f
      scaleX = 1f
      scaleY = 1f
    }
    val previous = root
    val next = reconciler.reconcile(previous, spec.node)
    if (next !== previous) {
      previous?.let { removeView(it.view) }
      addView(next.view)
      root = next
    }
    reconciler.collectMeasured(next)
    alpha = if (spec.hidden) 0f else 1f
    dirty = true
    requestLayout()
  }

  /** The view of the node with `id`, for flights and measurement. */
  fun findNode(id: String): View? = root?.let { find(it, id) }

  private fun find(
    holder: Holder,
    id: String,
  ): View? {
    if (holder.id == id) return holder.view
    for (child in holder.children) find(child, id)?.let { return it }
    return holder.content?.let { find(it, id) }
  }

  // Node views are owned here, not by React: see `TimelineRecyclerView.startViewTransition`.
  override fun startViewTransition(view: View) = Unit

  override fun endViewTransition(view: View) = Unit

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    root?.let { reconciler.setAnimating(it, true) }
  }

  override fun onDetachedFromWindow() {
    super.onDetachedFromWindow()
    root?.let { reconciler.setAnimating(it, false) }
  }

  override fun requestLayout() {
    super.requestLayout()
    // A child changed size (streamed Markdown, a loaded image): Yoga must measure the leaves again.
    if (!measuring) dirty = true
  }

  override fun onMeasure(
    widthMeasureSpec: Int,
    heightMeasureSpec: Int,
  ) {
    val width = MeasureSpec.getSize(widthMeasureSpec)
    val holder = root
    if (holder == null) {
      setMeasuredDimension(width, 0)
      return
    }
    if (dirty || width != layoutWidth) {
      measuring = true
      try {
        for (node in reconciler.measured) if (!node.isDirty()) node.dirty()
        holder.yoga.calculateLayout(width.toFloat(), YogaConstants.UNDEFINED)
      } finally {
        measuring = false
      }
      layoutWidth = width
      dirty = false
    }
    setMeasuredDimension(width, holder.yoga.layoutHeight.roundToInt())
  }

  override fun onLayout(
    changed: Boolean,
    l: Int,
    t: Int,
    r: Int,
    b: Int,
  ) {
    val holder = root ?: return
    measuring = true
    try {
      applyLayout(holder)
    } finally {
      measuring = false
    }
  }
}
