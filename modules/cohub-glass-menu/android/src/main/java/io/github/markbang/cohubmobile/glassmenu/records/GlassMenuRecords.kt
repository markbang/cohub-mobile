package io.github.markbang.cohubmobile.glassmenu.records

import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

/** A rectangle in points, in the glass view's coordinates. */
class GlassRectRecord : Record {
  @Field val x: Float = 0f
  @Field val y: Float = 0f
  @Field val width: Float = 0f
  @Field val height: Float = 0f
}

/** The capsule behind the lit row: its side inset in points and its opacities (upstream `GlassMenuContent.drawPlate`). */
class GlassPlateRecord : Record {
  @Field val inset: Float = 8f
  @Field val darkOpacity: Float = .155f
  @Field val darkShine: Float = .03f
  @Field val lightOpacity: Float = .09f
}
