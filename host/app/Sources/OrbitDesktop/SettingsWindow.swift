import AppKit
import ServiceManagement
import SwiftUI

/// ログイン時に起動 (SMAppService), shared by the menu and the settings window.
enum LoginItem {
    static var isEnabled: Bool { SMAppService.mainApp.status == .enabled }

    /// Returns the resulting state; shows an alert when it could not be changed.
    @discardableResult
    static func set(_ on: Bool) -> Bool {
        let svc = SMAppService.mainApp
        do {
            if on { try svc.register() } else { try svc.unregister() }
        } catch {
            let a = NSAlert()
            a.messageText = "ログイン項目を変更できませんでした"
            a.informativeText = "\(error.localizedDescription)\nOrbit Desktop.app をアプリケーションフォルダに移してから、もう一度お試しください。"
            NSApp.activate(ignoringOtherApps: true)
            a.runModal()
        }
        return isEnabled
    }
}

/// "設定" window for ~/.config/orbit-desktop/settings.json (unknown keys are preserved).
/// Layout, modules, providers and page rotation live in the on-desktop editor (レイアウトを編集…).
final class SettingsModel: ObservableObject {
    static let intensities = ["なし", "1", "2", "3", "4", "5弱", "5強", "6弱", "6強", "7"]

    @Published var eewEnabled = true
    @Published var eewNotify = true
    @Published var eewPause = true
    @Published var minIntensity = "なし"
    @Published var pauseMin = "5弱"
    @Published var launchAtLogin = false
    @Published var status = ""

    var onNotifyEnabled: (() -> Void)?
    private var savedNotify = true

    func load() {
        let raw = AppSettings.readRaw()
        let d = AppSettings.defaults
        let e = (d["eew"] ?? [:]).merging(raw["eew"] as? [String: Any] ?? [:]) { $1 }
        eewEnabled = e["enabled"] as? Bool ?? true
        eewNotify = e["notify"] as? Bool ?? true
        eewPause = e["pause_music"] as? Bool ?? true
        minIntensity = (e["min_intensity"] as? String).flatMap { Self.intensities.contains($0) ? $0 : nil } ?? "なし"
        pauseMin = (e["pause_min_intensity"] as? String).flatMap { Self.intensities.dropFirst().contains($0) ? $0 : nil } ?? "5弱"
        savedNotify = eewEnabled && eewNotify
        launchAtLogin = LoginItem.isEnabled
    }

    func save() {
        var raw = AppSettings.readRaw()
        var e = raw["eew"] as? [String: Any] ?? [:]
        e["enabled"] = eewEnabled
        e["notify"] = eewNotify
        e["pause_music"] = eewPause
        e["min_intensity"] = minIntensity == "なし" ? NSNull() : minIntensity
        e["pause_min_intensity"] = pauseMin
        raw["eew"] = e
        if let err = AppSettings.writeRaw(raw) {
            status = "保存できませんでした: \(err.localizedDescription)"
            return
        }
        status = "保存しました（すぐに反映されます）"
        if eewEnabled && eewNotify && !savedNotify { onNotifyEnabled?() }
        savedNotify = eewEnabled && eewNotify
    }
}

struct SettingsView: View {
    @ObservedObject var m: SettingsModel

    var body: some View {
        Form {
            Section("全般") {
                Toggle("ログイン時に起動", isOn: Binding(get: { m.launchAtLogin },
                                                  set: { m.launchAtLogin = LoginItem.set($0) }))
                Text("配置・表示する項目・ページ切り替えは、メニューの「レイアウトを編集…」から壁紙の上で変更できます。")
                    .font(.caption).foregroundStyle(.secondary)
            }
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
            HStack {
                Button("保存") { m.save() }.keyboardShortcut(.defaultAction)
                Button("元に戻す") { m.load(); m.status = "" }
                Button("設定ファイルを表示") { revealSettingsFile() }
                Spacer()
                Text(m.status).font(.caption).foregroundStyle(.secondary)
            }
        }
        .formStyle(.grouped)
        .frame(width: 480, height: 440)
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
        if window == nil {
            let w = NSWindow(contentRect: .zero, styleMask: [.titled, .closable], backing: .buffered, defer: false)
            w.title = "設定"
            w.contentView = NSHostingView(rootView: SettingsView(m: model))
            w.isReleasedWhenClosed = false
            w.center()
            window = w
        }
        NSApp.activate(ignoringOtherApps: true)
        window?.makeKeyAndOrderFront(nil)
    }
}
