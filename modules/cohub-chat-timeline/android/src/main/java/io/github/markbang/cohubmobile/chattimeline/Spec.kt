package io.github.markbang.cohubmobile.chattimeline

import android.view.animation.Interpolator
import android.view.animation.LinearInterpolator
import androidx.core.view.animation.PathInterpolatorCompat

internal typealias SpecMap = Map<String, Any?>

internal fun SpecMap.string(key: String): String? = this[key] as? String

internal fun SpecMap.float(key: String): Float? = (this[key] as? Number)?.toFloat()

internal fun SpecMap.bool(key: String): Boolean? = this[key] as? Boolean

@Suppress("UNCHECKED_CAST")
internal fun SpecMap.map(key: String): SpecMap? = this[key] as? Map<String, Any?>

internal fun SpecMap.list(key: String): List<Any?>? = this[key] as? List<Any?>

/** `processColor` hands over ARGB as a number that may exceed Int's range when read as a double. */
internal fun SpecMap.color(key: String): Int? = (this[key] as? Number)?.toLong()?.toInt()

/**
 * One node of a row's description. JS owns the tree: layout is React Native's flexbox (applied
 * through Yoga), so a row's design changes ship over OTA without touching this module.
 */
internal class Node(
  val raw: SpecMap,
) {
  val type: String = raw.string("type") ?: "view"
  val id: String? = raw.string("id")
  val style: SpecMap = raw.map("style") ?: emptyMap()
  val action: String? = raw.string("action")
  val animations: List<NodeAnimation> = parseAnimations(raw.list("animations"))

  @Suppress("UNCHECKED_CAST")
  val children: List<Node> = raw.list("children")?.mapNotNull { child -> (child as? Map<String, Any?>)?.let(::Node) } ?: emptyList()
}

internal class Flight(
  val nodeId: String,
  val x: Float,
  val y: Float,
  val width: Float,
  val height: Float,
  val duration: Long,
  val easing: Interpolator,
)

internal class RowSpec(
  raw: SpecMap,
) {
  val type: String = raw.string("type") ?: "row"
  val node: Node = Node(raw.map("node") ?: emptyMap())
  val appear: List<NodeAnimation> = parseAnimations(raw.list("appear"))
  val hidden: Boolean = raw.bool("hidden") ?: false

  /** Whether the reading position may hold on this row when rows are added or removed around it. */
  val anchor: Boolean = raw.bool("anchor") ?: true
  val flight: Flight? =
    raw.map("flight")?.let { flight ->
      val nodeId = flight.string("nodeId") ?: return@let null
      Flight(
        nodeId = nodeId,
        x = flight.float("x") ?: 0f,
        y = flight.float("y") ?: 0f,
        width = flight.float("width") ?: 0f,
        height = flight.float("height") ?: 0f,
        duration = (flight.float("duration") ?: 420f).toLong(),
        easing = parseEasing(flight["easing"]),
      )
    }
}

/** A keyframed loop or one-shot on one view property; JS decides when motion is reduced. */
internal class NodeAnimation(
  val property: String,
  val at: FloatArray,
  val values: FloatArray,
  val duration: Long,
  val delay: Long,
  /** 0 repeats forever. */
  val iterations: Int,
  val easing: Interpolator,
)

private fun parseAnimations(list: List<Any?>?): List<NodeAnimation> {
  if (list == null) return emptyList()
  return list.mapNotNull { entry ->
    @Suppress("UNCHECKED_CAST")
    val spec = entry as? Map<String, Any?> ?: return@mapNotNull null
    val property = spec.string("property") ?: return@mapNotNull null
    val frames = spec.list("keyframes")?.mapNotNull { frame -> frame as? Map<*, *> } ?: return@mapNotNull null
    if (frames.size < 2) return@mapNotNull null
    NodeAnimation(
      property = property,
      at = FloatArray(frames.size) { (frames[it]["at"] as? Number)?.toFloat() ?: 0f },
      values = FloatArray(frames.size) { (frames[it]["value"] as? Number)?.toFloat() ?: 0f },
      duration = (spec.float("duration") ?: 300f).toLong().coerceAtLeast(1),
      delay = (spec.float("delay") ?: 0f).toLong().coerceAtLeast(0),
      iterations = (spec.float("iterations") ?: 1f).toInt().coerceAtLeast(0),
      easing = parseEasing(spec["easing"]),
    )
  }
}

/** `linear` or a cubic-bezier as `[x1, y1, x2, y2]`, the shape `src/motion.ts` already uses. */
internal fun parseEasing(value: Any?): Interpolator {
  val points = (value as? List<*>)?.mapNotNull { (it as? Number)?.toFloat() }
  if (points != null && points.size == 4) return PathInterpolatorCompat.create(points[0], points[1], points[2], points[3])
  return LinearInterpolator()
}
