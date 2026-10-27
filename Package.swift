// swift-tools-version:5.10
import PackageDescription

let package = Package(
    name: "continuo",
    platforms: [.macOS(.v14)],
    targets: [
        .target(name: "ContinuoCore"),
        .executableTarget(name: "continuo", dependencies: ["ContinuoCore"]),
        // the band in a web page: ContinuoCore built for WebAssembly as a reactor (see web/)
        .executableTarget(name: "ContinuoWeb", dependencies: ["ContinuoCore"],
                          linkerSettings: [.unsafeFlags(["-Xclang-linker", "-mexec-model=reactor"], .when(platforms: [.wasi]))]),
        .testTarget(name: "ContinuoCoreTests", dependencies: ["ContinuoCore"]),
    ]
)
