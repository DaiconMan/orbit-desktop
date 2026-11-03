import Foundation

/// `~/.config/orbit-desktop/settings.json`, shared by the app (EEW) and the server (wallpaper.*).
/// Unknown keys are preserved on save. Thread-safe; re-parses only when the file's mtime changes.
final class AppSettings: @unchecked Sendable {
    static let shared = AppSettings()
    static let url = Paths.userConfigDir.appendingPathComponent("settings.json")
    static let legacyURL = Paths.home.appendingPathComponent(".config/nowplaying-wallpaper/config.json")

    static let defaults: [String: [String: Any]] = [
        "eew": ["enabled": true, "notify": true, "pause_music": true, "min_intensity": NSNull(), "pause_min_intensity": "5弱"],
        "wallpaper": ["hidden": [String](), "page_seconds": 30],
    ]

    struct EEW {
        var enabled = true, notify = true, pauseMusic = true
        var minIntensity: String? = nil
        var pauseMinIntensity: String? = "5弱"
    }

    private let lock = NSLock()
    private var mtime: Date?? = .none  // .none = never read; .some(nil) = file missing
    private var merged: [String: [String: Any]] = defaults
    private(set) var error: String?

    /// One-time copy of the prototype's eew + wallpaper sections when settings.json does not exist yet.
    static func migrateIfNeeded() {
        let fm = FileManager.default
        guard !fm.fileExists(atPath: url.path), fm.fileExists(atPath: legacyURL.path),
              let d = try? Data(contentsOf: legacyURL),
              let old = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] else { return }
        var out: [String: Any] = [:]
        for k in ["eew", "wallpaper"] { if let v = old[k] as? [String: Any] { out[k] = v } }
        guard !out.isEmpty else { return }
        writeRaw(out)
        NSLog("[orbit] migrated settings from \(legacyURL.path)")
    }

    /// The file as written by the user (no defaults merged in), for editing.
    static func readRaw() -> [String: Any] {
        guard let d = try? Data(contentsOf: url) else { return [:] }
        return ((try? JSONSerialization.jsonObject(with: d)) as? [String: Any]) ?? [:]
    }

    @discardableResult
    static func writeRaw(_ obj: [String: Any]) -> Error? {
        do {
            try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            let d = try JSONSerialization.data(withJSONObject: obj, options: [.prettyPrinted, .sortedKeys])
            try d.write(to: url, options: .atomic)
            return nil
        } catch { return error }
    }

    /// The on-desktop editor saved (`saveArrangement`). Every key is optional; unknown keys in the file are kept.
    /// Returns whether a provider's `enabled` flag changed (providers are read at server start).
    static func saveEditor(_ body: [String: Any]) -> (providersChanged: Bool, error: Error?) {
        var raw = readRaw()
        if let a = body["arrangement"] {
            // the GUI arrangement replaces layout.yaml's zones + widgets; null = back to layout.yaml
            if let arr = a as? [String: Any] { raw["arrangement"] = arr } else if a is NSNull { raw.removeValue(forKey: "arrangement") }
            raw.removeValue(forKey: "layout")  // position overrides of the first editor version
        }
        var wp = raw["wallpaper"] as? [String: Any] ?? [:]
        if let h = body["hidden"] as? [Any] { wp["hidden"] = h.compactMap { $0 as? String } }
        if let n = body["pageSeconds"] as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID(), n.doubleValue.isFinite {
            wp["page_seconds"] = Int(min(3600, max(5, n.doubleValue.rounded())))
        }
        if !wp.isEmpty { raw["wallpaper"] = wp }
        if let t = body["theme"] as? [String: Any], let dim = t["night_dim"] as? Bool {
            var theme = raw["theme"] as? [String: Any] ?? [:]
            theme["night_dim"] = dim
            raw["theme"] = theme
        }
        var changed = false
        if let ps = body["providers"] as? [String: Any] {
            var cur = raw["providers"] as? [String: Any] ?? [:]
            for (name, v) in ps {
                guard !name.isEmpty, name.count <= 64, let on = (v as? [String: Any])?["enabled"] as? Bool else { continue }
                var entry = cur[name] as? [String: Any] ?? [:]
                if entry["enabled"] as? Bool != on { changed = true }
                entry["enabled"] = on
                cur[name] = entry
            }
            raw["providers"] = cur
        }
        return (changed, writeRaw(raw))
    }

    /// `acknowledged` = sorted union of the existing list and `warnings` (at most 200; the oldest existing entries go first).
    @discardableResult
    static func acknowledge(_ warnings: [String]) -> Error? {
        var raw = readRaw()
        var list = (raw["acknowledged"] as? [Any] ?? []).compactMap { $0 as? String }
        for w in warnings where !w.isEmpty && !list.contains(w) { list.append(String(w.prefix(1000))) }
        if list.count > 200 { list.removeFirst(list.count - 200) }
        raw["acknowledged"] = list.sorted()
        return writeRaw(raw)
    }

    /// Defaults merged with the file, section by section (like the prototype's cfg()).
    func current() -> [String: [String: Any]] {
        lock.lock(); defer { lock.unlock() }
        let m = (try? FileManager.default.attributesOfItem(atPath: Self.url.path))?[.modificationDate] as? Date
        if case .some(let old) = mtime, old == m { return merged }
        mtime = .some(m)
        var data = Self.defaults
        error = nil
        if m != nil {
            do {
                let d = try Data(contentsOf: Self.url)
                if let user = try JSONSerialization.jsonObject(with: d) as? [String: Any] {
                    for (sec, vals) in user {
                        if let v = vals as? [String: Any], var cur = data[sec] { v.forEach { cur[$0] = $1 }; data[sec] = cur }
                    }
                }
            } catch let e { error = String("\(e)".prefix(120)) }
        }
        merged = data
        return data
    }

    func eew() -> EEW {
        let e = current()["eew"] ?? [:]
        var r = EEW()
        r.enabled = (e["enabled"] as? Bool) ?? true
        r.notify = (e["notify"] as? Bool) ?? true
        r.pauseMusic = (e["pause_music"] as? Bool) ?? true
        r.minIntensity = Self.str(e["min_intensity"])
        r.pauseMinIntensity = Self.str(e["pause_min_intensity"])
        return r
    }

    private static func str(_ v: Any?) -> String? {
        if let s = v as? String { return s }
        if let n = v as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID() { return n.stringValue }
        return nil
    }
}
