#!/usr/bin/env bash
#
# Builds the release .app and packages it into a DMG.
#
# Tauri's own DMG step can't run non-interactively: bundle_dmg.sh drives Finder
# via AppleScript to lay out the window icons, which needs an Automation
# permission prompt that a headless shell never gets. The script has a
# --sandbox-safe flag that skips exactly that step, so this invokes it directly.
#
# The source argument is the directory *containing* the .app, not the .app
# itself — bundle_dmg.sh does `cd "$2"` and copies the contents, so passing
# tabili.app produces a disk image with a bare Contents/ folder at its root and
# no application to drag across.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

VERSION=$(node -p "require('./src-tauri/tauri.conf.json').version")
PRODUCT=$(node -p "require('./src-tauri/tauri.conf.json').productName")
case "$(uname -m)" in
	arm64) ARCH="aarch64" ;;
	*) ARCH="$(uname -m)" ;;
esac

BUNDLE_DIR="src-tauri/target/release/bundle"
DMG_DIR="$BUNDLE_DIR/dmg"
DMG_NAME="${PRODUCT}_${VERSION}_${ARCH}.dmg"

echo "==> Building ${PRODUCT} ${VERSION} (${ARCH})"
npx tauri build --bundles app

# bundle_dmg.sh and its support files are emitted by Tauri's bundler and live
# under target/, so a cargo clean takes them with it. Asking for a dmg bundle
# writes them back out; the Finder step then fails, which is expected and why
# the failure is swallowed.
if [[ ! -x "$DMG_DIR/bundle_dmg.sh" ]]; then
	echo "==> Restoring bundle_dmg.sh (its Finder step is expected to fail)"
	npx tauri build --bundles dmg || true
fi

echo "==> Packaging $DMG_NAME"
cd "$DMG_DIR"
rm -f "$DMG_NAME"
./bundle_dmg.sh \
	--volname "$PRODUCT" \
	--icon "${PRODUCT}.app" 180 170 \
	--app-drop-link 480 170 \
	--window-size 660 400 \
	--hide-extension "${PRODUCT}.app" \
	--sandbox-safe \
	"$DMG_NAME" \
	../macos

# A DMG whose root holds Contents/ instead of the .app mounts fine and installs
# nothing, and the packaging step reports success either way — so verify.
echo "==> Verifying"
MOUNT=$(mktemp -d)
hdiutil attach "$DMG_NAME" -nobrowse -mountpoint "$MOUNT" -quiet
trap 'hdiutil detach "$MOUNT" -quiet 2>/dev/null || true; rmdir "$MOUNT" 2>/dev/null || true' EXIT
if [[ ! -x "$MOUNT/${PRODUCT}.app/Contents/MacOS/${PRODUCT}" ]]; then
	echo "FAILED: ${PRODUCT}.app is missing or has no executable inside the image" >&2
	exit 1
fi
echo "OK: $(cd "$(dirname "$DMG_NAME")" && pwd)/$DMG_NAME"
