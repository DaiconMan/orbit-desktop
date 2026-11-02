// snap: render a URL in an off-screen WKWebView (same engine as the host app) and save a PNG.
//   swift tools/snap.swift <url> <out.png> [WIDTHxHEIGHT] [wait-seconds] [js-expression-to-print]
// e.g. swift tools/snap.swift "http://127.0.0.1:47911/?page=2" /tmp/p2.png 1710x1112 8
// If `swift` fails with an Xcode license error, prefix DEVELOPER_DIR=/Library/Developer/CommandLineTools.
import AppKit
import WebKit

let args = CommandLine.arguments
guard args.count >= 3, let url = URL(string: args[1]) else {
    FileHandle.standardError.write("usage: snap <url> <out.png> [WxH] [wait]\n".data(using: .utf8)!)
    exit(2)
}
let out = URL(fileURLWithPath: args[2])
let dims = (args.count > 3 ? args[3] : "1710x1112").split(separator: "x").compactMap { Double($0) }
let size = NSSize(width: dims.count == 2 ? dims[0] : 1710, height: dims.count == 2 ? dims[1] : 1112)
let wait = args.count > 4 ? Double(args[4]) ?? 8 : 8

let app = NSApplication.shared
app.setActivationPolicy(.prohibited)
let win = NSWindow(contentRect: NSRect(origin: NSPoint(x: -30000, y: -30000), size: size), styleMask: .borderless, backing: .buffered, defer: false)
let cfg = WKWebViewConfiguration()
cfg.websiteDataStore = .nonPersistent()
let wv = WKWebView(frame: NSRect(origin: .zero, size: size), configuration: cfg)
win.contentView = wv
// keep rendering although the window is off-screen (WebKit otherwise treats it as occluded and stops painting)
let occl = NSSelectorFromString("_setWindowOcclusionDetectionEnabled:")
if wv.responds(to: occl), let imp = wv.method(for: occl) {
    typealias SetBool = @convention(c) (AnyObject, Selector, Bool) -> Void
    unsafeBitCast(imp, to: SetBool.self)(wv, occl, false)
}
win.level = .normal  // placed far off-screen: the user never sees it
win.orderFrontRegardless()  // "visible" so timers and rAF run
wv.load(URLRequest(url: url))

let js = args.count > 5 ? args[5] : nil
DispatchQueue.main.asyncAfter(deadline: .now() + wait) {
    if let js {
        wv.evaluateJavaScript(js) { r, e in print("js:", r ?? "nil", e.map { "\($0)" } ?? "") }
    }
    let c = WKSnapshotConfiguration()
    c.rect = NSRect(origin: .zero, size: size)
    wv.takeSnapshot(with: c) { img, err in
        guard let img, let tiff = img.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff),
              let png = rep.representation(using: .png, properties: [:]) else {
            FileHandle.standardError.write("snapshot failed: \(String(describing: err))\n".data(using: .utf8)!)
            exit(1)
        }
        try? png.write(to: out)
        print(out.path)
        exit(0)
    }
}
app.run()
