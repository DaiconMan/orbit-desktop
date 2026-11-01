// Orbit Desktop host app (MIT). Shows the Orbit runtime page on the desktop of every screen,
// runs the dev server as a child process and feeds it native providers, so every macOS
// permission (audio capture, calendars, automation) belongs to this one app.
import AppKit

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
