// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "LatrKit",
    platforms: [
        .macOS(.v14),
        .iOS(.v17),
    ],
    products: [
        .library(name: "LatrKit", targets: ["LatrKit"]),
    ],
    dependencies: [
        .package(url: "https://github.com/apple/swift-crypto.git", from: "3.12.0"),
    ],
    targets: [
        .target(
            name: "LatrKit",
            dependencies: [
                .product(name: "Crypto", package: "swift-crypto"),
            ],
            path: "Sources/LatrKit"
        ),
        .testTarget(
            name: "LatrKitTests",
            dependencies: ["LatrKit"],
            path: "Tests/LatrKitTests"
        ),
    ]
)
