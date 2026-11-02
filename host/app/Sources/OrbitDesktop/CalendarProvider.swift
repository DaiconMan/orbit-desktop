import Foundation
import EventKit

/// The `calendar` signal: events from the start of today to 8 days later (EventKit), written to
/// host-dir/calendar.json every 5 minutes and whenever the calendar database changes.
final class CalendarProvider {
    private let store = EKEventStore()
    private let out = Paths.hostDir.appendingPathComponent("calendar.json")
    private let iso = ISO8601DateFormatter()
    private var timer: Timer?
    private var observer: NSObjectProtocol?
    private(set) var running = false
    private(set) var denied = false

    func start() {
        guard !running else { return }
        running = true
        store.requestFullAccessToEvents { [weak self] ok, _ in
            DispatchQueue.main.async {
                guard let self, self.running else { return }
                guard ok else { self.denied = true; return }
                self.denied = false
                self.dump()
                self.timer = Timer.scheduledTimer(withTimeInterval: 300, repeats: true) { [weak self] _ in self?.dump() }
                self.observer = NotificationCenter.default.addObserver(forName: .EKEventStoreChanged, object: self.store, queue: .main) { [weak self] _ in self?.dump() }
            }
        }
    }

    func stop() {
        running = false
        timer?.invalidate()
        timer = nil
        if let o = observer { NotificationCenter.default.removeObserver(o) }
        observer = nil
    }

    private func hex(_ c: CGColor?) -> String {
        guard let c = c?.converted(to: CGColorSpace(name: CGColorSpace.sRGB)!, intent: .defaultIntent, options: nil),
              let p = c.components, p.count >= 3 else { return "#7aa2ff" }
        return String(format: "#%02x%02x%02x", Int(p[0] * 255), Int(p[1] * 255), Int(p[2] * 255))
    }

    private func dump() {
        let cal = Calendar.current
        let start = cal.startOfDay(for: Date())
        let end = cal.date(byAdding: .day, value: 8, to: start)!
        let pred = store.predicateForEvents(withStart: start, end: end, calendars: nil)
        let evs = store.events(matching: pred).sorted { $0.startDate < $1.startDate }.map { e -> [String: Any] in
            ["title": e.title ?? "", "start": iso.string(from: e.startDate), "end": iso.string(from: e.endDate),
             "allDay": e.isAllDay, "calendar": e.calendar.title, "color": hex(e.calendar.cgColor),
             "location": e.location ?? "", "status": e.availability == .free ? "free" : "busy"]
        }
        Paths.writeJSON(["events": evs, "ts": Date().timeIntervalSince1970], to: out)
    }
}
