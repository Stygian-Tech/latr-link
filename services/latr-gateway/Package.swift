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
        .package(url: "https://github.com/Stygian-Tech/latr-kit.git", revision: "f0e2ce680b07fa41d28d7b1cfeac01a25d5df2c6"),
        .package(url: "https://github.com/hummingbird-project/hummingbird.git", from: "2.0.0"),
        .package(url: "https://github.com/swift-server/async-http-client.git", from: "1.25.0"),
        .package(url: "https://github.com/apple/swift-crypto.git", from: "3.12.0"),
        .package(url: "https://github.com/21-DOT-DEV/swift-secp256k1", exact: "0.23.2"),
        .package(url: "https://github.com/vapor/postgres-nio.git", from: "1.21.0"),
    ],
    targets: [
        .target(
            name: "LatrGatewayLib",
            dependencies: [
                .product(name: "LatrKit", package: "latr-kit"),
                .product(name: "Hummingbird", package: "hummingbird"),
                .product(name: "AsyncHTTPClient", package: "async-http-client"),
                .product(name: "Crypto", package: "swift-crypto"),
                .product(name: "P256K", package: "swift-secp256k1"),
                .product(name: "PostgresNIO", package: "postgres-nio"),
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
            path: "Tests/LatrGatewayTests",
            // Golden-vector JSON is read from the source tree via #filePath, not bundled,
            // so it is excluded rather than declared as a resource.
            exclude: ["Fixtures"]
        ),
    ]
)
