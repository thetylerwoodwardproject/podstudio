import { launch, BASE, sleep, ok, failCount, db } from "./lib.mjs";
import fs from "fs";
import { chromium } from "playwright-core";
const epId=fs.readFileSync(new URL("./epid.txt",import.meta.url),"utf8").trim();
const {b,ctx,p,errs}=await launch();
const R=48000;
const proj=async()=> (await (await ctx.request.get(BASE+"/studio/projects/"+epId)).json());
for(const j of (await (await ctx.request.get(BASE+`/studio/projects/${epId}/exports`)).json()).exports) await ctx.request.delete(BASE+'/studio/exports/'+j.id);
const P=await proj(); const doc=P.doc; const recId=doc.sources[0].recordingId;
console.log("project revision",P.seq,"clips",doc.clips.length);
// ---- reference mix from the ORIGINAL recording, by the definition of the edit
const wav=Buffer.from(await (await ctx.request.get(BASE+`/studio/recordings/${recId}/audio`)).body());
const n=Math.floor((wav.length-44)/3); const src=new Float32Array(n); for(let i=0,o=44;i<n;i++,o+=3){let v=wav[o]|(wav[o+1]<<8)|(wav[o+2]<<16); if(v&0x800000)v|=~0xffffff; src[i]=v<0?v/0x800000:v/0x7fffff;}
let len=0; for(const c of doc.clips) len=Math.max(len,c.start+c.length);
const ref=new Float32Array(len);
for(const c of doc.clips){ const g=10**(c.gainDb/20); for(let t=c.start;t<c.start+c.length;t++){ let k=g; if(c.fadeIn>0&&t<c.start+c.fadeIn)k*=(t-c.start)/c.fadeIn; const os=c.start+c.length-c.fadeOut; if(c.fadeOut>0&&t>os)k*=(c.start+c.length-t)/c.fadeOut; ref[t]+=src[c.srcStart+(t-c.start)]*k; } }
const dec=(bytes,bd)=>{const per=bd/8;const m=(bytes.length-44)/per;const o=new Float32Array(m);for(let i=0,q=44;i<m;i++,q+=per){let v=bd===16?(bytes[q]|(bytes[q+1]<<8)):(bytes[q]|(bytes[q+1]<<8)|(bytes[q+2]<<16)); v=bd===16?(v<<16)>>16:(v<<8)>>8; o[i]=v/(bd===16?32768:8388608);}return o};
const rms=(a,b)=>{let s=0;for(let i=0;i<a.length;i++)s+=(a[i]-b[i])**2;return 10*Math.log10(s/a.length+1e-20)};
const goertzel=(w,fr)=>{const c=2*Math.cos(2*Math.PI*fr/R);let s1=0,s2=0;for(const x of w){const s=x+c*s1-s2;s2=s1;s1=s}return 2*Math.sqrt(Math.max(0,s1*s1+s2*s2-c*s1*s2))/w.length};

await p.goto(BASE+"/studio/editor?episode="+epId); await p.waitForSelector('[data-testid=canvas-host]'); await sleep(500);
await p.click('[data-testid=open-export]'); await p.waitForSelector('[data-testid=export-dialog]');
// ---- 24-bit 48 kHz
await p.click('[data-testid=bd-24]'); await p.click('[data-testid=sr-48]'); await p.click('[data-testid=start-export]');
await p.waitForSelector('[data-testid=export-job][data-status=verified]',{timeout:60000});
let jobs=(await (await ctx.request.get(BASE+`/studio/projects/${epId}/exports`)).json()).exports; const j24=jobs[0];
ok("job verified with summary", j24.status==="verified" && j24.summary.frames===len && j24.revisionSeq===P.seq, JSON.stringify(j24.summary).slice(0,120));
const dl=await ctx.request.get(BASE+"/studio/exports/"+j24.id); const w24=new Uint8Array(await dl.body());
ok("download works with attachment header", dl.status()===200 && /attachment; filename=/.test(dl.headers()["content-disposition"]||""), dl.headers()["content-disposition"]);
const v=new DataView(w24.buffer); ok("24-bit/48k mono header, length = edited length", v.getUint32(24,true)===48000&&v.getUint16(34,true)===24&&v.getUint16(22,true)===1&&(w24.length-44)/3===len, `${w24.length} bytes`);
const got24=dec(w24,24);
// exports are loudness-normalised (−19 LUFS mono): compare against the definition × the reported gain.
// Parity of the mix itself is what this checks; the limiter must not have touched this material.
const ng=j24.summary.normalise; ok("export was normalised to −19 LUFS (no limiting on this take)", ng && ng.targetLufs===-19 && ng.limitedSamples===0 && Math.abs(j24.summary.integratedLufs+19)<0.5, JSON.stringify(ng));
const kg=10**((ng?.gainDb??0)/20); const refN=ref.map(x=>x*kg);
ok("aligned residual vs the edit definition × normalisation gain < −60 dBFS (required) — measured", rms(got24,refN)<-60, rms(got24,refN).toFixed(1)+" dBFS");
// retake tones really are gone from the export
let toneHits=0; for(let at=0;at+1200<=got24.length;at+=240){ const sl=got24.subarray(at,at+1200); if(goertzel(sl,1000)>0.25){ let r=0; for(const x of sl)r+=x*x; r=Math.sqrt(r/sl.length); if(goertzel(sl,1000)*0.7071>=0.6*r) toneHits++; } }
ok("no 1 kHz retake tone in the exported audio", toneHits===0, "hits "+toneHits);
// sha256 matches the stored one
const crypto=await import("crypto"); ok("downloaded bytes hash to the stored sha256", crypto.createHash("sha256").update(w24).digest("hex")===j24.summary.sha256);
// ---- 16-bit 44.1 kHz
await p.click('[data-testid=bd-16]'); await p.click('[data-testid=sr-441]'); await p.click('[data-testid=start-export]');
await p.waitForFunction(()=>document.querySelectorAll('[data-testid=export-job][data-status=verified]').length>=2,null,{timeout:60000});
jobs=(await (await ctx.request.get(BASE+`/studio/projects/${epId}/exports`)).json()).exports; const j16=jobs[0];
const w16=new Uint8Array(await (await ctx.request.get(BASE+"/studio/exports/"+j16.id)).body()); const v16=new DataView(w16.buffer);
const frames441=Math.ceil(len*147/160);
ok("16-bit/44.1k header and frame count", v16.getUint32(24,true)===44100&&v16.getUint16(34,true)===16&&(w16.length-44)/2===frames441, `${(w16.length-44)/2} vs ${frames441}`);
// compare with the reference resampled by an independent linear-interp of the 48k reference tone content? use band-limited check instead: duration + RMS level within 0.2 dB
const got16=dec(w16,16); const lvl=(a)=>10*Math.log10(a.reduce((s,x)=>s+x*x,0)/a.length); 
ok("44.1k export keeps the level (within 0.2 dB of the 48k render)", Math.abs(lvl(got16)-lvl(got24))<0.2, `${lvl(got16).toFixed(2)} vs ${lvl(got24).toFixed(2)} dB`);
await p.screenshot({path:"ed6-export.png"});
// ---- unauthenticated access to the download is refused
const anon=await (await chromium.launch({executablePath:(await import("./lib.mjs")).exe,args:["--ignore-certificate-errors","--host-resolver-rules=MAP studio.tylerwoodward.me 127.0.0.1"]})); const actx=await anon.newContext({ignoreHTTPSErrors:true});
const r=await actx.request.get(BASE+"/studio/exports/"+j24.id,{maxRedirects:0}); ok("download refused without a session", r.status()!==200, String(r.status())); await anon.close();
// ---- queued job can be cancelled; abandoned running job (lapsed lease) is picked up
db(`d.prepare("insert into render_jobs (id,episode_id,project_revision_id,revision_seq,kind,settings,status,progress,created_at) values ('zz-q',?,?,?,'wav','{\\"bitDepth\\":24,\\"sampleRate\\":48000}','queued',0,?)").run("${epId}","${P.revisionId}",${P.seq},${Date.now()+60000})`);
let rr=await ctx.request.delete(BASE+"/studio/exports/zz-q"); ok("a queued export can be cancelled", (await rr.json()).action==="cancelled");
db(`d.prepare("insert into render_jobs (id,episode_id,project_revision_id,revision_seq,kind,settings,status,progress,attempts,lease_until,created_at) values ('zz-r',?,?,?,'wav','{\\"bitDepth\\":16,\\"sampleRate\\":48000}','running',0.4,1,?,?)").run("${epId}","${P.revisionId}",${P.seq},${Date.now()-5000},${Date.now()})`);
await sleep(8000); const st=JSON.parse(db(`console.log(JSON.stringify(d.prepare("select status,attempts from render_jobs where id='zz-r'").get()))`));
ok("a job whose worker died (lease lapsed) is picked up and finished", st.status==="verified"&&st.attempts===2, JSON.stringify(st));
// ---- a job pointing at a bad revision fails cleanly with a message, leaves no object
db(`d.prepare("insert into render_jobs (id,episode_id,project_revision_id,revision_seq,kind,settings,status,progress,created_at) values ('zz-bad',?,'nope',99,'wav','{\\"bitDepth\\":24,\\"sampleRate\\":48000}','queued',0,?)").run("${epId}",${Date.now()})`);
await sleep(5000); const bad=JSON.parse(db(`console.log(JSON.stringify(d.prepare("select status,error from render_jobs where id='zz-bad'").get()))`)); ok("a job with a missing revision fails with a message", bad.status==="failed"&&/revision/.test(bad.error), JSON.stringify(bad));
// ---- delete removes file + asset
const before=db(`console.log(d.prepare("select count(*) c from assets where kind='export_wav' and episode_id='${epId}'").get().c)`);
for(const j of (await (await ctx.request.get(BASE+`/studio/projects/${epId}/exports`)).json()).exports) await ctx.request.delete(BASE+"/studio/exports/"+j.id);
const after=db(`console.log(d.prepare("select count(*) c from assets where kind='export_wav' and episode_id='${epId}'").get().c)`);
ok("deleting exports removes their assets", +before>=3 && +after===0, `${before} → ${after}`);
ok("deleted export no longer downloads", (await ctx.request.get(BASE+"/studio/exports/"+j24.id)).status()===404);
console.log("errors",errs); console.log("FAILS",failCount()); await b.close();
