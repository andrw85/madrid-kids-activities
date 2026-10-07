#!/usr/bin/env bash
set -e
PROJ=/mnt/c/Users/enddooa/madrid-kids
SDK=$PROJ/android-sdk
AND=$PROJ/cap/android
JAVA_BIN=$(readlink -f "$(command -v java)")
export JAVA_HOME=$(dirname "$(dirname "$JAVA_BIN")")
export ANDROID_HOME="$SDK"
export ANDROID_SDK_ROOT="$SDK"

echo "sdk.dir=$SDK" > "$AND/local.properties"
cd "$AND"
chmod +x gradlew || true
echo "Building debug APK (first run downloads Gradle 8.2.1, be patient)..."
./gradlew assembleDebug --no-daemon -g "$PROJ/.gradle-home" 2>&1 | tail -25
echo "=== APK output ==="
find "$AND/app/build/outputs/apk" -name "*.apk" 2>/dev/null
