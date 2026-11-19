#!/usr/bin/env bash
# Builds the signed Android app (APK, or with "aab" the App Bundle for Google Play) next to the project folder:
#   "../SuryaSetu-<version>.apk"   e.g. /home/<you>/Pycharm_project/ai agent/SuryaSetu-1.1.0.apk
# Needs Java 17 and the Android SDK (scripts/setup-android-tools.sh puts both in your home folder).
#
# Updates keep the data on the phone ONLY if every release is signed with the same key. The key is made the
# first time (android/suryasetu-release.jks + android/keystore.properties). Back both up somewhere safe.
# Raise "version" in package.json for every release (Android refuses an update with the same or a lower number).
set -euo pipefail
cd "$(dirname "$0")/.."
export JAVA_HOME="${JAVA_HOME:-$HOME/jdk-${JAVA_MAJOR:-17}}" ANDROID_HOME="${ANDROID_HOME:-$HOME/android-sdk}"
export PATH="$JAVA_HOME/bin:$PATH"
[ -x "$JAVA_HOME/bin/java" ] || { echo "Java not found at $JAVA_HOME — run scripts/setup-android-tools.sh first."; exit 1; }
[ -d "$ANDROID_HOME/platforms" ] || { echo "Android SDK not found at $ANDROID_HOME — run scripts/setup-android-tools.sh first."; exit 1; }
VERSION="$(node -p "require('./package.json').version")"

if [ ! -f android/keystore.properties ]; then
  echo "Making the release signing key (once)…"
  PASS="$(node -e "console.log(require('crypto').randomBytes(18).toString('base64url'))")"
  keytool -genkeypair -v -keystore android/suryasetu-release.jks -alias suryasetu -keyalg RSA -keysize 4096 -validity 36500 \
    -storepass "$PASS" -keypass "$PASS" -dname "CN=SuryaSetu, O=SuryaSetu, C=IN" >/dev/null
  printf 'storeFile=suryasetu-release.jks\nstorePassword=%s\nkeyAlias=suryasetu\nkeyPassword=%s\n' "$PASS" "$PASS" > android/keystore.properties
  chmod 600 android/keystore.properties android/suryasetu-release.jks
  echo "Key saved in android/suryasetu-release.jks (password in android/keystore.properties). BACK THEM UP."
fi

echo "Building the app $VERSION…"
CAP_BUILD=1 npm run build   # with the security policy built into the page (the app has no web server headers)
npx cap sync android
npm run build >/dev/null    # put the normal website build back
printf 'sdk.dir=%s\n' "$ANDROID_HOME" > android/local.properties
if [ "${1:-apk}" = "aab" ]; then
  # Google Play takes an Android App Bundle (.aab), signed with the same key (your Play "upload key").
  (cd android && ./gradlew --no-daemon bundleRelease)
  cp android/app/build/outputs/bundle/release/app-release.aab "../SuryaSetu-$VERSION.aab"
  echo "App bundle for Google Play ready: $(cd .. && pwd)/SuryaSetu-$VERSION.aab"
else
  (cd android && ./gradlew --no-daemon assembleRelease)
  cp android/app/build/outputs/apk/release/app-release.apk "../SuryaSetu-$VERSION.apk"
  echo "APK ready: $(cd .. && pwd)/SuryaSetu-$VERSION.apk"
fi
