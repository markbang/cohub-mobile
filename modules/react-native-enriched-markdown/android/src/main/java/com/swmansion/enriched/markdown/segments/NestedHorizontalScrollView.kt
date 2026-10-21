package com.swmansion.enriched.markdown.segments

import android.content.Context
import android.view.MotionEvent
import android.view.ViewConfiguration
import android.widget.HorizontalScrollView
import kotlin.math.abs

/**
 * cohub: not upstream. Code blocks and tables scroll inside the chat timeline and panel pager.
 *
 * Claims the drag once it has a direction and only while this view can scroll
 * that way; claiming on ACTION_DOWN would cancel the panel swipe at the edge.
 * Nested scrolling is off so leftover motion cannot drag an ancestor.
 */
internal class NestedHorizontalScrollView(context: Context) : HorizontalScrollView(context) {
  private var downX = 0f
  private var downY = 0f
  private val touchSlop = ViewConfiguration.get(context).scaledTouchSlop

  init {
    isNestedScrollingEnabled = false
  }

  override fun dispatchTouchEvent(event: MotionEvent): Boolean {
    when (event.actionMasked) {
      MotionEvent.ACTION_DOWN -> {
        downX = event.rawX
        downY = event.rawY
      }
      MotionEvent.ACTION_MOVE -> {
        val dx = event.rawX - downX
        val dy = event.rawY - downY
        if (abs(dx) > touchSlop || abs(dy) > touchSlop) {
          if (abs(dy) > abs(dx)) {
            parent?.requestDisallowInterceptTouchEvent(false)
          } else {
            val canScroll = if (dx > 0) canScrollHorizontally(-1) else canScrollHorizontally(1)
            parent?.requestDisallowInterceptTouchEvent(canScroll)
          }
        }
      }
      MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
        parent?.requestDisallowInterceptTouchEvent(false)
      }
    }
    return super.dispatchTouchEvent(event)
  }
}
