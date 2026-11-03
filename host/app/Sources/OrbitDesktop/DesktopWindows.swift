import AppKit
import WebKit

/// A non-activating panel, so a click on a clickable widget never activates the app or steals focus.
/// It becomes key only in edit mode, where the layout editor needs the keyboard (Esc / Enter / arrows).
final class DesktopWindow: NSPanel {
    var allowKey = false
    override var canBecomeKey: Bool { allowKey }
    override var canBecomeMain: Bool { false }
}

/// One click on a clickable widget must work although the wallpaper window is never key.
final class DesktopWebView: WKWebView {
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
}

/// Receives `window.webkit.messageHandlers.orbit.postMessage(...)` from the runtime page (HUD layout editor).
/// Weak proxy so the user content controller doesn't retain DesktopWindows.
private final class OrbitMessageProxy: NSObject, WKScriptMessageHandler {
    weak var target: DesktopWindows?
    init(_ t: DesktopWindows) { target = t }
    func userContentController(_ c: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.received(message)
    }
}

/// One borderless, click-through window per screen at desktop level (below the Finder icons),
/// on every Space, each showing the runtime page.
final class DesktopWindows: NSObject, WKNavigationDelegate {
    private var windows: [NSWindow] = []
    private(set) var editing = false
    /// widget runtime errors reported by the pages (latest 20, unique by message), listed by 確認事項
    private(set) var pluginErrors: [(time: Date, message: String)] = []
    var onPluginErrorsChanged: (() -> Void)?
    /// HUD editor asked to save: (layout overrides, hidden plugin ids)
    var onSaveLayout: (([String: Any], [String]) -> Void)?
    /// on-desktop editor saved: the whole message (arrangement, hidden, providers, theme, pageSeconds; all optional).
    /// Returns whether the server must restart (a provider was switched on or off).
    var onSaveArrangement: (([String: Any]) -> Bool)?
    /// the page acknowledged config warnings
    var onAckWarnings: (([String]) -> Void)?
    var onEditingChanged: ((Bool) -> Void)?
    var onRestartServer: (() -> Void)?
    /// clickable widget rects per window (CSS px = points, top-left origin), from `clickZones`
    private var zones: [ObjectIdentifier: [NSRect]] = [:]
    private var mouseTimer: Timer?
    private var rebuildWork: DispatchWorkItem?
    private(set) var isShowing = false
    private var ruleList: WKContentRuleList?
    private var rulesReady = false

    override init() {
        super.init()
        let nc = NotificationCenter.default
        nc.addObserver(self, selector: #selector(screensChanged), name: NSApplication.didChangeScreenParametersNotification, object: nil)
    }

    func show() {
        isShowing = true
        guard rulesReady else { return compileRules { [weak self] in self?.rebuild() } }
        rebuild()
    }

    /// Defence in depth on top of the frame CSP (docs/security.md, residual risk 1): the engine
    /// itself refuses every load that is not our loopback origin, for the page and all frames.
    private func compileRules(_ done: @escaping () -> Void) {
        let rules = """
        [{"trigger":{"url-filter":".*"},"action":{"type":"block"}},
         {"trigger":{"url-filter":"^http://127\\\\.0\\\\.0\\\\.1:\(Settings.port)/"},"action":{"type":"ignore-previous-rules"}},
         {"trigger":{"url-filter":"^data:"},"action":{"type":"ignore-previous-rules"}},
         {"trigger":{"url-filter":"^blob:"},"action":{"type":"ignore-previous-rules"}},
         {"trigger":{"url-filter":"^about:"},"action":{"type":"ignore-previous-rules"}}]
        """
        WKContentRuleListStore.default().compileContentRuleList(forIdentifier: "orbit-loopback-only-\(Settings.port)",
                                                                encodedContentRuleList: rules) { [weak self] list, err in
            if let err { NSLog("[orbit] content rules failed: \(err)") }
            self?.ruleList = list
            self?.rulesReady = true
            done()
        }
    }

    func hide() {
        isShowing = false
        zones = [:]
        updateMousePolling()
        windows.forEach { $0.orderOut(nil); ($0.contentView as? WKWebView)?.navigationDelegate = nil; $0.close() }
        windows = []
    }

    func reload() {
        windows.forEach { ($0.contentView as? WKWebView)?.reloadFromOrigin() }
    }

    @objc private func screensChanged() {
        guard isShowing else { return }
        rebuildWork?.cancel()  // displays often send several changes in a row
        let w = DispatchWorkItem { [weak self] in self?.rebuild() }
        rebuildWork = w
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.8, execute: w)
    }

    private func rebuild() {
        let screens = NSScreen.screens
        // Reuse windows when the screen count is unchanged (just move/resize them).
        if windows.count == screens.count {
            for (w, s) in zip(windows, screens) { w.setFrame(s.frame, display: true) }
            return
        }
        hide()
        isShowing = true
        windows = screens.map(makeWindow)
    }

    private func makeWindow(for screen: NSScreen) -> NSWindow {
        let w = DesktopWindow(contentRect: screen.frame, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        w.hidesOnDeactivate = false
        w.level = NSWindow.Level(rawValue: Int(CGWindowLevelForKey(.desktopWindow)))
        w.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle, .fullScreenNone]
        w.ignoresMouseEvents = true
        w.isOpaque = true
        w.hasShadow = false
        w.backgroundColor = .black
        w.isReleasedWhenClosed = false
        w.animationBehavior = .none

        let cfg = WKWebViewConfiguration()
        cfg.websiteDataStore = .nonPersistent()  // the runtime keeps no state; nothing to leak
        cfg.mediaTypesRequiringUserActionForPlayback = []  // video backgrounds autoplay
        cfg.suppressesIncrementalRendering = true
        if let ruleList { cfg.userContentController.add(ruleList) }
        cfg.userContentController.add(OrbitMessageProxy(self), name: "orbit")
        // No WebRTC: STUN/ICE could otherwise bypass connect-src (docs/security.md, residual risk 2).
        // There is no public switch; use the SPI only when it exists.
        let rtc = NSSelectorFromString("_setPeerConnectionEnabled:")
        if cfg.preferences.responds(to: rtc), let imp = cfg.preferences.method(for: rtc) {
            typealias SetBool = @convention(c) (AnyObject, Selector, Bool) -> Void
            unsafeBitCast(imp, to: SetBool.self)(cfg.preferences, rtc, false)
        }
        let wv = DesktopWebView(frame: NSRect(origin: .zero, size: screen.frame.size), configuration: cfg)
        wv.autoresizingMask = [.width, .height]
        wv.setValue(false, forKey: "drawsBackground")  // black window shows until the page paints
        wv.navigationDelegate = self
        wv.allowsBackForwardNavigationGestures = false
        wv.allowsMagnification = false
        if #available(macOS 13.3, *) { wv.isInspectable = Settings.devtools }
        w.contentView = wv
        w.setFrame(screen.frame, display: false)
        w.orderFront(nil)
        wv.load(URLRequest(url: Settings.baseURL))
        return w
    }

    // MARK: HUD layout editor
    /// Edit mode: windows float above other windows, take the mouse and the keyboard, and the page shows the editor.
    /// While the editor is open: a marker file (build.sh --install refuses to restart the app under it).
    static let editingMarker = Paths.hostDir.appendingPathComponent("editing")
    /// The editor's unsaved draft, so a crash or restart doesn't lose work (offered again on the next edit).
    static let draftURL = Paths.hostDir.appendingPathComponent("editor-draft.json")

    func setEditing(_ on: Bool) {
        guard on != editing else { return }
        editing = on
        if on { FileManager.default.createFile(atPath: Self.editingMarker.path, contents: Data()) }
        else { try? FileManager.default.removeItem(at: Self.editingMarker) }
        for w in windows {
            w.ignoresMouseEvents = !on
            (w as? DesktopWindow)?.allowKey = on
            w.level = on ? .floating : NSWindow.Level(rawValue: Int(CGWindowLevelForKey(.desktopWindow)))
            (w.contentView as? WKWebView)?.evaluateJavaScript("window.orbitEdit && window.orbitEdit(\(on), \(Self.insetsJSON(w.screen)))")
        }
        if on {
            NSApp.activate(ignoringOtherApps: true)
            (windows.first(where: { $0.screen == NSScreen.main }) ?? windows.first)?.makeKeyAndOrderFront(nil)
        } else {
            windows.forEach { $0.orderFront(nil) }
        }
        updateMousePolling()
        onEditingChanged?(on)
    }

    // MARK: click-through except over clickable widgets
    /// Poll the pointer (20×/s) only while not editing and some window has zones; no timer otherwise.
    private func updateMousePolling() {
        let need = !editing && zones.values.contains { !$0.isEmpty }
        if need, mouseTimer == nil {
            let t = Timer(timeInterval: 0.05, repeats: true) { [weak self] _ in self?.trackMouse() }
            t.tolerance = 0.02
            RunLoop.main.add(t, forMode: .common)
            mouseTimer = t
        } else if !need, let t = mouseTimer {
            t.invalidate()
            mouseTimer = nil
            if !editing { windows.forEach { if !$0.ignoresMouseEvents { $0.ignoresMouseEvents = true } } }
        }
        if need { trackMouse() }
    }

    private func trackMouse() {
        guard !editing else { return }
        let m = NSEvent.mouseLocation  // global screen coordinates, bottom-left origin
        for w in windows {
            let f = w.frame
            let p = NSPoint(x: m.x - f.minX, y: f.maxY - m.y)  // window content = page viewport, top-left origin
            let inside = f.contains(m) && (zones[ObjectIdentifier(w)] ?? []).contains { $0.contains(p) }
            if w.ignoresMouseEvents == inside { w.ignoresMouseEvents = !inside }
        }
    }

    private static func parseZones(_ v: Any?) -> [NSRect]? {
        guard let list = v as? [Any], list.count <= 500 else { return nil }
        var out: [NSRect] = []
        for z in list {
            guard let d = z as? [String: Any] else { return nil }
            let n = ["x", "y", "w", "h"].compactMap { (d[$0] as? NSNumber)?.doubleValue }
            guard n.count == 4, n.allSatisfy({ $0.isFinite && abs($0) < 100_000 }), n[2] > 0, n[3] > 0 else { return nil }
            out.append(NSRect(x: n[0], y: n[1], width: n[2], height: n[3]))
        }
        return out
    }

    /// Menu bar / Dock areas of the screen, so the editor's toolbar and palette stay clickable.
    static func insetsJSON(_ screen: NSScreen?) -> String {
        guard let s = screen else { return "{}" }
        let f = s.frame, v = s.visibleFrame
        return "{\"top\":\(Int(f.maxY - v.maxY)),\"bottom\":\(Int(v.minY - f.minY)),\"left\":\(Int(v.minX - f.minX)),\"right\":\(Int(f.maxX - v.maxX))}"
    }

    func received(_ message: WKScriptMessage) {
        // only the runtime page itself (main frame, our loopback origin); plugin frames are opaque-origin iframes
        let o = message.frameInfo.securityOrigin
        guard message.frameInfo.isMainFrame, o.protocol == "http", o.host == "127.0.0.1", o.port == Settings.port,
              let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
        switch type {
        case "saveLayout":
            let layout = body["layout"] as? [String: Any] ?? [:]
            let hidden = (body["hidden"] as? [Any] ?? []).compactMap { $0 as? String }
            onSaveLayout?(layout, hidden)
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { [weak self] in self?.setEditing(false) }
        case "saveArrangement":
            let restart = onSaveArrangement?(body) ?? false
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { [weak self] in
                self?.setEditing(false)
                if restart { self?.onRestartServer?() }
            }
        case "ackWarnings":
            let list = (body["warnings"] as? [Any] ?? []).compactMap { $0 as? String }
            if !list.isEmpty { onAckWarnings?(list) }
        case "clickZones":
            guard let win = message.webView?.window, windows.contains(where: { $0 === win }),
                  let rects = Self.parseZones(body["zones"]) else { return }
            zones[ObjectIdentifier(win)] = rects
            updateMousePolling()
        case "runAction":
            guard let action = body["action"] as? [String: Any] else { return }
            ClickActions.run(action)
        case "pluginError":
            if let m = body["message"] as? String {
                let msg = String(m.prefix(300))
                if !pluginErrors.contains(where: { $0.message == msg }) {
                    pluginErrors.append((Date(), msg))
                    if pluginErrors.count > 20 { pluginErrors.removeFirst(pluginErrors.count - 20) }
                    onPluginErrorsChanged?()
                }
                NSLog("[orbit] widget error: \(m)")
            }
        case "saveDraft":
            if let d = body["draft"], JSONSerialization.isValidJSONObject(d), let data = try? JSONSerialization.data(withJSONObject: d) {
                if data.count < 2_000_000 { try? data.write(to: Self.draftURL, options: .atomic) }
            } else {
                try? FileManager.default.removeItem(at: Self.draftURL)   // null = discard
            }
        case "exitEdit":
            setEditing(false)
        default: break
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        if editing {
            let ins = Self.insetsJSON(webView.window?.screen)
            webView.evaluateJavaScript("setTimeout(() => window.orbitEdit && window.orbitEdit(true, \(ins)), 1500)")
        }
    }

    // MARK: navigation policy: only our own loopback origin (frames included), nothing else.
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        let u = action.request.url
        let ours = u?.scheme == "http" && u?.host == "127.0.0.1" && u?.port == Settings.port
        let blank = u?.scheme == "about" || u?.scheme == "data"
        decisionHandler(ours || (blank && action.targetFrame?.isMainFrame == false) ? .allow : .cancel)
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        if let w = webView.window { zones[ObjectIdentifier(w)] = nil; updateMousePolling() }
        webView.load(URLRequest(url: Settings.baseURL))
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        // server restarting: try again shortly
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak webView] in
            webView?.load(URLRequest(url: Settings.baseURL))
        }
    }
}
