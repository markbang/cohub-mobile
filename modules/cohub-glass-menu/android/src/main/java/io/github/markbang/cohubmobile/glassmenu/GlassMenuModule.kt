package io.github.markbang.cohubmobile.glassmenu

import android.graphics.Color
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import io.github.markbang.cohubmobile.glassmenu.records.GlassMenuConfigRecord
import io.github.markbang.cohubmobile.glassmenu.records.GlassPlateRecord
import io.github.markbang.cohubmobile.glassmenu.records.GlassRectRecord
import io.github.markbang.cohubmobile.glassmenu.records.GlassTriggerConfigRecord

class GlassMenuModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("CohubGlassMenu")

    // The glass needs RuntimeShader (Android 13). JS keeps its drawn menu below that.
    Constant("supported") { Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU }

    View(GlassMenuView::class) {
      Events("onStateChange")

      Prop("open") { view: GlassMenuView, value: Boolean? -> view.open = value ?: false }
      Prop("sourceRect") { view: GlassMenuView, value: GlassRectRecord? -> view.sourceRect = value ?: GlassRectRecord() }
      Prop("sourceTag") { view: GlassMenuView, value: Int? -> view.sourceTag = value }
      Prop("backdropTag") { view: GlassMenuView, value: Int? -> view.backdropTag = value }
      Prop("backdropColor") { view: GlassMenuView, value: Color? -> view.backdropColor = value?.toArgb() ?: Color.BLACK }
      Prop("dark") { view: GlassMenuView, value: Boolean? -> view.dark = value ?: true }
      Prop("cornerRadius") { view: GlassMenuView, value: Float? -> view.cornerRadius = value ?: 34f }
      Prop("plateTag") { view: GlassMenuView, value: Int? -> view.plateTag = value }
      Prop("plate") { view: GlassMenuView, value: GlassPlateRecord? -> view.plate = value ?: GlassPlateRecord() }
      Prop("config") { view: GlassMenuView, value: GlassMenuConfigRecord? -> view.config = value ?: GlassMenuConfigRecord() }
      Prop("triggerConfig") { view: GlassMenuView, value: GlassTriggerConfigRecord? -> view.triggerConfig = value ?: GlassTriggerConfigRecord() }

      OnViewDidUpdateProps { view: GlassMenuView -> view.sync() }
    }
  }
}
