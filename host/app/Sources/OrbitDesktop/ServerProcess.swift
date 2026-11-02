import Foundation

/// Runs host/dev-server/orbit_server.py as a child process and restarts it if it dies.
/// Being our child, its osascript calls are attributed to this app by TCC.
final class ServerProcess {
    enum State: Equatable { case stopped, starting, running, failed(String) }

    private(set) var state: State = .stopped { didSet { if state != oldValue { onStateChange?(state) } } }
    var onStateChange: ((State) -> Void)?

    private var proc: Process?
    private var wantRunning = false
    private var crashes: [Date] = []
    private var healthTimer: Timer?

    func start() {
        wantRunning = true
        launch()
    }

    func stop() {
        wantRunning = false
        healthTimer?.invalidate()
        proc?.terminate()
        proc = nil
        state = .stopped
    }

    func restart() {
        wantRunning = false
        if let p = proc, p.isRunning {
            p.terminationHandler = nil
            p.terminate()
            p.waitUntilExit()
        }
        proc = nil
        start()
    }

    private func launch() {
        guard wantRunning else { return }
        Paths.ensureDirs()
        let log = openLog()
        let p = Process()
        p.executableURL = URL(fileURLWithPath: Settings.python)
        // -B: never write __pycache__ (it would land inside the signed app bundle); -s: no user site-packages.
        p.arguments = ["-B", "-s", Paths.serverScript.path, "--port", String(Settings.port),
                       "--host-dir", Paths.hostDir.path, "--parent-pid", String(getpid())]
        var env = ProcessInfo.processInfo.environment
        env["PYTHONDONTWRITEBYTECODE"] = "1"
        env["PYTHONUNBUFFERED"] = "1"
        // the server's own subprocesses (osascript, …) must not hit an unaccepted Xcode license either
        if let clt = Settings.cltDir { env["DEVELOPER_DIR"] = clt }
        p.environment = env
        p.standardOutput = log
        p.standardError = log
        p.standardInput = FileHandle.nullDevice
        p.terminationHandler = { [weak self] proc in
            DispatchQueue.main.async { self?.didExit(status: proc.terminationStatus) }
        }
        do {
            try p.run()
        } catch {
            state = .failed("cannot run \(Settings.python): \(error.localizedDescription)")
            return
        }
        proc = p
        state = .starting
        waitForHealth()
    }

    private func didExit(status: Int32) {
        proc = nil
        healthTimer?.invalidate()
        guard wantRunning else { state = .stopped; return }
        let now = Date()
        crashes = crashes.filter { now.timeIntervalSince($0) < 60 } + [now]
        if crashes.count >= 5 {
            state = .failed("server exited \(crashes.count)× within a minute (status \(status)); see the server log")
            wantRunning = false
            return
        }
        state = .failed("server exited (status \(status)); restarting")
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self] in self?.launch() }
    }

    private func waitForHealth() {
        healthTimer?.invalidate()
        var tries = 0
        healthTimer = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] t in
            tries += 1
            guard let self else { t.invalidate(); return }
            OrbitAPI.health { ok, hostApp in
                guard self.state == .starting else { return }
                if ok && hostApp {
                    t.invalidate()
                    self.state = .running
                } else if ok && !hostApp {
                    // Something else (a manually started dev server?) already owns the port.
                    t.invalidate()
                    self.state = .failed("port \(Settings.port) is used by another Orbit server; stop it or change the port")
                }
            }
            if tries > 120 { t.invalidate(); if self.state == .starting { self.state = .failed("server did not start; see the server log") } }
        }
    }

    private func openLog() -> FileHandle {
        let url = Paths.serverLog
        // keep the log small: start fresh once it passes 1 MB
        if let size = (try? FileManager.default.attributesOfItem(atPath: url.path))?[.size] as? Int, size > 1_000_000 {
            try? FileManager.default.removeItem(at: url)
        }
        if !FileManager.default.fileExists(atPath: url.path) { FileManager.default.createFile(atPath: url.path, contents: nil) }
        guard let h = try? FileHandle(forWritingTo: url) else { return FileHandle.nullDevice }
        h.seekToEndOfFile()
        h.write("\n--- \(Date()) starting server (\(Paths.serverScript.path)) ---\n".data(using: .utf8)!)
        return h
    }
}

/// Tiny client for the server's own API (loopback only).
enum OrbitAPI {
    private static let session: URLSession = {
        let c = URLSessionConfiguration.ephemeral
        c.timeoutIntervalForRequest = 3
        c.connectionProxyDictionary = [:]  // never route loopback through a proxy
        return URLSession(configuration: c)
    }()

    static func get(_ path: String, _ done: @escaping (Any?) -> Void) {
        let url = URL(string: path, relativeTo: Settings.baseURL)!
        session.dataTask(with: url) { data, resp, _ in
            let ok = (resp as? HTTPURLResponse)?.statusCode == 200
            let obj = ok ? data.flatMap { try? JSONSerialization.jsonObject(with: $0) } : nil
            DispatchQueue.main.async { done(obj) }
        }.resume()
    }

    static func health(_ done: @escaping (_ ok: Bool, _ hostApp: Bool) -> Void) {
        get("/api/health") { obj in
            let d = obj as? [String: Any]
            done(d?["ok"] as? Bool == true, d?["hostApp"] as? Bool == true)
        }
    }
}
