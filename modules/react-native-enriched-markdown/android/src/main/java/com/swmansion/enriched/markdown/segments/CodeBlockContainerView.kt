package com.swmansion.enriched.markdown.segments

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.graphics.Canvas
import android.graphics.ColorFilter
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PixelFormat
import android.graphics.RectF
import android.graphics.Typeface
import android.graphics.drawable.Drawable
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.text.Layout
import android.text.SpannableString
import android.text.StaticLayout
import android.text.TextPaint
import android.text.TextUtils
import android.util.TypedValue
import android.view.GestureDetector
import android.view.MotionEvent
import android.view.View
import android.widget.FrameLayout
import android.widget.ImageView
import androidx.appcompat.widget.AppCompatImageButton
import androidx.appcompat.widget.AppCompatTextView
import com.swmansion.enriched.markdown.parser.MarkdownASTNode
import com.swmansion.enriched.markdown.spans.LineHeightSpan
import com.swmansion.enriched.markdown.styles.CodeBlockStyle
import com.swmansion.enriched.markdown.styles.StyleConfig
import com.swmansion.enriched.markdown.utils.common.CodeBlockHighlighter
import com.swmansion.enriched.markdown.utils.common.CodeBlockNode
import com.swmansion.enriched.markdown.utils.text.extensions.applyCodeBlockTextStyle
import com.swmansion.enriched.markdown.utils.text.span.SPAN_FLAGS_EXCLUSIVE_EXCLUSIVE
import com.swmansion.enriched.markdown.views.ContextMenuPopup
import com.swmansion.enriched.markdown.views.CopyGlyph
import kotlin.math.ceil

/**
 * Block segment view for fenced code blocks (see splitASTIntoSegments):
 * a fixed header bar (language name, copy button) above a horizontally
 * scrolling, non-wrapping code pane. A block without a language has no header:
 * cohub: a row holding only the copy button reads as empty, so the button floats
 * over the code instead. Syntax coloring comes from the
 * CodeBlockHighlighter seam and falls back to plain text. The box visuals
 * must stay in sync with the commonmark flavor's CodeBlockSpan.
 *
 * measureCodeBlockNodeHeight must stay in sync with the view: it builds the
 * same styled text, paint, and header metrics, so the height reported to
 * Yoga matches the laid-out height. Since lines never wrap, the height is
 * independent of the available width.
 */
class CodeBlockContainerView(
  context: Context,
  styleConfig: StyleConfig,
) : FrameLayout(context),
  BlockSegmentView {
  private val codeBlockStyle: CodeBlockStyle = styleConfig.codeBlockStyle
  private val contextMenuStyle = styleConfig.contextMenuStyle

  private val inset = contentInset(codeBlockStyle)
  private val borderW = borderPx(codeBlockStyle)
  private val horizontalPad = (inset - borderW).coerceAtLeast(0)
  private var headerH = 0

  override val segmentMarginTop: Int get() = codeBlockStyle.marginTop.toInt()
  override val segmentMarginBottom: Int get() = codeBlockStyle.marginBottom.toInt()

  // Shared, runtime-mutable block props read live at use-time (menu-open, tap);
  // the root mutates the one instance in place, so this view and any sibling
  // created later see the same current values. See DynamicBlockProps.
  var dynamicProps: DynamicBlockProps = DynamicBlockProps()

  private var code: String = ""
  private var language: String? = null
  private var fenceChar: String = "`"

  // True until the closing fence arrives: highlighting is deferred and copying
  // is disabled, while the header stays visible.
  var pending: Boolean = false
    set(value) {
      if (field == value) return
      field = value
      copyButton.isEnabled = !value
      // The reconciler can reuse an unchanged block without re-applying the
      // node, so re-derive here to pick up highlighting once the block closes.
      rebuildCodeText()
    }

  private val textView =
    AppCompatTextView(context).apply {
      includeFontPadding = false
      setLineSpacing(0f, 1f)
      breakStrategy = Layout.BREAK_STRATEGY_SIMPLE
      hyphenationFrequency = Layout.HYPHENATION_FREQUENCY_NONE
      layoutDirection = View.LAYOUT_DIRECTION_LTR
      textDirection = View.TEXT_DIRECTION_LTR
      setTextSize(TypedValue.COMPLEX_UNIT_PX, codeBlockStyle.fontSize)
      typeface = createCodePaint(codeBlockStyle, context).typeface
      setTextColor(codeBlockStyle.color)
      setOnLongClickListener { view -> showContextMenu(view) }
    }

  private val scrollView =
    NestedHorizontalScrollView(context).apply { // cohub: claims its own horizontal drag
      isHorizontalScrollBarEnabled = true
      overScrollMode = View.OVER_SCROLL_NEVER
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        horizontalScrollbarThumbDrawable =
          GradientDrawable().apply {
            setColor(secondaryColor(codeBlockStyle.color))
            cornerRadius = context.resources.displayMetrics.density * 2
          }
      }
      addView(textView, LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT))
    }

  private val languageView =
    AppCompatTextView(context).apply {
      includeFontPadding = false
      maxLines = 1
      ellipsize = TextUtils.TruncateAt.END
      setTextSize(TypedValue.COMPLEX_UNIT_PX, codeBlockStyle.fontSize * HEADER_LABEL_SCALE)
      typeface = headerTypeface
      setTextColor(codeBlockStyle.headerTextColor)
    }

  private val copyIcon =
    CopyIconDrawable(
      codeBlockStyle.headerTextColor,
      codeBlockStyle.backgroundColor,
      ceil(codeBlockStyle.fontSize * HEADER_ICON_SCALE).toInt(),
    )
  private val clearCopied = Runnable { copyIcon.copied = false }

  // contentDescription reads the shared label live so a runtime label change is
  // reflected for TalkBack without a push (mirrors the live block-menu reads).
  private val copyButton =
    object : AppCompatImageButton(context) {
      override fun getContentDescription(): CharSequence = dynamicProps.copyLabel
    }.apply {
      background = null
      scaleType = ImageView.ScaleType.CENTER
      setImageDrawable(copyIcon)
      setOnClickListener { copyCode() }
    }

  private val minCopyTarget = ceil(MIN_COPY_TARGET_DP * context.resources.displayMetrics.density).toInt()
  private val copyTarget get() = maxOf(headerH, minCopyTarget)

  private val dividerPaint =
    Paint(Paint.ANTI_ALIAS_FLAG).apply {
      color = codeBlockStyle.headerDividerColor
      strokeWidth = context.resources.displayMetrics.density
    }
  private val headerPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = codeBlockStyle.headerBackgroundColor }
  private val headerPath = Path()

  private val tapDetector =
    GestureDetector(
      context,
      object : GestureDetector.SimpleOnGestureListener() {
        override fun onDown(e: MotionEvent): Boolean = true

        override fun onSingleTapUp(e: MotionEvent): Boolean {
          if (isPointInsideCopyButton(e.x, e.y)) return false
          handleCodeBlockPress()
          return false
        }
      },
    )

  init {
    setWillNotDraw(false)
    background =
      GradientDrawable().apply {
        setColor(codeBlockStyle.backgroundColor)
        cornerRadius = codeBlockStyle.borderRadius
        if (codeBlockStyle.borderWidth > 0f) {
          setStroke(ceil(codeBlockStyle.borderWidth).toInt(), codeBlockStyle.borderColor)
        }
      }
    isLongClickable = true
    setOnLongClickListener { view -> showContextMenu(view) }
    addView(scrollView, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT))
    addView(languageView, LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT))
    addView(copyButton, LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT))
  }

  fun applyCodeBlockNode(node: MarkdownASTNode) {
    code = CodeBlockNode.extractCode(node)
    fenceChar = CodeBlockNode.fenceChar(node)

    val newLanguage = CodeBlockNode.language(node)
    if (newLanguage != language) {
      language = newLanguage
      languageView.text = CodeBlockNode.displayLanguageName(newLanguage)
    }
    applyHeaderState()

    rebuildCodeText()
  }

  private fun applyHeaderState() {
    headerH = headerHeight(codeBlockStyle, languageView.text)
    val floatsCopy = headerH == 0
    copyIcon.floating = floatsCopy
    // Room past the longest line, so its end can scroll clear of the floating button.
    textView.setPadding(horizontalPad, inset, horizontalPad + if (floatsCopy) copyTarget else 0, inset)
    requestLayout()
    invalidate()
  }

  // Highlighting is deferred while pending, applied once the block closes.
  private fun rebuildCodeText() {
    val plainCode = buildCodeText(code, codeBlockStyle)
    if (!pending) {
      CodeBlockHighlighter.highlight(plainCode, code, language, codeBlockStyle)
    }
    textView.text = plainCode
  }

  override fun onMeasure(
    widthSpec: Int,
    heightSpec: Int,
  ) {
    val measuredWidth = MeasureSpec.getSize(widthSpec)
    scrollView.measure(
      MeasureSpec.makeMeasureSpec((measuredWidth - borderW * 2).coerceAtLeast(0), MeasureSpec.EXACTLY),
      MeasureSpec.makeMeasureSpec(0, MeasureSpec.UNSPECIFIED),
    )
    copyButton.measure(
      MeasureSpec.makeMeasureSpec(copyTarget, MeasureSpec.EXACTLY),
      MeasureSpec.makeMeasureSpec(copyTarget, MeasureSpec.EXACTLY),
    )
    val labelMaxWidth = (measuredWidth - inset * 2 - copyTarget).coerceAtLeast(0)
    languageView.measure(
      MeasureSpec.makeMeasureSpec(labelMaxWidth, MeasureSpec.AT_MOST),
      MeasureSpec.makeMeasureSpec(0, MeasureSpec.UNSPECIFIED),
    )
    setMeasuredDimension(measuredWidth, headerH + scrollView.measuredHeight)
  }

  override fun onLayout(
    changed: Boolean,
    left: Int,
    top: Int,
    right: Int,
    bottom: Int,
  ) {
    val width = right - left
    val labelTop = (headerH - languageView.measuredHeight) / 2
    languageView.layout(
      inset,
      labelTop,
      inset + languageView.measuredWidth,
      labelTop + languageView.measuredHeight,
    )

    val iconWidth = copyButton.drawable?.intrinsicWidth ?: copyButton.measuredWidth
    val iconSlack = ((copyButton.measuredWidth - iconWidth) / 2).coerceAtLeast(0)
    val buttonLeft = (width - inset - copyButton.measuredWidth + iconSlack).coerceAtLeast(0)
    // A target taller than its row overhangs it: the top is clipped by this view and the bottom sits over the code.
    val buttonCenterY =
      if (headerH > 0) {
        headerH / 2
      } else {
        inset + (if (codeBlockStyle.lineHeight > 0f) codeBlockStyle.lineHeight else codeBlockStyle.fontSize).toInt() / 2
      }
    val buttonTop = buttonCenterY - copyButton.measuredHeight / 2
    copyButton.layout(
      buttonLeft,
      buttonTop,
      buttonLeft + copyButton.measuredWidth,
      buttonTop + copyButton.measuredHeight,
    )

    scrollView.layout(borderW, headerH, width - borderW, bottom - top - borderW)
  }

  // cohub: the header is a tinted band above the code, set by the codeBlock.header* tokens.
  override fun onDraw(canvas: Canvas) {
    super.onDraw(canvas)
    if (headerH == 0) return
    val borderWidth = borderW.toFloat()
    val radius = (codeBlockStyle.borderRadius - borderWidth).coerceAtLeast(0f)
    headerPath.reset()
    headerPath.addRoundRect(
      RectF(borderWidth, borderWidth, width - borderWidth, headerH.toFloat()),
      floatArrayOf(radius, radius, radius, radius, 0f, 0f, 0f, 0f),
      Path.Direction.CW,
    )
    canvas.drawPath(headerPath, headerPaint)
    val y = headerH - dividerPaint.strokeWidth / 2
    canvas.drawLine(borderWidth, y, width - borderWidth, y, dividerPaint)
  }

  override fun onDetachedFromWindow() {
    super.onDetachedFromWindow()
    removeCallbacks(clearCopied)
    copyIcon.copied = false
  }

  // Returns whether a menu was shown, so the long-press listener only consumes
  // the event when there is one (a pending block has no menu yet).
  private fun showContextMenu(anchor: View): Boolean {
    if (!dynamicProps.enableBlockContextMenu || pending) return false
    ContextMenuPopup.show(anchor, this, contextMenuStyle) {
      item(ContextMenuPopup.Icon.COPY, dynamicProps.copyLabel) { copyCode() }
      item(ContextMenuPopup.Icon.DOCUMENT, dynamicProps.copyAsMarkdownLabel) { copyFencedMarkdown() }
    }
    return true
  }

  private fun copyCode() {
    if (pending || code.isEmpty()) return
    copyToClipboard(code)
    copyIcon.copied = true
    removeCallbacks(clearCopied)
    postDelayed(clearCopied, COPIED_FEEDBACK_MS)
    dynamicProps.onCopyPress?.invoke(code, language ?: "")
  }

  private fun handleCodeBlockPress() {
    if (!dynamicProps.enableCodeBlockPress || pending) return
    dynamicProps.onCodeBlockPress?.invoke(code, language ?: "")
  }

  override fun dispatchTouchEvent(ev: MotionEvent): Boolean {
    tapDetector.onTouchEvent(ev)
    return super.dispatchTouchEvent(ev)
  }

  private fun isPointInsideCopyButton(
    x: Float,
    y: Float,
  ): Boolean = x >= copyButton.left && x < copyButton.right && y >= copyButton.top && y < copyButton.bottom

  private fun copyFencedMarkdown() {
    if (code.isEmpty()) return
    copyToClipboard(CodeBlockNode.fencedMarkdown(code, language, fenceChar))
  }

  private fun copyToClipboard(text: String) {
    val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
    clipboard.setPrimaryClip(ClipData.newPlainText("Code", text))
  }

  private class CopyIconDrawable(
    color: Int,
    backingColor: Int,
    private val size: Int,
  ) : Drawable() {
    private val paint =
      Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeWidth = size / 20f
        strokeJoin = Paint.Join.ROUND
        strokeCap = Paint.Cap.ROUND
        this.color = color
      }

    private val glyph = CopyGlyph()
    private val backingPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { this.color = backingColor }

    // Over the code the glyph needs a backing, or scrolled text would run through it.
    var floating = false
      set(value) {
        if (field == value) return
        field = value
        invalidateSelf()
      }

    var copied = false
      set(value) {
        if (field == value) return
        field = value
        invalidateSelf()
      }

    override fun draw(canvas: Canvas) {
      if (floating) {
        val pad = bounds.width() / 4f
        canvas.drawRoundRect(-pad, -pad, bounds.width() + pad, bounds.height() + pad, pad, pad, backingPaint)
      }
      if (!copied) {
        glyph.draw(canvas, bounds.width().toFloat(), paint)
        return
      }
      val u = bounds.width() / 24f
      canvas.drawLine(5 * u, 12.5f * u, 10 * u, 17.5f * u, paint)
      canvas.drawLine(10 * u, 17.5f * u, 19 * u, 7 * u, paint)
    }

    override fun getIntrinsicWidth() = size

    override fun getIntrinsicHeight() = size

    override fun setAlpha(alpha: Int) {
      paint.alpha = alpha
    }

    override fun setColorFilter(colorFilter: ColorFilter?) {
      paint.colorFilter = colorFilter
    }

    @Deprecated("Deprecated in Java")
    override fun getOpacity() = PixelFormat.TRANSLUCENT
  }

  companion object {
    private const val HEADER_LABEL_SCALE = 0.85f
    private const val MIN_COPY_TARGET_DP = 44f
    private const val COPIED_FEEDBACK_MS = 1500L

    // Drawable box for the copy glyph, as a multiple of the code font size.
    // iOS sizes the SF Symbol by point size (kENRMHeaderIconScale = 0.72) but
    // the symbol renders roughly half again as tall as its point size; this box
    // is scaled up to land the drawn glyph at the same on-screen size.
    private const val HEADER_ICON_SCALE = 1.08f

    private val headerTypeface: Typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)

    private fun secondaryColor(color: Int): Int = (color and 0x00FFFFFF) or (0x99 shl 24)

    private fun contentInset(style: CodeBlockStyle): Int = ceil(style.padding + style.borderWidth).toInt()

    private fun borderPx(style: CodeBlockStyle): Int = ceil(style.borderWidth).toInt()

    // A band of one label line plus its vertical padding; the code text view's
    // own top inset then forms the gap below the band. Height and measurement
    // both read this, so a block without a language reports no header either.
    private fun headerHeight(
      style: CodeBlockStyle,
      displayLanguage: CharSequence,
    ): Int {
      if (displayLanguage.isEmpty()) return 0
      val paint =
        TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
          textSize = style.fontSize * HEADER_LABEL_SCALE
          typeface = headerTypeface
        }
      val metrics = paint.fontMetrics
      return ceil(metrics.descent - metrics.ascent + style.headerPaddingVertical * 2).toInt()
    }

    private fun createCodePaint(
      style: CodeBlockStyle,
      context: Context,
    ): TextPaint =
      TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
        applyCodeBlockTextStyle(style, context)
      }

    private fun buildCodeText(
      code: String,
      style: CodeBlockStyle,
    ): SpannableString =
      SpannableString(code).apply {
        if (style.lineHeight > 0f && isNotEmpty()) {
          setSpan(LineHeightSpan(style.lineHeight), 0, length, SPAN_FLAGS_EXCLUSIVE_EXCLUSIVE)
        }
      }

    // Lines never wrap (the code pane scrolls horizontally), so the layout is
    // built at the text's desired width and the result is independent of the
    // available width.
    fun measureCodeBlockNodeHeight(
      node: MarkdownASTNode,
      config: StyleConfig,
      context: Context,
      @Suppress("unused") width: Float,
    ): Float {
      val style = config.codeBlockStyle
      val inset = contentInset(style)
      val headerH = headerHeight(style, CodeBlockNode.displayLanguageName(CodeBlockNode.language(node)))
      val text = buildCodeText(CodeBlockNode.extractCode(node), style)
      if (text.isEmpty()) return headerH + inset * 2f
      val paint = createCodePaint(style, context)
      val contentWidth = ceil(Layout.getDesiredWidth(text, paint)).toInt().coerceAtLeast(1)
      val layout =
        StaticLayout.Builder
          .obtain(text, 0, text.length, paint, contentWidth)
          .setIncludePad(false)
          .setLineSpacing(0f, 1f)
          .setBreakStrategy(Layout.BREAK_STRATEGY_SIMPLE)
          .setHyphenationFrequency(Layout.HYPHENATION_FREQUENCY_NONE)
          .build()
      return layout.height.toFloat() + inset * 2 + headerH
    }
  }
}
