import UIKit
import SwiftUI
import UniformTypeIdentifiers
import LatrNativeCore

@MainActor
final class ShareViewController: UIViewController {
    private var model: ShareModel?
    override func viewDidLoad() {
        super.viewDidLoad()
        let model = ShareModel()
        self.model = model
        let host = UIHostingController(rootView: ShareReviewView(model: model) { [weak self] in
            self?.extensionContext?.completeRequest(returningItems: nil)
        })
        addChild(host)
        view.addSubview(host.view)
        host.view.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            host.view.leadingAnchor.constraint(equalTo: view.leadingAnchor), host.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            host.view.topAnchor.constraint(equalTo: view.topAnchor), host.view.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])
        host.didMove(toParent: self)
        Task {
            var text: [String] = []
            let items = extensionContext?.inputItems.compactMap { $0 as? NSExtensionItem } ?? []
            for item in items {
                for provider in item.attachments ?? [] {
                    let type = provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) ? UTType.url.identifier : UTType.plainText.identifier
                    guard provider.hasItemConformingToTypeIdentifier(type) else { continue }
                    if let string = await Self.loadText(provider, type: type) { text.append(string) }
                }
            }
            await model.prepare(text: text.joined(separator: "\n"))
        }
    }

    private static func loadText(_ provider: NSItemProvider, type: String) async -> String? {
        await withCheckedContinuation { continuation in
            provider.loadItem(forTypeIdentifier: type, options: nil) { item, _ in
                if let url = item as? URL { continuation.resume(returning: url.absoluteString) }
                else if let string = item as? String { continuation.resume(returning: string) }
                else { continuation.resume(returning: nil) }
            }
        }
    }
}

@MainActor @Observable
private final class ShareModel {
    var runtime: NativeRuntime?
    var session: NativeSession?
    var subjects: [String] = []
    var selected = ""
    var tags: [String] = []
    var loading = true
    var saving = false
    var status: String?
    var error: String?
    var completed = false

    func prepare(text: String) async {
        defer { loading = false }
        subjects = SharedLinkParser.subjects(in: text)
        if subjects.count == 1 { selected = subjects[0] }
        do {
            let runtime = try RuntimeConfiguration.make()
            self.runtime = runtime
            session = try await runtime.oauth.restoreSession()
            if session != nil { try await runtime.library.drainPendingSaves() }
        } catch { self.error = error.localizedDescription }
    }

    func save() async {
        guard let runtime, subjects.contains(selected), !saving else { return }
        saving = true
        defer { saving = false }
        do {
            let subject = try SharedLinkParser.validatedSubject(selected)
            let tags = try TagValidation.normalize(tags)
            if session == nil {
                _ = try await runtime.library.enqueueSave(subject: subject, tags: tags, expectedDID: nil)
                status = "Draft retained. Open L@tr.link, sign in, then confirm the account under Pending saves."
            } else {
                let save = try await runtime.library.enqueueSave(subject: subject, tags: tags, expectedDID: session?.did)
                try? await runtime.library.drainPendingSaves()
                let pending = try await runtime.library.pendingSaves()
                if let remaining = pending.first(where: { $0.id == save.id }) {
                    status = remaining.lastError == nil ? "Pending — retained on this device. Open L@tr.link or share again to retry." : "Pending — retained on this device. \(remaining.lastError!)"
                } else { status = "Saved to L@tr.link" }
            }
            completed = true
        } catch { self.error = "Failed: \(error.localizedDescription)" }
    }
}

private struct ShareReviewView: View {
    @Bindable var model: ShareModel
    let close: () -> Void
    @State private var tagInput = ""
    var body: some View {
        NavigationStack {
            Form {
                if model.loading { ProgressView("Reading shared link…") }
                else if model.subjects.isEmpty {
                    ContentUnavailableView("No supported link", systemImage: "link", description: Text("Share a web link or AT Protocol URI. Images and files are not supported."))
                } else {
                    Section("Account") {
                        if let session = model.session { Text(session.handle ?? session.did) }
                        else { Text("Signed out"); Text("Save a draft now, then sign in through the L@tr.link app to choose its account.").font(.footnote).foregroundStyle(.secondary) }
                    }
                    Section("Link") {
                        if model.subjects.count > 1 {
                            Picker("Choose one link", selection: $model.selected) {
                                Text("Select a link").tag("")
                                ForEach(model.subjects, id: \.self) { Text($0).tag($0) }
                            }
                        } else { Text(model.selected).textSelection(.enabled) }
                    }
                    Section("Tags") {
                        ForEach(model.tags.map(ExactTag.init)) { item in
                            let tag = item.value
                            HStack { Text(tag); Spacer(); Button("Remove \(tag)", systemImage: "minus.circle", role: .destructive) { model.tags.removeAll { ExactTag.equal($0, tag) } }.labelStyle(.iconOnly) }
                        }
                        HStack {
                            TextField("Add a tag", text: $tagInput).textInputAutocapitalization(.never).autocorrectionDisabled().onSubmit(addTag)
                            Button("Add", action: addTag).disabled(tagInput.isEmpty)
                        }
                    }
                }
                if let error = model.error { Section { Label(error, systemImage: "exclamationmark.triangle").foregroundStyle(.red) } }
                if let status = model.status { Section { Label(status, systemImage: status.hasPrefix("Saved") ? "checkmark.circle.fill" : "clock").accessibilityIdentifier("Save result") } }
            }
            .disabled(model.saving || model.completed)
            .navigationTitle("Save to L@tr.link")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(model.completed ? "Done" : "Cancel", action: close).disabled(model.saving) }
                if !model.completed {
                    ToolbarItem(placement: .confirmationAction) {
                        Button(model.session == nil ? "Save draft" : "Save") { Task { await model.save() } }
                            .disabled(model.loading || model.saving || !model.subjects.contains(model.selected) || model.runtime == nil)
                    }
                }
            }
            .overlay { if model.saving { ProgressView("Saving…").padding().background(.regularMaterial, in: .rect(cornerRadius: 12)) } }
        }
    }
    private func addTag() {
        do { model.tags = try TagValidation.normalize(model.tags + [tagInput]); tagInput = ""; model.error = nil }
        catch { model.error = error.localizedDescription }
    }
}
