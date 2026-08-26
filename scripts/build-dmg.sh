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

# Universal by default so one image runs on both Apple Silicon and Intel. An
# arm64-only build will not start on an Intel Mac at all: Rosetta translates
# x86_64 to ARM, never the other way. Override with TABILI_TARGET to build a
# single-architecture image (e.g. aarch64-apple-darwin) when iterating.
TARGET="${TABILI_TARGET:-universal-apple-darwin}"
case "$TARGET" in
	universal-apple-darwin) ARCH="universal" ;;
	x86_64-apple-darwin) ARCH="x64" ;;
	aarch64-apple-darwin) ARCH="aarch64" ;;
	*) ARCH="$TARGET" ;;
esac

BUNDLE_DIR="src-tauri/target/${TARGET}/release/bundle"
DMG_DIR="$BUNDLE_DIR/dmg"
DMG_NAME="${PRODUCT}_${VERSION}_${ARCH}.dmg"

# bundle_dmg.sh and its support files are emitted by Tauri's bundler and live
# under target/, so a cargo clean takes them with it. Asking for a dmg bundle
# writes them back out; its Finder step then fails, which is expected.
#
# This runs BEFORE the app build on purpose. The failed step leaves a temporary
# read-write image behind in the bundle directory, and packaging that instead of
# the app produces a disk image containing a stray .dmg and no application —
# which still mounts, so nothing downstream notices. Building the app afterwards
# leaves the directory clean and current.
if [[ ! -x "$DMG_DIR/bundle_dmg.sh" ]]; then
	echo "==> Restoring bundle_dmg.sh (its Finder step is expected to fail)"
	npx tauri build --target "$TARGET" --bundles dmg || true
fi

echo "==> Building ${PRODUCT} ${VERSION} (${TARGET})"
npx tauri build --target "$TARGET" --bundles app

# Any temporary image left by an interrupted or failed bundling run.
rm -f "$BUNDLE_DIR"/macos/rw.*.dmg "$DMG_DIR"/rw.*.dmg

if [[ ! -d "$BUNDLE_DIR/macos/${PRODUCT}.app" ]]; then
	echo "FAILED: ${BUNDLE_DIR}/macos/${PRODUCT}.app was not produced" >&2
	ls -la "$BUNDLE_DIR/macos" >&2 || true
	exit 1
fi

# An unsigned build carries a quarantine attribute that Gatekeeper refuses to
# open, so the DMG includes a one-click installer that copies the app, clears
# the attribute, and launches it — no terminal, no manual xattr. This is a
# convenience fallback for builds without a Developer ID; notarized builds get
# the same script but it simply becomes a normal copy (xattr is a no-op when
# there's nothing to clear).
if [[ -n "${APPLE_SIGNING_IDENTITY:-}" ]]; then
	echo "==> Signed build: skipping one-click installer helper"
else
	echo "==> Adding one-click installer for unsigned build"
	INSTALLER="$BUNDLE_DIR/macos/Install ${PRODUCT}.command"
	cat > "$INSTALLER" <<-EOF
		#!/bin/bash
		# One-click install for the unsigned tabili build.
		# Copies the app to /Applications and clears the quarantine attribute that
		# Gatekeeper sets on any downloaded app.
		set -e
		APP="${PRODUCT}.app"
		SRC="\$(cd "\$(dirname "\$0")" && pwd)/\$APP"
		DEST="/Applications/\$APP"

		if [ ! -d "\$SRC" ]; then
		  echo "Error: \$APP not found next to this installer."
		  echo "Press Enter to close."
		  read -r
		  exit 1
		fi

		if [ -d "\$DEST" ]; then
		  echo "Removing existing \$DEST"
		  rm -rf "\$DEST"
		fi

		echo "Copying \$APP to /Applications …"
		cp -R "\$SRC" "\$DEST"
		echo "Clearing quarantine attribute …"
		xattr -cr "\$DEST"
		echo ""
		echo "Done. Opening tabili …"
		open "\$DEST"

		echo ""
		echo "Press Enter to close this window."
		read -r
	EOF
	chmod +x "$INSTALLER"
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

# Signing and notarizing, when credentials are present.
#
# Without them the build is ad-hoc signed, which macOS reports on another
# machine as "tabili is damaged and can't be opened" — Gatekeeper cannot
# validate the signature on a quarantined app, and says that rather than
# anything useful. The recipient has to run `xattr -cr` to clear quarantine.
#
# Set APPLE_SIGNING_IDENTITY to a "Developer ID Application" certificate to sign,
# and either APPLE_API_KEY_PATH + APPLE_API_KEY + APPLE_API_ISSUER (App Store
# Connect key) or APPLE_ID + APPLE_PASSWORD + APPLE_TEAM_ID (app-specific
# password) to notarize. `tauri build` picks the identity up on its own for the
# .app; the DMG has to be signed and notarized here because we package it
# ourselves.
if [[ -n "${APPLE_SIGNING_IDENTITY:-}" ]]; then
	echo "==> Signing disk image"
	codesign --force --sign "$APPLE_SIGNING_IDENTITY" --timestamp "$DMG_NAME"

	if [[ -n "${APPLE_API_KEY_PATH:-}" ]]; then
		echo "==> Notarizing (App Store Connect key)"
		xcrun notarytool submit "$DMG_NAME" \
			--key "$APPLE_API_KEY_PATH" \
			--key-id "$APPLE_API_KEY" \
			--issuer "$APPLE_API_ISSUER" \
			--wait
	elif [[ -n "${APPLE_ID:-}" ]]; then
		echo "==> Notarizing (Apple ID)"
		xcrun notarytool submit "$DMG_NAME" \
			--apple-id "$APPLE_ID" \
			--password "$APPLE_PASSWORD" \
			--team-id "$APPLE_TEAM_ID" \
			--wait
	else
		echo "    no notarization credentials set — signed only, Gatekeeper will still warn" >&2
	fi

	# Stapling attaches the ticket to the image so it validates offline.
	xcrun stapler staple "$DMG_NAME" || echo "    stapling failed (not notarized?)" >&2
else
	echo "==> Unsigned (ad-hoc). Recipients must run: xattr -cr /Applications/${PRODUCT}.app"
fi

# A DMG whose root holds Contents/ instead of the .app mounts fine and installs
# nothing, and the packaging step reports success either way — so verify.
echo "==> Verifying"
MOUNT=$(mktemp -d)
hdiutil attach "$DMG_NAME" -nobrowse -mountpoint "$MOUNT" -quiet
trap 'hdiutil detach "$MOUNT" -quiet 2>/dev/null || true; rmdir "$MOUNT" 2>/dev/null || true' EXIT
BINARY="$MOUNT/${PRODUCT}.app/Contents/MacOS/${PRODUCT}"
if [[ ! -x "$BINARY" ]]; then
	echo "FAILED: ${PRODUCT}.app is missing or has no executable inside the image" >&2
	exit 1
fi

# A universal build that quietly produced a single slice would run nowhere but
# this machine, and nothing above would have said so.
ARCHS=$(lipo -archs "$BINARY")
echo "Architectures: $ARCHS"
if [[ "$TARGET" == "universal-apple-darwin" ]]; then
	for slice in arm64 x86_64; do
		if [[ "$ARCHS" != *"$slice"* ]]; then
			echo "FAILED: universal build is missing the $slice slice (got: $ARCHS)" >&2
			exit 1
		fi
	done
fi

# What Gatekeeper itself will decide on the recipient's machine, rather than
# assuming the signing step above was enough.
if spctl -a -t exec -vv "$MOUNT/${PRODUCT}.app" 2>&1 | grep -q "accepted"; then
	echo "Gatekeeper: accepted — opens without warnings"
else
	echo "Gatekeeper: rejected — recipients need 'xattr -cr /Applications/${PRODUCT}.app'"
fi
echo "OK: $(cd "$(dirname "$DMG_NAME")" && pwd)/$DMG_NAME"
