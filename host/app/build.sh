#!/bin/sh
# Build "Orbit Desktop.app" from source (no Xcode needed; Command Line Tools are enough).
#
#   host/app/build.sh                 # -> host/app/build/Orbit Desktop.app
#   host/app/build.sh --install       # also copy it to ~/Applications and (re)launch it
#
# Signing: ad-hoc by default. macOS ties permission grants (calendar, audio capture,
# automation) to the code signature, and an ad-hoc signature changes on every build, so
# grants reset after each rebuild. To keep them, create a self-signed "Code Signing"
# certificate in Keychain Access (Certificate Assistant > Create a Certificate…) and run
#   ORBIT_SIGN_IDENTITY="Orbit Desktop Dev" host/app/build.sh
set -eu

HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../.." && pwd)
APP="$HERE/build/Orbit Desktop.app"
IDENTITY=${ORBIT_SIGN_IDENTITY:--}

cd "$HERE"
# A selected Xcode whose license was never accepted breaks swift/xcrun; fall back to the CLT.
CLT=/Library/Developer/CommandLineTools
if [ -z "${DEVELOPER_DIR:-}" ] && ! xcrun --find swift >/dev/null 2>&1 && [ -d "$CLT" ]; then
  export DEVELOPER_DIR="$CLT"
  echo "note: using $CLT (the selected Xcode is not usable)"
fi
swift build -c release
BIN=$(swift build -c release --show-bin-path)/OrbitDesktop

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/orbit/host"
cp "$BIN" "$APP/Contents/MacOS/OrbitDesktop"
cp "$HERE/Support/Info.plist" "$APP/Contents/Info.plist"

# The runtime, plugins and dev server travel inside the bundle (read-only). To live-edit a
# checkout instead: defaults write io.github.daiconman.orbit-desktop repoPath "$REPO"
R="$APP/Contents/Resources/orbit"
cp -R "$REPO/runtime" "$REPO/widgets" "$REPO/examples" "$R/"
mkdir -p "$R/host/dev-server"
cp "$REPO"/host/dev-server/*.py "$R/host/dev-server/"
cp "$REPO/LICENSE" "$REPO/THIRD_PARTY_NOTICES.md" "$R/"
find "$R" \( -name '__pycache__' -o -name '.DS_Store' \) -prune -exec rm -rf {} +

codesign --force --sign "$IDENTITY" --identifier io.github.daiconman.orbit-desktop "$APP"
echo "built: $APP (signed: $IDENTITY)"

if [ "${1:-}" = "--install" ]; then
  DEST="$HOME/Applications/Orbit Desktop.app"
  osascript -e 'tell application id "io.github.daiconman.orbit-desktop" to quit' 2>/dev/null || true
  sleep 1
  mkdir -p "$HOME/Applications"
  rm -rf "$DEST"
  cp -R "$APP" "$DEST"
  open "$DEST"
  echo "installed: $DEST"
fi
