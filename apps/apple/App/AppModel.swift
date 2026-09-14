import SwiftUI
import AuthenticationServices
import LatrNativeCore

@MainActor @Observable
final class AppModel {
    let runtime: NativeRuntime?
    var session: NativeSession?
    var bookmarks: [BookmarkView] = []
    var pending: [PendingSave] = []
    var cursor: String?
    var loadingMore = false
    var archivedDates: [String: String] = [:]
    var error: String?
    var notice: String?
    var loading = false
    var signingIn = false
    var migrationStatus = "Not checked"
    var tagProgress: String?
    private var authPresenter: AuthenticationPresenter?
    private var accountGeneration = UUID()

    init() {
        do {
            #if DEBUG
            if ProcessInfo.processInfo.arguments.contains("--ui-test-library") || ProcessInfo.processInfo.arguments.contains("--ui-test-signed-out") {
                let directory = FileManager.default.temporaryDirectory.appending(path: "latr-ui-tests-\(UUID().uuidString)")
                runtime = try NativeRuntime.preview(directory: directory, authenticated: !ProcessInfo.processInfo.arguments.contains("--ui-test-signed-out"))
            } else { runtime = try RuntimeConfiguration.make() }
            #else
            runtime = try RuntimeConfiguration.make()
            #endif
        }
        catch { runtime = nil; self.error = error.localizedDescription }
    }

    func restore() async {
        guard let runtime else { return }
        let generation = accountGeneration
        do {
            let restoredSession = try await runtime.oauth.restoreSession()
            guard generation == accountGeneration else { return }
            session = restoredSession
            if session != nil {
                let cached = try await runtime.library.cachedBookmarks()
                guard generation == accountGeneration else { return }
                bookmarks = cached
                archivedDates = (UserDefaults.standard.dictionary(forKey: archiveDatesKey) as? [String: String]) ?? [:]
            }
            await activate()
            if session != nil {
                do { try await runtime.library.migrateLegacyIfNeeded(); migrationStatus = "Up to date" }
                catch { migrationStatus = "Needs retry: \(error.localizedDescription)" }
            }
        } catch { self.error = error.localizedDescription }
    }

    func activate() async {
        guard let runtime, session != nil else { return }
        let generation = accountGeneration
        do {
            try? await runtime.library.drainPendingSaves()
            let saves = try await runtime.library.pendingSaves()
            guard generation == accountGeneration else { return }
            pending = saves.filter { $0.did == nil || $0.did == session?.did }
        } catch { self.error = error.localizedDescription }
        await refresh()
    }

    func refreshPending() async {
        guard let runtime else { return }
        let generation = accountGeneration
        do {
            let saves = try await runtime.library.pendingSaves()
            guard generation == accountGeneration else { return }
            pending = saves.filter { $0.did == nil || $0.did == session?.did }
        } catch { self.error = error.localizedDescription }
    }

    func signIn(handle: String) async {
        guard let runtime, !signingIn else { return }
        accountGeneration = UUID()
        let generation = accountGeneration
        signingIn = true
        defer { signingIn = false; authPresenter = nil }
        do {
            let url = try await runtime.oauth.authorizationURL(for: handle.trimmingCharacters(in: .whitespacesAndNewlines))
            let presenter = AuthenticationPresenter()
            authPresenter = presenter
            let callback = try await presenter.authenticate(url: url, scheme: Bundle.main.infoDictionary?["LATR_ENVIRONMENT"] as? String == "production" ? "link.latr" : "link.latr.testing")
            let authenticated = try await runtime.oauth.completeAuthorization(callback: callback)
            guard generation == accountGeneration else { return }
            session = authenticated
            await activate()
            await migrate()
        } catch let authError as ASWebAuthenticationSessionError where authError.code == .canceledLogin {
            try? await runtime.oauth.cancelAuthorization()
            notice = "Sign-in cancelled."
        } catch { self.error = error.localizedDescription }
    }

    /// ASWebAuthenticationSession owns callbacks while a login is active. URL delivery only
    /// resumes a persisted authorization after the process has been restarted.
    func handleCallback(_ url: URL) async {
        guard let runtime, url.scheme == runtime.configuration.callbackScheme,
              !signingIn, session == nil else { return }
        accountGeneration = UUID()
        let generation = accountGeneration
        signingIn = true
        defer { signingIn = false }
        do {
            let authenticated = try await runtime.oauth.completeAuthorization(callback: url)
            guard generation == accountGeneration else { return }
            session = authenticated
            await activate()
            await migrate()
        } catch { self.error = error.localizedDescription }
    }

    func refresh() async {
        guard let runtime, session != nil, !loading else { return }
        let generation = accountGeneration
        loading = true
        defer { loading = false }
        do {
            let page = try await runtime.library.bookmarkPage()
            guard generation == accountGeneration else { return }
            bookmarks = page.bookmarks
            cursor = page.cursor
        }
        catch { self.error = error.localizedDescription }
    }

    func loadMore() async {
        guard let runtime, let cursor, !loadingMore, !loading else { return }
        let generation = accountGeneration
        loadingMore = true
        defer { loadingMore = false }
        do {
            let page = try await runtime.library.bookmarkPage(cursor: cursor)
            guard generation == accountGeneration else { return }
            let existing = Set(bookmarks.map(\.uri))
            bookmarks += page.bookmarks.filter { !existing.contains($0.uri) }
            self.cursor = page.cursor
        } catch { self.error = error.localizedDescription }
    }

    private var archiveDatesKey: String { "archiveDates.\(session?.environment.rawValue ?? "").\(session?.did ?? "")" }
    func recordArchivedDate(for uri: String, archived: Bool) {
        if archived { archivedDates[uri] = ISO8601DateFormatter().string(from: Date()) }
        else { archivedDates.removeValue(forKey: uri) }
        UserDefaults.standard.set(archivedDates, forKey: archiveDatesKey)
    }

    func save(subject: String, tags: [String]) async -> Bool {
        guard let runtime, let displayedDID = session?.did else { return false }
        let generation = accountGeneration
        do {
            let queued = try await runtime.library.enqueueSave(subject: subject, tags: tags, expectedDID: displayedDID)
            try? await runtime.library.drainPendingSaves()
            let saves = try await runtime.library.pendingSaves()
            guard generation == accountGeneration else { return true }
            pending = saves.filter { $0.did == nil || $0.did == session?.did }
            notice = pending.contains(where: { $0.id == queued.id }) ? "Pending — saved on this device and will retry when you open L@tr.link." : "Saved to L@tr.link."
            await refresh()
            return true
        } catch { self.error = error.localizedDescription; return false }
    }

    func mutate(_ action: () async throws -> Void) async {
        do { try await action(); await refresh() }
        catch { self.error = error.localizedDescription }
    }

    func migrate() async {
        guard let runtime else { return }
        migrationStatus = "Importing legacy saves…"
        do {
            try await runtime.library.migrateLegacy()
            migrationStatus = "Updating page metadata…"
            try await runtime.library.syncMetadata()
            migrationStatus = "Up to date"
            await refresh()
        } catch { migrationStatus = "Needs retry: \(error.localizedDescription)" }
    }

    func signOut() async {
        guard let runtime else { return }
        accountGeneration = UUID()
        do { try await runtime.oauth.signOut(); session = nil; bookmarks = []; pending = []; archivedDates = [:]; cursor = nil }
        catch { self.error = error.localizedDescription }
    }
}

@MainActor
private final class AuthenticationPresenter: NSObject, ASWebAuthenticationPresentationContextProviding {
    private var authentication: ASWebAuthenticationSession?

    func authenticate(url: URL, scheme: String) async throws -> URL {
        try await withCheckedThrowingContinuation { continuation in
            let authentication = ASWebAuthenticationSession(url: url, callbackURLScheme: scheme) { callback, error in
                if let callback { continuation.resume(returning: callback) }
                else { continuation.resume(throwing: error ?? URLError(.cancelled)) }
            }
            self.authentication = authentication
            authentication.presentationContextProvider = self
            authentication.prefersEphemeralWebBrowserSession = false
            if !authentication.start() { continuation.resume(throwing: URLError(.cannotLoadFromNetwork)) }
        }
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows).first(where: \.isKeyWindow) ?? ASPresentationAnchor()
    }
}
