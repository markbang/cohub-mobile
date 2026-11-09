package io.github.markbang.cohubmobile.glassmenu.render

import android.os.Build
import androidx.annotation.RequiresApi

/**
 * Renderers outlive the menus that drew them. A renderer compiles its runtime shaders, warms its blur and shader
 * pipelines and runs its shape field once (`warmPipelines`, `warmField`); upstream keeps one per glass trigger for
 * the app's life, while each menu here is a new view, so without the pool every open paid that again. Menus open one
 * at a time, so the pool stays small. UI thread only.
 */
@RequiresApi(Build.VERSION_CODES.TIRAMISU)
internal object GlassRendererPool {
  private const val Capacity = 2
  private val idle = ArrayDeque<GlassRenderer>()
  private var idleDensity = 0f

  fun obtain(density: Float, fieldStep: Float): GlassRenderer {
    if (density != idleDensity) idle.clear()
    return idle.removeLastOrNull() ?: GlassRenderer(density, fieldStep)
  }

  fun recycle(renderer: GlassRenderer, density: Float) {
    renderer.release()
    if (density != idleDensity) {
      idle.clear()
      idleDensity = density
    }
    if (idle.size < Capacity) idle.addLast(renderer)
  }
}
