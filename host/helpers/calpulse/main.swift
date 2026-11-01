// CalPulse (Orbit Desktop helper, MIT): reads today's + next-24h events from macOS Calendar (EventKit) every 5 minutes
// and writes them to a local JSON file for the wallpaper. No network access.
import Foundation
import EventKit

// Output path: first CLI argument, default ~/Library/Caches/orbit-desktop/calendar.json
let out = CommandLine.arguments.count > 1 ? (CommandLine.arguments[1] as NSString).expandingTildeInPath
    : (NSHomeDirectory() as NSString).appendingPathComponent("Library/Caches/orbit-desktop/calendar.json")
try? FileManager.default.createDirectory(atPath: (out as NSString).deletingLastPathComponent, withIntermediateDirectories: true)
let store = EKEventStore()
let iso = ISO8601DateFormatter()

func hex(_ c: CGColor?) -> String {
    guard let c = c?.converted(to: CGColorSpace(name: CGColorSpace.sRGB)!, intent: .defaultIntent, options: nil),
          let p = c.components, p.count >= 3 else { return "#7aa2ff" }
    return String(format: "#%02x%02x%02x", Int(p[0] * 255), Int(p[1] * 255), Int(p[2] * 255))
}

func dump() {
    let cal = Calendar.current
    let start = cal.startOfDay(for: Date())
    let end = cal.date(byAdding: .day, value: 2, to: start)!
    let pred = store.predicateForEvents(withStart: start, end: end, calendars: nil)
    let evs = store.events(matching: pred).sorted { $0.startDate < $1.startDate }.map { e -> [String: Any] in
        ["title": e.title ?? "", "start": iso.string(from: e.startDate), "end": iso.string(from: e.endDate),
         "allDay": e.isAllDay, "calendar": e.calendar.title, "color": hex(e.calendar.cgColor),
         "location": e.location ?? "", "status": e.availability == .free ? "free" : "busy"]
    }
    let obj: [String: Any] = ["events": evs, "ts": Date().timeIntervalSince1970]
    if let d = try? JSONSerialization.data(withJSONObject: obj) {
        try? d.write(to: URL(fileURLWithPath: out + ".tmp")); rename(out + ".tmp", out)
    }
}

store.requestFullAccessToEvents { ok, err in
    guard ok else { FileHandle.standardError.write("calendar access denied: \(String(describing: err))\n".data(using: .utf8)!); exit(1) }
    DispatchQueue.main.async {
        dump()
        Timer.scheduledTimer(withTimeInterval: 300, repeats: true) { _ in dump() }
        NotificationCenter.default.addObserver(forName: .EKEventStoreChanged, object: store, queue: .main) { _ in dump() }
    }
}
RunLoop.main.run()
