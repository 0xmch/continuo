// The band for a web page: C functions the WebAssembly module exports. Text (config, commands,
// replies, state) goes both ways through one buffer; the band's MIDI comes out as 16-byte records
// the page reads: time (Float64, seconds on the page's clock), part (Int32, -1 for clock), the
// message's length, then up to 3 bytes. The page plays them on its own synths.

#if os(WASI)
import ContinuoCore
import FoundationEssentials

final class Collector: Sink {
    var events: [(time: Double, part: Int32, bytes: [UInt8])] = []
    func send(_ bytes: [UInt8], output: Int, at time: Double, part: Int) { events.append((time, Int32(part), bytes)) }
}

let textCapacity = 1 << 20
let textBuffer = UnsafeMutablePointer<UInt8>.allocate(capacity: textCapacity)
let recordCapacity = 4096
let recordBuffer = UnsafeMutableRawPointer.allocate(byteCount: recordCapacity * 16, alignment: 8)
let collector = Collector()
var engine: Engine?
var chordName = ""

func readText(_ length: Int32) -> String {
    String(decoding: UnsafeBufferPointer(start: textBuffer, count: Int(length)), as: UTF8.self)
}

func writeText(_ s: String) -> Int32 {
    let bytes = Array(s.utf8.prefix(textCapacity))
    bytes.withUnsafeBufferPointer { textBuffer.update(from: $0.baseAddress!, count: bytes.count) }
    return Int32(bytes.count)
}

@_expose(wasm, "cn_text") @_cdecl("cn_text")
public func cnText() -> UnsafeMutablePointer<UInt8> { textBuffer }

@_expose(wasm, "cn_text_capacity") @_cdecl("cn_text_capacity")
public func cnTextCapacity() -> Int32 { Int32(textCapacity) }

@_expose(wasm, "cn_records") @_cdecl("cn_records")
public func cnRecords() -> UnsafeMutableRawPointer { recordBuffer }

/// A band from the config JSON in the text buffer: 0 when it's ready, else minus the length of
/// the error, which is in the buffer.
@_expose(wasm, "cn_init") @_cdecl("cn_init")
public func cnInit(_ length: Int32) -> Int32 {
    do {
        let config = try JSONDecoder().decode(Config.self, from: Data(readText(length).utf8))
        let band = try Engine(config: config, sink: collector)
        band.onChord = { _, chord in chordName = "\(chord)" }
        collector.events.removeAll()
        chordName = ""
        engine = band
        return 0
    } catch { return -writeText("\(error)") }
}

@_expose(wasm, "cn_note_on") @_cdecl("cn_note_on")
public func cnNoteOn(_ note: Int32, _ time: Double) { engine?.noteOn(Int(note), channel: 0, input: 0, at: time) }

@_expose(wasm, "cn_note_off") @_cdecl("cn_note_off")
public func cnNoteOff(_ note: Int32, _ time: Double) { engine?.noteOff(Int(note), channel: 0, input: 0, at: time) }

/// A `continuo ctl` command from the text buffer (scene jazz, tempo 120, chord Dm9, mute arp,
/// stop…); the reply goes back in the buffer, its length returned.
@_expose(wasm, "cn_control") @_cdecl("cn_control")
public func cnControl(_ length: Int32, _ time: Double) -> Int32 {
    writeText(engine?.control(readText(length), at: time) ?? "no band yet")
}

/// Runs the band up to `time`; returns how many MIDI records are in the record buffer.
@_expose(wasm, "cn_run") @_cdecl("cn_run")
public func cnRun(_ time: Double) -> Int32 {
    guard let band = engine else { return 0 }
    if collector.events.isEmpty { band.run(until: time) }
    let n = min(collector.events.count, recordCapacity)
    for (i, e) in collector.events.prefix(n).enumerated() {
        let r = recordBuffer + i * 16
        r.storeBytes(of: e.time, as: Double.self)
        r.storeBytes(of: e.part, toByteOffset: 8, as: Int32.self)
        r.storeBytes(of: UInt8(min(e.bytes.count, 3)), toByteOffset: 12, as: UInt8.self)
        for (k, b) in e.bytes.prefix(3).enumerated() { r.storeBytes(of: b, toByteOffset: 13 + k, as: UInt8.self) }
    }
    collector.events.removeFirst(n)
    return Int32(n)
}

/// The band's state as JSON in the text buffer, its length returned: whether it plays, the
/// scene, tempo, the chord it follows and each part with its channel (0-15) and mute.
@_expose(wasm, "cn_state") @_cdecl("cn_state")
public func cnState() -> Int32 {
    guard let band = engine else { return writeText("{}") }
    struct PartState: Encodable { let name: String, kind: String, channel: Int, mute: Bool }
    struct State: Encodable { let running: Bool, scene: String?, tempo: Double, chord: String, parts: [PartState], scenes: [String] }
    let state = State(running: band.running, scene: band.scene, tempo: band.tempo, chord: chordName,
                      parts: band.parts.map { PartState(name: $0.name, kind: $0.kind.rawValue, channel: $0.channel, mute: $0.mute) },
                      scenes: band.scenes.map(\.name))
    return writeText(String(decoding: (try? JSONEncoder().encode(state)) ?? Data("{}".utf8), as: UTF8.self))
}

/// `continuo render` for the parity check: rehearses the chords in the text buffer's JSON
/// ({"config": …, "chords": ["Dm9", …], "scene": "bossa", "bars": 1, "loops": 1}) and writes the
/// rehearsal's JSON (as `render --json` does) back; minus the error's length if it fails.
@_expose(wasm, "cn_rehearse") @_cdecl("cn_rehearse")
public func cnRehearse(_ length: Int32) -> Int32 {
    struct Request: Decodable { let config: Config, chords: [String], scene: String?, bars: Int?, loops: Int? }
    do {
        let q = try JSONDecoder().decode(Request.self, from: Data(readText(length).utf8))
        var chords: [Chord] = []
        for s in q.chords {
            guard let c = parseChord(s) else { throw ConfigError("can't read the chord \(s)") }
            chords.append(c)
        }
        let r = try rehearse(q.config, chords: chords, barsPerChord: q.bars ?? 1, loops: q.loops ?? 1, scene: q.scene)
        return writeText(String(decoding: r.json, as: UTF8.self))
    } catch { return -writeText("\(error)") }
}
#endif
