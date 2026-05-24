// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "LatrGateway",
    platforms: [
        .macOS(.v14),
    ],
    products: [
        .executable(name: "LatrGateway", targets: ["LatrGateway"]),
    ],
    dependencies: [
        .package(url: "https://github.com/hummingbird-project/hummingbird.git", from: "2.0.0"),
        .package(url: "https://github.com/swift-server/async-http-client.git", from: "1.25.0"),
    ],
    targets: [
        .target(
            name: "LatrGatewayLib",
            dependencies: [
                .product(name: "Hummingbird", package: "hummingbird"),
                .product(name: "AsyncHTTPClient", package: "async-http-client"),
            ],
            path: "Sources/LatrGatewayLib"
        ),
        .executableTarget(
            name: "LatrGateway",
            dependencies: ["LatrGatewayLib"],
            path: "Sources/LatrGateway"
        ),
        .testTarget(
            name: "LatrGatewayTests",
            dependencies: [
                "LatrGatewayLib",
                .product(name: "HummingbirdTesting", package: "hummingbird"),
            ],
            path: "Tests/LatrGatewayTests"
        ),
    ]
)
