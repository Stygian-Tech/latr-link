import SwiftUI
import LatrNativeCore

struct LoginHandleField: View {
    @Binding var handle: String
    let signingIn: Bool
    let submit: () -> Void
    @State private var suggestions: [LoginHandleSuggestion] = []
    @State private var selectedHandle: String?
    @State private var loading = false
    @State private var failed = false
    @FocusState private var focused: Bool
    private let client: LoginHandleTypeahead
    private struct SearchIdentity: Equatable { let handle: String; let signingIn: Bool }

    init(handle: Binding<String>, signingIn: Bool, submit: @escaping () -> Void) {
        _handle = handle
        self.signingIn = signingIn
        self.submit = submit
        #if DEBUG
        client = ProcessInfo.processInfo.arguments.contains("--ui-test-typeahead") ? .preview() : LoginHandleTypeahead()
        #else
        client = LoginHandleTypeahead()
        #endif
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            TextField("AT Protocol handle", text: $handle)
                .textContentType(.username).textInputAutocapitalization(.never).autocorrectionDisabled()
                .keyboardType(.URL).textFieldStyle(.roundedBorder).focused($focused)
                .onSubmit(submit)
                .disabled(signingIn)
            if loading { ProgressView("Finding accounts…").font(.caption) }
            if !suggestions.isEmpty {
                VStack(spacing: 0) {
                    ForEach(suggestions) { suggestion in
                        Button {
                            selectedHandle = suggestion.handle
                            handle = suggestion.handle
                            suggestions = []
                            focused = false
                        } label: {
                            HStack(spacing: 12) {
                                AsyncImage(url: suggestion.avatar.flatMap(URL.init(string:))) { image in
                                    image.resizable().scaledToFill()
                                } placeholder: {
                                    Image(systemName: "person.crop.circle.fill").resizable().foregroundStyle(.secondary)
                                }
                                .frame(width: 40, height: 40).clipShape(.circle).accessibilityHidden(true)
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(suggestion.displayName?.isEmpty == false ? suggestion.displayName! : suggestion.handle).font(.body.weight(.medium)).foregroundStyle(.primary)
                                    Text("@\(suggestion.handle)").font(.caption).foregroundStyle(.secondary)
                                }
                                Spacer(minLength: 0)
                            }.padding(12).contentShape(.rect)
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("login-suggestion.\(suggestion.did)")
                        .accessibilityHint("Use this handle to sign in")
                    }
                }.background(.quaternary.opacity(0.45), in: .rect(cornerRadius: 12))
            }
            if failed {
                Text("Account suggestions are unavailable. You can still sign in with your handle.")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
        .task(id: SearchIdentity(handle: handle, signingIn: signingIn)) { await search() }
        .onChange(of: signingIn) { _, active in if active { suggestions = [] } }
    }

    private func search() async {
        suggestions = []; failed = false; loading = false
        let input = handle
        guard !signingIn, input != selectedHandle, LoginHandleTypeahead.query(for: input) != nil else { return }
        do {
            try await Task.sleep(for: .milliseconds(200))
            loading = true
            defer { if !Task.isCancelled { loading = false } }
            let matches = try await client.search(input)
            guard !Task.isCancelled, handle == input, !signingIn else { return }
            suggestions = matches
        } catch {
            guard !Task.isCancelled, handle == input, !signingIn else { return }
            failed = true
        }
    }
}
