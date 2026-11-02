import ExpoModulesCore

public final class ChatTimelineModule: Module {
  public func definition() -> ModuleDefinition {
    Name("CohubChatTimeline")

    View(ChatTimelineView.self) {
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
        "onRefresh"
      )

      Prop("contentInset") { (view: ChatTimelineView, value: [String: Any]) in
        view.timeline.applyContentInset(value)
      }
      Prop("viewportInset") { (view: ChatTimelineView, value: [String: Any]) in
        view.timeline.applyViewportInset(value)
      }
      Prop("thresholds") { (view: ChatTimelineView, value: [String: Any]) in
        view.timeline.applyThresholds(value)
      }
      Prop("detached") { (view: ChatTimelineView, value: Bool) in
        view.timeline.applyDetached(value)
      }
      Prop("keyboard") { (view: ChatTimelineView, value: [String: Any]) in
        view.timeline.applyKeyboard(value)
      }
      Prop("initialTarget") { (view: ChatTimelineView, value: [String: Any]?) in
        view.timeline.applyInitialTarget(value.map { $0 as [AnyHashable: Any] })
      }
      Prop("refreshEnabled") { (view: ChatTimelineView, value: Bool) in
        view.timeline.applyRefreshEnabled(value)
      }
      Prop("refreshing") { (view: ChatTimelineView, value: Bool) in
        view.timeline.applyRefreshing(value)
      }

      AsyncFunction("setRows") { (view: ChatTimelineView, keys: [String], rows: [String: Any]) in
        view.timeline.setRows(keys: keys, rows: rows)
      }.runOnQueue(.main)

      AsyncFunction("scrollToEnd") { (view: ChatTimelineView, animated: Bool) in
        view.timeline.scrollToEnd(animated: animated)
      }.runOnQueue(.main)

      AsyncFunction("scrollToKey") { (view: ChatTimelineView, key: String, options: [String: Any]) -> Bool in
        let animated = options["animated"] as? Bool ?? false
        let position = (options["viewPosition"] as? Double) ?? 0
        let offset = (options["viewOffset"] as? Double) ?? 0
        return view.timeline.scrollToRow(key: key, animated: animated, viewPosition: CGFloat(position), viewOffset: CGFloat(offset))
      }.runOnQueue(.main)

      AsyncFunction("scrollBy") { (view: ChatTimelineView, delta: Double, animated: Bool) in
        view.timeline.scrollBy(delta: CGFloat(delta), animated: animated)
      }.runOnQueue(.main)

      AsyncFunction("setFollowing") { (view: ChatTimelineView, following: Bool) in
        view.timeline.setFollowingFromJS(following)
      }.runOnQueue(.main)

      AsyncFunction("getState") { (view: ChatTimelineView) -> [String: Any] in
        return (view.timeline.currentState() as? [String: Any]) ?? [:]
      }.runOnQueue(.main)

      AsyncFunction("measureNode") { (view: ChatTimelineView, key: String, nodeId: String?) -> [String: Any]? in
        return view.timeline.measure(rowKey: key, nodeId: nodeId) as? [String: Any]
      }.runOnQueue(.main)
    }
  }
}

public final class ChatTimelineView: ExpoView {
  let timeline = CHTTimelineView()

  let onTimelineScroll = EventDispatcher()
  let onScrollPhase = EventDispatcher()
  let onFollowingChange = EventDispatcher()
  let onVisibleRows = EventDispatcher()
  let onNearEdge = EventDispatcher()
  let onRowAction = EventDispatcher()
  let onTimelineLoad = EventDispatcher()
  let onFlightEnd = EventDispatcher()
  let onKeyboardLift = EventDispatcher()
  let onRefresh = EventDispatcher()

  public required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = false
    timeline.frame = bounds
    timeline.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    addSubview(timeline)
    timeline.onEvent = { [weak self] name, payload in
      self?.dispatch(name, payload as? [String: Any] ?? [:])
    }
  }

  private func dispatch(_ name: String, _ payload: [String: Any]) {
    switch name {
    case "onTimelineScroll": onTimelineScroll(payload)
    case "onScrollPhase": onScrollPhase(payload)
    case "onFollowingChange": onFollowingChange(payload)
    case "onVisibleRows": onVisibleRows(payload)
    case "onNearEdge": onNearEdge(payload)
    case "onRowAction": onRowAction(payload)
    case "onTimelineLoad": onTimelineLoad(payload)
    case "onFlightEnd": onFlightEnd(payload)
    case "onKeyboardLift": onKeyboardLift(payload)
    case "onRefresh": onRefresh(payload)
    default: break
    }
  }
}
