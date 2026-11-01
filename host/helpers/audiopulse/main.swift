// AudioPulse (Orbit Desktop helper, MIT): captures system audio output via a Core Audio process tap (macOS 14.2+),
// computes level + bass/mid/high band energies, and writes them ~20x/s to a small JSON file.
// No network access. Requires "System Audio Recording Only" permission (asked once).
import Foundation
import CoreAudio
import AudioToolbox
import Accelerate

// Output path: first CLI argument, default ~/Library/Caches/orbit-desktop/audiopulse.json
let outPath = CommandLine.arguments.count > 1 ? (CommandLine.arguments[1] as NSString).expandingTildeInPath
    : (NSHomeDirectory() as NSString).appendingPathComponent("Library/Caches/orbit-desktop/audiopulse.json")
try? FileManager.default.createDirectory(atPath: (outPath as NSString).deletingLastPathComponent, withIntermediateDirectories: true)
let tmpPath = outPath + ".tmp"

func prop<T>(_ obj: AudioObjectID, _ sel: AudioObjectPropertySelector, _ def: T) -> T {
    var addr = AudioObjectPropertyAddress(mSelector: sel, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
    var size = UInt32(MemoryLayout<T>.size); var v = def
    _ = AudioObjectGetPropertyData(obj, &addr, 0, nil, &size, &v); return v
}

// default output device UID (the aggregate device clocks off it)
let outDev: AudioObjectID = prop(AudioObjectID(kAudioObjectSystemObject), kAudioHardwarePropertyDefaultOutputDevice, AudioObjectID(0))
var uidAddr = AudioObjectPropertyAddress(mSelector: kAudioDevicePropertyDeviceUID, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
var uidRef: Unmanaged<CFString>?; var uidSize = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
AudioObjectGetPropertyData(outDev, &uidAddr, 0, nil, &uidSize, &uidRef)
let outUID = (uidRef?.takeRetainedValue() as String?) ?? ""

let tap = CATapDescription(stereoGlobalTapButExcludeProcesses: [])
tap.uuid = UUID(); tap.isPrivate = true; tap.muteBehavior = .unmuted
var tapID = AudioObjectID(kAudioObjectUnknown)
guard AudioHardwareCreateProcessTap(tap, &tapID) == noErr else { FileHandle.standardError.write("tap failed (permission?)\n".data(using: .utf8)!); exit(1) }

let agg: [String: Any] = [
    kAudioAggregateDeviceNameKey: "AudioPulse", kAudioAggregateDeviceUIDKey: UUID().uuidString,
    kAudioAggregateDeviceMainSubDeviceKey: outUID, kAudioAggregateDeviceIsPrivateKey: true, kAudioAggregateDeviceIsStackedKey: false,
    kAudioAggregateDeviceTapAutoStartKey: true,
    kAudioAggregateDeviceSubDeviceListKey: [[kAudioSubDeviceUIDKey: outUID]],
    kAudioAggregateDeviceTapListKey: [[kAudioSubTapDriftCompensationKey: true, kAudioSubTapUIDKey: tap.uuid.uuidString]],
]
var aggID = AudioObjectID(kAudioObjectUnknown)
guard AudioHardwareCreateAggregateDevice(agg as CFDictionary, &aggID) == noErr else { FileHandle.standardError.write("aggregate failed\n".data(using: .utf8)!); exit(1) }

let sampleRate: Float64 = prop(aggID, kAudioDevicePropertyNominalSampleRate, Float64(48000))
let N = 2048, log2n = vDSP_Length(11)
let fft = vDSP_create_fftsetup(log2n, FFTRadix(kFFTRadix2))!
var ring = [Float](repeating: 0, count: N), ringPos = 0
var window = [Float](repeating: 0, count: N); vDSP_hann_window(&window, vDSP_Length(N), Int32(vDSP_HANN_NORM))
var lastWrite = 0.0
var callbacks = 0
let q = DispatchQueue(label: "audiopulse.write")

func bandEnergy(_ mag: [Float], _ lo: Double, _ hi: Double) -> Float {
    let bin = sampleRate / Double(N)
    let a = max(1, Int(lo / bin)), b = min(N / 2 - 1, Int(hi / bin))
    guard b > a else { return 0 }
    var s: Float = 0; vDSP_meanv(Array(mag[a...b]), 1, &s, vDSP_Length(b - a + 1)); return s
}

func analyze() {
    var x = [Float](repeating: 0, count: N)
    for i in 0..<N { x[i] = ring[(ringPos + i) % N] }
    var rms: Float = 0; vDSP_rmsqv(x, 1, &rms, vDSP_Length(N))
    vDSP_vmul(x, 1, window, 1, &x, 1, vDSP_Length(N))
    var re = [Float](repeating: 0, count: N / 2), im = [Float](repeating: 0, count: N / 2)
    var mag = [Float](repeating: 0, count: N / 2)
    re.withUnsafeMutableBufferPointer { rp in im.withUnsafeMutableBufferPointer { ip in
        var sc = DSPSplitComplex(realp: rp.baseAddress!, imagp: ip.baseAddress!)
        x.withUnsafeBufferPointer { xp in xp.baseAddress!.withMemoryRebound(to: DSPComplex.self, capacity: N / 2) { vDSP_ctoz($0, 2, &sc, 1, vDSP_Length(N / 2)) } }
        vDSP_fft_zrip(fft, &sc, 1, log2n, FFTDirection(FFT_FORWARD))
        vDSP_zvabs(&sc, 1, &mag, 1, vDSP_Length(N / 2))
    } }
    let k: Float = 1.0 / Float(N)
    let bass = bandEnergy(mag, 25, 160) * k, mid = bandEnergy(mag, 160, 2000) * k, high = bandEnergy(mag, 2000, 10000) * k
    // 16 log-spaced bands, 40 Hz – 12 kHz (for the aurora shape)
    var bands: [String] = []
    let lo = log(40.0), hi = log(12000.0)
    for i in 0..<16 {
        let a = exp(lo + (hi - lo) * Double(i) / 16), b = exp(lo + (hi - lo) * Double(i + 1) / 16)
        bands.append(String(format: "%.5f", bandEnergy(mag, a, b) * k))
    }
    let json = String(format: "{\"level\":%.4f,\"bass\":%.4f,\"mid\":%.4f,\"high\":%.4f,\"bands\":[%@],\"ts\":%.3f}\n", rms, bass, mid, high, bands.joined(separator: ","), Date().timeIntervalSince1970)
    q.async { try? json.write(toFile: tmpPath, atomically: false, encoding: .utf8); rename(tmpPath, outPath) }
}

var procID: AudioDeviceIOProcID?
AudioDeviceCreateIOProcIDWithBlock(&procID, aggID, nil) { _, inData, _, _, _ in
    let abl = UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: inData))
    for buf in abl {
        guard let p = buf.mData?.assumingMemoryBound(to: Float.self) else { continue }
        let ch = max(1, Int(buf.mNumberChannels)), frames = Int(buf.mDataByteSize) / (4 * ch)
        for f in 0..<frames {
            var s: Float = 0; for c in 0..<ch { s += p[f * ch + c] }
            ring[ringPos] = s / Float(ch); ringPos = (ringPos + 1) % N
        }
        break
    }
    let now = Date().timeIntervalSince1970
    callbacks += 1
    if callbacks == 1 { FileHandle.standardError.write("first callback\n".data(using: .utf8)!) }
    if now - lastWrite > 0.05 { lastWrite = now; analyze() }
}
let st = AudioDeviceStart(aggID, procID)
FileHandle.standardError.write("start=\(st) agg=\(aggID) tap=\(tapID) out=\(outUID) sr=\(sampleRate)\n".data(using: .utf8)!)
signal(SIGTERM) { _ in exit(0) }
RunLoop.main.run()
