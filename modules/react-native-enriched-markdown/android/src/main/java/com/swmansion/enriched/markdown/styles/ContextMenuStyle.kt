package com.swmansion.enriched.markdown.styles

import com.facebook.react.bridge.ReadableMap

data class ContextMenuStyle(
  val backgroundColor: Int,
  val textColor: Int,
  val iconColor: Int,
  val pressedColor: Int,
  val dividerColor: Int,
  val borderColor: Int,
  val borderWidth: Float,
  val borderRadius: Float,
  val fontSize: Float,
  val iconSize: Float,
) {
  companion object {
    fun fromReadableMap(
      map: ReadableMap,
      parser: StyleParser,
    ): ContextMenuStyle =
      ContextMenuStyle(
        backgroundColor = parser.parseColor(map, "backgroundColor"),
        textColor = parser.parseColor(map, "textColor"),
        iconColor = parser.parseColor(map, "iconColor"),
        pressedColor = parser.parseColor(map, "pressedColor"),
        dividerColor = parser.parseColor(map, "dividerColor"),
        borderColor = parser.parseColor(map, "borderColor"),
        borderWidth = parser.toPixelFromDIP(map.getDouble("borderWidth").toFloat()),
        borderRadius = parser.toPixelFromDIP(map.getDouble("borderRadius").toFloat()),
        fontSize = parser.toPixelFromSP(map.getDouble("fontSize").toFloat()),
        iconSize = parser.toPixelFromDIP(map.getDouble("iconSize").toFloat()),
      )
  }
}
