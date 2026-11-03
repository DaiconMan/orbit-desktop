import AppKit

final class AppDelegate: NSObject, NSApplicationDelegate, NSMenuDelegate {
    private let server = ServerProcess()
    private let desktop = DesktopWindows()
    private let system = SystemProvider()
    private let calendar = CalendarProvider()
    private var audioBox: AnyObject?  // AudioProvider (macOS 14.2+)
    private let eew = EEWProvider()
    private let banner = EEWBanner()
    private let notifier = EEWNotifier()
    private let settingsWindow = SettingsWindowController()
    private var eewState = EEWProvider.Snapshot(error: "starting")
    private var eewLine = NSMenuItem(title: "緊急地震速報: 起動中…", action: nil, keyEquivalent: "")
    private var statusItem: NSStatusItem!
    private var statusLine = NSMenuItem(title: "起動中…", action: nil, keyEquivalent: "")
    private var configVersion = ""
    private var configPath = ""
    private var configErrors = 0
    private var needs = Set<String>()
    private var pollTimer: Timer?

    func applicationDidFinishLaunching(_ note: Notification) {
        Paths.ensureDirs()
        AppSettings.migrateIfNeeded()
        setUpMenu()
        system.start()
        startEEW()
        server.onStateChange = { [weak self] st in self?.serverStateChanged(st) }
        desktop.onSaveLayout = { [weak self] layout, hidden in self?.saveLayout(layout, hidden: hidden) }
        desktop.onSaveArrangement = { body in
            let r = AppSettings.saveEditor(body)
            if let err = r.error { NSLog("[orbit] saving arrangement failed: \(err)"); return false }
            return r.providersChanged
        }
        desktop.onRestartServer = { [weak self] in self?.server.restart() }
        desktop.onAckWarnings = { [weak self] list in
            if let err = AppSettings.acknowledge(list) { NSLog("[orbit] saving acknowledged failed: \(err)") }
            self?.refreshReview()
        }
        desktop.onPluginErrorsChanged = { [weak self] in self?.updateReviewTitle() }
        desktop.onEditingChanged = { [weak self] on in self?.editItem.state = on ? .on : .off }
        server.start()
        // the runtime page polls the config itself; we only need it to decide which providers run
        pollTimer = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in self?.pollConfig() }
    }

    func applicationWillTerminate(_ note: Notification) {
        server.stop()
        system.stop()
        calendar.stop()
        // The tap and its aggregate device are private to this process and vanish with it;
        // tearing them down here could block quitting.
    }

    // MARK: earthquake early warning
    private func startEEW() {
        eew.onUpdate = { [weak self] s in
            guard let self else { return }
            self.eewState = s
            self.banner.update(s)
            self.refreshEEWLine()
        }
        eew.onNotify = { [weak self] title, body in self?.notifier.post(title: title, body: body) }
        settingsWindow.model.onNotifyEnabled = { [weak self] in self?.notifier.requestAuthorization() }
        eew.start()
    }

    private func refreshEEWLine() {
        let s = eewState
        if s.disabled { eewLine.title = "緊急地震速報: オフ" }
        else if s.connected { eewLine.title = "緊急地震速報: 接続中（\(s.msgs) 件受信）" }
        else { eewLine.title = "緊急地震速報: ⚠︎ 未接続 – \(s.error ?? "")" }
    }

    // MARK: server / config
    private func serverStateChanged(_ st: ServerProcess.State) {
        switch st {
        case .running:
            if !desktop.isShowing { desktop.show() } else { desktop.reload() }
            configVersion = ""
            pollConfig()
        case .failed(let why):
            NSLog("[orbit] server: \(why)")
        default: break
        }
        refreshStatus()
    }

    private func pollConfig() {
        guard server.state == .running else { return }
        OrbitAPI.get("/api/config/version") { [weak self] obj in
            guard let self, let v = (obj as? [String: Any])?["version"] as? String, v != self.configVersion else { return }
            OrbitAPI.get("/api/config") { obj in
                guard let cfg = obj as? [String: Any] else { return }
                self.configVersion = (cfg["version"] as? String) ?? v
                self.apply(config: cfg)
            }
        }
    }

    /// Start only the providers the active layout asks for, so nobody gets a calendar or
    /// audio-capture prompt for a widget they don't use.
    private func apply(config cfg: [String: Any]) {
        var n = Set<String>()
        if let bg = cfg["background"] as? [String: Any] {
            (bg["needs"] as? [String])?.forEach { n.insert($0) }
            if let react = bg["react"] as? [String: Any], react.keys.contains(where: { $0.hasPrefix("audio.") }) { n.insert("audio") }
        }
        for w in (cfg["widgets"] as? [[String: Any]]) ?? [] { (w["needs"] as? [String])?.forEach { n.insert($0) } }
        needs = n
        configPath = (cfg["configPath"] as? String) ?? ""
        configErrors = (cfg["errors"] as? [Any])?.count ?? 0
        review = Review(cfg)
        updateReviewTitle()

        if n.contains("calendar") { calendar.start() } else { calendar.stop() }
        if #available(macOS 14.2, *) {
            if n.contains("audio") {
                let a = (audioBox as? AudioProvider) ?? AudioProvider()
                audioBox = a
                a.start()
            } else {
                (audioBox as? AudioProvider)?.stop()
            }
        }
        refreshStatus()
    }

    // MARK: menu
    private func setUpMenu() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        if let b = statusItem.button {
            b.image = NSImage(systemSymbolName: "sparkles", accessibilityDescription: "Orbit Desktop")
            b.image?.isTemplate = true
        }
        let m = NSMenu()
        m.delegate = self
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "dev"
        m.addItem(withTitle: "Orbit Desktop \(version)", action: nil, keyEquivalent: "").isEnabled = false
        statusLine.isEnabled = false
        m.addItem(statusLine)
        eewLine.isEnabled = false
        m.addItem(eewLine)
        m.addItem(.separator())
        // everyday actions are GUI-only; editing files lives under 詳細
        editItem = item("レイアウトを編集…", #selector(toggleEditLayout), "e")
        m.addItem(editItem)
        m.addItem(item("設定…", #selector(openSettings), ","))
        m.addItem(reviewItem)
        m.addItem(item("壁紙を再読み込み", #selector(reload), "r"))
        m.addItem(item("緊急地震速報のテスト表示", #selector(testEEW), ""))
        m.addItem(.separator())
        let adv = NSMenu()
        for (t, sel) in [("layout.yaml をテキストで編集…", #selector(editLayout)),
                         ("ブラウザでプレビュー", #selector(openPreview)), ("サーバのログを表示", #selector(showLog)),
                         ("サーバを再起動", #selector(restartServer))] {
            adv.addItem(item(t, sel, ""))
        }
        let advItem = NSMenuItem(title: "詳細", action: nil, keyEquivalent: "")
        advItem.submenu = adv
        m.addItem(advItem)
        m.addItem(item("ログイン時に起動", #selector(toggleLogin), ""))
        m.addItem(.separator())
        m.addItem(item("Orbit Desktop を終了", #selector(quit), "q"))
        statusItem.menu = m
    }

    private func item(_ title: String, _ sel: Selector, _ key: String) -> NSMenuItem {
        let i = NSMenuItem(title: title, action: sel, keyEquivalent: key)
        i.target = self
        return i
    }

    func menuWillOpen(_ menu: NSMenu) {
        refreshStatus()
        refreshEEWLine()
        updateReviewTitle()
        refreshReview()
        menu.items.first { $0.action == #selector(toggleLogin) }?.state = LoginItem.isEnabled ? .on : .off
    }

    private func refreshStatus() {
        var s: String
        switch server.state {
        case .stopped: s = "サーバ停止中"
        case .starting: s = "サーバ起動中…"
        case .running: s = "動作中（127.0.0.1:\(Settings.port)）"
        case .failed(let why): s = "⚠︎ " + why
        }
        if server.state == .running {
            if configErrors > 0 { s += " · \(configErrors) config problem\(configErrors == 1 ? "" : "s")" }
            if calendar.denied { s += " · calendar access denied" }
            if #available(macOS 14.2, *), let a = audioBox as? AudioProvider, needs.contains("audio"), !a.running { s += " · audio tap off" }
        }
        statusLine.title = s
    }

    @objc private func reload() { desktop.reload() }

    @objc private func openSettings() { settingsWindow.show() }

    /// Same test message as the prototype's menu: injected by EEWProvider (local, so dry-run music pause).
    @objc private func testEEW() {
        let p = EEWProvider.testFile
        let j = #"{"code":556,"_pause":false,"issue":{"eventId":"TEST-MENU-\#(Int(Date().timeIntervalSince1970))","serial":"1"},"earthquake":{"originTime":"","hypocenter":{"name":"東京湾","depth":40,"magnitude":6.1}},"cancelled":false,"areas":[{"pref":"東京都","name":"東京都23区","scaleFrom":50,"scaleTo":55,"kindCode":"10"}]}"#
        try? FileManager.default.createDirectory(at: p.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? j.data(using: .utf8)?.write(to: p, options: .atomic)
        DispatchQueue.main.asyncAfter(deadline: .now() + 20) { try? FileManager.default.removeItem(at: p) }
    }

    private var editItem: NSMenuItem!

    @objc private func toggleEditLayout() { desktop.setEditing(!desktop.editing) }

    /// HUD editor saved: overrides go to settings.json `layout`, hidden modules to `wallpaper.hidden`.
    private func saveLayout(_ layout: [String: Any], hidden: [String]) {
        var raw = AppSettings.readRaw()
        raw["layout"] = layout
        var wp = raw["wallpaper"] as? [String: Any] ?? [:]
        wp["hidden"] = hidden
        raw["wallpaper"] = wp
        if let err = AppSettings.writeRaw(raw) { NSLog("[orbit] saving layout failed: \(err)") }
    }

    // MARK: 確認事項 (config errors, warnings, widget errors)
    private struct Review {
        var errors: [String] = [], warnings: [String] = [], ack: Set<String> = []
        init() {}
        init(_ cfg: [String: Any]) {
            errors = (cfg["errors"] as? [Any] ?? []).compactMap { $0 as? String }
            warnings = (cfg["warnings"] as? [Any] ?? []).compactMap { $0 as? String }
            ack = Set((cfg["ackWarnings"] as? [Any] ?? []).compactMap { $0 as? String })
        }
    }
    private var review = Review()
    private lazy var reviewItem = item("確認事項…", #selector(showReview), "")

    /// errors + warnings not yet acknowledged + widget errors not yet acknowledged
    private var reviewCount: Int {
        review.errors.count + review.warnings.filter { !review.ack.contains($0) }.count
            + desktop.pluginErrors.filter { !review.ack.contains($0.message) }.count
    }

    private func updateReviewTitle() {
        let n = reviewCount
        reviewItem.title = n > 0 ? "確認事項（\(n)）…" : "確認事項…"
    }

    private func refreshReview(_ done: (() -> Void)? = nil) {
        guard server.state == .running else { done?(); return }
        OrbitAPI.get("/api/config") { [weak self] obj in
            guard let self else { return }
            if let cfg = obj as? [String: Any] { self.review = Review(cfg); self.updateReviewTitle() }
            done?()
        }
    }

    /// Config warnings (e.g. personal / unofficial providers enabled) are listed here instead of on the desktop.
    @objc private func showReview() {
        refreshReview { [weak self] in
            guard let self else { return }
            let r = self.review
            let fmt = DateFormatter()
            fmt.timeStyle = .short
            fmt.dateStyle = .none
            let plugin = self.desktop.pluginErrors
            var lines = r.errors.map { "⚠︎ " + $0 }
            lines += r.warnings.map { (r.ack.contains($0) ? "✓ " : "・") + $0 }
            lines += plugin.map { (r.ack.contains($0.message) ? "✓ " : "・") + "ウィジェットのエラー（\(fmt.string(from: $0.time))）: " + $0.message }
            let a = NSAlert()
            a.messageText = lines.isEmpty ? "確認事項はありません" : "確認事項"
            a.informativeText = lines.isEmpty ? "" : lines.joined(separator: "\n\n") + (r.ack.isEmpty ? "" : "\n\n✓ = 確認済み")
            if !r.warnings.isEmpty || !plugin.isEmpty { a.addButton(withTitle: "確認済みにする") }
            a.addButton(withTitle: "閉じる")
            NSApp.activate(ignoringOtherApps: true)
            guard a.runModal() == .alertFirstButtonReturn, !r.warnings.isEmpty || !plugin.isEmpty else { return }
            if let err = AppSettings.acknowledge(r.warnings + plugin.map(\.message)) {
                NSLog("[orbit] saving acknowledged failed: \(err)")
                return NSSound.beep()
            }
            // the server re-reads settings.json on its own; give it a moment, then reload
            DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
                self.desktop.reload()
                self.refreshReview()
            }
        }
    }

    @objc private func editLayout() {
        let fm = FileManager.default
        if !fm.fileExists(atPath: Paths.userConfig.path) {
            // first edit: start the user's own copy from the example, then make the server use it
            try? fm.createDirectory(at: Paths.userConfigDir, withIntermediateDirectories: true)
            try? fm.copyItem(at: Paths.exampleConfig, to: Paths.userConfig)
            server.restart()
        }
        openInTextEditor(Paths.userConfig)
    }

    /// Open a text file in a text editor, not in an IDE that happens to own the extension (Xcode claims .yaml).
    /// Order: `defaults write io.github.daiconman.orbit-desktop editor <bundle id or app path>`, the default app
    /// for the file unless it is Xcode, a known editor that is installed, then TextEdit.
    private func openInTextEditor(_ file: URL) {
        let ws = NSWorkspace.shared
        var candidates: [URL] = []
        if let pref = UserDefaults.standard.string(forKey: "editor") {
            if pref.hasPrefix("/") { candidates.append(URL(fileURLWithPath: pref)) }
            else if let u = ws.urlForApplication(withBundleIdentifier: pref) { candidates.append(u) }
        }
        if let def = ws.urlForApplication(toOpen: file), Bundle(url: def)?.bundleIdentifier != "com.apple.dt.Xcode" {
            candidates.append(def)
        }
        for id in ["com.microsoft.VSCode", "com.todesktop.230313mzl4w4u92", "dev.zed.Zed", "com.sublimetext.4",
                   "com.barebones.bbedit", "com.coteditor.CotEditor", "com.apple.TextEdit"] {
            if let u = ws.urlForApplication(withBundleIdentifier: id) { candidates.append(u) }
        }
        guard let app = candidates.first else { ws.open(file); return }
        ws.open([file], withApplicationAt: app, configuration: NSWorkspace.OpenConfiguration())
    }

    @objc private func openPreview() {
        NSWorkspace.shared.open(URL(string: "?demo", relativeTo: Settings.baseURL)!)
    }

    @objc private func showLog() { NSWorkspace.shared.open(Paths.serverLog) }

    @objc private func restartServer() { server.restart() }

    @objc private func toggleLogin() { LoginItem.set(!LoginItem.isEnabled) }

    @objc private func quit() { NSApp.terminate(nil) }
}
