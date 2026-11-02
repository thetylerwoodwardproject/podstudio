import { launch, BASE, sleep, ok, failCount } from "./lib.mjs";
import { execSync } from "child_process";
const EP=process.env.EP, REC=process.env.REC, ASSET=process.env.ASSET;
const R=48000, TOTAL=7200*R;
const {b,ctx,p,errs}=await launch();
const stat=(n)=>execSync(`docker stats --no-stream --format '{{.MemUsage}} {{.CPUPerc}}' podstudio-${n}-1`).toString().trim();
const log=(...a)=>console.log(new Date().toISOString().slice(11,19),...a);
const heap=()=>p.evaluate(()=>Math.round(performance.memory.usedJSHeapSize/1048576));
// ---- start project + build the 8-track document
let r=await (await ctx.request.post(BASE+`/studio/projects/${EP}/start`,{data:{recordingId:REC}})).json(); if(!r.ok) throw new Error(JSON.stringify(r));
const base=r.project; const src=base.doc.sources[0];
const kinds=["host","guest","host","guest","music","sfx","music","sfx"]; const tracks=kinds.map((k,i)=>({id:"t"+i,name:["Host","Guest","Host 2","Guest 2","Music","SFX","Music 2","SFX 2"][i],kind:k,muted:false,solo:false,locked:false,height:96}));
const clips=[]; let n=0;
for(let i=0;i<8;i++){ const step=(40+i*3)*R; for(let s=0;s<TOTAL;s+=step){ const len=Math.min(step,TOTAL-s); clips.push({id:`c${i}-${n++}`,trackId:"t"+i,sourceId:src.id,srcStart:s,length:len,start:s,gainDb:-18,fadeIn:0,fadeOut:0}); } }
const doc={...base.doc,tracks,clips,annotations:base.doc.annotations};
const body=JSON.stringify({baseRevisionId:base.revisionId,document:doc,label:"8-track measurement"});
let t0=Date.now(); const sv=await ctx.request.post(BASE+`/studio/projects/${EP}`,{data:body,headers:{"Content-Type":"application/json"}}); const svj=await sv.json();
log(`saved 8-track project: ${clips.length} clips, ${(body.length/1024).toFixed(0)} KB JSON, ${Date.now()-t0} ms`, svj.ok?"ok":JSON.stringify(svj).slice(0,200));
// ---- peaks: cold (server streams 1 GB) then cached
t0=Date.now(); let pk=await ctx.request.get(BASE+`/studio/recordings/${REC}/peaks`,{timeout:600000}); const pkb=await pk.body(); const cold=(Date.now()-t0)/1000;
log(`peaks cold: ${cold.toFixed(1)} s, ${(pkb.length/1048576).toFixed(2)} MB | web ${stat("web")}`);
t0=Date.now(); pk=await ctx.request.get(BASE+`/studio/recordings/${REC}/peaks`); await pk.body(); log(`peaks cached: ${Date.now()-t0} ms`);
// ---- open the editor
const reqs=[]; p.on("request",q=>{ if(q.url().includes("/audio")) reqs.push({u:q.url(),r:q.headers()["range"]}) });
t0=Date.now(); await p.goto(BASE+`/studio/editor?episode=${EP}`); await p.waitForSelector('[data-testid=canvas-host]');
await p.waitForFunction(()=>{const cs=[...document.querySelectorAll('canvas')];return cs.length===8&&cs.every(c=>{const x=c.getContext('2d');const d=x.getImageData(0,0,c.width,Math.min(c.height,40)).data;for(let i=3;i<d.length;i+=4*17) if(d[i]>0) return true;return false})},null,{timeout:60000});
const load=Date.now()-t0; log(`editor ready (8 tracks painted): ${load} ms | heap ${await heap()} MB`);
// ---- zoom + scroll redraw cost
const redraw=await p.evaluate(async()=>{const sc=document.querySelector('[data-testid=timeline-scroll]'); const times=[]; document.querySelector('[data-testid=zoom-in]').click(); document.querySelector('[data-testid=zoom-in]').click(); document.querySelector('[data-testid=zoom-in]').click(); await new Promise(r=>setTimeout(r,300)); for(let i=0;i<20;i++){const t=performance.now(); sc.scrollLeft+=900; await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))); times.push(performance.now()-t);} times.sort((a,b)=>a-b); return {median:times[10],p95:times[19]}});
log(`scroll redraw (8 tracks, zoomed in 8×): median ${redraw.median.toFixed(1)} ms, p95 ${redraw.p95.toFixed(1)} ms | heap ${await heap()} MB`);
// ---- seek to 1:00:00 (End then arrows are too slow: use ruler via keyboard End then compute); use the player directly via keys
t0=Date.now(); await p.keyboard.press("End"); await p.waitForFunction(()=>document.querySelector('[data-testid=clock]').textContent.startsWith("2:00:00"),null,{timeout:5000}); log(`seek to end → clock updated in ${Date.now()-t0} ms`);
// shift+left x 360 = 1 h back in 10 s steps (fast enough)
for(let i=0;i<360;i++) await p.keyboard.press("Shift+ArrowLeft",{delay:0});
await sleep(500); log("clock at", (await p.innerText('[data-testid=clock]')).replace(/\n/g," "));
// ---- play 12 s from here: audio requests + heap + clock advance
reqs.length=0; const h0=await heap(); await p.click('[data-testid=play]'); await sleep(12000);
const clk=await p.innerText('[data-testid=clock]'); await p.keyboard.press("Space"); const h1=await heap();
const rbytes=reqs.reduce((s,q)=>{const m=(q.r||"").match(/bytes=(\d+)-(\d+)/);return s+(m?(+m[2]-+m[1]+1):0)},0);
log(`played 12 s on 8 tracks: clock ${clk.split("/")[0].trim()}, ${reqs.length} audio range requests, ${(rbytes/1048576).toFixed(1)} MB fetched, heap ${h0}→${h1} MB`);
ok("playback advanced about 12 s on 8 tracks", /^1:0\d:\d\d\.\d/.test(clk.trim()));
ok("playback fetched bounded audio (< 40 MB for 12 s)", rbytes<40*1048576, (rbytes/1048576).toFixed(1)+" MB");
// ---- edit latency: split at playhead across 8 tracks (UI → dirty), ripple delete, undo
const lat=async(action)=>{const t=await p.evaluate(()=>performance.now()); await action(); await p.waitForFunction((t0)=>{const s=document.querySelector('[data-testid=save-status]').textContent;return /Unsaved|Saving|Saved · revision [3-9]/.test(s)},t,{timeout:5000}); return (await p.evaluate(()=>performance.now()))-t};
const splitMs=await lat(()=>p.click('[data-testid=split]')); log(`split at playhead (8 tracks, ${clips.length} clips): UI reflects in ${splitMs.toFixed(0)} ms`);
await p.waitForFunction(()=>/^Saved/.test(document.querySelector('[data-testid=save-status]').textContent),null,{timeout:20000}); 
const st2=await p.innerText('[data-testid=save-status]'); log("autosave:", st2);
// range select 10 min via ruler drag then ripple delete
const rb=await p.locator('[data-testid=ruler]').boundingBox(); const y=rb.y+rb.height/2; const sx=300; 
await p.mouse.move(sx,y); await p.mouse.down(); await p.mouse.move(sx+500,y,{steps:10}); await p.mouse.up();
const ripMs=await lat(()=>p.click('[data-testid=ripple-delete]')); log(`ripple delete across 8 tracks: UI reflects in ${ripMs.toFixed(0)} ms`);
await p.waitForFunction(()=>/^Saved/.test(document.querySelector('[data-testid=save-status]').textContent),null,{timeout:20000});
const undoMs=await lat(()=>p.keyboard.press("Control+z")); log(`undo: ${undoMs.toFixed(0)} ms | heap ${await heap()} MB`);
await p.waitForFunction(()=>/^Saved/.test(document.querySelector('[data-testid=save-status]').textContent),null,{timeout:20000});
// ---- export 24/48 in the worker, sample memory
const pr=await (await ctx.request.get(BASE+`/studio/projects/${EP}`)).json(); log("exporting revision",pr.seq);
await ctx.request.post(BASE+`/studio/projects/${EP}/exports`,{data:{bitDepth:24,sampleRate:48000}});
t0=Date.now(); let peakMem=0, last="";
for(;;){ await sleep(3000); const ex=(await (await ctx.request.get(BASE+`/studio/projects/${EP}/exports`)).json()).exports[0]; const m=stat("worker"); const mb=parseFloat(m); const unit=m.includes("GiB")?1024:1; peakMem=Math.max(peakMem,parseFloat(m)*unit); last=`${ex.status} ${(ex.progress*100).toFixed(0)}% worker ${m}`; if(ex.status==="verified"||ex.status==="failed"){ log(last); log(`export ${ex.status} in ${((Date.now()-t0)/1000).toFixed(0)} s; worker peak sampled ≈ ${peakMem.toFixed(0)} MiB; ${JSON.stringify(ex.summary||ex.error).slice(0,160)}`); break } if((Date.now()-t0)>1800000) throw new Error("export too slow"); if(Math.round((Date.now()-t0)/3000)%5===0) log(last) }
const ex=(await (await ctx.request.get(BASE+`/studio/projects/${EP}/exports`)).json()).exports[0];
ok("2-hour 8-track export verified", ex.status==="verified", ex.status);
console.log("errors",errs); console.log("FAILS",failCount()); await b.close();
