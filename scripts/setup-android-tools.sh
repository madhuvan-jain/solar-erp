#!/usr/bin/env bash
# One-time: puts Java and the Android SDK in your home folder (no sudo, nothing system-wide).
# Versions can be chosen (after upgrading Capacitor for Google Play's target API, see GO-LIVE-STEPS.md):
#   JAVA_MAJOR=21 ANDROID_PLATFORM=35 BUILD_TOOLS=35.0.0 npm run android-tools
# Running it means you accept the Android SDK licence (https://developer.android.com/studio/terms).
# About 1.5 GB of downloads: Java from Adoptium (Eclipse Temurin), the SDK from Google.
set -euo pipefail
JAVA_MAJOR="${JAVA_MAJOR:-17}"
ANDROID_PLATFORM="${ANDROID_PLATFORM:-34}"
BUILD_TOOLS="${BUILD_TOOLS:-34.0.0}"
JDK_DIR="${JDK_DIR:-$HOME/jdk-$JAVA_MAJOR}"
SDK_DIR="${ANDROID_HOME:-$HOME/android-sdk}"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
if [ ! -x "$JDK_DIR/bin/java" ]; then
  echo "Downloading Java $JAVA_MAJOR (Eclipse Temurin)…"
  curl -fSL -o "$TMP/jdk.tgz" "https://api.adoptium.net/v3/binary/latest/$JAVA_MAJOR/ga/linux/x64/jdk/hotspot/normal/eclipse"
  mkdir -p "$JDK_DIR" && tar -xzf "$TMP/jdk.tgz" -C "$JDK_DIR" --strip-components=1
fi
export JAVA_HOME="$JDK_DIR" PATH="$JDK_DIR/bin:$PATH"
if [ ! -x "$SDK_DIR/cmdline-tools/latest/bin/sdkmanager" ]; then
  echo "Downloading the Android command-line tools…"
  curl -fSL -o "$TMP/clt.zip" "https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip"
  mkdir -p "$SDK_DIR/cmdline-tools" && unzip -q -o "$TMP/clt.zip" -d "$TMP/clt" && rm -rf "$SDK_DIR/cmdline-tools/latest" && mv "$TMP/clt/cmdline-tools" "$SDK_DIR/cmdline-tools/latest"
fi
echo "Installing SDK parts (platform $ANDROID_PLATFORM, build tools $BUILD_TOOLS)…"
yes | "$SDK_DIR/cmdline-tools/latest/bin/sdkmanager" --sdk_root="$SDK_DIR" --licenses >/dev/null
"$SDK_DIR/cmdline-tools/latest/bin/sdkmanager" --sdk_root="$SDK_DIR" "platform-tools" "platforms;android-$ANDROID_PLATFORM" "build-tools;$BUILD_TOOLS"
echo "Done. Java: $JDK_DIR   Android SDK: $SDK_DIR"
