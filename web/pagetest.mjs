// End-to-end check of the page in a muted headless Chrome: starts the band, plays a chord pad,
// changes scene, plays notes on the keys, and reads the output level and the band's state.
// Fails on any console error or a silent band.
//
//   node web/pagetest.mjs [url] [screenshot dir]
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const url = process.argv[2] || "http://localhost:8794/", outdir = process.argv[3] || tmpdir();
const port = 9337;
const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", ["--headless=new", "--mute-audio",
  "--autoplay-policy=no-user-gesture-required", `--user-data-dir=${mkdtempSync(join(tmpdir(), "ct-"))}`,
  `--remote-debugging-port=${port}`, "--window-size=1100,1300", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws, id = 0;
const pending = new Map(), problems = [];
async function main() {
  let target;
  for (let i = 0; i < 50 && !target; i++) { try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === "page"); } catch {} await sleep(200); }
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r));
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
    if (m.method === "Runtime.exceptionThrown") problems.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") problems.push(m.params.args.map((a) => a.value ?? a.description).join(" "));
  });
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const run = async (expression) => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result.value;
  const shot = async (name) => writeFileSync(join(outdir, name), Buffer.from((await send("Page.captureScreenshot", { format: "png" })).data, "base64"));
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1100, height: 1300, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url });
  await sleep(1500);
  await run(`document.getElementById("start").click()`);
  for (let i = 0; i < 100 && !(await run(`document.body.classList.contains("live")`)); i++) await sleep(200);
  const results = [];
  const check = async (what) => {
    let peak = -120;
    for (let i = 0; i < 20; i++) { peak = Math.max(peak, await run(`continuo.level()`)); await sleep(100); }
    const s = await run(`(() => { const s = continuo.state(); return s.chord + ", " + s.scene + " at " + s.tempo + " bpm, playing " + s.parts.filter((p) => !p.mute).map((p) => p.name).join(" "); })()`);
    results.push(`${what}: output peak ${peak.toFixed(1)} dBFS; ${s}`);
    if (peak < -60) problems.push(`${what}: the band is silent`);
  };
  await run(`document.querySelector(".pad").click()`);
  await sleep(500);
  await check("pad Dm9, funk");
  await shot("continuo-desktop.png");
  for (const scene of ["jazz", "bossa", "house"]) {
    await run(`document.querySelector('#scenes [data-scene="${scene}"]').click()`);
    await sleep(300);
    await check(`scene ${scene}`);
  }
  await run(`document.querySelector('#parts [data-part="arp"]').click()`);
  await check("arp toggled");
  // a chord on the on-screen keys: F A C E
  await run(`for (const n of [53, 57, 60, 64]) document.querySelector('.key[data-note="' + n + '"]').dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: n }))`);
  await sleep(400);
  await check("keys F A C E");
  await run(`document.getElementById("stop").click()`);
  await sleep(1500);
  const after = await run(`continuo.level()`);
  results.push(`stopped: output ${after.toFixed(1)} dBFS`);
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 1100, deviceScaleFactor: 2, mobile: true });
  await sleep(500);
  await shot("continuo-phone.png");
  const sw = await run(`document.documentElement.scrollWidth`);
  if (sw > 390) problems.push(`the phone layout is ${sw} px wide`);
  console.log(results.join("\n"));
  console.log(problems.length ? "PROBLEMS:\n" + problems.join("\n") : "no console errors; the band played in every check");
  return problems.length ? 1 : 0;
}
main().then((code) => { ws?.close(); chrome.kill(); process.exit(code); }, (e) => { console.error(e); chrome.kill(); process.exit(1); });
