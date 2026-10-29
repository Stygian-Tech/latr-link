import SwiftUI
import SafariServices
import LatrNativeCore

enum LibrarySection: String, CaseIterable, Identifiable {
    case unread = "Unread", archive = "Archive", pending = "Pending saves", tags = "Tags", settings = "Settings"
    var id: String { rawValue }
    var icon: String {
        switch self {
        case .unread: "bookmark"; case .archive: "archivebox"; case .pending: "clock"
        case .tags: "tag"; case .settings: "gearshape"
        }
    }
}

enum ContentFilter: String, CaseIterable, Identifiable {
    case all = "All", article = "Articles", social = "Social", other = "Other"
    var id: String { rawValue }
}

enum LibrarySort: String, CaseIterable, Identifiable {
    case newest = "Newest first", oldest = "Oldest first", title = "Title", archived = "Recently archived"
    var id: String { rawValue }
}

struct RootView: View {
    @Bindable var model: AppModel
    @State private var selection: LibrarySection? = .unread
    @State private var showSave = false
    @State private var filterTag: Data?

    var body: some View {
        Group {
            if model.session == nil { LoginView(model: model) }
            else {
                NavigationSplitView {
                    List(selection: $selection) {
                        Section("Library") {
                            ForEach(LibrarySection.allCases) { section in
                                NavigationLink(value: section) { Label(section.rawValue, systemImage: section.icon) }.accessibilityIdentifier("sidebar.\(section.rawValue)")
                            }
                        }
                        if let session = model.session {
                            Section("Account") {
                                Text(session.handle ?? session.did).font(.caption).textSelection(.enabled)
                            }
                        }
                    }
                    .navigationTitle("L@tr.link")
                    
                } detail: {
                    NavigationStack {
                        Group { switch selection ?? .unread {
                        case .unread, .archive:
                            LibraryView(model: model, archived: selection == .archive, filterTag: $filterTag)
                        case .pending: PendingSavesView(model: model)
                        case .tags: TagsView(model: model) { tag in filterTag = Data(tag.utf8); selection = .unread }
                        case .settings: SettingsView(model: model)
                        } }
                        .toolbar { Button("Save link", systemImage: "plus") { showSave = true }.keyboardShortcut("n") }
                    }
                }
            }
        }
        .sheet(isPresented: $showSave) { SaveLinkView(model: model) }
        .alert("Unable to complete action", isPresented: Binding(get: { model.error != nil }, set: { if !$0 { model.error = nil } })) {
            Button("OK") { model.error = nil }
        } message: { Text(model.error ?? "") }
        .safeAreaInset(edge: .bottom) {
            if let notice = model.notice {
                HStack {
                    Text(notice).font(.footnote)
                    Spacer()
                    Button("Dismiss", systemImage: "xmark") { model.notice = nil }.labelStyle(.iconOnly)
                }.padding().background(.regularMaterial)
            }
        }
    }
}

private struct LoginView: View {
    @Bindable var model: AppModel
    @State private var handle = ""

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    Image("Brand").resizable().scaledToFit().frame(width: 76, height: 76).accessibilityHidden(true)
                    Text("Make time for what matters.").font(.largeTitle.bold())
                    Text("Save links from your favorite apps. Read them later on your phone, iPad, or the web.").foregroundStyle(.secondary)
                    LoginHandleField(handle: $handle, signingIn: model.signingIn, submit: login)
                    Button(action: login) {
                        HStack { if model.signingIn { ProgressView() }; Text(model.signingIn ? "Signing in…" : "Sign in") }.frame(maxWidth: .infinity)
                    }.buttonStyle(.borderedProminent).controlSize(.large).disabled(handle.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || model.signingIn)
                    Text("Use your Bluesky or other AT Protocol account. Your saved links live in your own personal data repository.")
                        .font(.footnote).foregroundStyle(.secondary)
                    Label("Save from the share sheet", systemImage: "square.and.arrow.up").font(.headline)
                    Text("After signing in, open the share sheet in Safari or another app and choose Save to L@tr.link.").font(.callout)
                    if Bundle.main.infoDictionary?["LATR_ENVIRONMENT"] as? String == "testing" {
                        Label("Development environment", systemImage: "hammer").font(.caption).foregroundStyle(.orange)
                    }
                }.padding(28).frame(maxWidth: 520, alignment: .leading).frame(maxWidth: .infinity)
            }.navigationTitle("L@tr.link")
        }
    }

    private func login() { Task { await model.signIn(handle: handle) } }
}

struct LibraryView: View {
    @Bindable var model: AppModel
    let archived: Bool
    @Binding var filterTag: Data?
    @State private var filter: ContentFilter = .all
    @State private var sort: LibrarySort = .newest
    @State private var search = ""
    @State private var visibleCount = 40
    @State private var editing: BookmarkSelection?
    @State private var deleting: BookmarkSelection?
    @State private var browser: BrowserDestination?
    @State private var unavailable: String?
    @Environment(\.openURL) private var openURL

    private var filtered: [BookmarkView] {
        model.bookmarks.filter { bookmark in
            bookmark.isArchived == archived &&
            (filter == .all || bookmark.contentFilter == filter) &&
            (filterTag == nil || (bookmark.value.tags ?? []).contains(where: { Data($0.utf8) == filterTag! })) &&
            (search.isEmpty || bookmark.displayTitle.localizedCaseInsensitiveContains(search) || bookmark.value.subject.localizedCaseInsensitiveContains(search))
        }.sorted { a, b in
            switch sort {
            case .title: a.displayTitle.localizedStandardCompare(b.displayTitle) == .orderedAscending
            case .oldest: a.value.createdAt < b.value.createdAt
            case .newest: a.value.createdAt > b.value.createdAt
            case .archived: (model.archivedDates[a.uri] ?? a.value.createdAt) > (model.archivedDates[b.uri] ?? b.value.createdAt)
            }
        }
    }

    var body: some View {
        List {
            Section {
                Picker("Content", selection: $filter) { ForEach(ContentFilter.allCases) { Text($0.rawValue).tag($0) } }.pickerStyle(.segmented)
                if let filterTag {
                    HStack { Label(String(decoding: filterTag, as: UTF8.self), systemImage: "tag"); Spacer(); Button("Clear filter") { self.filterTag = nil } }
                }
                Text("\(filtered.count) \(archived ? "archived" : "unread") · about \(filtered.reduce(0) { $0 + $1.readingMinutes }) min of reading").font(.caption).foregroundStyle(.secondary)
            }
            ForEach(Array(filtered.prefix(visibleCount)), id: \.uri) { bookmark in
                Button { open(bookmark) } label: { BookmarkRow(bookmark: bookmark) }.buttonStyle(.plain)
                    .contextMenu {
                        Button(archived ? "Move to unread" : "Archive", systemImage: archived ? "tray.and.arrow.up" : "archivebox") { changeState(bookmark) }
                        Button("Edit tags", systemImage: "tag") { editing = BookmarkSelection(bookmark: bookmark) }
                        ShareLink(item: bookmark.value.subject)
                        Button("Delete", systemImage: "trash", role: .destructive) { deleting = BookmarkSelection(bookmark: bookmark) }
                    }
                    .swipeActions(edge: .trailing) {
                        Button("Delete", systemImage: "trash", role: .destructive) { deleting = BookmarkSelection(bookmark: bookmark) }
                            .tint(.red)
                            .labelStyle(.titleAndIcon)
                        Button(archived ? "Restore to unread" : "Archive", systemImage: archived ? "tray.and.arrow.up" : "archivebox") { changeState(bookmark) }
                            .tint(.indigo)
                            .labelStyle(.titleAndIcon)
                    }
                    .swipeActions(edge: .leading) {
                        Button("Tags", systemImage: "tag") { editing = BookmarkSelection(bookmark: bookmark) }
                            .tint(.orange)
                            .labelStyle(.titleAndIcon)
                            .accessibilityIdentifier("bookmark-tags-action")
                    }
            }
            if visibleCount < filtered.count || model.cursor != nil {
                Button(model.loadingMore ? "Loading…" : "Load more") {
                    if visibleCount >= filtered.count { Task { await model.loadMore(); visibleCount += 40 } }
                    else { visibleCount += 40 }
                }.disabled(model.loadingMore)
            }
            if filtered.isEmpty && !model.loading {
                ContentUnavailableView(search.isEmpty ? "Nothing here yet" : "No matching links", systemImage: archived ? "archivebox" : "bookmark", description: Text("Save a link from the share sheet or the + button."))
            }
            if model.loading { ProgressView("Loading library…") }
        }
        .navigationTitle(archived ? "Archive" : "Unread")
        .searchable(text: $search, prompt: "Search saved links")
        .refreshable { await model.refresh() }
        .toolbar {
            Menu("Sort", systemImage: "arrow.up.arrow.down") { Picker("Sort", selection: $sort) { ForEach(LibrarySort.allCases) { Text($0.rawValue).tag($0) } } }
        }
        .sheet(item: $editing) { EditBookmarkTagsView(model: model, bookmark: $0.bookmark) }
        .sheet(item: $browser) { SafariView(url: $0.url).ignoresSafeArea() }
        .confirmationDialog("Delete this saved link?", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), titleVisibility: .visible) {
            Button("Delete", role: .destructive) {
                guard let bookmark = deleting?.bookmark, let runtime = model.runtime else { return }
                deleting = nil
                Task { await model.mutate { try await runtime.library.deleteBookmark(uri: bookmark.uri) } }
            }
        }
        .alert("Link unavailable", isPresented: Binding(get: { unavailable != nil }, set: { if !$0 { unavailable = nil } })) {
            Button("Copy link") { UIPasteboard.general.string = unavailable }
            Button("Retry") { if let subject = unavailable, let bookmark = model.bookmarks.first(where: { $0.value.subject == subject }) { open(bookmark) } }
            Button("Cancel", role: .cancel) { unavailable = nil }
        } message: { Text("This AT Protocol link could not be resolved to a web page.") }
    }

    private func changeState(_ bookmark: BookmarkView) {
        guard let runtime = model.runtime else { return }
        Task { await model.mutate { try await runtime.library.setState(bookmarkURI: bookmark.uri, archived: !bookmark.isArchived); model.recordArchivedDate(for: bookmark.uri, archived: !bookmark.isArchived) } }
    }

    private func open(_ bookmark: BookmarkView) {
        guard let runtime = model.runtime else { return }
        Task {
            do {
                guard let url = try await runtime.library.readingURL(for: bookmark) else { unavailable = bookmark.value.subject; return }
                if bookmark.contentFilter == .article { openURL(url) } else { browser = BrowserDestination(url: url) }
            } catch { unavailable = bookmark.value.subject }
        }
    }

}

private struct BookmarkRow: View {
    let bookmark: BookmarkView
    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            VStack(alignment: .leading, spacing: 6) {
                Text(bookmark.displayTitle).font(.headline).lineLimit(3)
                if let description = bookmark.preview?.description, !description.isEmpty { Text(description).font(.subheadline).foregroundStyle(.secondary).lineLimit(2) }
                Text(URL(string: bookmark.value.subject)?.host ?? bookmark.value.subject).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                Text("\(bookmark.contentFilter.rawValue) · \(bookmark.readingMinutes) min").font(.caption2).foregroundStyle(.secondary)
                if !(bookmark.value.tags ?? []).isEmpty { Text((bookmark.value.tags ?? []).map { "#\($0)" }.joined(separator: "  ")).font(.caption).foregroundStyle(.blue) }
            }.frame(maxWidth: .infinity, alignment: .leading)
            if let image = bookmark.preview?.image, let url = URL(string: image) {
                AsyncImage(url: url) { image in image.resizable().scaledToFill() } placeholder: { Color.secondary.opacity(0.1) }
                    .frame(width: 72, height: 72).clipShape(.rect(cornerRadius: 8)).accessibilityHidden(true)
            }
        }.padding(.vertical, 8).accessibilityElement(children: .combine)
    }
}

struct BookmarkSelection: Identifiable { let bookmark: BookmarkView; var id: String { bookmark.uri } }
private struct BrowserDestination: Identifiable { let url: URL; var id: URL { url } }
private struct SafariView: UIViewControllerRepresentable {
    let url: URL
    func makeUIViewController(context: Context) -> SFSafariViewController { SFSafariViewController(url: url) }
    func updateUIViewController(_ uiViewController: SFSafariViewController, context: Context) {}
}

extension BookmarkView {
    var displayTitle: String { nativeDisplayTitle }
    var readingMinutes: Int { estimatedReadingMinutes }
    var contentFilter: ContentFilter {
        switch nativeContentKind {
        case .article: .article
        case .social: .social
        case .other: .other
        }
    }
}
