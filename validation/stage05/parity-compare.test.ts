import { expect, it } from "vitest";
import fs from "node:fs";
import { FxChain, normalizeFx } from "@podstudio/audio/fx";
it("browser worklet output = Node FxChain output", () => {
  const j = JSON.parse(fs.readFileSync(new URL("../../../parity-browser.json", import.meta.url), "utf8"));
  const dec = (b64: string) => new Float32Array(Uint8Array.from(Buffer.from(b64, "base64")).buffer);
  const L = dec(j.l), R = dec(j.r);
  const N = L.length;
  const inp = [new Float32Array(N), new Float32Array(N)];
  for (let c = 0; c < 2; c++) {
    let s = 17 + c;
    for (let i = 0; i < N; i++) {
      s = (s * 1664525 + 1013904223) >>> 0;
      let v = 0.02 * ((s / 2 ** 32) * 2 - 1);
      if (Math.floor(i / 24000) % 2 === 1) for (const h of [180, 360, 540, 900]) v += (0.1 / (h / 180)) * Math.sin((2 * Math.PI * h * (c ? 1.01 : 1) * i) / 48000);
      inp[c]![i] = Math.fround(v);
    }
  }
  const ch = new FxChain(48000, 2, normalizeFx(j.fx)!);
  const outL = new Float32Array(N), outR = new Float32Array(N);
  for (let i = 0; i < N; i += 128) {
    const y = ch.process([inp[0]!.subarray(i, i + 128), inp[1]!.subarray(i, i + 128)]);
    outL.set(y[0]!, i);
    outR.set(y[1]!, i);
  }
  let err = 0, sig = 0, maxd = 0, same = 0;
  for (let i = 0; i < N; i++) {
    for (const [a, b] of [[L[i]!, outL[i]!], [R[i]!, outR[i]!]] as const) {
      err += (a - b) ** 2;
      sig += b * b;
      maxd = Math.max(maxd, Math.abs(a - b));
      if (a === b) same++;
    }
  }
  const resid = 10 * Math.log10(err / (2 * N) + 1e-30);
  console.log(`PARITY samples ${2 * N}, bit-identical ${same}, max |diff| ${maxd.toExponential(2)}, residual ${resid.toFixed(1)} dBFS RMS, signal ${(10 * Math.log10(sig / (2 * N))).toFixed(1)} dBFS`);
  expect(resid).toBeLessThan(-60);
});
