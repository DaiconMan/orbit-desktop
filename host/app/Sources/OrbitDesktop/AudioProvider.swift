import Foundation
import CoreAudio
import AudioToolbox
import Accelerate

/// The `audio` signal: taps the system audio output with a Core Audio process tap (macOS 14.2+),
/// computes level + bass/mid/high + 16 log-spaced bands and writes host-dir/audio.json ~20×/s.
/// Only levels leave this class; no audio is stored. Needs "System Audio Recording Only" permission.
/// During silence it writes once a second instead of 20×/s, so the whole pipeline idles.
@available(macOS 14.2, *)
final class AudioProvider {
    private let out = Paths.hostDir.appendingPathComponent("audio.json")
    private let writeQueue = DispatchQueue(label: "orbit.audio.write", qos: .utility)
    /// Core Audio set-up/tear-down can block (e.g. while the permission prompt is open), so it
    /// never runs on the main thread.
    private let control = DispatchQueue(label: "orbit.audio.control", qos: .utility)
    private var tapID = AudioObjectID(kAudioObjectUnknown)
    private var aggID = AudioObjectID(kAudioObjectUnknown)
    private var procID: AudioDeviceIOProcID?
    private var deviceListener: AudioObjectPropertyListenerBlock?
    private(set) var running = false
    var lastError: String?

    // analysis state (touched only on the IO thread)
    private let N = 2048
    private let log2n = vDSP_Length(11)
    private let fft: FFTSetup
    private var ring: [Float]
    private var ringPos = 0
    private var window: [Float]
    private var sampleRate: Double = 48000
    private var lastWrite = 0.0
    private var silentSince = 0.0

    init() {
        fft = vDSP_create_fftsetup(log2n, FFTRadix(kFFTRadix2))!
        ring = [Float](repeating: 0, count: N)
        window = [Float](repeating: 0, count: N)
        vDSP_hann_window(&window, vDSP_Length(N), Int32(vDSP_HANN_NORM))
    }

    deinit {
        vDSP_destroy_fftsetup(fft)
    }

    func start() {
        control.async { [self] in
            guard !running else { return }
            do {
                try setUp()
                running = true
                lastError = nil
                listenForDeviceChanges()
            } catch {
                lastError = "\(error)"
                tearDown()
                NSLog("[orbit] audio: \(error)")
            }
        }
    }

    func stop() {
        control.async { [self] in
            removeDeviceListener()
            tearDown()
            running = false
        }
    }

    // MARK: setup / teardown
    private struct AudioError: Error, CustomStringConvertible { let description: String }

    private static func prop<T: BitwiseCopyable>(_ obj: AudioObjectID, _ sel: AudioObjectPropertySelector, _ def: T) -> T {
        var addr = AudioObjectPropertyAddress(mSelector: sel, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
        var size = UInt32(MemoryLayout<T>.size)
        var v = def
        _ = AudioObjectGetPropertyData(obj, &addr, 0, nil, &size, &v)
        return v
    }

    private func defaultOutputUID() -> String {
        let dev: AudioObjectID = Self.prop(AudioObjectID(kAudioObjectSystemObject), kAudioHardwarePropertyDefaultOutputDevice, AudioObjectID(0))
        var addr = AudioObjectPropertyAddress(mSelector: kAudioDevicePropertyDeviceUID, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
        var ref: Unmanaged<CFString>?
        var size = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
        guard AudioObjectGetPropertyData(dev, &addr, 0, nil, &size, &ref) == noErr else { return "" }
        return (ref?.takeRetainedValue() as String?) ?? ""
    }

    private func setUp() throws {
        let outUID = defaultOutputUID()
        let tap = CATapDescription(stereoGlobalTapButExcludeProcesses: [])
        tap.uuid = UUID()
        tap.isPrivate = true
        tap.muteBehavior = .unmuted
        guard AudioHardwareCreateProcessTap(tap, &tapID) == noErr else {
            throw AudioError(description: "process tap failed (System Audio Recording permission denied?)")
        }
        let agg: [String: Any] = [
            kAudioAggregateDeviceNameKey: "Orbit Desktop Tap", kAudioAggregateDeviceUIDKey: UUID().uuidString,
            kAudioAggregateDeviceMainSubDeviceKey: outUID, kAudioAggregateDeviceIsPrivateKey: true,
            kAudioAggregateDeviceIsStackedKey: false, kAudioAggregateDeviceTapAutoStartKey: true,
            kAudioAggregateDeviceSubDeviceListKey: [[kAudioSubDeviceUIDKey: outUID]],
            kAudioAggregateDeviceTapListKey: [[kAudioSubTapDriftCompensationKey: true, kAudioSubTapUIDKey: tap.uuid.uuidString]],
        ]
        guard AudioHardwareCreateAggregateDevice(agg as CFDictionary, &aggID) == noErr else {
            throw AudioError(description: "aggregate device failed")
        }
        sampleRate = Self.prop(aggID, kAudioDevicePropertyNominalSampleRate, Float64(48000))
        let status = AudioDeviceCreateIOProcIDWithBlock(&procID, aggID, nil) { [weak self] _, inData, _, _, _ in
            self?.ingest(inData)
        }
        guard status == noErr, procID != nil else { throw AudioError(description: "IOProc failed (\(status))") }
        guard AudioDeviceStart(aggID, procID) == noErr else { throw AudioError(description: "device start failed") }
    }

    private func tearDown() {
        if aggID != kAudioObjectUnknown {
            if let p = procID {
                AudioDeviceStop(aggID, p)
                AudioDeviceDestroyIOProcID(aggID, p)
            }
            AudioHardwareDestroyAggregateDevice(aggID)
        }
        if tapID != kAudioObjectUnknown { AudioHardwareDestroyProcessTap(tapID) }
        procID = nil
        aggID = AudioObjectID(kAudioObjectUnknown)
        tapID = AudioObjectID(kAudioObjectUnknown)
    }

    /// Headphones plugged in, AirPlay picked, …: rebuild the tap on the new output device.
    private func listenForDeviceChanges() {
        var addr = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyDefaultOutputDevice,
                                              mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
        let block: AudioObjectPropertyListenerBlock = { [weak self] _, _ in
            guard let self, self.running else { return }
            self.tearDown()
            do { try self.setUp() } catch { self.lastError = "\(error)"; self.running = false }
        }
        deviceListener = block
        AudioObjectAddPropertyListenerBlock(AudioObjectID(kAudioObjectSystemObject), &addr, control, block)
    }

    private func removeDeviceListener() {
        guard let block = deviceListener else { return }
        var addr = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyDefaultOutputDevice,
                                              mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
        AudioObjectRemovePropertyListenerBlock(AudioObjectID(kAudioObjectSystemObject), &addr, control, block)
        deviceListener = nil
    }

    // MARK: IO thread
    private func ingest(_ inData: UnsafePointer<AudioBufferList>) {
        let abl = UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: inData))
        if let buf = abl.first, let p = buf.mData?.assumingMemoryBound(to: Float.self) {
            let ch = max(1, Int(buf.mNumberChannels)), frames = Int(buf.mDataByteSize) / (4 * ch)
            for f in 0..<frames {
                var s: Float = 0
                for c in 0..<ch { s += p[f * ch + c] }
                ring[ringPos] = s / Float(ch)
                ringPos = (ringPos + 1) % N
            }
        }
        let now = Date().timeIntervalSince1970
        if now - lastWrite > 0.05 { analyze(now) }
    }

    private func bandEnergy(_ mag: [Float], _ lo: Double, _ hi: Double) -> Float {
        let bin = sampleRate / Double(N)
        let a = max(1, Int(lo / bin)), b = min(N / 2 - 1, Int(hi / bin))
        guard b > a else { return 0 }
        var s: Float = 0
        mag.withUnsafeBufferPointer { vDSP_meanv($0.baseAddress! + a, 1, &s, vDSP_Length(b - a + 1)) }
        return s
    }

    private func analyze(_ now: Double) {
        var x = [Float](repeating: 0, count: N)
        for i in 0..<N { x[i] = ring[(ringPos + i) % N] }
        var rms: Float = 0
        vDSP_rmsqv(x, 1, &rms, vDSP_Length(N))
        if rms < 1e-5 {  // silence: one frame per second keeps the stream alive
            if silentSince == 0 { silentSince = now }
            if now - silentSince > 0.5 && now - lastWrite < 1.0 { return }
        } else {
            silentSince = 0
        }
        lastWrite = now
        vDSP_vmul(x, 1, window, 1, &x, 1, vDSP_Length(N))
        var re = [Float](repeating: 0, count: N / 2), im = [Float](repeating: 0, count: N / 2)
        var mag = [Float](repeating: 0, count: N / 2)
        re.withUnsafeMutableBufferPointer { rp in
            im.withUnsafeMutableBufferPointer { ip in
                var sc = DSPSplitComplex(realp: rp.baseAddress!, imagp: ip.baseAddress!)
                x.withUnsafeBufferPointer { xp in
                    xp.baseAddress!.withMemoryRebound(to: DSPComplex.self, capacity: N / 2) { vDSP_ctoz($0, 2, &sc, 1, vDSP_Length(N / 2)) }
                }
                vDSP_fft_zrip(fft, &sc, 1, log2n, FFTDirection(FFT_FORWARD))
                vDSP_zvabs(&sc, 1, &mag, 1, vDSP_Length(N / 2))
            }
        }
        let k: Float = 1.0 / Float(N)
        let bass = bandEnergy(mag, 25, 160) * k, mid = bandEnergy(mag, 160, 2000) * k, high = bandEnergy(mag, 2000, 10000) * k
        var bands: [String] = []
        let lo = log(40.0), hi = log(12000.0)
        for i in 0..<16 {
            let a = exp(lo + (hi - lo) * Double(i) / 16), b = exp(lo + (hi - lo) * Double(i + 1) / 16)
            bands.append(String(format: "%.5f", bandEnergy(mag, a, b) * k))
        }
        let json = String(format: "{\"level\":%.4f,\"bass\":%.4f,\"mid\":%.4f,\"high\":%.4f,\"bands\":[%@],\"ts\":%.3f}\n",
                          rms, bass, mid, high, bands.joined(separator: ","), now)
        let url = out
        writeQueue.async { Paths.writeAtomic(Data(json.utf8), to: url) }
    }
}
