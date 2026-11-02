import AppKit
import SwiftUI

/// "壁紙の設定" window for ~/.config/orbit-desktop/settings.json (unknown keys are preserved).
/// Port of the prototype's settings window; the module list comes from the running layout.
final class SettingsModel: ObservableObject {
    static let intensities = ["なし", "1", "2", "3", "4", "5弱", "5強", "6弱", "6強", "7"]

    @Published var eewEnabled = true
    @Published var eewNotify = true
    @Published var eewPause = true
    @Published var minIntensity = "なし"
    @Published var pauseMin = "5弱"
    @Published var hidden: Set<String> = []
    @Published var pageSeconds = 30.0
    @Published var modules: [(id: String, name: String)] = []
    @Published var status = ""

    var onSaved: (() -> Void)?
    var onNotifyEnabled: (() -> Void)?
    private var layoutModules: [(id: String, name: String)] = []
    private var savedNotify = true

    func load() {
        let raw = AppSettings.readRaw()
        let d = AppSettings.defaults
        let e = (d["eew"] ?? [:]).merging(raw["eew"] as? [String: Any] ?? [:]) { $1 }
        let w = (d["wallpaper"] ?? [:]).merging(raw["wallpaper"] as? [String: Any] ?? [:]) { $1 }
        eewEnabled = e["enabled"] as? Bool ?? true
        eewNotify = e["notify"] as? Bool ?? true
        eewPause = e["pause_music"] as? Bool ?? true
        minIntensity = (e["min_intensity"] as? String).flatMap { Self.intensities.contains($0) ? $0 : nil } ?? "なし"
        pauseMin = (e["pause_min_intensity"] as? String).flatMap { Self.intensities.dropFirst().contains($0) ? $0 : nil } ?? "5弱"
        hidden = Set(w["hidden"] as? [String] ?? [])
        pageSeconds = (w["page_seconds"] as? NSNumber)?.doubleValue ?? 30
        savedNotify = eewEnabled && eewNotify
        rebuildModules()
    }

    /// Widget instances of the active layout (`use` + `name`, unique by `use`).
    func fetchModules() {
        OrbitAPI.get("/api/config") { [weak self] obj in
            guard let self else { return }
            var seen = Set<String>()
            var list: [(id: String, name: String)] = []
            for w in ((obj as? [String: Any])?["widgets"] as? [[String: Any]]) ?? [] {
                guard let use = w["use"] as? String, seen.insert(use).inserted else { continue }
                list.append((use, (w["name"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? use))
            }
            self.layoutModules = list
            self.rebuildModules()
        }
    }

    private func rebuildModules() {
        var list = layoutModules
        let known = Set(list.map(\.id))
        for id in hidden.sorted() where !known.contains(id) { list.append((id, "\(id)（現在のレイアウトにはありません）")) }
        modules = list
    }

    func save() {
        var raw = AppSettings.readRaw()
        var e = raw["eew"] as? [String: Any] ?? [:], w = raw["wallpaper"] as? [String: Any] ?? [:]
        e["enabled"] = eewEnabled
        e["notify"] = eewNotify
        e["pause_music"] = eewPause
        e["min_intensity"] = minIntensity == "なし" ? NSNull() : minIntensity
        e["pause_min_intensity"] = pauseMin
        let order = modules.map(\.id)
        w["hidden"] = order.filter { hidden.contains($0) } + hidden.subtracting(order).sorted()
        w["page_seconds"] = Int(pageSeconds)
        raw["eew"] = e
        raw["wallpaper"] = w
        if let err = AppSettings.writeRaw(raw) {
            status = "保存できませんでした: \(err.localizedDescription)"
            return
        }
        status = "保存しました（すぐに壁紙に反映されます）"
        if eewEnabled && eewNotify && !savedNotify { onNotifyEnabled?() }
        savedNotify = eewEnabled && eewNotify
        onSaved?()
    }
}

struct SettingsView: View {
    @ObservedObject var m: SettingsModel

    var body: some View {
        Form {
            Section("緊急地震速報") {
                Toggle("緊急地震速報を使う（受信・表示）", isOn: $m.eewEnabled)
                Toggle("Mac の通知と警告音", isOn: $m.eewNotify).disabled(!m.eewEnabled)
                Toggle("強い揺れのときは音楽を一時停止", isOn: $m.eewPause).disabled(!m.eewEnabled)
                Picker("表示する予想震度の下限", selection: $m.minIntensity) {
                    ForEach(SettingsModel.intensities, id: \.self) { Text($0) }
                }.disabled(!m.eewEnabled)
                Picker("音楽を止める予想震度", selection: $m.pauseMin) {
                    ForEach(SettingsModel.intensities.dropFirst(), id: \.self) { Text($0) }
                }.disabled(!m.eewEnabled || !m.eewPause)
            }
            Section("壁紙のモジュール") {
                if m.modules.isEmpty { Text("レイアウトを読み込み中…").foregroundStyle(.secondary) }
                ForEach(m.modules, id: \.id) { mod in
                    Toggle(mod.name, isOn: Binding(get: { !m.hidden.contains(mod.id) },
                                                   set: { if $0 { m.hidden.remove(mod.id) } else { m.hidden.insert(mod.id) } }))
                }
                HStack {
                    Text("中央のページ切り替え")
                    Slider(value: $m.pageSeconds, in: 10...120, step: 5)
                    Text("\(Int(m.pageSeconds))秒").monospacedDigit().frame(width: 48)
                }
            }
            HStack {
                Button("保存") { m.save() }.keyboardShortcut(.defaultAction)
                Button("元に戻す") { m.load(); m.status = "" }
                Button("設定ファイルを表示") { revealSettingsFile() }
                Spacer()
                Text(m.status).font(.caption).foregroundStyle(.secondary)
            }
        }
        .formStyle(.grouped)
        .frame(width: 480, height: 600)
    }

    private func revealSettingsFile() {
        if !FileManager.default.fileExists(atPath: AppSettings.url.path) { m.save() }
        NSWorkspace.shared.activateFileViewerSelecting([AppSettings.url])
    }
}

final class SettingsWindowController {
    let model = SettingsModel()
    private var window: NSWindow?

    func show() {
        model.load()
        model.status = ""
        model.fetchModules()
        if window == nil {
            let w = NSWindow(contentRect: .zero, styleMask: [.titled, .closable], backing: .buffered, defer: false)
            w.title = "壁紙の設定"
            w.contentView = NSHostingView(rootView: SettingsView(m: model))
            w.isReleasedWhenClosed = false
            w.center()
            window = w
        }
        NSApp.activate(ignoringOtherApps: true)
        window?.makeKeyAndOrderFront(nil)
    }
}
