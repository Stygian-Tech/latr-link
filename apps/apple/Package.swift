// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "LatrNativeCore",
    platforms: [.iOS(.v18), .macOS(.v14)],
    products: [.library(name: "LatrNativeCore", targets: ["LatrNativeCore"])],
    dependencies: [.package(url: "https://github.com/Stygian-Tech/latr-kit.git", revision: "f0e2ce680b07fa41d28d7b1cfeac01a25d5df2c6")],
    targets: [
        .target(name: "LatrNativeCore", dependencies: [.product(name: "LatrKit", package: "latr-kit")], path: "Core", linkerSettings: [.linkedLibrary("sqlite3")]),
        .testTarget(name: "LatrNativeCoreTests", dependencies: ["LatrNativeCore"], path: "Tests/Core")
    ],
    swiftLanguageModes: [.v6]
)
