import AppKit

/// Click actions of widgets (`{type:'runAction', action:{type, value}}` from the runtime page).
/// The page is trusted, but every action is validated here anyway. Failures are logged and beep.
enum ClickActions {
    private static let workQ = DispatchQueue(label: "io.github.daiconman.orbit-desktop.actions", attributes: .concurrent)
    /// NSAppleScript is used from this one serial queue only.
    private static let scriptQ = DispatchQueue(label: "io.github.daiconman.orbit-desktop.music")

    static let allowedSchemes: Set<String> = ["http", "https", "mailto", "x-apple.systempreferences", "shortcuts", "raycast"]
    static let forbiddenSchemes: Set<String> = ["file", "javascript", "data", "blob"]

    static func run(_ action: [String: Any]) {
        guard let type = action["type"] as? String, let value = action["value"] as? String,
              !value.isEmpty, value.count <= 2048 else { return fail("invalid action \(action)") }
        switch type {
        case "url": openURL(value)
        case "app": openApp(value)
        case "shortcut": runShortcut(value)
        case "script": runScript(value)
        case "music": music(value)
        default: fail("unknown action type \(type)")
        }
    }

    static func fail(_ why: String) {
        NSLog("[orbit] action failed: \(why)")
        DispatchQueue.main.async { NSSound.beep() }
    }

    // MARK: url

    static func openURL(_ s: String) {
        guard let u = URL(string: s.trimmingCharacters(in: .whitespacesAndNewlines)),
              let scheme = u.scheme?.lowercased(), !forbiddenSchemes.contains(scheme) else { return fail("url not allowed: \(s)") }
        let ws = NSWorkspace.shared
        guard allowedSchemes.contains(scheme) || ws.urlForApplication(toOpen: u) != nil else {
            return fail("no app handles \(scheme): URLs")
        }
        if !ws.open(u) { fail("could not open \(s)") }
    }

    // MARK: app

    static func openApp(_ name: String) {
        workQ.async {
            guard let url = resolveApp(name.trimmingCharacters(in: .whitespacesAndNewlines)) else { return fail("app not found: \(name)") }
            let cfg = NSWorkspace.OpenConfiguration()
            cfg.activates = true
            NSWorkspace.shared.openApplication(at: url, configuration: cfg) { _, err in
                if let err { fail("could not open \(url.path): \(err.localizedDescription)") }
            }
        }
    }

    /// A bundle id (`com.apple.iCal`), or an app name, either the file name (`Calendar`) or the
    /// localized name Finder shows (`カレンダー`).
    static func resolveApp(_ name: String) -> URL? {
        guard !name.isEmpty, !name.contains("/") else { return nil }
        let ws = NSWorkspace.shared, fm = FileManager.default
        if name.contains("."), !name.contains(" "), let u = ws.urlForApplication(withBundleIdentifier: name) { return u }
        let want = (name.hasSuffix(".app") ? String(name.dropLast(4)) : name).lowercased()
        var apps: [String] = []
        let dirs = ["/Applications", "/Applications/Utilities", "/System/Applications", "/System/Applications/Utilities",
                    NSHomeDirectory() + "/Applications", "/System/Library/CoreServices"]
        for dir in dirs {
            guard let items = try? fm.contentsOfDirectory(atPath: dir) else { continue }
            for item in items where item.hasSuffix(".app") {
                let path = dir + "/" + item
                let base = String(item.dropLast(4)).lowercased()
                var shown = fm.displayName(atPath: path)
                if shown.hasSuffix(".app") { shown = String(shown.dropLast(4)) }
                if base == want || shown.lowercased() == want { return URL(fileURLWithPath: path) }
                apps.append(path)
            }
        }
        // the Finder name depends on the UI language; also try the app's Japanese / English names
        return apps.first { localizedNames($0).contains(want) }.map { URL(fileURLWithPath: $0) }
    }

    private static func localizedNames(_ app: String) -> Set<String> {
        let res = app + "/Contents/Resources"
        var tables: [[String: Any]] = []
        if let lt = NSDictionary(contentsOfFile: res + "/InfoPlist.loctable") as? [String: Any] {
            for lang in ["ja", "en", "Base"] { if let t = lt[lang] as? [String: Any] { tables.append(t) } }
        }
        for lang in ["ja", "Japanese", "en", "English", "Base"] {
            if let t = NSDictionary(contentsOfFile: "\(res)/\(lang).lproj/InfoPlist.strings") as? [String: Any] { tables.append(t) }
        }
        var out = Set<String>()
        for t in tables {
            for k in ["CFBundleDisplayName", "CFBundleName"] { if let v = t[k] as? String { out.insert(v.lowercased()) } }
        }
        return out
    }

    // MARK: shortcut / script

    static func runShortcut(_ name: String) {
        guard name.count <= 200, !name.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }) else {
            return fail("invalid shortcut name")
        }
        runProcess("/usr/bin/shortcuts", ["run", name], label: "shortcut \(name)")
    }

    static func runScript(_ value: String) {
        let path = URL(fileURLWithPath: (value as NSString).expandingTildeInPath).standardizedFileURL.resolvingSymlinksInPath().path
        let home = URL(fileURLWithPath: NSHomeDirectory()).resolvingSymlinksInPath().path
        let fm = FileManager.default
        guard (value.hasPrefix("/") || value.hasPrefix("~/")), path.hasPrefix(home + "/"),
              (try? fm.attributesOfItem(atPath: path))?[.type] as? FileAttributeType == .typeRegular,
              fm.isExecutableFile(atPath: path) else {
            return fail("script refused (must be an executable file inside your home folder): \(value)")
        }
        runProcess(path, [], label: "script \(path)")
    }

    /// No shell, no stdin, 120 s timeout, output logged (first 4 KB).
    static func runProcess(_ exe: String, _ args: [String], label: String) {
        workQ.async {
            let p = Process()
            p.executableURL = URL(fileURLWithPath: exe)
            p.arguments = args
            p.currentDirectoryURL = URL(fileURLWithPath: NSHomeDirectory())
            let pipe = Pipe()
            p.standardOutput = pipe
            p.standardError = pipe
            p.standardInput = FileHandle.nullDevice
            do { try p.run() } catch { return fail("\(label): \(error.localizedDescription)") }
            var timedOut = false
            let killer = DispatchWorkItem { if p.isRunning { timedOut = true; p.terminate() } }
            workQ.asyncAfter(deadline: .now() + 120, execute: killer)
            var out = Data()
            // read until EOF (or until the timeout ends the process), keeping at most 4 KB
            while true {
                let chunk = pipe.fileHandleForReading.availableData
                if chunk.isEmpty { break }
                if out.count < 4096 { out.append(chunk.prefix(4096 - out.count)) }
            }
            p.waitUntilExit()
            killer.cancel()
            let text = String(decoding: out, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
            NSLog("[orbit] \(label) exited \(p.terminationStatus)\(timedOut ? " (timed out after 120 s)" : "")\(text.isEmpty ? "" : ": \(text)")")
            if timedOut || p.terminationStatus != 0 { fail("\(label) failed") }
        }
    }

    // MARK: music (Music / Spotify)

    private static let players: [(app: String, bid: String)] = [("Music", "com.apple.Music"), ("Spotify", "com.spotify.client")]

    /// `playpause`, `next`, `previous`, `shuffle`, `repeat`, `playlist:<name>` (Spotify: `playlist:spotify:…` URI).
    static func music(_ value: String) {
        let simple = ["playpause", "next", "previous", "shuffle", "repeat"]
        guard simple.contains(value) || value.hasPrefix("playlist:") else { return fail("unknown music command \(value)") }
        scriptQ.async {
            // only players that are already running: compiling `tell application "X"` for an app that
            // isn't installed shows a modal "Where is X?" dialog
            let running = players.filter { !NSRunningApplication.runningApplications(withBundleIdentifier: $0.bid).isEmpty }
            var target = running.first { isPlaying($0.app) } ?? running.first
            if target == nil, value.hasPrefix("playlist:"),
               NSWorkspace.shared.urlForApplication(withBundleIdentifier: "com.apple.Music") != nil {
                target = players[0]  // an explicit click on a playlist may launch Music
            }
            guard let t = target else { return fail("music: neither Music nor Spotify is running") }
            guard let body = command(value, app: t.app) else {
                // e.g. a Music playlist name while Spotify is the active player: nothing to do
                return NSLog("[orbit] music: \(value) ignored for \(t.app)")
            }
            let src = """
            with timeout of 8 seconds
              tell application "\(t.app)"
                \(body)
              end tell
            end timeout
            """
            var err: NSDictionary?
            _ = NSAppleScript(source: src)?.executeAndReturnError(&err)
            if let err { fail("music \(value) (\(t.app)): \(err)") }
        }
    }

    private static func isPlaying(_ app: String) -> Bool {
        var err: NSDictionary?
        let src = "with timeout of 4 seconds\ntell application \"\(app)\" to return (player state as text)\nend timeout"
        return NSAppleScript(source: src)?.executeAndReturnError(&err).stringValue == "playing"
    }

    /// AppleScript string literal: quotes and backslashes escaped, control characters dropped.
    static func asString(_ s: String) -> String {
        let clean = String(String.UnicodeScalarView(s.unicodeScalars.filter { !CharacterSet.controlCharacters.contains($0) }))
        return "\"" + clean.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"") + "\""
    }

    private static func command(_ value: String, app: String) -> String? {
        let music = app == "Music"
        switch value {
        case "playpause": return "playpause"
        case "next": return "next track"
        case "previous": return "previous track"
        case "shuffle": return music ? "set shuffle enabled to not shuffle enabled" : "set shuffling to not shuffling"
        case "repeat":
            return music
                ? "if song repeat is off then\n set song repeat to all\nelse if song repeat is all then\n set song repeat to one\nelse\n set song repeat to off\nend if"
                : "set repeating to not repeating"
        default:
            let name = String(value.dropFirst("playlist:".count))
            guard !name.isEmpty, name.count <= 300 else { return nil }
            if music { return "play playlist \(asString(name))" }
            return name.hasPrefix("spotify:") ? "play track \(asString(name))" : nil
        }
    }
}
