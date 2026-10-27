#!/bin/sh
# Builds the band for the web page: ContinuoCore and ContinuoWeb for WebAssembly, into
# web/continuo.wasm. Needs swiftly's Swift 6.4.1 and its Wasm SDK (swift.org's "Getting
# started with Swift SDKs for WebAssembly"); Xcode's own Swift can't target WebAssembly.
# SDKROOT points at Xcode's macOS SDK: 6.4.1's linker can't read the Command Line Tools'
# newer one, which it would pick otherwise to build the package manifest.
set -eu
cd "$(dirname "$0")/.."
export SDKROOT="${SDKROOT:-$(xcrun --sdk macosx --show-sdk-path)}"
~/.swiftly/bin/swiftly run swift build --swift-sdk swift-6.4.1-RELEASE_wasm --product ContinuoWeb -c release \
  -Xswiftc -Osize -Xswiftc -gnone -Xlinker --strip-all +6.4.1
cp .build/out/Products/Release-webassembly-wasm32/ContinuoWeb.wasm web/continuo.wasm
ls -l web/continuo.wasm
