// swift-tools-version:5.10
// Orbit Desktop host app. Build the .app bundle with ./build.sh (plain `swift build` gives a bare
// executable without Info.plist, so macOS permission prompts would not work).
import PackageDescription

let package = Package(
    name: "OrbitDesktop",
    platforms: [.macOS(.v14)],
    targets: [
        .executableTarget(
            name: "OrbitDesktop",
            path: "Sources/OrbitDesktop",
            linkerSettings: [
                .linkedFramework("AppKit"), .linkedFramework("WebKit"), .linkedFramework("EventKit"),
                .linkedFramework("CoreAudio"), .linkedFramework("AudioToolbox"), .linkedFramework("Accelerate"),
                .linkedFramework("IOKit"), .linkedFramework("SystemConfiguration"),
                .linkedFramework("SwiftUI"), .linkedFramework("UserNotifications"),
            ]
        ),
    ]
)
