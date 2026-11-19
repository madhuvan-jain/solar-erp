#!/usr/bin/env bash
# The iPhone / iPad app. Runs on a Mac only (Apple's rule): needs Xcode 15+ (App Store → Xcode) and CocoaPods.
#   bash scripts/build-ios.sh        → builds the app's pages, copies them into ios/, opens Xcode
# Then in Xcode: choose your Team (Signing & Capabilities), Product → Archive → Distribute App → App Store Connect.
# Raise "version" in package.json for every App Store version; the build number below goes up by itself.
set -euo pipefail
cd "$(dirname "$0")/.."
[ "$(uname)" = "Darwin" ] || { echo "The iPhone app can only be built on a Mac (with Xcode)."; exit 1; }
command -v xcodebuild >/dev/null || { echo "Install Xcode from the Mac App Store, open it once, then run this again."; exit 1; }
command -v pod >/dev/null || { echo "Install CocoaPods first:  brew install cocoapods   (or: sudo gem install cocoapods)"; exit 1; }
VERSION="$(node -p "require('./package.json').version")"
BUILD="${BUILD_NUMBER:-$(date +%Y%m%d%H)}"   # must be higher for every upload of the same version

[ -d node_modules ] || npm ci
echo "Building the app $VERSION ($BUILD)…"
CAP_BUILD=1 npm run build      # with the security policy built into the page (the app has no web server headers)
npx cap sync ios               # copies the pages in and runs "pod install"
sed -i '' -E "s/MARKETING_VERSION = [^;]+;/MARKETING_VERSION = $VERSION;/; s/CURRENT_PROJECT_VERSION = [^;]+;/CURRENT_PROJECT_VERSION = $BUILD;/" \
  ios/App/App.xcodeproj/project.pbxproj
npm run build >/dev/null       # put the normal website build back
echo "Opening Xcode. Signing & Capabilities → Team: your Apple Developer team. Then Product → Archive."
npx cap open ios
