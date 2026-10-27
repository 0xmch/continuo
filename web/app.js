// continuo in a page: chords from the pads, the on-screen keys, the computer keyboard or a MIDI
// keyboard go to the band (continuo's own Swift, compiled to WebAssembly); what it plays comes
// back as MIDI and plays on the page's synths, 100 ms ahead of the audio clock.
import { loadBand } from "./band.js";
import { Synth } from "./synth.js";

const $ = (id) => document.getElementById(id);
const LOOKAHEAD = 0.1;
const PROGRESSIONS = [
  ["Dm9", "G13", "Cmaj9", "A7alt"],
  ["Fmaj7", "Em7", "Dm7", "Cmaj7"],
  ["Am9", "D9", "Gmaj7", "Cmaj7"],
  ["Ebmaj7", "Cm9", "Fm9", "Bb13"],
];
// the computer keyboard as a piano, from C: the home row plays the white keys
const KEYS = "awsedftgyhujkolp;";
const BASE = 48, FIRST = 48, LAST = 72;   // C3; the on-screen keys run C3–C5

let ctx = null, synth = null, band = null, pump = 0, octave = 0;
const held = new Map();   // source key → note, so a key lifts the note it pressed

function now() { return ctx.currentTime; }

function noteOn(source, note) {
  if (!band || held.has(source)) return;
  held.set(source, note);
  band.noteOn(note, now());
  keyEl(note)?.classList.add("down");
}

function noteOff(source) {
  const note = held.get(source);
  if (note === undefined) return;
  held.delete(source);
  band.noteOff(note, now());
  keyEl(note)?.classList.remove("down");
}

function keyEl(note) { return document.querySelector(`.key[data-note="${note}"]`); }

function control(line) {
  if (!band) return "";
  const reply = band.control(line, now());
  if (line === "stop") synth.allOff();
  refresh();
  return reply;
}

function tick() {
  const t = now();
  for (const e of band.run(t + LOOKAHEAD)) synth.midi(e.bytes, Math.max(e.time, t));
}

let shown = "";
function refresh() {
  if (!band) return;
  const s = band.state();
  const key = JSON.stringify(s);
  if (key === shown) return;
  shown = key;
  $("chord").textContent = s.chord || "play a chord";
  $("chord").classList.toggle("idle", !s.chord);
  $("where").textContent = `${s.scene ?? ""} · ${Math.round(s.tempo)} bpm${s.running ? "" : " · stopped"}`;
  for (const b of document.querySelectorAll("#scenes button")) b.setAttribute("aria-pressed", b.dataset.scene === s.scene);
  for (const b of document.querySelectorAll("#parts button")) {
    const p = s.parts.find((p) => p.name === b.dataset.part);
    b.setAttribute("aria-pressed", p ? !p.mute : false);
  }
  for (const b of document.querySelectorAll(".pad")) b.classList.toggle("on", b.dataset.chord === s.chord);
  const tempo = $("tempo");
  if (document.activeElement !== tempo) tempo.value = Math.round(s.tempo);
  $("tempo-value").textContent = Math.round(s.tempo);
}

async function start() {
  const button = $("start");
  button.disabled = true;
  ctx = new AudioContext({ latencyHint: "interactive" });
  synth = new Synth(ctx);
  synth.setVolume(+$("volume").value);
  try {
    $("start-note").textContent = "loading the band (3.8 MB)…";
    const [wasm, config] = await Promise.all([
      fetch("continuo.wasm").then((r) => { if (!r.ok) throw new Error(`continuo.wasm: ${r.status}`); return r.arrayBuffer(); }),
      fetch("config.json").then((r) => r.json()),
    ]);
    band = await loadBand(wasm, (line) => console.log("continuo:", line));
    band.init(config);
  } catch (e) {
    $("start-note").textContent = `The band didn't load: ${e.message}`;
    button.disabled = false;
    return;
  }
  await ctx.resume();
  pump = setInterval(tick, 25);
  setInterval(refresh, 150);
  document.body.classList.add("live");
  buildScenes(band.state().scenes);
  refresh();
}

function buildScenes(names) {
  const box = $("scenes");
  box.replaceChildren(...names.map((name) => {
    const b = document.createElement("button");
    b.className = "toggle";
    b.dataset.scene = name;
    b.textContent = name;
    b.onclick = () => control(`scene ${name}`);
    return b;
  }));
}

function buildPads() {
  const box = $("pads");
  for (const row of PROGRESSIONS) {
    const line = document.createElement("div");
    line.className = "pad-row";
    for (const chord of row) {
      const b = document.createElement("button");
      b.className = "pad";
      b.dataset.chord = chord.replace("b", "♭").replace("#", "♯");
      b.textContent = b.dataset.chord;
      b.onclick = () => control(`chord ${chord}`);
      line.append(b);
    }
    box.append(line);
  }
}

function buildKeys() {
  const box = $("keys");
  const black = new Set([1, 3, 6, 8, 10]);
  for (let n = FIRST; n <= LAST; n++) {
    const k = document.createElement("div");
    k.className = "key" + (black.has(n % 12) ? " black" : "");
    k.dataset.note = n;
    const letter = KEYS[n - BASE];
    if (letter) k.dataset.letter = letter.toUpperCase();
    const source = `pointer:${n}`;
    k.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      try { k.setPointerCapture(e.pointerId); } catch {}   // keeps the note until this pointer lifts, wherever it goes
      noteOn(source, n);
    });
    k.addEventListener("pointerup", () => noteOff(source));
    k.addEventListener("pointercancel", () => noteOff(source));
    box.append(k);
  }
}

addEventListener("keydown", (e) => {
  if (e.repeat || e.metaKey || e.ctrlKey || e.altKey || e.target.matches("input")) return;
  const i = KEYS.indexOf(e.key.toLowerCase());
  if (i >= 0) { noteOn(`key:${e.code}`, BASE + i + octave * 12); e.preventDefault(); }
  else if (e.key === "z") octave = Math.max(-2, octave - 1);
  else if (e.key === "x") octave = Math.min(2, octave + 1);
});
addEventListener("keyup", (e) => noteOff(`key:${e.code}`));
addEventListener("blur", () => { for (const source of [...held.keys()]) noteOff(source); });

async function connectMidi() {
  const button = $("midi");
  if (!navigator.requestMIDIAccess) { button.textContent = "no Web MIDI in this browser"; button.disabled = true; return; }
  try {
    const access = await navigator.requestMIDIAccess();
    const wire = () => {
      let n = 0;
      for (const input of access.inputs.values()) {
        n++;
        input.onmidimessage = ({ data }) => {
          const status = data[0] & 0xf0, source = `midi:${input.id}:${data[1]}`;
          if (status === 0x90 && data[2] > 0) noteOn(source, data[1]);
          else if (status === 0x80 || status === 0x90) noteOff(source);
        };
      }
      button.textContent = n ? `MIDI: ${n} input${n > 1 ? "s" : ""}` : "MIDI: nothing plugged in";
      button.setAttribute("aria-pressed", n > 0);
    };
    access.onstatechange = wire;
    wire();
  } catch {
    button.textContent = "MIDI: not allowed";
  }
}

$("start").onclick = start;
$("stop").onclick = () => control("stop");
$("midi").onclick = connectMidi;
$("volume").oninput = (e) => { synth?.setVolume(+e.target.value); $("volume-value").textContent = `${e.target.value} dB`; };
$("tempo").oninput = (e) => { $("tempo-value").textContent = e.target.value; };
$("tempo").onchange = (e) => control(`tempo ${e.target.value}`);
for (const b of document.querySelectorAll("#parts button")) b.onclick = () => control(`toggle ${b.dataset.part}`);
buildPads();
buildKeys();
$("volume-value").textContent = `${$("volume").value} dB`;

// for the page test: the output level, and the band's state
window.continuo = { level: () => synth?.level() ?? -120, state: () => band?.state(), control };
