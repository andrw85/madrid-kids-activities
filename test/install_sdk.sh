#!/usr/bin/env bash
set -e
SDK=/mnt/c/Users/enddooa/madrid-kids/android-sdk
SM="$SDK/cmdline-tools/latest/bin/sdkmanager"
JAVA_BIN=$(readlink -f "$(command -v java)")
export JAVA_HOME=$(dirname "$(dirname "$JAVA_BIN")")
echo "JAVA_HOME=$JAVA_HOME"
yes | "$SM" --sdk_root="$SDK" --licenses >/dev/null 2>&1 || true
echo "licenses accepted"
"$SM" --sdk_root="$SDK" "platform-tools" "platforms;android-34" "build-tools;34.0.0" 2>&1 | tail -6
echo "=== installed ==="
ls "$SDK"
