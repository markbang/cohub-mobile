package com.swmansion.enriched.markdown.views

import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.ColorFilter
import android.graphics.Outline
import android.graphics.Paint
import android.graphics.PixelFormat
import android.graphics.RectF
import android.graphics.drawable.ColorDrawable
import android.graphics.drawable.Drawable
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.View.MeasureSpec
import android.view.ViewGroup
import android.view.ViewOutlineProvider
import android.view.animation.DecelerateInterpolator
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.PopupWindow
import android.widget.TextView
import com.swmansion.enriched.markdown.styles.ContextMenuStyle
import kotlin.math.ceil
import kotlin.math.roundToInt

// cohub: colors, radius, and sizes come from markdownStyle.contextMenu.
object ContextMenuPopup {
  private const val ENTER_SCALE = 0.96f
  private const val ENTER_DURATION_MS = 140L

  private var activePopup: PopupWindow? = null

  fun dismiss() {
    activePopup?.dismiss()
  }

  enum class Icon { COPY, DOCUMENT }

  class Builder internal constructor() {
    internal val items = mutableListOf<MenuItem>()

    fun item(
      icon: Icon,
      label: String,
      onClick: () -> Unit,
    ) {
      items.add(MenuItem(icon, label, onClick))
    }
  }

  internal data class MenuItem(
    val icon: Icon,
    val label: String,
    val onClick: () -> Unit,
  )

  private var density = 1f
  private val Float.dp get() = (this * density).roundToInt()

  fun show(
    anchor: View,
    parent: View,
    style: ContextMenuStyle,
    block: Builder.() -> Unit,
  ) {
    activePopup?.dismiss()

    val context = anchor.context
    density = context.resources.displayMetrics.density
    val builder = Builder().apply(block)
    if (builder.items.isEmpty()) return

    val container =
      LinearLayout(context).apply {
        orientation = LinearLayout.VERTICAL
        // Clips the row ripples; the window background below paints the surface and casts the shadow.
        outlineProvider =
          object : ViewOutlineProvider() {
            override fun getOutline(
              view: View,
              outline: Outline,
            ) {
              outline.setRoundRect(0, 0, view.width, view.height, style.borderRadius)
            }
          }
        clipToOutline = true
      }

    builder.items.forEachIndexed { index, item ->
      if (index > 0 && Color.alpha(style.dividerColor) > 0) container.addView(createDivider(context, style))
      container.addView(createMenuItemView(context, item, style))
    }

    val metrics = context.resources.displayMetrics
    val margin = 8f.dp
    container.measure(
      MeasureSpec.makeMeasureSpec(metrics.widthPixels - margin * 2, MeasureSpec.AT_MOST),
      MeasureSpec.makeMeasureSpec(0, MeasureSpec.UNSPECIFIED),
    )
    val menuWidth = container.measuredWidth
    val menuHeight = container.measuredHeight

    // An explicit size keeps the window on the measured content, which the position below relies on.
    val popup =
      PopupWindow(container, menuWidth, menuHeight, true).apply {
        elevation = 12f.dp.toFloat()
        isOutsideTouchable = true
        animationStyle = 0
        setBackgroundDrawable(
          GradientDrawable().apply {
            setColor(style.backgroundColor)
            cornerRadius = style.borderRadius
            if (style.borderWidth > 0f) setStroke(ceil(style.borderWidth).toInt(), style.borderColor)
          },
        )
        setOnDismissListener {
          activePopup = null
        }
      }

    val location = IntArray(2).also { anchor.getLocationOnScreen(it) }
    val centerX = location[0] + anchor.width / 2
    val x = (centerX - menuWidth / 2).coerceIn(margin, metrics.widthPixels - menuWidth - margin)

    val above = location[1] - menuHeight - margin
    val below = location[1] + anchor.height + margin
    val opensAbove = above >= margin
    val y =
      when {
        opensAbove -> above
        below + menuHeight <= metrics.heightPixels - margin -> below
        // The anchor fills the screen, as a long code block can.
        else -> ((metrics.heightPixels - menuHeight) / 2).coerceAtLeast(margin)
      }

    activePopup = popup
    popup.showAtLocation(parent, Gravity.NO_GRAVITY, x, y)

    // The root holds the window background, so the surface and its shadow scale with the rows.
    val root = container.rootView
    root.pivotX = (centerX - x).toFloat().coerceIn(0f, menuWidth.toFloat())
    root.pivotY = if (opensAbove) menuHeight.toFloat() else 0f
    root.alpha = 0f
    root.scaleX = ENTER_SCALE
    root.scaleY = ENTER_SCALE
    root
      .animate()
      .alpha(1f)
      .scaleX(1f)
      .scaleY(1f)
      .setDuration(ENTER_DURATION_MS)
      .setInterpolator(DecelerateInterpolator())
      .start()
  }

  private fun createMenuItemView(
    context: Context,
    item: MenuItem,
    style: ContextMenuStyle,
  ) = LinearLayout(context).apply {
    orientation = LinearLayout.HORIZONTAL
    gravity = Gravity.CENTER_VERTICAL
    setPadding(16f.dp, 0, 16f.dp, 0)
    minimumHeight = 48f.dp
    isClickable = true
    isFocusable = true
    background = RippleDrawable(ColorStateList.valueOf(style.pressedColor), null, ColorDrawable(Color.WHITE))

    val iconSize = ceil(style.iconSize).toInt()
    addView(
      ImageView(context).apply {
        setImageDrawable(createIconDrawable(item.icon, style.iconColor))
      },
      LinearLayout.LayoutParams(iconSize, iconSize),
    )

    addView(
      TextView(context).apply {
        text = item.label
        setTextSize(TypedValue.COMPLEX_UNIT_PX, style.fontSize)
        setTextColor(style.textColor)
      },
      LinearLayout
        .LayoutParams(
          ViewGroup.LayoutParams.WRAP_CONTENT,
          ViewGroup.LayoutParams.WRAP_CONTENT,
        ).apply { marginStart = 12f.dp },
    )

    setOnClickListener {
      item.onClick()
      dismiss()
    }
  }

  private fun createDivider(
    context: Context,
    style: ContextMenuStyle,
  ) = View(context).apply {
    setBackgroundColor(style.dividerColor)
    layoutParams =
      LinearLayout
        .LayoutParams(
          ViewGroup.LayoutParams.MATCH_PARENT,
          1f.dp.coerceAtLeast(1),
        ).apply {
          setMargins(16f.dp, 0, 16f.dp, 0)
        }
  }

  private fun createIconDrawable(
    icon: Icon,
    iconColor: Int,
  ): Drawable =
    object : Drawable() {
      private val paint =
        Paint(Paint.ANTI_ALIAS_FLAG).apply {
          style = Paint.Style.STROKE
          strokeWidth = 1.5f * density
          strokeJoin = Paint.Join.ROUND
          strokeCap = Paint.Cap.ROUND
          color = iconColor
        }

      private val copyGlyph = CopyGlyph()

      // COPY mirrors SF Symbol doc.on.doc, DOCUMENT mirrors doc.text; the copy
      // glyph is shared with the header button in CodeBlockContainerView.
      override fun draw(canvas: Canvas) {
        val u = bounds.width() / 24f
        if (icon == Icon.COPY) {
          copyGlyph.draw(canvas, bounds.width().toFloat(), paint)
        } else {
          canvas.drawRoundRect(RectF(5 * u, 3 * u, 19 * u, 21 * u), 2.5f * u, 2.5f * u, paint)
          canvas.drawLine(8.5f * u, 9 * u, 15.5f * u, 9 * u, paint)
          canvas.drawLine(8.5f * u, 12.5f * u, 15.5f * u, 12.5f * u, paint)
          canvas.drawLine(8.5f * u, 16 * u, 13 * u, 16 * u, paint)
        }
      }

      override fun getIntrinsicWidth() = 24f.dp

      override fun getIntrinsicHeight() = 24f.dp

      override fun setAlpha(alpha: Int) {
        paint.alpha = alpha
      }

      override fun setColorFilter(colorFilter: ColorFilter?) {
        paint.colorFilter = colorFilter
      }

      @Deprecated("Deprecated in Java")
      override fun getOpacity() = PixelFormat.TRANSLUCENT
    }
}
