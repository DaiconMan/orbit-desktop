import AppKit
import ServiceManagement

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
    private var statusLine = NSMenuItem(title: "Starting…", action: nil, keyEquivalent: "")
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
        settingsWindow.model.onSaved = { [weak self] in
            // the server re-reads settings.json (wallpaper.hidden / page_seconds) on its own
            DispatchQueue.main.asyncAfter(deadline: .now() + 1) { self?.desktop.reload() }
        }
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
        m.addItem(item("Reload Wallpaper", #selector(reload), "r"))
        m.addItem(item("壁紙の設定…", #selector(openSettings), ","))
        m.addItem(item("Edit layout.yaml…", #selector(editLayout), ""))
        m.addItem(item("Open Preview in Browser", #selector(openPreview), ""))
        m.addItem(item("緊急地震速報のテスト表示", #selector(testEEW), ""))
        m.addItem(.separator())
        m.addItem(item("Show Server Log", #selector(showLog), ""))
        m.addItem(item("Restart Server", #selector(restartServer), ""))
        m.addItem(item("Start at Login", #selector(toggleLogin), ""))
        m.addItem(.separator())
        m.addItem(item("Quit Orbit Desktop", #selector(quit), "q"))
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
        menu.items.first { $0.action == #selector(toggleLogin) }?.state = SMAppService.mainApp.status == .enabled ? .on : .off
    }

    private func refreshStatus() {
        var s: String
        switch server.state {
        case .stopped: s = "Server stopped"
        case .starting: s = "Starting server…"
        case .running: s = "Running on 127.0.0.1:\(Settings.port)"
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

    @objc private func editLayout() {
        let fm = FileManager.default
        if !fm.fileExists(atPath: Paths.userConfig.path) {
            // first edit: start the user's own copy from the example, then make the server use it
            try? fm.createDirectory(at: Paths.userConfigDir, withIntermediateDirectories: true)
            try? fm.copyItem(at: Paths.exampleConfig, to: Paths.userConfig)
            server.restart()
        }
        NSWorkspace.shared.open(Paths.userConfig)
    }

    @objc private func openPreview() {
        NSWorkspace.shared.open(URL(string: "?demo", relativeTo: Settings.baseURL)!)
    }

    @objc private func showLog() { NSWorkspace.shared.open(Paths.serverLog) }

    @objc private func restartServer() { server.restart() }

    @objc private func toggleLogin() {
        let svc = SMAppService.mainApp
        do {
            if svc.status == .enabled { try svc.unregister() } else { try svc.register() }
        } catch {
            let a = NSAlert()
            a.messageText = "Could not change the login item"
            a.informativeText = "\(error.localizedDescription)\nMove Orbit Desktop.app to /Applications and try again."
            a.runModal()
        }
    }

    @objc private func quit() { NSApp.terminate(nil) }
}
