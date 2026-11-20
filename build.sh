#!/bin/bash
set -euo pipefail
export COPYFILE_DISABLE=1

project_dir=$(cd "$(dirname "$0")" && pwd -P)
dist="$project_dir/dist"
mkdir -p "$dist"
stage=$(mktemp -d "$dist/.build.XXXXXX")
trap 'rm -rf "$stage"' EXIT
app="$stage/Remote Pad.app"
contents="$app/Contents"
resources="$contents/Resources"
mkdir -p "$contents/MacOS" "$resources/app"
module_cache="$(getconf DARWIN_USER_TEMP_DIR)RemotePad-SwiftModules"
cp "$project_dir/mac/RemotePad.swift" "$stage/RemotePad.swift"

for arch in arm64 x86_64; do
    xcrun swiftc -O -swift-version 5 -target "$arch-apple-macosx13.0" \
        -module-cache-path "$module_cache" \
        "$stage/RemotePad.swift" -o "$stage/RemotePad-$arch"
done
xcrun lipo -create "$stage/RemotePad-arm64" "$stage/RemotePad-x86_64" -output "$contents/MacOS/RemotePad"

for asset in home.html home.js bench.html bench.js mapper.html mapper-page.js mapper-ui.js controller-model.js bindings-store.js ui.css controller.js overlay.js boot.js; do
    test -r "$project_dir/app/$asset"
done
/usr/bin/ditto --norsrc --noextattr "$project_dir/app" "$resources/app"
/usr/bin/install -m 644 "$project_dir/mac/RemotePad.icns" "$resources/RemotePad.icns"
/bin/sh "$project_dir/tools/prepare-extension.sh" "$resources/chrome"
mkdir -p "$resources/Documentation"
for document in LICENSE EULA.md PRIVACY.md SUPPORT.md; do
    /usr/bin/install -m 644 "$project_dir/$document" "$resources/Documentation/$document"
done

mkdir -p "$resources/PS5"
install -m 644 "$project_dir/ps5/compose.yaml" "$resources/PS5/compose.yaml"
install -m 755 "$project_dir/ps5/Start PS5 Player.command" "$resources/PS5/Start PS5 Player.command"
install -m 644 "$project_dir/docs/PS5.md" "$resources/Documentation/PS5.md"

cat > "$contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleDevelopmentRegion</key><string>en</string>
    <key>CFBundleDisplayName</key><string>Remote Pad</string>
    <key>CFBundleExecutable</key><string>RemotePad</string>
    <key>CFBundleIconFile</key><string>RemotePad</string>
    <key>CFBundleIdentifier</key><string>local.remotepad.macos</string>
    <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
    <key>CFBundleName</key><string>Remote Pad</string>
    <key>NSHumanReadableCopyright</key><string>Copyright © 2026 Lamacchia Solutions. All rights reserved.</string>
    <key>CFBundlePackageType</key><string>APPL</string>
    <key>CFBundleShortVersionString</key><string>1.2.0</string>
    <key>CFBundleVersion</key><string>5</string>
    <key>LSApplicationCategoryType</key><string>public.app-category.games</string>
    <key>LSMinimumSystemVersion</key><string>13.0</string>
    <key>NSHighResolutionCapable</key><true/>
    <key>NSMicrophoneUsageDescription</key><string>Xbox Remote Play can use your microphone when you turn on voice chat.</string>
</dict>
</plist>
PLIST

/usr/bin/plutil -lint "$contents/Info.plist"
/usr/bin/codesign --force --sign - --timestamp=none "$app"
/usr/bin/codesign --verify --strict --all-architectures "$app"
/usr/bin/ditto -c -k --norsrc --noextattr --keepParent "$app" "$stage/Remote-Pad-macOS.zip"
/usr/bin/unzip -tq "$stage/Remote-Pad-macOS.zip"

if [[ -e "$dist/Remote Pad.app" ]]; then
    mv "$dist/Remote Pad.app" "$stage/previous.app"
fi
if ! mv "$app" "$dist/Remote Pad.app"; then
    if [[ -d "$stage/previous.app" ]]; then mv "$stage/previous.app" "$dist/Remote Pad.app"; fi
    exit 1
fi
mv -f "$stage/Remote-Pad-macOS.zip" "$dist/Remote-Pad-macOS.zip"
echo "Built $dist/Remote Pad.app"
echo "Packaged $dist/Remote-Pad-macOS.zip"
