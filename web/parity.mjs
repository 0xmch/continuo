// Parity check: the WebAssembly band against the native one. For every scene of a config, the
// same progression goes through `continuo render --json` and the module's rehearse(), and the
// two piano rolls (every note's part, pitch, start, length and velocity, the chords and the
// parts) must be the same.
//
//   node web/parity.mjs <ContinuoWeb.wasm> <continuo binary> <config.json> [chords…]
import { execFileSync } from "node:child_process";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadBand } from "./band.js";

const [wasm, native, configPath, ...rest] = process.argv.slice(2);
const chords = rest.length ? rest : ["Dm9", "G13", "Cmaj9", "A7alt", "F#m7b5", "B7b9", "Em9", "A13"];
const config = JSON.parse(readFileSync(configPath, "utf8"));
const band = await loadBand(readFileSync(wasm), () => {});
const dir = mkdtempSync(join(tmpdir(), "parity-"));
let failed = 0;
for (const scene of (config.scenes || []).map((s) => s.name)) {
  const out = join(dir, `${scene}.json`);
  execFileSync(native, ["render", ...chords, "--scene", scene, "--bars", "2", "--loops", "2", "--json", out,
    "--config", configPath, "--bank", "none", "--phrases", "none"], { stdio: "ignore" });
  const a = JSON.parse(readFileSync(out, "utf8"));
  const b = band.rehearse({ config, chords, scene, bars: 2, loops: 2 });
  const same = JSON.stringify(a) === JSON.stringify(b);
  if (!same) failed++;
  console.log(`${scene.padEnd(8)} ${String(a.notes.length).padStart(4)} notes native, ${String(b.notes.length).padStart(4)} in the browser build: ${same ? "same" : "DIFFERENT"}`);
  if (!same) {
    const i = a.notes.findIndex((n, k) => JSON.stringify(n) !== JSON.stringify(b.notes[k]));
    console.log("  first difference at note", i, JSON.stringify(a.notes[i]), JSON.stringify(b.notes[i]));
  }
}
process.exit(failed ? 1 : 0);
