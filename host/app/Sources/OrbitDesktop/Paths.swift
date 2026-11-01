import Foundation

enum Paths {
    static let bundleID = Bundle.main.bundleIdentifier ?? "io.github.daiconman.orbit-desktop"
    private static let fm = FileManager.default

    /// Folder holding runtime/, widgets/, host/dev-server/ and examples/.
    /// Order: $ORBIT_REPO, `defaults write <bundle id> repoPath <dir>` (live-edit a checkout),
    /// the copy inside the app bundle, then the checkout this binary was built from (`swift run`).
    static var repo: URL {
        var candidates: [URL] = []
        if let env = ProcessInfo.processInfo.environment["ORBIT_REPO"] { candidates.append(URL(fileURLWithPath: env)) }
        if let def = UserDefaults.standard.string(forKey: "repoPath") {
            candidates.append(URL(fileURLWithPath: (def as NSString).expandingTildeInPath))
        }
        if let res = Bundle.main.resourceURL { candidates.append(res.appendingPathComponent("orbit")) }
        var src = URL(fileURLWithPath: #filePath)
        for _ in 0..<5 { src.deleteLastPathComponent() }  // Sources/OrbitDesktop/Paths.swift -> repo root
        candidates.append(src)
        return candidates.first { fm.fileExists(atPath: $0.appendingPathComponent("host/dev-server/orbit_server.py").path) }
            ?? candidates.last!
    }

    static var serverScript: URL { repo.appendingPathComponent("host/dev-server/orbit_server.py") }
    static var exampleConfig: URL { repo.appendingPathComponent("examples/layout.yaml") }

    static let home = URL(fileURLWithPath: NSHomeDirectory())
    static let userConfigDir = home.appendingPathComponent(".config/orbit-desktop")
    static let userConfig = userConfigDir.appendingPathComponent("layout.yaml")
    /// Native provider output read by the server (`--host-dir`).
    static let hostDir = home.appendingPathComponent("Library/Caches/orbit-desktop/host")
    static let logDir = home.appendingPathComponent("Library/Logs/OrbitDesktop")
    static let serverLog = logDir.appendingPathComponent("server.log")

    static func ensureDirs() {
        for d in [hostDir, logDir] { try? fm.createDirectory(at: d, withIntermediateDirectories: true) }
    }

    /// Write via a temp file + rename so the server never reads a half-written file.
    static func writeAtomic(_ data: Data, to url: URL) {
        let tmp = url.appendingPathExtension("tmp")
        do {
            try data.write(to: tmp)
            _ = rename(tmp.path, url.path)
        } catch {}
    }

    static func writeJSON(_ obj: Any, to url: URL) {
        guard let d = try? JSONSerialization.data(withJSONObject: obj) else { return }
        writeAtomic(d, to: url)
    }
}

enum Settings {
    static var port: Int {
        let p = UserDefaults.standard.integer(forKey: "port")
        return (1024...65535).contains(p) ? p : 47900
    }
    static var python: String {
        ProcessInfo.processInfo.environment["ORBIT_PYTHON"] ?? UserDefaults.standard.string(forKey: "python") ?? "/usr/bin/python3"
    }
    /// `defaults write io.github.daiconman.orbit-desktop devtools -bool true` → Safari Web Inspector.
    static var devtools: Bool { UserDefaults.standard.bool(forKey: "devtools") }
    static var baseURL: URL { URL(string: "http://127.0.0.1:\(port)/")! }
}
