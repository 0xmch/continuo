// The band, from continuo's own Swift (ContinuoCore) compiled to WebAssembly: load it, give it
// a config, feed it notes and commands, and collect the MIDI it plays, stamped with the times
// it belongs to. Works in a page and in Node (the parity check).
import { wasi } from "./wasi.js";

export async function loadBand(bytes, log = console.log) {
  let memory = null;
  const { instance } = await WebAssembly.instantiate(bytes, { wasi_snapshot_preview1: wasi(() => memory, log) });
  const x = instance.exports;
  memory = x.memory;
  x._initialize();
  const encoder = new TextEncoder(), decoder = new TextDecoder();
  const put = (s) => {
    const bytes = encoder.encode(s);
    if (bytes.length > x.cn_text_capacity()) throw new Error("text too long for the band's buffer");
    const at = x.cn_text();   // first: the buffer's first use can grow memory, which replaces memory.buffer
    new Uint8Array(memory.buffer, at, bytes.length).set(bytes);
    return bytes.length;
  };
  const get = (n) => { const at = x.cn_text(); return decoder.decode(new Uint8Array(memory.buffer, at, Math.abs(n))); };
  return {
    /** Starts a band from a config object; throws with continuo's message if it can't. */
    init(config) { const n = x.cn_init(put(JSON.stringify(config))); if (n < 0) throw new Error(get(n)); },
    noteOn: (note, time) => x.cn_note_on(note, time),
    noteOff: (note, time) => x.cn_note_off(note, time),
    /** A `continuo ctl` command; returns its reply. */
    control: (line, time) => get(x.cn_control(put(line), time)),
    /** Runs the band up to `time`; returns [{time, part, bytes}] in the order it played them. */
    run(time) {
      const events = [];
      for (let n = x.cn_run(time); n > 0; n = x.cn_run(time)) {
        const at = x.cn_records();
        const v = new DataView(memory.buffer, at, n * 16);
        for (let i = 0; i < n; i++) {
          const length = v.getUint8(i * 16 + 12);
          events.push({ time: v.getFloat64(i * 16, true), part: v.getInt32(i * 16 + 8, true),
            bytes: [0, 1, 2].slice(0, length).map((k) => v.getUint8(i * 16 + 13 + k)) });
        }
        if (n < 4096) break;
      }
      return events;
    },
    state: () => JSON.parse(get(x.cn_state())),
    /** `continuo render --json`: {config, chords, scene, bars, loops} → the rehearsal's JSON. */
    rehearse(request) { const n = x.cn_rehearse(put(JSON.stringify(request))); if (n < 0) throw new Error(get(n)); return JSON.parse(get(n)); },
  };
}
