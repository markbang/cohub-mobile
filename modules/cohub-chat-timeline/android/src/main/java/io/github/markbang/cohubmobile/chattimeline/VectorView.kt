package io.github.markbang.cohubmobile.chattimeline

import android.content.Context
import android.graphics.Canvas
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Path
import android.view.View
import androidx.core.graphics.PathParser

private class VectorPath(
  val path: Path,
  val fill: Int?,
  val stroke: Int?,
  val strokeWidth: Float,
  val cap: Paint.Cap,
  val join: Paint.Join,
)

/**
 * SVG paths in a view box, scaled to the view. JS sends Lucide icons and the mascot as path data,
 * so a new glyph is a JS change. `absoluteStrokeWidth` keeps a stroke in points at any size, as
 * Lucide's prop of the same name does.
 */
internal class VectorView(
  context: Context,
) : View(context) {
  private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
  private val matrix = Matrix()
  private var paths: List<VectorPath> = emptyList()
  private var viewBox = floatArrayOf(0f, 0f, 24f, 24f)
  private var absoluteStroke = false
  private var signature: Any? = null

  init {
    importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO
  }

  fun apply(node: Node) {
    val raw = node.raw
    if (signature == raw) return
    signature = raw
    viewBox = raw.list("viewBox")?.mapNotNull { (it as? Number)?.toFloat() }?.takeIf { it.size == 4 }?.toFloatArray() ?: floatArrayOf(0f, 0f, 24f, 24f)
    absoluteStroke = raw.bool("absoluteStrokeWidth") ?: false
    val defaultStroke = raw.color("stroke")
    val defaultFill = raw.color("fill")
    val defaultWidth = raw.float("strokeWidth") ?: 2f
    paths =
      raw.list("paths").orEmpty().mapNotNull { entry ->
        @Suppress("UNCHECKED_CAST")
        val spec = entry as? Map<String, Any?> ?: return@mapNotNull null
        val data = spec.string("d") ?: return@mapNotNull null
        val path = runCatching { PathParser.createPathFromPathData(data) }.getOrNull() ?: return@mapNotNull null
        VectorPath(
          path = path,
          fill = if (spec.containsKey("fill")) spec.color("fill") else defaultFill,
          stroke = if (spec.containsKey("stroke")) spec.color("stroke") else defaultStroke,
          strokeWidth = spec.float("strokeWidth") ?: defaultWidth,
          cap = if ((spec.string("strokeLinecap") ?: raw.string("strokeLinecap")) == "butt") Paint.Cap.BUTT else Paint.Cap.ROUND,
          join = if ((spec.string("strokeLinejoin") ?: raw.string("strokeLinejoin")) == "miter") Paint.Join.MITER else Paint.Join.ROUND,
        )
      }
    invalidate()
  }

  override fun onDraw(canvas: Canvas) {
    if (paths.isEmpty() || width == 0 || height == 0) return
    val scale = minOf(width / viewBox[2], height / viewBox[3])
    val dx = (width - viewBox[2] * scale) / 2f - viewBox[0] * scale
    val dy = (height - viewBox[3] * scale) / 2f - viewBox[1] * scale
    matrix.setScale(scale, scale)
    matrix.postTranslate(dx, dy)
    canvas.save()
    canvas.concat(matrix)
    val density = resources.displayMetrics.density
    for (vector in paths) {
      vector.fill?.let {
        paint.style = Paint.Style.FILL
        paint.color = it
        canvas.drawPath(vector.path, paint)
      }
      vector.stroke?.let {
        paint.style = Paint.Style.STROKE
        paint.color = it
        paint.strokeCap = vector.cap
        paint.strokeJoin = vector.join
        // Path space is the view box; an absolute width is in points, so undo the box scale.
        paint.strokeWidth = if (absoluteStroke) vector.strokeWidth * density / scale else vector.strokeWidth
        canvas.drawPath(vector.path, paint)
      }
    }
    canvas.restore()
  }
}
