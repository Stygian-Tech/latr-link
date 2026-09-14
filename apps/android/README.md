# L@tr.link for Android

Native Kotlin/Compose application for Android 10+ (API 29), with a native `ACTION_SEND` share target. Development and production install independently. Android Auth Tab falls back to Custom Tabs; OAuth credentials and signing keys use Android Keystore. No application API key is shipped.

## Build

Install JDK 21 and Android SDK 36. Set `ANDROID_HOME` and `JAVA_HOME`, then run:

```sh
./gradlew testDevelopmentDebugUnitTest lintDevelopmentDebug assembleDevelopmentDebug assembleProductionRelease
./gradlew connectedDevelopmentDebugAndroidTest
```

Release APK assembly is unsigned; store signing and publication are separate operations. Debug APK: `app/build/outputs/apk/development/debug/app-development-debug.apk`.

The client metadata documents must be reachable on the selected environment before real account authentication can complete. Development uses `https://testing.latr.link/oauth/android-testing-client-metadata.json` and `link.latr.testing:/oauth/android`; production uses `https://latr.link/oauth/android-client-metadata.json` and `link.latr:/oauth/android`.

## Data and behavior

Room stores account-scoped cached bookmarks and pending saves. A save is persisted before attempting the gateway. Failed saves keep their exact subjects, authored tags and account identity; retries run during foreground/share invocation, with explicit edit/discard controls. There is no promise of background delivery. Appearance uses DataStore. Signing out removes OAuth credentials; pending work remains bound to its original DID.

Library requests fetch bounded pages, reconcile missing metadata best-effort, and offer additional pages while preserving opaque cursors. Export exhausts the entire library. Global tag changes and legacy migration use bounded, resumable server operations. Nonarticle reading opens Custom Tabs; articles open externally. Feedback publishes to the public User Input board only after the user taps Publish feedback.

Tests load the shared native contract fixtures from `packages/native-contracts`; Android instrumentation covers share resolution, Room persistence/account isolation and platform Keystore/grapheme behavior. No test publishes feedback or writes to a real PDS.
