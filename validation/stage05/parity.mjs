// Stage 05 parity: the deployed preview FX (AudioWorklet in Chromium) vs the export's FxChain (Node, via vitest).
import { launch, BASE, sleep, resetProject } from "./lib.mjs";
import fs from "fs";
const epId = fs.readFileSync(new URL("./epid.txt", import.meta.url), "utf8").trim();
const { b, p, errs } = await launch();
resetProject(epId);
await p.goto(BASE + "/studio/editor?episode=" + epId); await p.click("[data-testid=start-editing]"); await p.waitForSelector("[data-testid=canvas-host]"); await sleep(600);
const FX = { v: 1, on: true, nr: { on: true, amount: 0.8 }, hpf: { on: true, freq: 120 }, lpf: { on: true, freq: 12000 }, eq: { low: { gainDb: -3, freq: 150 }, mid: { gainDb: 4, freq: 2200 }, high: { gainDb: 2, freq: 9000 } }, comp: { on: true, amount: 0.6 } };
const out = await p.evaluate(async (fx) => {
  const url = window.__podstudioWorklet;
  const N = 48000 * 3;
  const ctx = new OfflineAudioContext(2, N, 48000);
  await ctx.audioWorklet.addModule(url);
  // the same deterministic fixture the Node side builds: noise bed + a gated harmonic 'voice', L and R differ
  const buf = ctx.createBuffer(2, N, 48000);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let s = 17 + c;
    for (let i = 0; i < N; i++) {
      s = (s * 1664525 + 1013904223) >>> 0;
      let v = 0.02 * ((s / 2 ** 32) * 2 - 1);
      if (Math.floor(i / 24000) % 2 === 1) for (const h of [180, 360, 540, 900]) v += (0.1 / (h / 180)) * Math.sin((2 * Math.PI * h * (c ? 1.01 : 1) * i) / 48000);
      d[i] = v;
    }
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const node = new AudioWorkletNode(ctx, "podstudio-fx", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: "explicit", channelInterpretation: "speakers", processorOptions: { fx } });
  src.connect(node);
  node.connect(ctx.destination);
  src.start(0);
  const r = await ctx.startRendering();
  const enc = (a) => { const u = new Uint8Array(a.buffer); let bin = ""; for (let i = 0; i < u.length; i += 0x8000) bin += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(bin); };
  return { url, l: enc(r.getChannelData(0)), r: enc(r.getChannelData(1)) };
}, FX);
fs.writeFileSync(process.env.HOME + "/podstudio/apps/web/parity-browser.json", JSON.stringify({ fx: FX, ...out }));
console.log("worklet", out.url, "errors", errs);
resetProject(epId);
await b.close();
