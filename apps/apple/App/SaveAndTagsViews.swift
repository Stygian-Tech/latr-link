import SwiftUI
import LatrNativeCore

struct TagsEditor: View {
    @Binding var tags: [String]
    var suggestions: [String] = []
    @State private var input = ""
    @State private var error: String?
    var body: some View {
        Section("Tags") {
            ForEach(tags.map(ExactTag.init)) { item in
                let tag = item.value
                HStack { Text(tag); Spacer(); Button("Remove \(tag)", systemImage: "minus.circle", role: .destructive) { tags.removeAll { ExactTag.equal($0, tag) } }.labelStyle(.iconOnly) }
            }
            HStack {
                TextField("Add a tag", text: $input).textInputAutocapitalization(.never).autocorrectionDisabled().onSubmit(addTag)
                Button("Add", action: addTag).disabled(input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
            if let error { Text(error).font(.caption).foregroundStyle(.red) }
            ForEach(Array(suggestions.filter { candidate in !tags.contains(where: { ExactTag.equal($0, candidate) }) && !input.isEmpty && candidate.localizedCaseInsensitiveContains(input) }.prefix(8)).map(ExactTag.init)) { item in
                let suggestion = item.value
                Button(suggestion) { input = suggestion; addTag() }
            }
        }
    }
    private func addTag() {
        do { tags = try TagValidation.normalize(tags + [input]); input = ""; error = nil }
        catch { self.error = error.localizedDescription }
    }
}

struct SaveLinkView: View {
    @Bindable var model: AppModel
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @State private var selected = ""
    @State private var tags: [String] = []
    @State private var saving = false
    private var subjects: [String] { SharedLinkParser.subjects(in: text) }
    var body: some View {
        NavigationStack {
            Form {
                Section("Save to account") { Text(model.session?.handle ?? model.session?.did ?? "Sign in required") }
                Section("Link") {
                    TextField("Web link or AT URI", text: $text, axis: .vertical).keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                    PasteButton(payloadType: String.self) { values in text = values.joined(separator: "\n") }
                    if subjects.count > 1 {
                        Picker("Choose one link", selection: $selected) {
                            Text("Select a link").tag("")
                            ForEach(subjects, id: \.self) { Text($0).tag($0) }
                        }
                    }
                }
                TagsEditor(tags: $tags, suggestions: ExactTag.unique(model.bookmarks.flatMap(\.tags)).sorted())
                Section { Text("Your save is kept on this device until the server confirms it. You can review or remove pending saves from the library.").font(.footnote).foregroundStyle(.secondary) }
            }
            .navigationTitle("Save to L@tr.link")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.disabled(saving) }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        saving = true
                        Task {
                            if await model.save(subject: subjects.count == 1 ? subjects[0] : selected, tags: tags) { dismiss() }
                            saving = false
                        }
                    }.disabled(saving || subjects.isEmpty || (subjects.count > 1 && !subjects.contains(selected)))
                }
            }
            .overlay { if saving { ProgressView("Saving…").padding().background(.regularMaterial, in: .rect(cornerRadius: 12)) } }
        }
    }
}

struct EditBookmarkTagsView: View {
    @Bindable var model: AppModel
    let bookmark: BookmarkView
    @Environment(\.dismiss) private var dismiss
    @State private var tags: [String] = []
    @State private var saving = false
    var body: some View {
        NavigationStack {
            Form {
                Section { Text(bookmark.displayTitle) }
                TagsEditor(tags: $tags, suggestions: ExactTag.unique(model.bookmarks.flatMap(\.tags)).sorted())
                Button("Clear all tags", role: .destructive) { tags = [] }
            }.navigationTitle("Edit tags")
                .task { tags = bookmark.tags }
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Save") {
                            guard let runtime = model.runtime else { return }
                            saving = true
                            Task {
                                do { try await runtime.library.setTags(bookmarkURI: bookmark.uri, tags: tags); await model.refresh(); dismiss() }
                                catch { model.error = error.localizedDescription }
                                saving = false
                            }
                        }.disabled(saving)
                    }
                }
        }
    }
}

struct PendingSavesView: View {
    @Bindable var model: AppModel
    @State private var editing: PendingSave?
    @State private var adopting: PendingSave?
    @State private var adoptionDID: String?
    @State private var adoptionLabel = ""
    var body: some View {
        List {
            Section { Text("Confirmed saves retry when you open the app or share extension. Drafts require you to confirm the account.").font(.footnote).foregroundStyle(.secondary) }
            ForEach(model.pending) { save in
                VStack(alignment: .leading, spacing: 8) {
                    Text(save.subject).font(.headline).textSelection(.enabled)
                    Text(save.tags.joined(separator: ", ")).font(.caption)
                    Label(save.isDraft ? "Draft — choose account" : save.lastError == nil ? "Pending" : "Failed — retained for retry", systemImage: save.isDraft ? "pencil" : "clock").foregroundStyle(.secondary)
                    if let error = save.lastError { Text(error).font(.caption).foregroundStyle(.red) }
                    HStack {
                        Button("Edit") { editing = save }
                        if save.isDraft { Button("Save to my account") { adopting = save; adoptionDID = model.session?.did; adoptionLabel = model.session?.handle ?? model.session?.did ?? "your account" } }
                        else { Button("Retry") { Task { await model.activate() } } }
                        Spacer()
                        Button("Remove", role: .destructive) {
                            guard let runtime = model.runtime else { return }
                            Task { do { try await runtime.library.removePendingSave(id: save.id); await model.refreshPending() } catch { model.error = error.localizedDescription } }
                        }
                    }.buttonStyle(.borderless)
                }.padding(.vertical, 6)
            }
            if model.pending.isEmpty { ContentUnavailableView("No pending saves", systemImage: "checkmark.circle") }
        }.navigationTitle("Pending saves")
            .refreshable { await model.activate() }
            .sheet(item: $editing) { PendingEditor(model: model, save: $0) }
            .confirmationDialog("Save this draft to \(adoptionLabel)?", isPresented: Binding(get: { adopting != nil }, set: { if !$0 { adopting = nil } }), titleVisibility: .visible) {
                Button("Confirm account and save") {
                    guard let save = adopting, let displayedDID = adoptionDID, let runtime = model.runtime else { return }
                    adopting = nil
                    Task { do { _ = try await runtime.library.adoptDraft(id: save.id, expectedDID: displayedDID); await model.activate() } catch { model.error = error.localizedDescription } }
                }
            }
    }
}

private struct PendingEditor: View {
    @Bindable var model: AppModel
    let save: PendingSave
    @Environment(\.dismiss) private var dismiss
    @State private var subject = ""
    @State private var tags: [String] = []
    var body: some View {
        NavigationStack {
            Form {
                TextField("Link", text: $subject, axis: .vertical).textInputAutocapitalization(.never).autocorrectionDisabled()
                TagsEditor(tags: $tags)
            }.navigationTitle("Edit pending save")
                .task { subject = save.subject; tags = save.tags }
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Save changes") {
                            guard let runtime = model.runtime else { return }
                            Task { do { try await runtime.library.updatePendingSave(id: save.id, subject: subject, tags: tags); await model.refreshPending(); dismiss() } catch { model.error = error.localizedDescription } }
                        }
                    }
                }
        }
    }
}

struct TagsView: View {
    @Bindable var model: AppModel
    let select: (String) -> Void
    @State private var selected: String?
    @State private var replacement = ""
    @State private var showRename = false
    @State private var showDelete = false
    @State private var busy = false
    @State private var counts: [Data: Int] = [:]
    @State private var tagNames: [String] = []
    var body: some View {
        List {
            if let progress = model.tagProgress { Text(progress).font(.footnote).foregroundStyle(.secondary) }
            ForEach(tagNames.sorted().map(ExactTag.init)) { item in
                let tag = item.value
                HStack {
                    Button { select(tag) } label: { HStack { Label(tag, systemImage: "tag"); Spacer(); Text("\(counts[Data(tag.utf8)] ?? 0)").foregroundStyle(.secondary) } }
                    Menu("Manage \(tag)", systemImage: "ellipsis") {
                        Button("Rename") { selected = tag; replacement = tag; showRename = true }
                        Button("Delete tag", role: .destructive) { selected = tag; showDelete = true }
                    }
                }.disabled(busy)
            }
            if counts.isEmpty { ContentUnavailableView("No tags yet", systemImage: "tag", description: Text("Add tags when saving links to organize your library.")) }
        }.navigationTitle("Tags")
            .task { await load() }
            .refreshable { await load() }
            .alert("Rename tag everywhere", isPresented: $showRename) {
                TextField("New tag", text: $replacement)
                Button("Rename") { change(delete: false) }
                Button("Cancel", role: .cancel) {}
            } message: { Text("Updates every bookmark carrying the exact tag, including archived links.") }
            .confirmationDialog("Remove \(selected ?? "tag") from every bookmark?", isPresented: $showDelete, titleVisibility: .visible) {
                Button("Delete tag", role: .destructive) { change(delete: true) }
            }
    }
    private func load() async {
        guard let runtime = model.runtime else { return }
        do {
            let all = try await runtime.library.listBookmarks()
            let tags = all.flatMap(\.tags)
            counts = tags.reduce(into: [:]) { $0[Data($1.utf8), default: 0] += 1 }
            tagNames = ExactTag.unique(tags)
        }
        catch { model.error = error.localizedDescription }
    }
    private func change(delete: Bool) {
        guard let tag = selected, let runtime = model.runtime else { return }
        busy = true
        model.tagProgress = "Updating bookmarks with \(tag)…"
        Task {
            do {
                if delete { try await runtime.library.deleteTag(tag) }
                else { try await runtime.library.renameTag(tag, replacement: replacement) }
                model.tagProgress = "Tag update complete"
                await model.refresh(); await load()
            } catch { model.tagProgress = "Update paused. Retry the same action to continue: \(error.localizedDescription)" }
            busy = false
        }
    }
}
