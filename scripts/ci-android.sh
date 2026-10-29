#!/usr/bin/env bash
# Native Android checks; no release signing, uploads, or hosted mutations.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/apps/android"
if [ -z "${JAVA_HOME:-}" ] && [ -d '/Applications/Android Studio.app/Contents/jbr/Contents/Home' ]; then
  export JAVA_HOME='/Applications/Android Studio.app/Contents/jbr/Contents/Home'
fi
if [ -z "${ANDROID_HOME:-}" ] && [ -d "$HOME/Library/Android/sdk" ]; then
  export ANDROID_HOME="$HOME/Library/Android/sdk"
fi
./gradlew --no-daemon testDevelopmentDebugUnitTest lintDevelopmentDebug assembleDevelopmentDebug assembleProductionRelease
if [ "${NATIVE_ANDROID_DEVICE_TESTS:-0}" = 1 ]; then
  ./gradlew --no-daemon connectedDevelopmentDebugAndroidTest
fi
