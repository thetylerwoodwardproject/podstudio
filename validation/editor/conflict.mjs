import { launch, BASE, sleep, ok, failCount, resetProject, clearImports } from "./lib.mjs";
import fs from "fs";
const epId=fs.readFileSync(new URL("./epid.txt",import.meta.url),"utf8").trim();
const {b,ctx,p:A,errs}=await launch();
const R=48000;
const proj=async()=> (await (await ctx.request.get(BASE+"/studio/projects/"+epId)).json());
resetProject(epId); await clearImports(ctx, epId);
await A.goto(BASE+"/studio/editor?episode="+epId); await A.click('[data-testid=start-editing]'); await A.waitForSelector('[data-testid=canvas-host]');
const B=await ctx.newPage(); await B.goto(BASE+"/studio/editor?episode="+epId); await B.waitForSelector('[data-testid=canvas-host]');
await sleep(500);
// A splits at 4 s
await A.keyboard.press("Home"); for(let i=0;i<4;i++) await A.keyboard.press("ArrowRight"); await A.click('[data-testid=split]');
await A.waitForFunction(()=>/^Saved · revision 2/.test(document.querySelector('[data-testid=save-status]').textContent),null,{timeout:8000});
// B (stale: base revision 1) splits at 12 s → conflict
await B.keyboard.press("Home"); for(let i=0;i<12;i++) await B.keyboard.press("ArrowRight"); await B.click('[data-testid=split]');
await B.waitForSelector('[data-testid=conflict-banner]',{timeout:8000});
ok("stale tab gets conflict banner instead of overwriting", true, await B.innerText('[data-testid=save-status]'));
let d=await proj(); ok("server still has A's version only (rev 2, one split)", d.seq===2 && d.doc.clips.length===2, `seq ${d.seq} clips ${d.doc.clips.length}`);
await B.screenshot({path:"ed4-conflict.png"});
// B keeps its version → saved as revision 3 on top of A's
await B.click('button:has-text("Keep my version")');
await B.waitForFunction(()=>/^Saved · revision 3/.test(document.querySelector('[data-testid=save-status]').textContent),null,{timeout:8000});
d=await proj(); ok("keep-mine writes a new revision on top (rev 3), history keeps A's rev 2", d.seq===3, `seq ${d.seq}`);
// A now stale; edits; chooses "load newer"
await A.keyboard.press("Home"); for(let i=0;i<2;i++) await A.keyboard.press("ArrowRight"); await A.click('[data-testid=split]');
await A.waitForSelector('[data-testid=conflict-banner]',{timeout:8000});
await A.click('button:has-text("Load the newer version")');
await sleep(400);
ok("load-newer drops A's edit and reflects B's doc", (await A.innerText('[data-testid=save-status]')).startsWith("Saved · revision 3"), await A.innerText('[data-testid=save-status]'));
d=await proj(); ok("server unchanged by the discarded edit", d.seq===3);
// bad documents are rejected server-side
const bad=await ctx.request.post(BASE+"/studio/projects/"+epId,{data:{baseRevisionId:d.revisionId,document:{...d.doc,clips:[{...d.doc.clips[0],length:9e9}]}}});
ok("server rejects a clip that reaches outside its source (422)", bad.status()===422, String(bad.status())+" "+(await bad.text()).slice(0,80));
const bad2=await ctx.request.post(BASE+"/studio/projects/"+epId,{data:{baseRevisionId:d.revisionId,document:{...d.doc,sources:[{...d.doc.sources[0],assetId:"nope"}]}}});
ok("server rejects an unknown asset (422)", bad2.status()===422, String(bad2.status()));
console.log("errors",errs); console.log("FAILS",failCount()); await b.close();
