import AppKit
import Foundation

/// Earthquake Early Warning (緊急地震速報) and tsunami warnings from the P2P地震情報 WebSocket
/// (wss://api.p2pquake.net/v2/ws: code 556 = EEW, 552 = tsunami, 551 = quake report).
/// A faithful port of the prototype (nowplaying-wallpaper.py). Field names in alerts.json are
/// identical to the prototype's, because the wallpaper's alert overlay reads them.
///
/// All state lives on one serial queue; the UI (banner, menu) gets snapshots on the main queue.
final class EEWProvider: NSObject, URLSessionWebSocketDelegate, @unchecked Sendable {
    static let wsURL = URL(string: "wss://api.p2pquake.net/v2/ws")!
    static let ttl: Double = 180  // an EEW is shown for 3 min after its last update
    static let cacheDir = Paths.home.appendingPathComponent("Library/Caches/orbit-desktop")
    static let testFile = cacheDir.appendingPathComponent("eew-test.json")         // local test: injected if < 60 s old
    static let acceptTestFile = cacheDir.appendingPathComponent("eew-accept-test")  // if present: stream test:true messages too
    static let prefs = ["北海道", "青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県", "茨城県", "栃木県", "群馬県", "埼玉県", "千葉県", "東京都", "神奈川県",
                        "新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県", "岐阜県", "静岡県", "愛知県", "三重県", "滋賀県", "京都府", "大阪府", "兵庫県",
                        "奈良県", "和歌山県", "鳥取県", "島根県", "岡山県", "広島県", "山口県", "徳島県", "香川県", "愛媛県", "高知県", "福岡県", "佐賀県", "長崎県",
                        "熊本県", "大分県", "宮崎県", "鹿児島県", "沖縄県"]
    static let defaultPrefs = ["東京都", "神奈川県"]  // used when the current prefecture cannot be determined
    static let scaleCode: [String: Int] = ["1": 10, "2": 20, "3": 30, "4": 40, "5弱": 45, "5強": 50, "6弱": 55, "6強": 60, "7": 70]
    static let tsunamiGrade = ["MajorWarning": "大津波警報", "Warning": "津波警報", "Watch": "津波注意報", "Unknown": "津波予報"]

    struct Snapshot {
        var eew: [String: Any]?
        var tsunami: [String: Any]?
        var connected = false
        var disabled = false
        var error: String?
        var msgs = 0
    }

    /// Called on the main queue on every change and once a second while an alert is active.
    var onUpdate: ((Snapshot) -> Void)?
    /// Called on the main queue for a notification (title, body).
    var onNotify: ((String, String) -> Void)?

    private let q = DispatchQueue(label: "io.github.daiconman.orbit-desktop.eew")
    private let scriptQ = DispatchQueue(label: "io.github.daiconman.orbit-desktop.applescript")
    private let out = Paths.hostDir.appendingPathComponent("alerts.json")
    private var session: URLSession!
    private var timer: DispatchSourceTimer?

    // --- state (q only) ---
    private var eew: [String: Any]?
    private var tsunami: [String: Any]?
    private var pref: [String: Any]?
    private var notified = Set<String>(), paused = Set<String>()
    private var task: URLSessionWebSocketTask?
    private var gen = 0
    private var opened = false
    private var connectStart = 0.0, lastRx = 0.0, lastPing = 0.0
    private var backoff = 2.0
    private var retryAt: Double? = 0  // nil while connecting / connected
    private var wsSince = 0.0, wsAt = 0.0, wsMsgs = 0, wsLast: Double?
    private var wsError: String? = "starting"
    private var wsDisabled = false
    private var testDone: Date?
    private var nextPrefAt = 3.0, prefBusy = false
    private var dirty = true, lastWrite = 0.0

    private var now: Double { Date().timeIntervalSince1970 }

    override init() {
        super.init()
        let oq = OperationQueue()
        oq.underlyingQueue = q
        oq.maxConcurrentOperationCount = 1
        let c = URLSessionConfiguration.ephemeral
        c.timeoutIntervalForRequest = 15
        c.waitsForConnectivity = false
        session = URLSession(configuration: c, delegate: self, delegateQueue: oq)
    }

    func start() {
        q.async { [self] in
            guard timer == nil else { return }
            nextPrefAt = now + 3
            let t = DispatchSource.makeTimerSource(queue: q)
            t.schedule(deadline: .now(), repeating: 1, leeway: .milliseconds(100))
            t.setEventHandler { [weak self] in self?.tick() }
            timer = t
            t.resume()
        }
    }

    // MARK: 1 s housekeeping: settings, connection, test injection, expiry, output

    private func tick() {
        let cfg = AppSettings.shared.eew()
        let t = now
        if !cfg.enabled {
            if task != nil { close() }
            if !wsDisabled { wsDisabled = true; wsError = nil; wsAt = t; dirty = true }
            if eew != nil || tsunami != nil { eew = nil; tsunami = nil; dirty = true }
            backoff = 2
            retryAt = 0
        } else {
            if wsDisabled { wsDisabled = false; wsError = "connecting"; wsAt = t; dirty = true }
            if task == nil, let r = retryAt, t >= r { connect() }
            if let task {
                if !opened {
                    if t - connectStart > 15 { fail("handshake timeout") }
                } else if t - lastRx > 180 {
                    fail("silent")  // the server said nothing for 3 min
                } else if t - lastRx > 20 && t - lastPing > 60 {
                    lastPing = t   // idle: keep-alive ping
                    let g = gen
                    task.sendPing { [weak self] err in
                        guard let self else { return }
                        self.q.async {
                            guard g == self.gen else { return }
                            if let err { self.fail(err.localizedDescription) } else { self.lastRx = self.now }
                        }
                    }
                }
            }
        }
        injectTestFile()
        expire(enabled: cfg.enabled)
        if t >= nextPrefAt && !prefBusy { refreshPref() }

        let active = eew != nil || tsunami != nil
        if active || dirty || t - lastWrite > 30 {
            write()
            lastWrite = t
        }
        if active || dirty { publish() }
        dirty = false
    }

    private func injectTestFile() {
        guard let m = (try? FileManager.default.attributesOfItem(atPath: Self.testFile.path))?[.modificationDate] as? Date,
              now - m.timeIntervalSince1970 < 60, m != testDone else { return }
        testDone = m
        if let d = try? Data(contentsOf: Self.testFile), let obj = try? JSONSerialization.jsonObject(with: d) {
            dispatch(obj, local: true)
        }
    }

    private func expire(enabled: Bool) {
        let t = now
        if let e = eew, let recv = e["recv"] as? Double, t - recv > ((e["cancelled"] as? Bool) == true ? 15 : Self.ttl) {
            eew = nil; dirty = true
        }
        if let ts = tsunami, let recv = ts["recv"] as? Double, t - recv > ((ts["test"] as? Bool) == true ? 600 : 12 * 3600) {
            tsunami = nil; dirty = true  // real: 12 h unless cancelled earlier
        }
    }

    // MARK: WebSocket

    private func connect() {
        gen += 1
        var req = URLRequest(url: Self.wsURL)
        req.setValue("orbit-desktop/1.0", forHTTPHeaderField: "User-Agent")
        let t = session.webSocketTask(with: req)
        t.maximumMessageSize = 4_000_000
        task = t
        opened = false
        connectStart = now
        retryAt = nil
        t.resume()
        receive(t, gen)
    }

    private func receive(_ t: URLSessionWebSocketTask, _ g: Int) {
        t.receive { [weak self] result in
            guard let self else { return }
            self.q.async {
                guard g == self.gen else { return }
                switch result {
                case .failure(let e):
                    self.fail(e.localizedDescription)
                case .success(let msg):
                    self.lastRx = self.now
                    self.wsMsgs += 1
                    self.wsLast = self.now
                    self.dirty = true
                    var data: Data?
                    switch msg {
                    case .string(let s): data = s.data(using: .utf8)
                    case .data: data = nil  // text frames only, like the prototype
                    @unknown default: data = nil
                    }
                    if AppSettings.shared.eew().enabled, let data, let obj = try? JSONSerialization.jsonObject(with: data) {
                        self.dispatch(obj, local: false)
                    }
                    self.receive(t, g)
                }
            }
        }
    }

    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didOpenWithProtocol protocol: String?) {
        q.async { [self] in
            guard webSocketTask === task else { return }
            opened = true
            lastRx = now; lastPing = now
            wsSince = now; wsMsgs = 0; wsLast = nil; wsError = nil
            dirty = true
            NSLog("[orbit] EEW stream connected")
        }
    }

    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask,
                    didCloseWith closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?) {
        q.async { [self] in
            guard webSocketTask === task else { return }
            fail("server closed (\(closeCode.rawValue))")
        }
    }

    func urlSession(_ session: URLSession, task t: URLSessionTask, didCompleteWithError error: Error?) {
        q.async { [self] in
            guard t === task else { return }
            fail(error?.localizedDescription ?? "server closed")
        }
    }

    private func close() {
        gen += 1
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
        opened = false
    }

    /// Drop the connection and schedule a reconnect: exponential backoff 2 s → 5 min, jittered.
    private func fail(_ why: String) {
        guard task != nil else { return }
        close()
        wsError = String(why.prefix(120))
        wsAt = now
        dirty = true
        if now - connectStart > 120 { backoff = 2 }
        retryAt = now + backoff + Double.random(in: 0..<2)
        backoff = min(300, backoff * 2)
        NSLog("[orbit] EEW stream: \(why); retry in \(Int(retryAt! - now)) s")
    }

    // MARK: messages

    private func dispatch(_ obj: Any, local: Bool) {
        let list = (obj as? [Any]) ?? [obj]
        for x in list {
            guard let m = x as? [String: Any] else { continue }
            switch (m["code"] as? NSNumber)?.intValue {
            case 556: handleEEW(m, local: local)
            case 552: handleTsunami(m, local: local)
            default: break  // 551 (quake report): the server's quake feed polls on its own
            }
        }
    }

    private func handleEEW(_ m: [String: Any], local: Bool) {
        let cfg = AppSettings.shared.eew()
        guard cfg.enabled else { return }
        if truthy(m["test"]) && !(local || FileManager.default.fileExists(atPath: Self.acceptTestFile.path)) { return }
        let eq = m["earthquake"] as? [String: Any] ?? [:], iss = m["issue"] as? [String: Any] ?? [:]
        let hy = eq["hypocenter"] as? [String: Any] ?? [:]
        let eid = str(iss["eventId"]) ?? str(m["id"]) ?? str(m["_id"]) ?? String(Int(now))
        let curID = eew?["id"] as? String
        if truthy(m["cancelled"]) {
            if var cur = eew, curID == eid {
                cur["cancelled"] = true
                cur["recv"] = now
                eew = cur
                dirty = true
            }
            return
        }
        var areas: [[String: Any]] = []
        var scales: [Double] = []
        for a in (m["areas"] as? [[String: Any]]) ?? [] {
            let sf = a["scaleFrom"], st = a["scaleTo"]
            areas.append(["pref": str(a["pref"]) ?? "", "name": str(a["name"]) ?? "",
                          "from": orNull(sf), "to": orNull(st), "kind": orNull(a["kindCode"])])
            let f = num(sf) ?? 0, to = num(st) ?? 0
            scales.append(max(f, to < 99 ? to : 0))  // 99 = "…程度以上"
        }
        let mag = num(hy["magnitude"]), dep = num(hy["depth"])
        let maxscale: Int? = scales.max().map { Int($0) }
        let test = truthy(m["test"]) || local
        var rec: [String: Any] = [
            "id": eid, "serial": orNull(iss["serial"]), "recv": now, "origin": orNull(jstTimestamp(eq["originTime"] as? String)),
            "place": str(hy["name"]) ?? "", "mag": orNull((mag ?? -1) > 0 ? mag : nil), "depth": orNull((dep ?? -1) >= 0 ? dep : nil),
            "condition": str(eq["condition"]) ?? "", "areas": areas, "maxscale": orNull(maxscale),
            "cancelled": false, "test": test,
        ]
        if (maxscale ?? 0) < scaleOf(cfg.minIntensity, 0) && curID != eid { return }
        // test file: a real pause only with "_pause": true
        rec["music"] = music(for: rec, areas: areas, maxscale: maxscale, dry: test && !truthy(m["_pause"]), cfg: cfg)
        eew = rec
        dirty = true
        if !notified.contains(eid) && cfg.notify {
            notified.insert(eid)
            var seen = Set<String>()
            let names = String(areas.map { a -> String in
                let p = a["pref"] as? String ?? ""; return p.isEmpty ? (a["name"] as? String ?? "") : p
            }.filter { seen.insert($0).inserted }.joined(separator: "・").prefix(80))
            let place = (rec["place"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "震源不明"
            let magStr = rec["mag"] is Double ? String(format: " M%.1f", rec["mag"] as! Double) : ""
            notify("緊急地震速報" + (test ? "（テスト）" : ""), "\(place)\(magStr)　強い揺れに警戒: \(names.isEmpty ? "—" : names)")
        }
    }

    /// Owner's rule: (current prefecture warned or predicted max intensity >= pause_min_intensity)
    /// and pause_music on → pause music once per event.
    private func music(for rec: [String: Any], areas: [[String: Any]], maxscale: Int?, dry: Bool, cfg: AppSettings.EEW) -> [String: Any] {
        let id = rec["id"] as! String
        let prefs = (pref?["names"] as? [String]).flatMap { $0.isEmpty ? nil : $0 } ?? Self.defaultPrefs
        let keys = Set(prefs.map(prefKey))
        let hit = areas.contains { a in
            keys.contains(prefKey(a["pref"] as? String ?? "")) || keys.contains { (a["name"] as? String ?? "").hasPrefix($0) }
        }
        let strong = (maxscale ?? 0) >= scaleOf(cfg.pauseMinIntensity, 45)
        var music: [String: Any] = ["eligible": (hit || strong) && cfg.pauseMusic, "local": hit, "strong": strong,
                                    "prefs": prefs, "dry": dry, "paused": [String]()]
        if music["eligible"] as! Bool && !paused.contains(id) {
            paused.insert(id)
            // AppleScript can take seconds: show the alert now, fill in "paused" when it returns.
            scriptQ.async { [weak self] in
                let names = Self.pausePlayers(dry: dry)
                self?.q.async {
                    guard let self, var e = self.eew, e["id"] as? String == id, var mu = e["music"] as? [String: Any] else { return }
                    mu["paused"] = names
                    e["music"] = mu
                    self.eew = e
                    self.dirty = true
                }
            }
        } else if paused.contains(id), let e = eew, e["id"] as? String == id, let prev = e["music"] as? [String: Any] {
            music = prev  // keep the first result for later reports of the same event
        }
        return music
    }

    private func handleTsunami(_ m: [String: Any], local: Bool) {
        let cfg = AppSettings.shared.eew()
        guard cfg.enabled else { return }
        if truthy(m["test"]) && !(local || FileManager.default.fileExists(atPath: Self.acceptTestFile.path)) { return }
        if truthy(m["cancelled"]) { tsunami = nil; dirty = true; return }
        let areas: [[String: Any]] = ((m["areas"] as? [[String: Any]]) ?? []).map { a in
            ["grade": orNull(a["grade"]), "name": str(a["name"]) ?? "", "immediate": truthy(a["immediate"]),
             "height": str((a["maxHeight"] as? [String: Any])?["description"]) ?? ""]
        }
        if areas.isEmpty { tsunami = nil; dirty = true; return }
        let iid = str((m["issue"] as? [String: Any])?["time"]) ?? str(m["_id"]) ?? String(now)
        tsunami = ["id": iid, "recv": now, "areas": areas, "test": truthy(m["test"]) || local]
        dirty = true
        let order = ["Unknown", "Watch", "Warning", "MajorWarning"]
        func rank(_ a: [String: Any]) -> Int {
            guard let g = a["grade"] as? String, Self.tsunamiGrade[g] != nil else { return 0 }
            return order.firstIndex(of: g) ?? 0
        }
        var top = areas[0]
        for a in areas.dropFirst() where rank(a) > rank(top) { top = a }  // first maximum, like Python's max()
        if let g = top["grade"] as? String, g == "Warning" || g == "MajorWarning", !notified.contains(iid), cfg.notify {
            notified.insert(iid)
            notify(Self.tsunamiGrade[g]!, String(areas.map { $0["name"] as? String ?? "" }.joined(separator: "・").prefix(100)))
        }
    }

    private func notify(_ title: String, _ body: String) {
        DispatchQueue.main.async { [weak self] in self?.onNotify?(title, body) }
    }

    // MARK: music (one script per player, so a player that is not installed cannot break the other)

    /// Pause only players that are already running AND playing (never launches an app). dry: only report.
    static func pausePlayers(dry: Bool) -> [String] {
        [("Music", "com.apple.Music"), ("Spotify", "com.spotify.client")].filter { app, bid in
            // Check "running" without AppleScript first: compiling `tell application "X"` for an app
            // that is not installed makes NSAppleScript show a modal "Where is X?" dialog.
            guard !NSRunningApplication.runningApplications(withBundleIdentifier: bid).isEmpty else { return false }
            let src = """
            if application "\(app)" is running then
              with timeout of 8 seconds
                tell application "\(app)"
                  if (player state as text) is "playing" then
                    if \(dry ? 1 : 0) is 0 then pause
                    return "\(app)"
                  end if
                end tell
              end timeout
            end if
            return ""
            """
            var err: NSDictionary?
            let r = NSAppleScript(source: src)?.executeAndReturnError(&err)
            if let err { NSLog("[orbit] pause \(app): \(err)") }
            return r?.stringValue == app
        }.map(\.0)
    }

    // MARK: prefecture (GSI reverse geocoder, no key): first 2 digits of muniCd

    private func refreshPref() {
        prefBusy = true
        DispatchQueue.main.async { [weak self] in
            OrbitAPI.get("/api/signals/location") { obj in
                guard let self else { return }
                let loc = obj as? [String: Any]
                guard let lat = (loc?["lat"] as? NSNumber)?.doubleValue, let lon = (loc?["lon"] as? NSNumber)?.doubleValue else {
                    self.q.async { self.prefDone(nil, retry: 30) }  // server not up yet
                    return
                }
                var c = URLComponents(string: "https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress")!
                c.queryItems = [URLQueryItem(name: "lat", value: String(lat)), URLQueryItem(name: "lon", value: String(lon))]
                var req = URLRequest(url: c.url!, timeoutInterval: 15)
                req.setValue("orbit-desktop/1.0", forHTTPHeaderField: "User-Agent")
                URLSession.shared.dataTask(with: req) { data, _, _ in
                    var name: String?
                    if let data, let j = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                       var cd = (j["results"] as? [String: Any])?["muniCd"] as? String {
                        if cd.count == 4 { cd = "0" + cd }  // defensive: treat a 4-digit code as missing its leading zero
                        if let n = Int(cd.prefix(2)), (1...47).contains(n) { name = Self.prefs[n - 1] }
                    }
                    self.q.async { self.prefDone(name, retry: 1800) }
                }.resume()
            }
        }
    }

    private func prefDone(_ name: String?, retry: Double) {
        prefBusy = false
        nextPrefAt = now + retry
        if let name {
            let p: [String: Any] = ["names": [name], "src": "gsi"]
            if (pref?["names"] as? [String]) != [name] { dirty = true }
            pref = p
        } else if pref == nil {
            pref = ["names": Self.defaultPrefs, "src": "default"]
            dirty = true
        }
    }

    // MARK: output

    private func wsDict() -> [String: Any] {
        if wsDisabled { return ["connected": false, "disabled": true, "at": wsAt] }
        if opened && task != nil { return ["connected": true, "since": wsSince, "msgs": wsMsgs, "last": orNull(wsLast)] }
        return ["connected": false, "error": wsError ?? "connecting", "at": wsAt]
    }

    private func write() {
        let obj: [String: Any] = [
            "eew": orNull(eew), "tsunami": orNull(tsunami), "ws": wsDict(),
            "pref": pref ?? ["names": Self.defaultPrefs, "src": "default"], "ts": now,
        ]
        Paths.writeJSON(obj, to: out)
    }

    private func publish() {
        let s = Snapshot(eew: eew, tsunami: tsunami, connected: opened && task != nil, disabled: wsDisabled,
                         error: (opened && task != nil) || wsDisabled ? nil : (wsError ?? "connecting"), msgs: wsMsgs)
        DispatchQueue.main.async { [weak self] in self?.onUpdate?(s) }
    }

    // MARK: helpers (Python truthiness, so `a or b` behaves like the prototype)

    private func truthy(_ v: Any?) -> Bool {
        switch v {
        case nil, is NSNull: return false
        case let s as String: return !s.isEmpty
        case let n as NSNumber: return n.doubleValue != 0
        case let a as [Any]: return !a.isEmpty
        case let d as [String: Any]: return !d.isEmpty
        default: return true
        }
    }

    private func str(_ v: Any?) -> String? {
        guard truthy(v) else { return nil }
        if let s = v as? String { return s }
        if let n = v as? NSNumber { return n.stringValue }
        return nil
    }

    private func num(_ v: Any?) -> Double? {
        guard let n = v as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID() else { return nil }
        return n.doubleValue
    }

    private func orNull(_ v: Any?) -> Any {
        switch v {
        case nil: return NSNull()
        case let .some(x): return x
        }
    }

    private func scaleOf(_ v: String?, _ dflt: Int) -> Int { v.flatMap { Self.scaleCode[$0] } ?? dflt }

    /// Like Python's name.rstrip("都府県") (except 北海道), kept identical to the prototype.
    private func prefKey(_ name: String) -> String {
        var s = name.trimmingCharacters(in: .whitespacesAndNewlines)
        if s == "北海道" { return s }
        while let c = s.last, "都府県".contains(c) { s.removeLast() }
        return s
    }

    /// "2026/11/03 12:34:56(.fff)" in JST → Unix time.
    private func jstTimestamp(_ s: String?) -> Double? {
        guard let s, !s.isEmpty else { return nil }
        let parts = s.split(separator: ".", maxSplits: 1)
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(secondsFromGMT: 9 * 3600)
        f.dateFormat = "yyyy/MM/dd HH:mm:ss"
        guard let d = f.date(from: String(parts[0])) else { return nil }
        var t = d.timeIntervalSince1970
        if parts.count == 2 {
            guard parts[1].allSatisfy(\.isNumber), (1...6).contains(parts[1].count) else { return nil }
            t += Double("0." + parts[1]) ?? 0
        }
        return t
    }
}
