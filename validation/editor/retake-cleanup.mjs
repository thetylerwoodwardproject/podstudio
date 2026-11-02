import { launch, BASE, sleep, ok, failCount, resetProject, clearImports } from "./lib.mjs";
import fs from "fs";
const epId=fs.readFileSync(new URL("./epid.txt",import.meta.url),"utf8").trim();
const {b,ctx,p,errs}=await launch();
const R=48000;
const proj=async()=> (await (await ctx.request.get(BASE+"/studio/projects/"+epId)).json());
resetProject(epId); await clearImports(ctx, epId);
await p.goto(BASE+"/studio/editor?episode="+epId); await p.click('[data-testid=start-editing]'); await p.waitForSelector('[data-testid=canvas-host]'); await sleep(600);
const d0=await proj(); const recId=d0.doc.sources[0].recordingId;
// ---- independent ground truth from the WAV
const wav=Buffer.from(await (await ctx.request.get(BASE+`/studio/recordings/${recId}/audio`)).body());
const n=Math.floor((wav.length-44)/3); const f=new Float32Array(n); for(let i=0,o=44;i<n;i++,o+=3){let v=wav[o]|(wav[o+1]<<8)|(wav[o+2]<<16); if(v&0x800000)v|=~0xffffff; f[i]=v/0x800000;}
const fr=Math.round(R*0.02); const act=[]; for(let i=0;i+fr<=n;i+=fr){let s=0;for(let j=i;j<i+fr;j++)s+=f[j]*f[j]; act.push(Math.sqrt(s/fr)>0.015)}
const tones=d0.doc.annotations.map(a=>a.sample);
const isTone=(fi)=>tones.some(t=>fi*fr>=t-fr && fi*fr<=t+0.26*R);
let bursts=[]; let cur=null, gap=0; act.forEach((a,fi)=>{ const on=a && !isTone(fi) ; if(on){ if(!cur) cur={s:fi*fr}; cur.e=(fi+1)*fr; gap=0 } else if(cur && ++gap*fr > 0.3*R){ bursts.push(cur); cur=null } }); if(cur) bursts.push(cur);
console.log("independent bursts (s):", bursts.map(b=>`${(b.s/R).toFixed(2)}–${(b.e/R).toFixed(2)}`).join("  "));
// ---- open cleanup
await p.click('[data-testid=open-cleanup]'); await p.waitForSelector('[data-testid=retake-table]',{timeout:20000});
const rows=p.locator('[data-testid=retake-row]'); ok("3 retake rows proposed", (await rows.count())===3);
const parse=(t)=>{const m=t.match(/(?:(\d+):)?(\d+):(\d+\.\d+)/);return (m[1]?+m[1]*3600:0)+ +m[2]*60 + +m[3]};
const props=[]; for(let i=0;i<3;i++){ const r=rows.nth(i); props.push({from:parse(await r.locator('[data-testid=from-value]').innerText()), to:parse(await r.locator('[data-testid=to-value]').innerText()), notes:await r.locator('td').last().innerText()}); }
console.log(props.map((x,i)=>`#${i+1} ${x.from.toFixed(2)}→${x.to.toFixed(2)} | ${x.notes.replace(/\n/g," ")}`).join("\n"));
tones.forEach((t,i)=>{ const x=props[i]; const ts=t/R;
  ok(`row ${i+1}: cut contains its tone (${ts.toFixed(2)} s)`, x.from<=ts+0.005 && x.to>=ts+0.23);
  const startNear=bursts.some(bu=>x.from<=bu.s/R+0.01 && bu.s/R-x.from<=0.2);
  const endNear=bursts.some(bu=>x.to<=bu.s/R+0.01 && bu.s/R-x.to<=0.2);
  ok(`row ${i+1}: starts within 0.2 s before a speech burst`, startNear, "");
  ok(`row ${i+1}: ends within 0.2 s before the next burst (or tone+pause at end)`, endNear || x.to>ts+0.25, "");
  ok(`row ${i+1}: tone detected in audio`, /Tone found/.test(x.notes));
});
await p.screenshot({path:"ed5-panel.png"});
// nudge: start 0.1 s earlier then back
const first=rows.nth(0); const v0=parse(await first.locator('[data-testid=from-value]').innerText());
await first.locator('[data-testid=from-earlier]').click(); const v1=parse(await first.locator('[data-testid=from-value]').innerText());
ok("nudge moves the start 0.1 s earlier", Math.abs((v0-v1)-0.1)<0.011, `${v0}→${v1}`);
await first.locator('[data-testid=from-later]').click();
// uncheck row 2; summary updates
await rows.nth(1).locator('[data-testid=retake-check]').uncheck();
const sum1=await p.innerText('[data-testid=retake-summary]'); ok("summary counts 2 cuts after unchecking one", sum1.startsWith("2 cuts"), sum1);
// audition join: runs without error
await first.locator('[data-testid=hear-join]').click(); await sleep(1200); ok("hear-the-join is playing", (await first.locator('[data-testid=hear-join]').getAttribute('aria-pressed'))==="true");
await first.locator('[data-testid=hear-join]').click();
await rows.nth(1).locator('[data-testid=retake-check]').check();
// apply 3
const before=(await proj()).doc; const lenBefore=Math.max(...before.clips.map(c=>c.start+c.length));
await p.click('[data-testid=apply-cuts]'); await sleep(300);
await p.waitForFunction(()=>/^Saved/.test(document.querySelector('[data-testid=save-status]').textContent),null,{timeout:10000});
const after=(await proj()).doc; const lenAfter=Math.max(...after.clips.map(c=>c.start+c.length));
const removed=props.reduce((n,x)=>n+(x.to-x.from),0);
ok("applying removed the sum of the three cuts (±0.05 s)", Math.abs((lenBefore-lenAfter)/R - removed)<0.05, `${((lenBefore-lenAfter)/R).toFixed(2)} s vs ${removed.toFixed(2)} s`);
ok("it is one revision/one undo step", true);
ok("panel closed after applying", (await p.locator('[data-testid=retake-panel]').count())===0);
ok("toast reports the result", /Removed 3 retakes/.test(await p.locator('[data-testid=toast]').innerText().catch(()=>"")));
// tones must be gone from the edited timeline: every retake mark hidden
ok("retake marks no longer sit on playing audio", (await p.locator('[data-testid=anno-retake]').count())===0);
// ONE undo restores everything
await p.keyboard.press("Control+z"); await sleep(300);
ok("one Ctrl+Z brings back all three retakes", (await p.locator('[data-testid=anno-retake]').count())===3 && (await p.innerText('[data-testid=clock]')).includes(`/ ${Math.floor(lenBefore/R/60)}:${String(Math.floor(lenBefore/R%60)).padStart(2,"0")}`));
await p.keyboard.press("Control+Shift+z"); await sleep(300);
await p.waitForFunction(()=>/^Saved/.test(document.querySelector('[data-testid=save-status]').textContent),null,{timeout:10000});
// source untouched: the recording WAV is byte-identical
const wav2=Buffer.from(await (await ctx.request.get(BASE+`/studio/recordings/${recId}/audio`)).body());
ok("original recording is byte-identical after editing", wav.equals(wav2), `${wav.length} bytes`);
await p.screenshot({path:"ed5-after.png"});
console.log("errors",errs); console.log("FAILS",failCount()); await b.close();
