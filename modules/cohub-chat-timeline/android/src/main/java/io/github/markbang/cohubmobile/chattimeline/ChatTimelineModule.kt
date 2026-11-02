package io.github.markbang.cohubmobile.chattimeline

import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class ChatTimelineModule : Module() {
  override fun definition() =
    ModuleDefinition {
      Name("CohubChatTimeline")

      View(ChatTimelineView::class) {
        Events(
          "onTimelineScroll",
          "onScrollPhase",
          "onFollowingChange",
          "onVisibleRows",
          "onNearEdge",
          "onRowAction",
          "onTimelineLoad",
          "onFlightEnd",
          "onKeyboardLift",
        )

        Prop("contentInset") { view: ChatTimelineView, value: Map<String, Any?> -> view.setContentInset(value) }
        Prop("viewportInset") { view: ChatTimelineView, value: Map<String, Any?> -> view.setViewportInset(value) }
        Prop("thresholds") { view: ChatTimelineView, value: Map<String, Any?> -> view.setThresholds(value) }
        Prop("detached") { view: ChatTimelineView, value: Boolean -> view.setDetached(value) }
        Prop("keyboard") { view: ChatTimelineView, value: Map<String, Any?> -> view.setKeyboard(value) }
        Prop("initialTarget") { view: ChatTimelineView, value: Map<String, Any?>? -> view.setInitialTarget(value) }

        AsyncFunction("setRows") { view: ChatTimelineView, keys: List<String>, rows: Map<String, Map<String, Any?>> ->
          view.setRows(keys, rows)
        }.runOnQueue(Queues.MAIN)

        AsyncFunction("scrollToEnd") { view: ChatTimelineView, animated: Boolean ->
          view.scrollToEnd(animated)
        }.runOnQueue(Queues.MAIN)

        AsyncFunction("scrollToKey") { view: ChatTimelineView, key: String, options: Map<String, Any?> ->
          view.scrollToKey(key, options.bool("animated") ?: false, options.float("viewPosition") ?: 0f, options.float("viewOffset") ?: 0f)
        }.runOnQueue(Queues.MAIN)

        AsyncFunction("scrollBy") { view: ChatTimelineView, delta: Float, animated: Boolean ->
          view.scrollBy(delta, animated)
        }.runOnQueue(Queues.MAIN)

        AsyncFunction("setFollowing") { view: ChatTimelineView, following: Boolean ->
          view.setFollowingFromJs(following)
        }.runOnQueue(Queues.MAIN)

        AsyncFunction("getState") { view: ChatTimelineView ->
          view.state()
        }.runOnQueue(Queues.MAIN)

        AsyncFunction("measureNode") { view: ChatTimelineView, key: String, nodeId: String? ->
          view.measureNode(key, nodeId)
        }.runOnQueue(Queues.MAIN)
      }
    }
}
