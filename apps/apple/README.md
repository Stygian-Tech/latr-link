# L@tr.link for iPhone and iPad

Native SwiftUI app and “Save to L@tr.link” Share Extension, targeting iOS/iPadOS 18 or newer. The app and extension use the local `LatrNativeCore` Swift package and its remotely pinned LatrKit dependency. The extension's UIKit controller only hosts SwiftUI and reads `NSItemProvider` attachments.

## Build

Install Xcode with an iOS 18+ SDK and XcodeGen, then run from this directory:

```sh
xcodegen generate
xcodebuild -project LatrLink.xcodeproj -scheme LatrLink \
  -configuration Debug -destination 'generic/platform=iOS Simulator' \
  CODE_SIGNING_ALLOWED=NO build
swift test
```

The repository `scripts/ci-apple.sh` also runs app UI tests on iPhone and iPad simulators. For real App Group and Keychain behavior in Simulator, omit `CODE_SIGNING_ALLOWED=NO` and pass `CODE_SIGN_IDENTITY=-` for an ad-hoc signed build; no Apple team credentials are needed for Simulator. Unsigned builds verify compilation but cannot use the real shared container. On this workstation use `DEVELOPER_DIR=/Applications/Xcode-beta.app/Contents/Developer` when appropriate. The generated Xcode project is disposable; change `project.yml` and regenerate.

Open `LatrLink.xcodeproj` for device builds. Supply `DEVELOPMENT_TEAM` from your local Xcode configuration or command line. Register the app and Share Extension identifiers, App Groups, and Keychain sharing with the same Apple team. Do not commit signing credentials or a team identifier.

| Configuration | App / extension | App Group | Shared Keychain suffix | Callback |
| --- | --- | --- | --- | --- |
| Debug | `link.latr.development` / `.share` | `group.link.latr.testing` | `link.latr.testing.shared` | `link.latr.testing:/oauth/ios` |
| Release | `link.latr` / `.share` | `group.link.latr` | `link.latr.shared` | `link.latr:/oauth/ios` |

Xcode prepends `AppIdentifierPrefix` to the Keychain suffix. Both targets must have identical App Group and Keychain entitlements. The app fails explicitly when the shared container is unavailable; it does not fall back to a private container that the extension cannot access.

## OAuth and environments

Debug uses `https://testing.latr.link/oauth/ios-testing-client-metadata.json`; Release uses `https://latr.link/oauth/ios-client-metadata.json`. These public metadata documents must be reachable before a real account can sign in. The native client opens `ASWebAuthenticationSession` after discovery and PAR; the shared core verifies callbacks, issues DPoP proofs, and serializes session refresh across processes.

Bookmark traffic uses the same-origin web proxy, so gateway application credentials remain on the server. The adapter preserves the existing `setState` PATCH compatibility behavior tracked by LTR-19. Development and Production have separate identifiers, shared containers, Keychain records, and pending-save ownership.

## Sharing and offline behavior

Share URL or plain-text attachments from Safari or another app. If more than one supported link is present, choose exactly one and review its account and tags. Save shows **Saved** only after server acknowledgement. Otherwise the confirmed save stays **Pending** in shared SQLite and retries on foreground/share activation. A signed-out share stores an unassigned draft; open the containing app, sign in, and explicitly confirm its account in Pending saves.

Pending saves can be edited, retried, or removed. Signing out pauses the account's queue. Clearing cached library data preserves pending saves. Archive, delete, tag mutations, migration, export, and feedback require connectivity. Export exhausts pagination. Tag rename/delete can be retried after partial progress. The archive sort uses timestamps captured by this installation and falls back to saved time for changes made by other clients.

## Acceptance checks

- Run package tests and the iPhone/iPad UI tests; build both Debug and Release. Debug-only `--ui-test-library` / `--ui-test-signed-out` arguments inject a real local runtime with mock HTTP and a memory vault, never a network-connected account. The Safari share test uses the ordinary runtime and shared-container entitlements.
- With correctly signed Development builds and hosted OAuth metadata, sign in on iPhone/iPad and confirm Safari exposes the Share Extension.
- Share one URL, text containing multiple URLs, and an unsupported attachment. Verify account review, tag validation, cancellation, and explicit results.
- Save offline, restart the extension/app, and return online. Verify one remote bookmark appears and pending state clears only after acknowledgement.
- Confirm signed-out drafts never submit before account confirmation; sign out/re-authenticate and ensure another account cannot consume the prior account's queue.
- Exercise app/extension contention during refresh, repeated callbacks, VoiceOver, large text, split-screen iPad navigation, sorting/filtering, archive/restore/delete, complete tags, migration failure/retry, cache clearing, and JSON export.
- Validate feedback through mocks. Publishing public test feedback requires explicit authorization.

Simulator launches and successful builds do not establish authenticated product acceptance. TestFlight uploads, store publication, production deployment, and real public feedback are separate release steps.
