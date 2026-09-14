import SwiftUI
import LatrNativeCore

@main
struct LatrLinkApp: App {
    @State private var model = AppModel()
    @Environment(\.scenePhase) private var scenePhase
    @AppStorage("appearance") private var appearance = "system"
    @AppStorage("fontDesign") private var fontDesign = "sans"
    @AppStorage("boldText") private var boldText = false

    var body: some Scene {
        WindowGroup {
            RootView(model: model)
                .preferredColorScheme(appearance == "system" ? nil : appearance == "dark" ? .dark : .light)
                .fontDesign(fontDesign == "serif" ? .serif : fontDesign == "mono" ? .monospaced : .default)
                .fontWeight(boldText ? .semibold : nil)
                .tint(.blue)
                .task { await model.restore() }
                .onOpenURL { url in Task { await model.handleCallback(url) } }
                .onChange(of: scenePhase) { _, phase in
                    if phase == .active { Task { await model.activate() } }
                }
        }
    }
}
