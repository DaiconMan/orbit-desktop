import AppKit
import UserNotifications

/// Always-on-top, click-through banner at the bottom of every screen (above full-screen apps)
/// while an EEW or tsunami warning is active. Port of the prototype's EEWBanner.app, driven by
/// EEWProvider snapshots instead of polling.
final class EEWBanner {
    static let scaleName: [Int: String] = [10: "1", 20: "2", 30: "3", 40: "4", 45: "5弱", 50: "5強", 55: "6弱", 60: "6強", 70: "7"]
    static let tsunamiName = ["MajorWarning": "大津波警報", "Warning": "津波警報", "Watch": "津波注意報"]
    static let red = NSColor(calibratedRed: 0.62, green: 0.05, blue: 0.08, alpha: 0.94)
    static let orange = NSColor(calibratedRed: 0.70, green: 0.36, blue: 0.02, alpha: 0.94)

    private final class Panel {
        let panel: NSPanel
        let title = NSTextField(labelWithString: ""), detail = NSTextField(labelWithString: "")
        init() {
            panel = NSPanel(contentRect: .zero, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
            panel.level = .screenSaver
            panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
            panel.ignoresMouseEvents = true
            panel.isOpaque = false
            panel.hasShadow = true
            panel.backgroundColor = .clear
            panel.isReleasedWhenClosed = false
            panel.hidesOnDeactivate = false
            panel.animationBehavior = .none
            let v = NSView()
            v.wantsLayer = true
            v.layer?.backgroundColor = EEWBanner.red.cgColor
            v.layer?.borderColor = NSColor(calibratedRed: 1, green: 0.45, blue: 0.45, alpha: 0.9).cgColor
            v.layer?.borderWidth = 1
            title.font = .systemFont(ofSize: 22, weight: .heavy)
            title.textColor = .white
            detail.font = .monospacedSystemFont(ofSize: 14, weight: .medium)
            detail.textColor = NSColor(white: 1, alpha: 0.92)
            detail.lineBreakMode = .byTruncatingTail
            detail.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
            for f in [title, detail] { f.translatesAutoresizingMaskIntoConstraints = false; v.addSubview(f) }
            NSLayoutConstraint.activate([
                title.leadingAnchor.constraint(equalTo: v.leadingAnchor, constant: 28), title.centerYAnchor.constraint(equalTo: v.centerYAnchor),
                detail.leadingAnchor.constraint(equalTo: title.trailingAnchor, constant: 24), detail.centerYAnchor.constraint(equalTo: v.centerYAnchor),
                detail.trailingAnchor.constraint(lessThanOrEqualTo: v.trailingAnchor, constant: -28),
            ])
            panel.contentView = v
        }
    }

    private var panels: [Panel] = []
    private var current: (String, String, Bool)?

    init() {
        NotificationCenter.default.addObserver(forName: NSApplication.didChangeScreenParametersNotification, object: nil, queue: .main) { [weak self] _ in
            self?.layout()
        }
    }

    func update(_ s: EEWProvider.Snapshot) {
        if let c = Self.text(for: s) { show(c.title, c.detail, warn: c.warn) } else { hide() }
    }

    /// The prototype's wording, unchanged.
    static func text(for s: EEWProvider.Snapshot) -> (title: String, detail: String, warn: Bool)? {
        let now = Date().timeIntervalSince1970
        if let e = s.eew, let recv = e["recv"] as? Double, now - recv < 180 {
            let test = (e["test"] as? Bool) ?? false
            if (e["cancelled"] as? Bool) == true { return ("緊急地震速報 取消" + (test ? "（テスト）" : ""), "", false) }
            var parts: [String] = []
            parts.append((e["place"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "震源不明")
            if let m = e["mag"] as? Double { parts.append(String(format: "M%.1f", m)) }
            if let ms = e["maxscale"] as? Int, let n = scaleName[ms] { parts.append("予想最大震度\(n)") }
            let prefs = ((e["areas"] as? [[String: Any]]) ?? []).compactMap { a -> String? in
                let p = (a["pref"] as? String) ?? ""
                return p.isEmpty ? a["name"] as? String : p
            }
            var seen = Set<String>()
            let uniq = prefs.filter { seen.insert($0).inserted }
            if !uniq.isEmpty { parts.append(uniq.joined(separator: "・")) }
            if let origin = e["origin"] as? Double { parts.append("発生から\(Int(now - origin))秒") }
            if let mu = e["music"] as? [String: Any], (mu["dry"] as? Bool) != true, !((mu["paused"] as? [String]) ?? []).isEmpty {
                parts.append("音楽を停止しました")
            }
            return ("緊急地震速報" + (test ? "（テスト）" : "") + "  強い揺れに警戒", parts.joined(separator: "   "), true)
        }
        if let t = s.tsunami, let areas = t["areas"] as? [[String: Any]] {
            let grades = areas.compactMap { $0["grade"] as? String }
            if let top = ["MajorWarning", "Warning"].first(where: { grades.contains($0) }) {
                let title = (tsunamiName[top] ?? "津波警報") + (((t["test"] as? Bool) ?? false) ? "（テスト）" : "")
                let detail = areas.filter { ($0["grade"] as? String) == top }.compactMap { $0["name"] as? String }.joined(separator: "・")
                return (title, detail, true)
            }
        }
        return nil
    }

    private func show(_ t: String, _ d: String, warn: Bool) {
        current = (t, d, warn)
        layout()
    }

    private func hide() {
        guard current != nil else { return }
        current = nil
        panels.forEach { $0.panel.orderOut(nil) }
    }

    /// One panel per screen, along its bottom edge (over the Dock area).
    private func layout() {
        guard let (t, d, warn) = current else { return }
        let screens = NSScreen.screens
        while panels.count < screens.count { panels.append(Panel()) }
        while panels.count > screens.count { panels.removeLast().panel.orderOut(nil) }
        let h: CGFloat = 64
        for (p, scr) in zip(panels, screens) {
            p.title.stringValue = t
            p.detail.stringValue = d
            p.panel.contentView?.layer?.backgroundColor = (warn ? Self.red : Self.orange).cgColor
            let f = NSRect(x: scr.frame.minX, y: scr.frame.minY, width: scr.frame.width, height: h)
            if p.panel.frame != f { p.panel.setFrame(f, display: true) }
            if !p.panel.isVisible { p.panel.orderFrontRegardless() }
        }
    }
}

/// macOS notifications for EEW / tsunami warnings. Authorization is requested lazily (first
/// warning, or when notifications are switched on in the settings). The Sosumi alert sound is
/// played by the app itself, so it is heard even when notifications are not allowed (an ad-hoc
/// signed build may never get the permission); the banner is shown regardless.
final class EEWNotifier: NSObject, UNUserNotificationCenterDelegate {
    private var center: UNUserNotificationCenter { UNUserNotificationCenter.current() }

    override init() {
        super.init()
        center.delegate = self
    }

    func requestAuthorization() {
        center.requestAuthorization(options: [.alert, .sound]) { ok, err in
            if !ok { NSLog("[orbit] notifications not authorized: \(err?.localizedDescription ?? "denied")") }
        }
    }

    func post(title: String, body: String) {
        NSSound(named: "Sosumi")?.play()
        let c = center
        c.requestAuthorization(options: [.alert, .sound]) { ok, err in
            guard ok else {
                NSLog("[orbit] notification not shown (\(err?.localizedDescription ?? "not authorized")): \(title) \(body)")
                return
            }
            let content = UNMutableNotificationContent()
            content.title = title
            content.body = body
            content.sound = nil  // already played above
            c.add(UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil))
        }
    }

    // show it even while the settings window makes us the active app
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                withCompletionHandler done: @escaping (UNNotificationPresentationOptions) -> Void) {
        done([.banner, .list])
    }
}
