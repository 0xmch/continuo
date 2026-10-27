// The page's instruments: small Web Audio synths standing in for the General MIDI sounds the
// band asks for with its program changes, one sound per channel. Every note starts and stops at
// the time the band stamped it with.

// osc: [wave, detune in cents, level]; filter: [cutoff Hz, Q, extra Hz at the attack, its decay s];
// amp: [attack s, decay s, sustain level, release s]; fm: [ratio, depth × pitch, depth's decay s]
const PATCHES = {
  bass: { osc: [["sawtooth", 0, 0.6], ["square", -1200, 0.4]], filter: [600, 4, 1600, 0.16], amp: [0.004, 0.3, 0.55, 0.06], gain: 0.5 },
  synthbass: { osc: [["sawtooth", 0, 0.7], ["sawtooth", 8, 0.5]], filter: [450, 8, 2800, 0.12], amp: [0.003, 0.2, 0.5, 0.05], gain: 0.42 },
  piano: { osc: [["triangle", 0, 0.75], ["sawtooth", 0, 0.12]], filter: [2400, 1, 2400, 0.8], amp: [0.003, 1.6, 0, 0.25], gain: 0.34 },
  ep: { fm: [1, 1.8, 0.6], osc: [["sine", 0, 1]], filter: [5000, 0.5, 0, 1], amp: [0.004, 2, 0.12, 0.3], gain: 0.34 },
  clav: { osc: [["square", 0, 0.5], ["sawtooth", 0, 0.3]], filter: [1600, 6, 2600, 0.1], amp: [0.002, 0.35, 0, 0.05], gain: 0.24, highpass: 280 },
  guitar: { osc: [["triangle", 0, 0.8], ["sawtooth", 0, 0.15]], filter: [2200, 2, 1600, 0.22], amp: [0.002, 1, 0, 0.15], gain: 0.3 },
  vibes: { osc: [["sine", 0, 1], ["sine", 2400, 0.1]], filter: [6000, 0.5, 0, 1], amp: [0.002, 2.4, 0, 0.4], gain: 0.3, tremolo: [5.5, 0.25] },
  lead: { osc: [["sawtooth", 0, 0.5], ["square", 6, 0.35]], filter: [1500, 5, 2400, 0.18], amp: [0.005, 0.2, 0.6, 0.08], gain: 0.2 },
  flute: { osc: [["sine", 0, 1], ["triangle", 1200, 0.08]], filter: [3500, 0.5, 0, 1], amp: [0.05, 0.2, 0.8, 0.12], gain: 0.28 },
  harp: { osc: [["triangle", 0, 1]], filter: [3000, 1, 1500, 0.3], amp: [0.002, 1.3, 0, 0.3], gain: 0.32 },
  strings: { osc: [["sawtooth", -6, 0.45], ["sawtooth", 6, 0.45]], filter: [1700, 0.7, 600, 1], amp: [0.35, 0.6, 0.8, 0.7], gain: 0.15 },
  pad: { osc: [["sawtooth", -9, 0.4], ["sawtooth", 9, 0.4], ["triangle", -1200, 0.3]], filter: [1100, 1, 400, 1.2], amp: [0.45, 1, 0.75, 0.9], gain: 0.16 },
};

/** The sound for a program change's byte (General MIDI program − 1). */
export function patchFor(byte) {
  const p = byte + 1;
  if (p >= 33 && p <= 38) return "bass";
  if (p === 39 || p === 40) return "synthbass";
  if (p <= 4) return "piano";
  if (p === 5 || p === 6) return "ep";
  if (p === 8) return "clav";
  if (p >= 9 && p <= 16) return "vibes";
  if (p >= 25 && p <= 32) return "guitar";
  if (p === 47) return "harp";
  if (p >= 41 && p <= 52) return "strings";
  if (p >= 73 && p <= 80) return "flute";
  if (p >= 81 && p <= 88) return "lead";
  if (p >= 89 && p <= 96) return "pad";
  return "piano";
}

const MAX_VOICES = 48;

export class Synth {
  constructor(ctx) {
    this.ctx = ctx;
    this.patch = Array(16).fill("piano");
    this.voices = new Map();   // channel × 128 + note → voice
    this.compressor = new DynamicsCompressorNode(ctx, { threshold: -18, knee: 12, ratio: 3, attack: 0.005, release: 0.2 });
    this.volume = new GainNode(ctx, { gain: 0 });
    this.analyser = new AnalyserNode(ctx, { fftSize: 2048 });
    this.compressor.connect(this.volume).connect(this.analyser).connect(ctx.destination);
  }

  setVolume(db) { this.volume.gain.setTargetAtTime(db <= -60 ? 0 : 10 ** (db / 20), this.ctx.currentTime, 0.03); }

  /** One MIDI message from the band, at `time` on the context's clock. */
  midi(bytes, time) {
    const status = bytes[0] & 0xf0, ch = bytes[0] & 0x0f;
    if (status === 0xc0) this.patch[ch] = patchFor(bytes[1]);
    else if (status === 0x90 && bytes[2] > 0) this.start(ch, bytes[1], bytes[2], time);
    else if (status === 0x80 || status === 0x90) this.stop(ch, bytes[1], time);
    else if (status === 0xb0 && (bytes[1] === 123 || bytes[1] === 120)) this.allOff(time);
  }

  start(ch, note, velocity, t) {
    const key = ch * 128 + note;
    if (this.voices.has(key)) this.stop(ch, note, t);
    if (this.voices.size >= MAX_VOICES) { const [k, v] = this.voices.entries().next().value; this.release(v, t); this.voices.delete(k); }
    const ctx = this.ctx, p = PATCHES[this.patch[ch]];
    const f = 440 * 2 ** ((note - 69) / 12), level = (velocity / 127) ** 1.4 * p.gain;
    const [a, d, s, r] = p.amp, [cut, q, sweep, sweepDecay] = p.filter;
    const amp = new GainNode(ctx, { gain: 0 });
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(level, t + a);
    amp.gain.setTargetAtTime(level * s, t + a, d / 3);
    const filter = new BiquadFilterNode(ctx, { type: "lowpass", Q: q, frequency: Math.min(18000, cut + sweep) });
    filter.frequency.setValueAtTime(Math.min(18000, cut + sweep), t);
    filter.frequency.setTargetAtTime(cut, t, sweepDecay / 3);
    let head = filter;
    if (p.highpass) { const hp = new BiquadFilterNode(ctx, { type: "highpass", frequency: p.highpass }); filter.connect(hp); head = hp; }
    head.connect(amp).connect(this.compressor);
    const sources = p.osc.map(([type, detune, gain]) => {
      const o = new OscillatorNode(ctx, { type, frequency: f, detune });
      o.connect(new GainNode(ctx, { gain })).connect(filter);
      return o;
    });
    if (p.fm) {
      const [ratio, depth, decay] = p.fm;
      const m = new OscillatorNode(ctx, { frequency: f * ratio });
      const mg = new GainNode(ctx, { gain: 0 });
      mg.gain.setValueAtTime(f * depth, t);
      mg.gain.setTargetAtTime(f * depth * 0.1, t, decay / 3);
      m.connect(mg);
      for (const o of sources) mg.connect(o.frequency);
      sources.push(m);
    }
    if (p.tremolo) {
      const [rate, depth] = p.tremolo;
      const lfo = new OscillatorNode(ctx, { frequency: rate }), lg = new GainNode(ctx, { gain: level * depth });
      lfo.connect(lg).connect(amp.gain);
      sources.push(lfo);
    }
    for (const o of sources) o.start(t);
    sources[0].onended = () => amp.disconnect();
    this.voices.set(key, { sources, amp, start: t, attack: a, release: r });
  }

  stop(ch, note, t) {
    const key = ch * 128 + note, v = this.voices.get(key);
    if (!v) return;
    this.voices.delete(key);
    this.release(v, t);
  }

  release(v, t) {
    const at = Math.max(t, v.start + v.attack);   // never before the attack ends: its ramp would come back
    v.amp.gain.setTargetAtTime(0, at, v.release / 3);
    for (const o of v.sources) o.stop(at + v.release * 3);
  }

  allOff(t = this.ctx.currentTime) {
    for (const v of this.voices.values()) this.release(v, t);
    this.voices.clear();
  }

  /** The output's level in dBFS, for the meter and the page test. */
  level() {
    const a = new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(a);
    let sum = 0;
    for (const x of a) sum += x * x;
    return 10 * Math.log10(sum / a.length + 1e-12);
  }
}
