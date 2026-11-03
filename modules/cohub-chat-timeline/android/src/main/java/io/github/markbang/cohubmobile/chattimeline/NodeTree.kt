package io.github.markbang.cohubmobile.chattimeline

import android.animation.ValueAnimator
import android.content.Context
import android.content.res.Resources
import android.graphics.Canvas
import android.graphics.Outline
import android.graphics.Paint
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.text.SpannableStringBuilder
import android.text.Spanned
import android.text.TextUtils
import android.text.style.ForegroundColorSpan
import android.text.style.LineHeightSpan
import android.text.style.MetricAffectingSpan
import android.text.TextPaint
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.ViewOutlineProvider
import android.widget.HorizontalScrollView
import android.widget.TextView
import androidx.core.view.AccessibilityDelegateCompat
import androidx.core.view.ViewCompat
import androidx.core.view.accessibility.AccessibilityNodeInfoCompat
import androidx.core.widget.NestedScrollView
import com.facebook.drawee.backends.pipeline.Fresco
import com.facebook.drawee.controller.BaseControllerListener
import com.facebook.drawee.generic.RoundingParams
import com.facebook.drawee.view.SimpleDraweeView
import com.facebook.imagepipeline.image.ImageInfo
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.modules.fresco.FrescoModule
import com.facebook.react.views.text.ReactTypefaceUtils
import com.facebook.yoga.YogaAlign
import com.facebook.yoga.YogaConfig
import com.facebook.yoga.YogaConfigFactory
import com.facebook.yoga.YogaConstants
import com.facebook.yoga.YogaDisplay
import com.facebook.yoga.YogaEdge
import com.facebook.yoga.YogaFlexDirection
import com.facebook.yoga.YogaGutter
import com.facebook.yoga.YogaJustify
import com.facebook.yoga.YogaMeasureMode
import com.facebook.yoga.YogaMeasureOutput
import com.facebook.yoga.YogaNode
import com.facebook.yoga.YogaNodeFactory
import com.facebook.yoga.YogaOverflow
import com.facebook.yoga.YogaPositionType
import com.facebook.yoga.YogaWrap
import com.swmansion.enriched.markdown.EnrichedMarkdown
import com.swmansion.enriched.markdown.utils.common.parseMd4cFlags
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.roundToInt

/** Receives what a row's nodes report; the timeline adds the row key. */
internal interface NodeEvents {
  fun onNodeAction(
    action: String,
    nodeId: String?,
    payload: Map<String, Any?>?,
  )
}

private val yogaConfig: YogaConfig by lazy {
  YogaConfigFactory.create().apply {
    // Layout runs in pixels, so whole-pixel rounding.
    setPointScaleFactor(1f)
  }
}

private fun dp(value: Float) = value * Resources.getSystem().displayMetrics.density

private fun sp(value: Float) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_SP, value, Resources.getSystem().displayMetrics)

private fun measureSpec(
  size: Float,
  mode: YogaMeasureMode,
): Int =
  when (mode) {
    YogaMeasureMode.EXACTLY -> View.MeasureSpec.makeMeasureSpec(size.roundToInt().coerceAtLeast(0), View.MeasureSpec.EXACTLY)
    YogaMeasureMode.AT_MOST -> View.MeasureSpec.makeMeasureSpec(size.toInt().coerceAtLeast(0), View.MeasureSpec.AT_MOST)
    YogaMeasureMode.UNDEFINED -> View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED)
  }

/** One node's view and Yoga node. Scroll nodes lay their content out as a separate Yoga root. */
internal class Holder(
  val type: String,
  val id: String?,
  val view: View,
  val yoga: YogaNode,
) {
  var node: Node? = null
  val children = mutableListOf<Holder>()
  var content: Holder? = null
  var animationSignature: Any? = null
  val animators = mutableListOf<ValueAnimator>()
}

/**
 * Builds and updates native views from JS node trees, reusing views by position, type, and id so
 * a streamed Markdown view keeps its segments, selection, and scroll between updates.
 */
internal class NodeReconciler(
  private val context: Context,
  private val events: NodeEvents,
) {
  /** Leaves with measure functions; Yoga only lets these be marked dirty. */
  val measured = mutableListOf<YogaNode>()

  fun reconcile(
    current: Holder?,
    node: Node,
  ): Holder {
    val holder =
      if (current != null && current.type == node.type && current.id == node.id) {
        current
      } else {
        current?.let(::release)
        create(node)
      }
    update(holder, node)
    return holder
  }

  fun collectMeasured(root: Holder) {
    measured.clear()
    collect(root)
  }

  private fun collect(holder: Holder) {
    if (holder.type == "text" || holder.type == "markdown" || holder.type == "scroll") measured += holder.yoga
    holder.children.forEach(::collect)
    holder.content?.let(::collect)
  }

  /** Loops stop while the row is off screen (in the recycler's pool) and start again when it returns. */
  fun setAnimating(
    holder: Holder,
    running: Boolean,
  ) {
    if (running) {
      holder.node?.let { applyAnimations(holder, it) }
    } else {
      holder.animators.forEach { it.cancel() }
      holder.animators.clear()
      holder.animationSignature = null
    }
    holder.children.forEach { setAnimating(it, running) }
    holder.content?.let { setAnimating(it, running) }
  }

  fun release(holder: Holder) {
    holder.animators.forEach { it.cancel() }
    holder.animators.clear()
    holder.children.forEach(::release)
    holder.content?.let(::release)
    (holder.view as? EnrichedMarkdown)?.cleanup()
  }

  private fun create(node: Node): Holder {
    val yoga = YogaNodeFactory.create(yogaConfig)
    val view: View =
      when (node.type) {
        "text" -> NodeTextView(context)
        "markdown" ->
          EnrichedMarkdown(context).apply {
            measuresContent = true
            setOnLinkPressCallback { url -> events.onNodeAction("link", null, mapOf("url" to url)) }
            setOnLinkLongPressCallback { url -> events.onNodeAction("linkLongPress", null, mapOf("url" to url)) }
          }
        "vector" -> VectorView(context)
        "image" -> NodeImageView(context)
        "scroll" ->
          if (node.raw.bool("horizontal") == true) {
            HorizontalScrollView(context).apply {
              isHorizontalScrollBarEnabled = false
              overScrollMode = View.OVER_SCROLL_NEVER
            }
          } else {
            NestedScrollView(context).apply {
              isVerticalScrollBarEnabled = true
              isNestedScrollingEnabled = true
            }
          }
        else -> BoxView(context)
      }
    val holder = Holder(node.type, node.id, view, yoga)
    when (node.type) {
      "text" -> yoga.setMeasureFunction { _, width, widthMode, height, heightMode -> measureLeaf(view, width, widthMode, height, heightMode) }
      "markdown" -> yoga.setMeasureFunction { _, width, widthMode, height, heightMode -> measureLeaf(view, width, widthMode, height, heightMode) }
      "scroll" -> {
        val content = create(Node(mapOf("type" to "view")))
        holder.content = content
        (view as ViewGroup).addView(content.view)
        yoga.setMeasureFunction { _, width, widthMode, _, _ ->
          val horizontal = view is HorizontalScrollView
          val available = if (widthMode == YogaMeasureMode.UNDEFINED) YogaConstants.UNDEFINED else width
          content.yoga.calculateLayout(if (horizontal) YogaConstants.UNDEFINED else available, YogaConstants.UNDEFINED)
          val contentWidth = content.yoga.layoutWidth
          val measuredWidth = if (horizontal && widthMode != YogaMeasureMode.UNDEFINED) minOf(contentWidth, width) else if (widthMode == YogaMeasureMode.UNDEFINED) contentWidth else width
          YogaMeasureOutput.make(measuredWidth, content.yoga.layoutHeight)
        }
      }
    }
    return holder
  }

  private fun measureLeaf(
    view: View,
    width: Float,
    widthMode: YogaMeasureMode,
    height: Float,
    heightMode: YogaMeasureMode,
  ): Long {
    view.measure(measureSpec(width, widthMode), measureSpec(height, heightMode))
    return YogaMeasureOutput.make(view.measuredWidth.toFloat(), view.measuredHeight.toFloat())
  }

  private fun update(
    holder: Holder,
    node: Node,
  ) {
    val previous = holder.node
    holder.node = node
    if (previous?.style != node.style) applyLayoutStyle(holder.yoga, node.style)
    when (val view = holder.view) {
      is BoxView -> {
        view.applyNode(node, events)
        reconcileChildren(holder, node.children, view)
      }
      is NodeTextView -> if (previous?.raw != node.raw) view.applyNode(node)
      is EnrichedMarkdown -> if (previous?.raw != node.raw) applyMarkdown(view, node, previous)
      is VectorView -> view.apply(node)
      is NodeImageView -> if (previous?.raw != node.raw) view.applyNode(node, events)
      is NestedScrollView, is HorizontalScrollView -> {
        val content = holder.content!!
        val contentNode = Node(mapOf("type" to "view", "style" to (node.raw.map("contentStyle") ?: emptyMap<String, Any?>()), "children" to node.raw["children"]))
        update(content, contentNode)
      }
    }
    applyCommonView(holder.view, node, previous)
    applyAnimations(holder, node)
  }

  private fun reconcileChildren(
    holder: Holder,
    nodes: List<Node>,
    group: ViewGroup,
  ) {
    val old = holder.children.toMutableList()
    val byId = old.filter { it.id != null }.associateBy { it.id }.toMutableMap()
    val next = ArrayList<Holder>(nodes.size)
    nodes.forEachIndexed { index, child ->
      val reuse =
        if (child.id != null) {
          byId.remove(child.id)?.takeIf { it.type == child.type }
        } else {
          old.getOrNull(index)?.takeIf { it.id == null && it.type == child.type && it !in next }
        }
      next += reconcile(reuse, child)
    }
    val kept = next.toSet()
    old.filter { it !in kept }.forEach { stale ->
      release(stale)
      group.removeView(stale.view)
    }
    next.forEachIndexed { index, child ->
      if (group.getChildAt(index) !== child.view) {
        (child.view.parent as? ViewGroup)?.removeView(child.view)
        group.addView(child.view, index)
      }
    }
    while (group.childCount > next.size) group.removeViewAt(group.childCount - 1)
    val yoga = holder.yoga
    while (yoga.childCount > 0) yoga.removeChildAt(yoga.childCount - 1)
    next.forEachIndexed { index, child -> yoga.addChildAt(child.yoga, index) }
    holder.children.clear()
    holder.children.addAll(next)
  }

  private fun applyMarkdown(
    view: EnrichedMarkdown,
    node: Node,
    previous: Node?,
  ) {
    val raw = node.raw
    // A streamed reply updates its text many times a second; the style and flags rarely change.
    val style = raw.map("markdownStyle")
    if (style != null && style != previous?.raw?.map("markdownStyle")) view.setMarkdownStyle(Arguments.makeNativeMap(style))
    val flags = raw.map("md4cFlags")
    if (previous == null || flags != previous.raw.map("md4cFlags")) view.setMd4cFlags(parseMd4cFlags(flags?.let { Arguments.makeNativeMap(it) }))
    view.setIsGFM(raw.bool("gfm") ?: true)
    view.setIsSelectable(raw.bool("selectable") ?: true)
    val streaming = raw.bool("streaming") ?: false
    view.streamingAnimation = streaming
    view.enableBlockContextMenu = raw.bool("blockContextMenu") ?: true
    view.enableTaskListItemToggle = false
    view.setMarkdownContent(raw.string("markdown") ?: "")
    // Streamed text parses off the main thread and grows the row when it lands; settled text
    // renders on bind, so a recycled row is measured with its content.
    if (streaming) view.commitProps() else view.commitPropsSynchronously()
  }

  private fun applyCommonView(
    view: View,
    node: Node,
    previous: Node?,
  ) {
    val style = node.style
    if (previous?.style?.get("opacity") != style["opacity"] || previous == null) view.alpha = style.float("opacity") ?: 1f
    val label = node.raw.string("accessibilityLabel")
    view.contentDescription = label
    val role = node.raw.string("accessibilityRole")
    val hidden = node.raw.bool("accessibilityHidden") ?: false
    view.importantForAccessibility =
      when {
        hidden -> View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
        label != null || role != null -> View.IMPORTANT_FOR_ACCESSIBILITY_YES
        else -> View.IMPORTANT_FOR_ACCESSIBILITY_AUTO
      }
    val state = node.raw.map("accessibilityState")
    if (role != null || state != null) {
      ViewCompat.setAccessibilityDelegate(
        view,
        object : AccessibilityDelegateCompat() {
          override fun onInitializeAccessibilityNodeInfo(
            host: View,
            info: AccessibilityNodeInfoCompat,
          ) {
            super.onInitializeAccessibilityNodeInfo(host, info)
            when (role) {
              "button" -> info.className = "android.widget.Button"
              "link" -> info.roleDescription = "link"
              "progressbar" -> info.className = "android.widget.ProgressBar"
              "header" -> info.isHeading = true
            }
            state?.bool("disabled")?.let { info.isEnabled = !it }
            state?.bool("busy")?.let { if (it) info.stateDescription = "busy" }
            state?.bool("expanded")?.let { expanded ->
              info.addAction(if (expanded) AccessibilityNodeInfoCompat.AccessibilityActionCompat.ACTION_COLLAPSE else AccessibilityNodeInfoCompat.AccessibilityActionCompat.ACTION_EXPAND)
            }
          }
        },
      )
    }
  }

  private fun applyAnimations(
    holder: Holder,
    node: Node,
  ) {
    val signature = node.raw["animations"]
    if (holder.animationSignature == signature) return
    holder.animationSignature = signature
    holder.animators.forEach { it.cancel() }
    holder.animators.clear()
    for (animation in node.animations) holder.animators += startAnimation(holder.view, animation)
  }
}

/** Runs a keyframed animation on one view property; also used for a row's appear animation. */
internal fun startAnimation(
  view: View,
  animation: NodeAnimation,
): ValueAnimator {
  val density = view.resources.displayMetrics.density
  val apply: (Float) -> Unit =
    when (animation.property) {
      "opacity" -> { value -> view.alpha = value }
      "translateX" -> { value -> view.translationX = value * density }
      "translateY" -> { value -> view.translationY = value * density }
      "scale" -> { value ->
        view.scaleX = value
        view.scaleY = value
      }
      "rotate" -> { value -> view.rotation = value }
      else -> { _ -> }
    }
  apply(animation.values.first())
  return ValueAnimator.ofFloat(0f, 1f).apply {
    duration = animation.duration
    startDelay = animation.delay
    interpolator = animation.easing
    repeatCount = if (animation.iterations == 0) ValueAnimator.INFINITE else animation.iterations - 1
    addUpdateListener { animator -> apply(sample(animation, animator.animatedValue as Float)) }
    start()
  }
}

private fun sample(
  animation: NodeAnimation,
  progress: Float,
): Float {
  val at = animation.at
  val values = animation.values
  if (progress <= at.first()) return values.first()
  for (index in 1 until at.size) {
    if (progress <= at[index]) {
      val span = at[index] - at[index - 1]
      val local = if (span <= 0f) 1f else (progress - at[index - 1]) / span
      return values[index - 1] + (values[index] - values[index - 1]) * local
    }
  }
  return values.last()
}

private fun dimension(
  value: Any?,
  set: (Float) -> Unit,
  percent: (Float) -> Unit,
  auto: (() -> Unit)? = null,
) {
  when (value) {
    is Number -> set(dp(value.toFloat()))
    is String ->
      when {
        value.endsWith("%") -> value.dropLast(1).toFloatOrNull()?.let(percent)
        value == "auto" -> auto?.invoke()
      }
    null -> auto?.invoke() ?: set(YogaConstants.UNDEFINED)
  }
}

/** React Native's flexbox subset, in points, applied to a Yoga node. */
private fun applyLayoutStyle(
  yoga: YogaNode,
  style: SpecMap,
) {
  yoga.flexDirection =
    when (style.string("flexDirection")) {
      "row" -> YogaFlexDirection.ROW
      "row-reverse" -> YogaFlexDirection.ROW_REVERSE
      "column-reverse" -> YogaFlexDirection.COLUMN_REVERSE
      else -> YogaFlexDirection.COLUMN
    }
  yoga.justifyContent =
    when (style.string("justifyContent")) {
      "center" -> YogaJustify.CENTER
      "flex-end" -> YogaJustify.FLEX_END
      "space-between" -> YogaJustify.SPACE_BETWEEN
      "space-around" -> YogaJustify.SPACE_AROUND
      "space-evenly" -> YogaJustify.SPACE_EVENLY
      else -> YogaJustify.FLEX_START
    }
  yoga.alignItems = align(style.string("alignItems")) ?: YogaAlign.STRETCH
  yoga.alignSelf = align(style.string("alignSelf")) ?: YogaAlign.AUTO
  yoga.alignContent = align(style.string("alignContent")) ?: YogaAlign.FLEX_START
  yoga.wrap = if (style.string("flexWrap") == "wrap") YogaWrap.WRAP else YogaWrap.NO_WRAP
  yoga.positionType = if (style.string("position") == "absolute") YogaPositionType.ABSOLUTE else YogaPositionType.RELATIVE
  yoga.display = if (style.string("display") == "none") YogaDisplay.NONE else YogaDisplay.FLEX
  yoga.overflow = if (style.string("overflow") == "hidden") YogaOverflow.HIDDEN else YogaOverflow.VISIBLE
  val flex = style.float("flex")
  yoga.flexGrow = style.float("flexGrow") ?: if (flex != null && flex > 0f) flex else 0f
  yoga.flexShrink = style.float("flexShrink") ?: if (flex != null && flex > 0f) 1f else 0f
  when {
    style["flexBasis"] != null -> dimension(style["flexBasis"], yoga::setFlexBasis, yoga::setFlexBasisPercent, yoga::setFlexBasisAuto)
    flex != null && flex > 0f -> yoga.setFlexBasis(0f)
    else -> yoga.setFlexBasisAuto()
  }
  dimension(style["width"], yoga::setWidth, yoga::setWidthPercent, yoga::setWidthAuto)
  dimension(style["height"], yoga::setHeight, yoga::setHeightPercent, yoga::setHeightAuto)
  dimension(style["minWidth"], yoga::setMinWidth, yoga::setMinWidthPercent)
  dimension(style["minHeight"], yoga::setMinHeight, yoga::setMinHeightPercent)
  dimension(style["maxWidth"], yoga::setMaxWidth, yoga::setMaxWidthPercent)
  dimension(style["maxHeight"], yoga::setMaxHeight, yoga::setMaxHeightPercent)
  yoga.aspectRatio = style.float("aspectRatio") ?: YogaConstants.UNDEFINED
  edges(style, "margin", { edge, value -> yoga.setMargin(edge, value) }, { edge, value -> yoga.setMarginPercent(edge, value) })
  edges(style, "padding", { edge, value -> yoga.setPadding(edge, value) }, { edge, value -> yoga.setPaddingPercent(edge, value) })
  for ((key, edge) in listOf("top" to YogaEdge.TOP, "right" to YogaEdge.RIGHT, "bottom" to YogaEdge.BOTTOM, "left" to YogaEdge.LEFT)) {
    dimension(style[key], { yoga.setPosition(edge, it) }, { yoga.setPositionPercent(edge, it) })
  }
  for ((key, edge) in listOf("borderWidth" to YogaEdge.ALL, "borderTopWidth" to YogaEdge.TOP, "borderRightWidth" to YogaEdge.RIGHT, "borderBottomWidth" to YogaEdge.BOTTOM, "borderLeftWidth" to YogaEdge.LEFT)) {
    yoga.setBorder(edge, style.float(key)?.let(::dp) ?: YogaConstants.UNDEFINED)
  }
  val gap = style.float("gap")
  yoga.setGap(YogaGutter.ALL, gap?.let(::dp) ?: YogaConstants.UNDEFINED)
  yoga.setGap(YogaGutter.ROW, style.float("rowGap")?.let(::dp) ?: YogaConstants.UNDEFINED)
  yoga.setGap(YogaGutter.COLUMN, style.float("columnGap")?.let(::dp) ?: YogaConstants.UNDEFINED)
}

private fun align(value: String?): YogaAlign? =
  when (value) {
    "flex-start" -> YogaAlign.FLEX_START
    "flex-end" -> YogaAlign.FLEX_END
    "center" -> YogaAlign.CENTER
    "stretch" -> YogaAlign.STRETCH
    "baseline" -> YogaAlign.BASELINE
    "auto" -> YogaAlign.AUTO
    else -> null
  }

private fun edges(
  style: SpecMap,
  prefix: String,
  set: (YogaEdge, Float) -> Unit,
  percent: (YogaEdge, Float) -> Unit,
) {
  val keys =
    listOf(
      prefix to YogaEdge.ALL,
      "${prefix}Horizontal" to YogaEdge.HORIZONTAL,
      "${prefix}Vertical" to YogaEdge.VERTICAL,
      "${prefix}Top" to YogaEdge.TOP,
      "${prefix}Right" to YogaEdge.RIGHT,
      "${prefix}Bottom" to YogaEdge.BOTTOM,
      "${prefix}Left" to YogaEdge.LEFT,
    )
  for ((key, edge) in keys) {
    when (val value = style[key]) {
      is Number -> set(edge, dp(value.toFloat()))
      is String -> if (value.endsWith("%")) value.dropLast(1).toFloatOrNull()?.let { percent(edge, it) } else set(edge, YogaConstants.UNDEFINED)
      else -> set(edge, YogaConstants.UNDEFINED)
    }
  }
}

/** Positions a holder's views from its computed Yoga layout. */
internal fun applyLayout(holder: Holder) {
  val yoga = holder.yoga
  val left = yoga.layoutX.roundToInt()
  val top = yoga.layoutY.roundToInt()
  val width = yoga.layoutWidth.roundToInt()
  val height = yoga.layoutHeight.roundToInt()
  val view = holder.view
  // A scroll view sizes its content from the content's measurement, so the content goes first.
  holder.content?.let(::applyLayout)
  if (view !is BoxView) {
    view.measure(View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(height, View.MeasureSpec.EXACTLY))
  } else {
    view.setMeasuredSize(width, height)
  }
  view.layout(left, top, left + width, top + height)
  holder.children.forEach(::applyLayout)
}

/** A flexbox container: background, border, corner radius, a leading rule, and press handling. */
internal class BoxView(
  context: Context,
) : ViewGroup(context) {
  private val surface = GradientDrawable()
  private val rulePaint = Paint(Paint.ANTI_ALIAS_FLAG)
  private var leftRuleWidth = 0f
  private var radius = 0f
  private var pressedOpacity: Float? = null
  private var pressedColor: Int? = null
  private var baseColor: Int? = null
  private var baseAlpha = 1f

  init {
    setWillNotDraw(false)
    clipChildren = false
    clipToPadding = false
  }

  private var yogaWidth = -1
  private var yogaHeight = -1

  /** The size Yoga gave this box; a scroll view measuring its content gets it too. */
  fun setMeasuredSize(
    width: Int,
    height: Int,
  ) {
    yogaWidth = width
    yogaHeight = height
    setMeasuredDimension(width, height)
  }

  fun applyNode(
    node: Node,
    events: NodeEvents,
  ) {
    val style = node.style
    baseColor = style.color("backgroundColor")
    radius = style.float("borderRadius")?.let(::dp) ?: 0f
    val borderWidth = style.float("borderWidth")?.let(::dp) ?: 0f
    val borderColor = style.color("borderColor")
    surface.cornerRadius = radius
    surface.setColor(baseColor ?: 0)
    if (borderWidth > 0f && borderColor != null) surface.setStroke(borderWidth.roundToInt().coerceAtLeast(1), borderColor) else surface.setStroke(0, 0)
    background = if (baseColor != null || (borderWidth > 0f && borderColor != null)) surface else null
    leftRuleWidth = style.float("borderLeftWidth")?.let(::dp) ?: 0f
    rulePaint.color = style.color("borderLeftColor") ?: borderColor ?: 0
    val clip = style.string("overflow") == "hidden"
    clipToOutline = clip && radius > 0f
    outlineProvider =
      if (clip && radius > 0f) {
        object : ViewOutlineProvider() {
          override fun getOutline(
            view: View,
            outline: Outline,
          ) = outline.setRoundRect(0, 0, view.width, view.height, radius)
        }
      } else {
        ViewOutlineProvider.BACKGROUND
      }
    clipChildren = clip
    baseAlpha = style.float("opacity") ?: 1f
    pressedOpacity = node.raw.float("pressedOpacity")
    pressedColor = node.raw.color("pressedBackgroundColor")
    val action = node.action
    val disabled = node.raw.bool("disabled") ?: false
    if (action != null) {
      val payload = node.raw.map("payload")
      setOnClickListener { events.onNodeAction(action, node.id, payload) }
      isClickable = true
      isEnabled = !disabled
    } else {
      setOnClickListener(null)
      isClickable = false
    }
    val longAction = node.raw.string("longAction")
    if (longAction != null) {
      setOnLongClickListener {
        events.onNodeAction(longAction, node.id, node.raw.map("payload"))
        true
      }
    } else {
      setOnLongClickListener(null)
      isLongClickable = false
    }
  }

  override fun drawableStateChanged() {
    super.drawableStateChanged()
    if (!isClickable) return
    pressedOpacity?.let { alpha = if (isPressed) it * baseAlpha else baseAlpha }
    pressedColor?.let { surface.setColor(if (isPressed) it else baseColor ?: 0) }
  }

  override fun onMeasure(
    widthMeasureSpec: Int,
    heightMeasureSpec: Int,
  ) {
    if (yogaWidth >= 0) {
      setMeasuredDimension(yogaWidth, yogaHeight)
    } else {
      setMeasuredDimension(MeasureSpec.getSize(widthMeasureSpec), MeasureSpec.getSize(heightMeasureSpec))
    }
  }

  // A reordered child is removed and added again, which throws while it is transitioning: see
  // `TimelineRecyclerView.startViewTransition`.
  override fun startViewTransition(view: View) = Unit

  override fun endViewTransition(view: View) = Unit

  // Children are positioned from Yoga by the row.
  override fun onLayout(
    changed: Boolean,
    l: Int,
    t: Int,
    r: Int,
    b: Int,
  ) = Unit

  override fun onDraw(canvas: Canvas) {
    super.onDraw(canvas)
    if (leftRuleWidth > 0f) canvas.drawRect(0f, 0f, leftRuleWidth, height.toFloat(), rulePaint)
  }
}

private class FixedLineHeight(
  private val height: Int,
) : LineHeightSpan {
  override fun chooseHeight(
    text: CharSequence,
    start: Int,
    end: Int,
    spanstartv: Int,
    lineHeight: Int,
    fm: Paint.FontMetricsInt,
  ) {
    val extra = height - (fm.descent - fm.ascent)
    fm.ascent -= ceil(extra / 2f).toInt()
    fm.descent += floor(extra / 2f).toInt()
    fm.top = fm.ascent
    fm.bottom = fm.descent
  }
}

private class TypefaceSpan(
  private val typeface: Typeface,
) : MetricAffectingSpan() {
  override fun updateDrawState(paint: TextPaint) {
    paint.typeface = typeface
  }

  override fun updateMeasureState(paint: TextPaint) {
    paint.typeface = typeface
  }
}

private fun fontWeight(value: Any?): Int =
  when (value) {
    is String -> if (value == "bold") 700 else value.toIntOrNull() ?: -1
    is Number -> value.toInt()
    else -> -1
  }

/** Plain or multi-run text with React Native's line-height and font resolution. */
internal class NodeTextView(
  context: Context,
) : TextView(context) {
  init {
    includeFontPadding = false
    setPadding(0, 0, 0, 0)
    gravity = Gravity.TOP or Gravity.START
  }

  fun applyNode(node: Node) {
    val raw = node.raw
    val text = raw.map("text") ?: emptyMap()
    val color = text.color("color") ?: currentTextColor
    val size = text.float("fontSize") ?: 15f
    setTextSize(TypedValue.COMPLEX_UNIT_SP, size)
    setTextColor(color)
    val typeface = typefaceFor(text)
    this.typeface = typeface
    letterSpacing = (text.float("letterSpacing") ?: 0f) / size
    fontFeatureSettings = if (text.list("fontVariant")?.contains("tabular-nums") == true) "tnum" else null
    gravity =
      Gravity.TOP or
      when (text.string("textAlign")) {
        "center" -> Gravity.CENTER_HORIZONTAL
        "right" -> Gravity.END
        else -> Gravity.START
      }
    val lines = raw.float("numberOfLines")?.toInt() ?: 0
    maxLines = if (lines > 0) lines else Int.MAX_VALUE
    ellipsize = if (lines > 0) TextUtils.TruncateAt.END else null
    val content = SpannableStringBuilder()
    val runs = raw.list("runs")
    if (runs != null) {
      for (entry in runs) {
        @Suppress("UNCHECKED_CAST")
        val run = entry as? Map<String, Any?> ?: continue
        val start = content.length
        content.append(run.string("text") ?: "")
        run.color("color")?.let { content.setSpan(ForegroundColorSpan(it), start, content.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE) }
        if (run.containsKey("fontWeight")) {
          val runFace = typefaceFor(text + mapOf("fontWeight" to run["fontWeight"]))
          content.setSpan(TypefaceSpan(runFace), start, content.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
        }
      }
    } else {
      content.append(raw.string("value") ?: "")
    }
    text.float("lineHeight")?.let { lineHeight ->
      content.setSpan(FixedLineHeight(sp(lineHeight).roundToInt()), 0, content.length, Spanned.SPAN_INCLUSIVE_INCLUSIVE)
    }
    val selectable = raw.bool("selectable") ?: false
    if (isTextSelectable != selectable) setTextIsSelectable(selectable)
    setText(content, BufferType.SPANNABLE)
  }

  private fun typefaceFor(text: SpecMap): Typeface =
    ReactTypefaceUtils.applyStyles(null, Typeface.NORMAL, fontWeight(text["fontWeight"]), text.string("fontFamily"), context.assets)

  // A recycled selectable TextView stops offering selection until its state is re-applied.
  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    if (isTextSelectable) {
      isEnabled = false
      isEnabled = true
    }
  }

  // A selectable TextView asks its scrolling ancestors to reveal it on focus; the timeline must not move.
  override fun requestRectangleOnScreen(
    rectangle: android.graphics.Rect,
    immediate: Boolean,
  ): Boolean = false
}

/**
 * A remote or `data:` image cropped into a rounded box; `fallbackUri` loads when the variant fails.
 * The background covers whatever the node's siblings draw beneath it (the failure glyph) until
 * both sources have failed; a tap on a failed image loads it again.
 */
internal class NodeImageView(
  context: Context,
) : SimpleDraweeView(context) {
  private var source: String? = null
  private var fallback: String? = null
  private var background: android.graphics.drawable.Drawable? = null
  private var failed = false
  private var events: NodeEvents? = null
  private var nodeId: String? = null

  init {
    ensureFresco(context)
    // As React Native's Image does: a view attached inside a row the recycler holds detached is
    // never "shown", so the platform keeps its drawable hidden and Fresco never starts the load.
    setLegacyVisibilityHandlingEnabled(true)
  }

  fun applyNode(
    node: Node,
    events: NodeEvents,
  ) {
    val raw = node.raw
    this.events = events
    nodeId = node.id
    val radius = node.style.float("borderRadius")?.let(::dp) ?: 0f
    hierarchy.roundingParams = RoundingParams.fromCornersRadius(radius)
    background = node.style.color("backgroundColor")?.let { android.graphics.drawable.ColorDrawable(it) }
    if (!failed) hierarchy.setBackgroundImage(background)
    val next = raw.string("uri") ?: return
    val nextFallback = raw.string("fallbackUri")?.takeIf { it != next }
    if (next == source && nextFallback == fallback) return
    source = next
    fallback = nextFallback
    load(next)
  }

  private fun load(uri: String) {
    failed = false
    hierarchy.setBackgroundImage(background)
    controller =
      Fresco
        .newDraweeControllerBuilder()
        .setUri(Uri.parse(uri))
        .setOldController(controller)
        .setControllerListener(
          object : BaseControllerListener<ImageInfo>() {
            override fun onFinalImageSet(
              id: String?,
              imageInfo: ImageInfo?,
              animatable: android.graphics.drawable.Animatable?,
            ) {
              // Fresco submits again when a failed view is attached anew.
              if (!failed) return
              failed = false
              hierarchy.setBackgroundImage(background)
            }

            override fun onFailure(
              id: String?,
              throwable: Throwable?,
            ) = failedLoading(uri, throwable)
          },
        ).build()
  }

  private fun failedLoading(
    uri: String,
    throwable: Throwable?,
  ) {
    val next = fallback?.takeIf { uri == source }
    if (next != null) {
      report(uri, throwable, "variant")
      load(next)
      return
    }
    // Fresco submits a failed request again whenever the row is reattached; that is not news.
    if (failed) return
    report(uri, throwable, "final")
    failed = true
    hierarchy.setBackgroundImage(null)
  }

  /** The scheme, host, HTTP status, and error class only: URLs can be presigned, `data:` URIs are the image. */
  private fun report(
    uri: String,
    throwable: Throwable?,
    stage: String,
  ) {
    val parsed = Uri.parse(uri)
    val status = throwable?.message?.let { Regex("""\bcode=(\d{3})\b""").find(it)?.groupValues?.get(1)?.toIntOrNull() }
    events?.onNodeAction(
      "imageError",
      nodeId,
      mapOf(
        "stage" to stage,
        "scheme" to parsed.scheme,
        "host" to parsed.host,
        "status" to status,
        "error" to throwable?.javaClass?.simpleName,
      ),
    )
  }

  private var ownsGesture = false
  private var downX = 0f
  private var downY = 0f

  /**
   * A tap on a failed thumbnail loads it again and still opens the viewer through the pressable
   * parent. A gesture that starts on a failed image stays this view's to the end, even if a load
   * lands meanwhile. Scrolls are taken by the lists, which cancel the gesture before it ends here.
   */
  override fun onTouchEvent(event: android.view.MotionEvent): Boolean {
    if (event.actionMasked == android.view.MotionEvent.ACTION_DOWN) ownsGesture = failed
    if (!ownsGesture) return super.onTouchEvent(event)
    val pressable = parent as? View
    when (event.actionMasked) {
      android.view.MotionEvent.ACTION_DOWN -> {
        downX = event.x
        downY = event.y
        pressable?.isPressed = true
      }
      android.view.MotionEvent.ACTION_UP -> {
        ownsGesture = false
        pressable?.isPressed = false
        val slop = android.view.ViewConfiguration.get(context).scaledTouchSlop
        if (kotlin.math.abs(event.x - downX) <= slop && kotlin.math.abs(event.y - downY) <= slop) {
          if (failed) source?.let(::load)
          pressable?.performClick()
        }
      }
      android.view.MotionEvent.ACTION_CANCEL -> {
        ownsGesture = false
        pressable?.isPressed = false
      }
    }
    return true
  }

  companion object {
    fun ensureFresco(context: Context) {
      if (Fresco.hasBeenInitialized()) return
      val reactContext = context as? ReactContext ?: return
      Fresco.initialize(reactContext.applicationContext, FrescoModule.getDefaultConfigBuilder(reactContext).build())
    }
  }
}
