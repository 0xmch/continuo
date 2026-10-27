// The web build's stand-ins for the few Foundation string calls the core makes. It builds on
// FoundationEssentials, which leaves out ICU and with it these; elsewhere Foundation's own apply.

#if os(WASI)
import FoundationEssentials

extension String {
    /// String(format:) for the one kind of format the core uses, "%.Nf" with a Double.
    init(format: String, _ arguments: CVarArg...) {
        guard format.hasPrefix("%."), format.hasSuffix("f"), let places = Int(format.dropFirst(2).dropLast()),
              let x = arguments.first as? Double else { self = format; return }
        var scale = 1.0
        for _ in 0..<places { scale *= 10 }
        let n = Int((abs(x) * scale).rounded())
        let whole = String(n / Int(scale)), part = String(n % Int(scale))
        self = (x < 0 && n != 0 ? "-" : "") + whole + (places > 0 ? "." + String(repeating: "0", count: places - part.count) + part : "")
    }

    func padding(toLength length: Int, withPad pad: String, startingAt index: Int) -> String {
        if count >= length { return String(prefix(length)) }
        let fill = Array(pad)
        return self + String((0..<(length - count)).map { fill[(index + $0) % fill.count] })
    }

    enum Trimmed { case whitespaces }   // the one set the core trims

    func trimmingCharacters(in set: Trimmed) -> String {
        let blank: (Character) -> Bool = { $0 == " " || $0 == "\t" }
        return String(drop(while: blank).reversed().drop(while: blank).reversed())
    }

    func replacingOccurrences(of target: String, with replacement: String) -> String {
        guard !target.isEmpty else { return self }
        return split(separator: target, omittingEmptySubsequences: false).joined(separator: replacement)
    }
}
#endif
