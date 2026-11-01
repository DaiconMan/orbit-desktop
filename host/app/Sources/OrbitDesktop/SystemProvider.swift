import Foundation
import Darwin
import IOKit
import SystemConfiguration

/// The `system` signal's cpu / load / mem / disk / net fields, measured with Mach, sysctl and IOKit
/// calls every 2 s instead of spawning ps, vm_stat, netstat and iostat (cheap on a fanless Air).
/// Writes host-dir/system.json; the server merges it with ping and speed-test results.
final class SystemProvider {
    private let queue = DispatchQueue(label: "orbit.system", qos: .utility)
    private var timer: DispatchSourceTimer?
    private let out = Paths.hostDir.appendingPathComponent("system.json")
    private let store = SCDynamicStoreCreate(nil, "OrbitDesktop" as CFString, nil, nil)

    private var prevTicks: (busy: UInt64, total: UInt64)?
    private var prevNet: (iface: String, rx: UInt64, tx: UInt64, t: Double)?
    private var prevDisk: (bytes: UInt64, t: Double)?
    private var iface = "en0"
    private var ifaceCheckedAt = 0.0

    func start() {
        guard timer == nil else { return }
        let t = DispatchSource.makeTimerSource(queue: queue)
        t.schedule(deadline: .now(), repeating: 2.0, leeway: .milliseconds(200))
        t.setEventHandler { [weak self] in self?.sample() }
        t.resume()
        timer = t
    }

    func stop() {
        timer?.cancel()
        timer = nil
    }

    private func sample() {
        let now = Date().timeIntervalSince1970
        var obj: [String: Any] = ["ts": now]
        obj["cpu"] = cpuPercent() ?? NSNull()
        var la = [Double](repeating: 0, count: 3)
        obj["load"] = getloadavg(&la, 3) > 0 ? la[0] : NSNull()
        obj["mem"] = memory() ?? NSNull()
        obj["net"] = network(now) ?? NSNull()
        obj["disk"] = disk(now) ?? NSNull()
        Paths.writeJSON(obj, to: out)
    }

    // MARK: CPU (share of total machine capacity, 0-100)
    private func cpuPercent() -> Double? {
        var info = host_cpu_load_info()
        var count = mach_msg_type_number_t(MemoryLayout<host_cpu_load_info_data_t>.size / MemoryLayout<integer_t>.size)
        let r = withUnsafeMutablePointer(to: &info) {
            $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) { host_statistics(mach_host_self(), HOST_CPU_LOAD_INFO, $0, &count) }
        }
        guard r == KERN_SUCCESS else { return nil }
        let user = UInt64(info.cpu_ticks.0), sys = UInt64(info.cpu_ticks.1), idle = UInt64(info.cpu_ticks.2), nice = UInt64(info.cpu_ticks.3)
        let cur = (busy: user + sys + nice, total: user + sys + nice + idle)
        defer { prevTicks = cur }
        guard let p = prevTicks, cur.total > p.total else { return nil }
        return min(100, Double(cur.busy &- p.busy) / Double(cur.total - p.total) * 100)
    }

    // MARK: memory (active + wired + compressed, like Activity Monitor's "Memory Used")
    private func memory() -> [String: Any]? {
        var vm = vm_statistics64()
        var count = mach_msg_type_number_t(MemoryLayout<vm_statistics64_data_t>.size / MemoryLayout<integer_t>.size)
        let r = withUnsafeMutablePointer(to: &vm) {
            $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) { host_statistics64(mach_host_self(), HOST_VM_INFO64, $0, &count) }
        }
        guard r == KERN_SUCCESS else { return nil }
        let page = UInt64(vm_kernel_page_size)
        let used = (UInt64(vm.active_count) + UInt64(vm.wire_count) + UInt64(vm.compressor_page_count)) * page
        let total = ProcessInfo.processInfo.physicalMemory
        guard total > 0 else { return nil }
        return ["used": used, "total": total, "pct": Double(used) / Double(total) * 100]
    }

    // MARK: network (bytes/s on the primary interface; 64-bit counters via NET_RT_IFLIST2)
    private func primaryInterface() -> String {
        if let v = SCDynamicStoreCopyValue(store, "State:/Network/Global/IPv4" as CFString) as? [String: Any],
           let name = v["PrimaryInterface"] as? String { return name }
        return iface
    }

    private func interfaceBytes(_ name: String) -> (UInt64, UInt64)? {
        var mib: [Int32] = [CTL_NET, PF_ROUTE, 0, 0, NET_RT_IFLIST2, 0]
        var len = 0
        guard sysctl(&mib, 6, nil, &len, nil, 0) == 0, len > 0 else { return nil }
        var buf = [UInt8](repeating: 0, count: len)
        guard sysctl(&mib, 6, &buf, &len, nil, 0) == 0 else { return nil }
        let want = if_nametoindex(name)
        guard want != 0 else { return nil }
        return buf.withUnsafeBytes { raw -> (UInt64, UInt64)? in
            var off = 0
            while off + MemoryLayout<if_msghdr>.size <= len {
                let hdr = raw.loadUnaligned(fromByteOffset: off, as: if_msghdr.self)
                guard hdr.ifm_msglen > 0 else { break }
                if Int32(hdr.ifm_type) == RTM_IFINFO2, off + MemoryLayout<if_msghdr2>.size <= len {
                    let m = raw.loadUnaligned(fromByteOffset: off, as: if_msghdr2.self)
                    if UInt32(m.ifm_index) == want { return (m.ifm_data.ifi_ibytes, m.ifm_data.ifi_obytes) }
                }
                off += Int(hdr.ifm_msglen)
            }
            return nil
        }
    }

    private func network(_ now: Double) -> [String: Any]? {
        if now - ifaceCheckedAt > 10 {  // follow Wi-Fi <-> Ethernet switches
            iface = primaryInterface()
            ifaceCheckedAt = now
        }
        guard let (rx, tx) = interfaceBytes(iface) else { prevNet = nil; return nil }
        defer { prevNet = (iface, rx, tx, now) }
        guard let p = prevNet, p.iface == iface, now > p.t, rx >= p.rx, tx >= p.tx else { return nil }
        let dt = now - p.t
        return ["rx": Double(rx - p.rx) / dt, "tx": Double(tx - p.tx) / dt, "iface": iface]
    }

    // MARK: disk (MB/s read + write over all block storage drivers)
    private func disk(_ now: Double) -> [String: Any]? {
        var iter: io_iterator_t = 0
        guard IOServiceGetMatchingServices(kIOMainPortDefault, IOServiceMatching("IOBlockStorageDriver"), &iter) == KERN_SUCCESS else { return nil }
        defer { IOObjectRelease(iter) }
        var total: UInt64 = 0
        while true {
            let s = IOIteratorNext(iter)
            if s == 0 { break }
            if let st = IORegistryEntryCreateCFProperty(s, "Statistics" as CFString, kCFAllocatorDefault, 0)?.takeRetainedValue() as? [String: Any] {
                total &+= ((st["Bytes (Read)"] as? NSNumber)?.uint64Value ?? 0) &+ ((st["Bytes (Write)"] as? NSNumber)?.uint64Value ?? 0)
            }
            IOObjectRelease(s)
        }
        defer { prevDisk = (total, now) }
        guard let p = prevDisk, now > p.t, total >= p.bytes else { return nil }
        return ["mbs": Double(total - p.bytes) / (now - p.t) / 1_048_576]
    }
}
