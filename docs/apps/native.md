# Native L@tr.link apps

L@tr.link has independent SwiftUI and Kotlin/Compose clients. Both use the same community-bookmark gateway contracts as the web app. The native apps are public OAuth clients; gateway application credentials stay on the existing web server proxy.

## Projects

| Platform | Project | Minimum OS |
| --- | --- | --- |
| iPhone and iPad | `apps/apple`, XcodeGen app + Share Extension + Swift package | iOS/iPadOS 18 |
| Android phones and tablets | `apps/android`, Kotlin/Compose Gradle project | Android 10 / API 29 |

See each project's README for build, signing, and local configuration instructions. No third-party app API key belongs in either mobile project.

## Environments and OAuth

| Setting | Development | Production |
| --- | --- | --- |
| Application identifier | `link.latr.development` | `link.latr` |
| Gateway proxy | `https://testing.latr.link/api/latr-gateway` | `https://latr.link/api/latr-gateway` |
| Apple metadata | `https://testing.latr.link/oauth/ios-testing-client-metadata.json` | `https://latr.link/oauth/ios-client-metadata.json` |
| Android metadata | `https://testing.latr.link/oauth/android-testing-client-metadata.json` | `https://latr.link/oauth/android-client-metadata.json` |
| Apple callback | `link.latr.testing:/oauth/ios` | `link.latr:/oauth/ios` |
| Android callback | `link.latr.testing:/oauth/android` | `link.latr:/oauth/android` |

The callback uses one slash after the colon, as required by the ATProto native-client profile. Each metadata document's `client_id` must match its fetched URL exactly. Public metadata must return HTTP 200 and JSON, without redirecting. OAuth servers must be able to fetch it: adding files to a local checkout does not make Development login available.

Metadata and `packages/native-contracts/contracts.v1.json` are generated from the pinned `latr-packages` proof plans and existing web metadata scope:

```sh
bun scripts/native-contracts.ts
bun scripts/native-contracts.ts --check
bun test scripts/native-contracts.test.ts
```

All signed-in features use the existing web permission scope, including legacy cleanup and User Input feedback/blob permissions. The apps explain public feedback publication before submission. OAuth occurs in the platform browser authentication session, while application UI and HTTP/cryptography remain native.

## Storage and sharing behavior

A share opens a native review form. It accepts HTTP(S) and AT URI subjects, preserves the exact trimmed subject, and requires selection when several links are present. Unsupported files are rejected. A save becomes durable only after confirmation; success is shown only after the gateway acknowledges it.

Confirmed offline saves remain pending and retry when the app or share flow runs again. Pending entries belong to one account DID and environment. Switching accounts cannot send another account's pending saves. Unassigned signed-out drafts require account confirmation. Sign-out pauses pending work, and clearing the library cache must not delete the queue. This is foreground retry, not a promise of delivery while the apps are closed.

Apple shares use the same secure session through Keychain sharing and coordinate cross-process work through App Group locks. Interactive login stays in the app; the extension does not use unsupported container-launch workarounds. Android's share Activity retains its draft through authentication and recreation.

## Contract compatibility

Current records are `community.lexicon.bookmarks.bookmark` plus `link.latr.bookmarks.metadata`. Open Graph previews are gateway cache data. Native apps do not write legacy bookmark records or replace encountered web URLs with discovered AT URIs.

The public proxy receives a gateway-bound DPoP proof and the exact ordered PDS proof pool. Each retry requires fresh proof IDs and current nonce handling. Migration carries its larger pool in the request body. The state transport uses the deployed PATCH compatibility behavior until LTR-19 resolves canonical POST parity.

LTR-26 tracks a pre-existing gateway mismatch for canonically equivalent Unicode tag spellings (for example, decomposed versus precomposed accented characters). Native clients preserve authored UTF-8 text; full server parity for that edge case requires the upstream LatrKit fix.

Articles open in the external browser; other web links use the platform in-app browser. The apps do not extract or download article pages for offline reading. JSON export must exhaust pagination; filters and cache must not silently truncate it.

## Verification and release gates

Run the repository's existing checks and the native checks:

```sh
bash scripts/ci.sh
bash scripts/ci-apple.sh       # macOS with Xcode + XcodeGen
bash scripts/ci-android.sh     # JDK and Android SDK
```

Native CI builds/tests source without publishing apps or accessing hosted user repositories. Apple simulator UI tests use ad-hoc signing so App Group/Keychain entitlements survive; the generic Release compile remains unsigned. Contract fixtures exercise scope/proof parity and Unicode/exact-subject behavior. Platform suites cover native storage, auth state, queue and UI behavior.

The initial Apple implementation was verified with 28 core tests (33 parameterized scenarios), warnings treated as errors, and four UI tests each on iPhone and iPad. The Safari tests exercise the installed Share Extension and persist an unassigned draft in the real shared SQLite container. Core tests include an independent child process holding the account lock and mocked public-feedback serialization; they do not establish signed-in app/extension acceptance. GitHub CI retains native test reports as artifacts for review.

Android verification includes 13 JVM contract tests, 19 API 35 emulator tests, lint, Development debug APK assembly, and unsigned Production release APK assembly. The device suite exercises Room/Keystore, replacement share intents and recreation, token rotation, account isolation, migration conflicts, mocked feedback uploads, proxy nonce retry, and a Compose library fixture. Existing gateway and Bun workspace checks also pass locally; PR #75 records CI status separately.

Before authenticated acceptance, make the metadata available in Development through the normal reviewed deployment process. Then verify:

1. Sign in with the same authorized test account on web and mobile. Verify cancellation and restart restoration.
2. Share from Safari on iPhone/iPad and Chrome on Android phone/tablet. Review multiple-link text, tags, success, cancellation, unsupported input, and duplicate subjects.
3. Save offline, terminate/reopen, reconnect, and confirm the same pending save reaches that account once. Verify another account cannot drain it.
4. Exercise expired-session refresh, Apple app/extension contention, Android Activity recreation, and interrupted requests.
5. Verify cross-client visibility, archive/restore/delete, tag editing/global operations, cursor pagination, migration retries, settings persistence, and complete JSON export.
6. Check large text, VoiceOver/TalkBack, tablet resizing, dark mode, keyboard navigation, and missing preview images.
7. Exercise feedback against mocks. Public feedback test submissions require explicit authorization.

Record build/test evidence separately from authenticated acceptance. TestFlight, Play/App Store submission, Production metadata deployment, and gateway rollout are separate release actions.

Tracking: LTR-23 (overall), LTR-25 (Apple), LTR-24 (Android); existing LTR-19 covers gateway verb parity.
