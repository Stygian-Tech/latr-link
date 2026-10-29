import SwiftUI
import PhotosUI
import UniformTypeIdentifiers
import LatrNativeCore

struct SettingsView: View {
    @Bindable var model: AppModel
    @AppStorage("appearance") private var appearance = "system"
    @AppStorage("fontDesign") private var fontDesign = "sans"
    @AppStorage("boldText") private var boldText = false
    @State private var document: LibraryExport?
    @State private var exporting = false
    @State private var preparing = false
    @State private var showFeedback = false
    @State private var showSignOut = false
    var body: some View {
        Form {
            Section("Appearance") {
                Picker("Theme", selection: $appearance) {
                    Text("System").tag("system"); Text("Light").tag("light"); Text("Dark").tag("dark")
                }
                Picker("Font", selection: $fontDesign) {
                    Text("Sans serif").tag("sans"); Text("Serif").tag("serif"); Text("Monospace").tag("mono")
                }
                Toggle("Bold text", isOn: $boldText)
            }
            Section("Account") {
                LabeledContent("Handle", value: model.session?.handle ?? "—")
                Text(model.session?.did ?? "").font(.caption).textSelection(.enabled)
                Button("Sign out", role: .destructive) { showSignOut = true }
            }
            Section("Library data") {
                Button(preparing ? "Preparing export…" : "Export library as JSON", systemImage: "square.and.arrow.up") {
                    guard let runtime = model.runtime else { return }
                    preparing = true
                    Task {
                        do { document = LibraryExport(data: try await runtime.library.exportBookmarks()); exporting = true }
                        catch { model.error = error.localizedDescription }
                        preparing = false
                    }
                }.disabled(preparing)
                Button("Clear cached library", systemImage: "arrow.clockwise") {
                    guard let runtime = model.runtime else { return }
                    Task {
                        do { try await runtime.library.clearCache(); model.bookmarks = []; model.notice = "Cached library cleared. Pending saves are retained." }
                        catch { model.error = error.localizedDescription }
                    }
                }
            }
            Section("Migration") {
                Text(model.migrationStatus).font(.callout)
                Button("Check legacy saves and metadata") { Task { await model.migrate() } }
            }
            Section("About L@tr.link") {
                Button("Send feedback", systemImage: "bubble.left.and.bubble.right") { showFeedback = true }
                Link("Visit L@tr.link", destination: URL(string: "https://latr.link")!)
                Text("Your saved links belong to you. L@tr.link stores them on the AT Protocol.").font(.footnote).foregroundStyle(.secondary)
                if Bundle.main.infoDictionary?["LATR_ENVIRONMENT"] as? String == "testing" { Label("Development environment", systemImage: "hammer").foregroundStyle(.orange) }
            }
        }.navigationTitle("Settings")
            .fileExporter(isPresented: $exporting, document: document, contentType: .json, defaultFilename: "latr-library") { result in
                if case .failure(let error) = result { model.error = error.localizedDescription }
            }
            .sheet(isPresented: $showFeedback) { FeedbackView(model: model) }
            .confirmationDialog("Sign out of L@tr.link?", isPresented: $showSignOut, titleVisibility: .visible) {
                Button("Sign out", role: .destructive) { Task { await model.signOut() } }
            } message: { Text("Your pending saves stay on this device and pause until you sign back in to this account.") }
    }
}

struct LibraryExport: FileDocument {
    static let readableContentTypes: [UTType] = [.json]
    let data: Data
    init(data: Data) { self.data = data }
    init(configuration: ReadConfiguration) throws { data = configuration.file.regularFileContents ?? Data() }
    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper { FileWrapper(regularFileWithContents: data) }
}

private struct FeedbackView: View {
    @Bindable var model: AppModel
    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var message = ""
    @State private var tag = "comment"
    @State private var availableTags: [FeedbackTag] = []
    @State private var selectedPhotos: [PhotosPickerItem] = []
    @State private var photos: [FeedbackPhoto] = []
    @State private var photoCount = 0
    @State private var photoError: String?
    @State private var photoLoading = false
    @State private var photoGeneration = UUID()
    @State private var sending = false
    @State private var error: String?
    @State private var postedURL: URL?
    var body: some View {
        NavigationStack {
            Form {
                if let postedURL {
                    Section {
                        Label("Feedback published", systemImage: "checkmark.circle.fill").foregroundStyle(.green)
                        Link("View your feedback", destination: postedURL)
                    }
                } else {
                    Section {
                        TextField("Title", text: $title)
                        TextField("Describe your idea or issue", text: $message, axis: .vertical).lineLimit(5...12)
                        Text("\(title.utf16.count)/200 title · \(message.utf16.count)/10,000 body").font(.caption).foregroundStyle(.secondary)
                        Picker("Category", selection: $tag) {
                            if availableTags.isEmpty {
                                Text("Bug").tag("bug"); Text("Feature").tag("feature"); Text("Question").tag("question"); Text("Comment").tag("comment")
                            } else { ForEach(availableTags, id: \.value) { Text($0.label).tag($0.value) } }
                        }
                    }
                    Section("Photos") {
                        PhotosPicker(selection: $selectedPhotos, maxSelectionCount: 4, matching: .images) { Label("Choose up to four photos", systemImage: "photo.on.rectangle") }
                        if photoLoading { ProgressView("Preparing photos…") }
                        if photoCount > 0 { Text("\(photoCount) photos selected") }
                        if let photoError { Text(photoError).foregroundStyle(.red) }
                        if !selectedPhotos.isEmpty { Button("Remove photos", role: .destructive) { selectedPhotos = []; photos = []; photoCount = 0 } }
                    }
                    Section {
                        Label("Feedback is public", systemImage: "globe")
                        Text("Your title, message, photos, and account identity will be published to the L@tr.link feedback board on AT Protocol. Do not include private information.").font(.footnote).foregroundStyle(.secondary)
                    }
                    if let error { Section { Text(error).foregroundStyle(.red) } }
                }
            }.disabled(sending)
                .navigationTitle("Feedback")
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button(postedURL == nil ? "Cancel" : "Done") { dismiss() }.disabled(sending) }
                    if postedURL == nil {
                        ToolbarItem(placement: .confirmationAction) {
                            Button(sending ? "Publishing…" : "Publish") { publish() }
                                .disabled(sending || photoLoading || photoError != nil || title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || title.utf16.count > 200 || message.utf16.count > 10_000)
                        }
                    }
                }
                .task {
                    guard let runtime = model.runtime else { return }
                    do {
                        availableTags = try await runtime.library.fetchFeedbackTags()
                        if !availableTags.contains(where: { ExactTag.equal($0.value, tag) }), let first = availableTags.first { tag = first.value }
                    }
                    catch { self.error = "Using standard categories. \(error.localizedDescription)" }
                }
                .onChange(of: selectedPhotos) { _, selection in
                    Task { await loadPhotos(selection) }
                }
        }
    }
    private func loadPhotos(_ selection: [PhotosPickerItem]) async {
        let generation = UUID()
        photoGeneration = generation
        photoLoading = true; photoError = nil
        defer { if generation == photoGeneration { photoLoading = false } }
        do {
            var loaded: [FeedbackPhoto] = []
            for item in selection {
                guard let data = try await item.loadTransferable(type: Data.self), let image = UIImage(data: data), let jpeg = image.jpegData(compressionQuality: 0.8) else { throw NativeError.invalidResponse }
                loaded.append(FeedbackPhoto(data: jpeg, mimeType: "image/jpeg", alt: ""))
            }
            guard generation == photoGeneration, selectedPhotos == selection else { return }
            photos = loaded; photoCount = loaded.count
        } catch { if generation == photoGeneration { photoError = "Could not prepare the selected photos. Choose another image or remove photos." } }
    }
    private func publish() {
        guard let runtime = model.runtime else { return }
        sending = true; error = nil
        Task {
            do { postedURL = try await runtime.library.submitFeedback(title: title, body: message, tags: [tag], photos: photos) }
            catch { self.error = error.localizedDescription }
            sending = false
        }
    }
}
