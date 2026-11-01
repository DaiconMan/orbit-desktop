import AppKit
import WebKit

/// One borderless, click-through window per screen at desktop level (below the Finder icons),
/// on every Space, each showing the runtime page.
final class DesktopWindows: NSObject, WKNavigationDelegate {
    private var windows: [NSWindow] = []
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
        let w = NSWindow(contentRect: screen.frame, styleMask: .borderless, backing: .buffered, defer: false)
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
        // No WebRTC: STUN/ICE could otherwise bypass connect-src (docs/security.md, residual risk 2).
        // There is no public switch; use the SPI only when it exists.
        let rtc = NSSelectorFromString("_setPeerConnectionEnabled:")
        if cfg.preferences.responds(to: rtc), let imp = cfg.preferences.method(for: rtc) {
            typealias SetBool = @convention(c) (AnyObject, Selector, Bool) -> Void
            unsafeBitCast(imp, to: SetBool.self)(cfg.preferences, rtc, false)
        }
        let wv = WKWebView(frame: NSRect(origin: .zero, size: screen.frame.size), configuration: cfg)
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

    // MARK: navigation policy: only our own loopback origin (frames included), nothing else.
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        let u = action.request.url
        let ours = u?.scheme == "http" && u?.host == "127.0.0.1" && u?.port == Settings.port
        let blank = u?.scheme == "about" || u?.scheme == "data"
        decisionHandler(ours || (blank && action.targetFrame?.isMainFrame == false) ? .allow : .cancel)
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        webView.load(URLRequest(url: Settings.baseURL))
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        // server restarting: try again shortly
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak webView] in
            webView?.load(URLRequest(url: Settings.baseURL))
        }
    }
}
