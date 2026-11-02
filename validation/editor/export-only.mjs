import { launch, BASE, sleep, ok, failCount } from "./lib.mjs";
import { execSync } from "child_process";
const EP=process.env.EP;
const {b,ctx,errs}=await launch();
const stat=(n)=>execSync(`docker stats --no-stream --format '{{.MemUsage}}' podstudio-${n}-1`).toString().trim();
const log=(...a)=>console.log(new Date().toISOString().slice(11,19),...a);
// clear earlier failed jobs
for(const j of (await (await ctx.request.get(BASE+`/studio/projects/${EP}/exports`)).json()).exports) await ctx.request.delete(BASE+"/studio/exports/"+j.id);
const pr=await (await ctx.request.get(BASE+`/studio/projects/${EP}`)).json(); log("exporting revision",pr.seq,"clips",pr.doc.clips.length);
await ctx.request.post(BASE+`/studio/projects/${EP}/exports`,{data:{bitDepth:24,sampleRate:48000}});
const t0=Date.now(); let peak=0, n=0;
for(;;){ await sleep(3000); const ex=(await (await ctx.request.get(BASE+`/studio/projects/${EP}/exports`)).json()).exports[0]; const m=stat("worker"); const v=parseFloat(m)*(m.split("/")[0].includes("GiB")?1024:1); peak=Math.max(peak,v); if(n++%6===0||ex.status!=="running"&&ex.status!=="queued") log(ex.status,(ex.progress*100).toFixed(0)+"%","worker",m);
  if(ex.status==="verified"||ex.status==="failed"||ex.status==="cancelled"){ log(`export ${ex.status} in ${((Date.now()-t0)/1000).toFixed(0)} s; worker mem peak (sampled) ≈ ${peak.toFixed(0)} MiB`, JSON.stringify(ex.summary||ex.error)); ok("2-hour 8-track export verified",ex.status==="verified"); break } if(Date.now()-t0>1800000) throw new Error("too slow") }
console.log("errors",errs); console.log("FAILS",failCount()); await b.close();
