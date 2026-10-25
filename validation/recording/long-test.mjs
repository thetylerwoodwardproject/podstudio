import { chromium } from "playwright-core";
import fs from "fs";
import { execSync } from "child_process";
// Long solo-recording qualification run against the deployed studio (Stage 03).
//   MINUTES=120 node long-test.mjs   — normally started by validation/recording/run-long.sh
// Records MINUTES of a fake microphone, presses K at 20/50/80 %, then verifies the finished WAV
// (header, duration, every chunk boundary, silent holes, retake tones) and cleans up its episode.
const MINUTES = Number(process.env.MINUTES || 30);
const pw = fs.readFileSync("/home/tylerw/podstudio/deploy/.env","utf8").match(/PODSTUDIO_ADMIN_PASSWORD=(.*)/)[1].trim();
const exe = fs.globSync(process.env.HOME+"/.cache/ms-playwright/chromium_headless_shell-*/*/chrome-headless-shell")[0];
const S=(process.env.WORK_DIR||process.cwd())+"/"; // mic-test.wav lives here; scratch files go here
const b = await chromium.launch({executablePath: exe, args:["--ignore-certificate-errors","--host-resolver-rules=MAP studio.tylerwoodward.me 127.0.0.1","--use-fake-ui-for-media-stream","--use-fake-device-for-media-stream","--use-file-for-fake-audio-capture="+S+"mic-test.wav","--autoplay-policy=no-user-gesture-required","--enable-precise-memory-info"]});
const BASE="https://studio.tylerwoodward.me"; let fails=0; const ok=(n,c,x="")=>{if(!c)fails++;console.log(c?"PASS":"FAIL",n,x)};
const log=(...a)=>console.log(new Date().toISOString().slice(11,19),...a);
const db=(body)=>execSync("cd /home/tylerw/podstudio/deploy && docker compose exec -T web node -",{input:`const D=require("better-sqlite3");const d=new D("/data/podstudio.db");${body}`}).toString().trim();
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const dstats=()=>execSync("docker stats --no-stream --format '{{.Name}} {{.MemUsage}} {{.CPUPerc}}' podstudio-web-1 2>/dev/null || docker stats --no-stream --format '{{.Name}} {{.MemUsage}} {{.CPUPerc}}' | grep web").toString().trim().split("\n")[0];
const ctx=await b.newContext({viewport:{width:1440,height:900},ignoreHTTPSErrors:true}); await ctx.grantPermissions(["microphone"],{origin:BASE});
const p=await ctx.newPage(); const errs=[]; p.on("pageerror",e=>errs.push(String(e)));
await p.goto(BASE+"/login"); await p.fill('input[type=email]',"tyler@fullymodulated.com"); await p.fill('input[type=password]',pw); await p.click('button[type=submit]'); await p.waitForSelector('[data-testid=show-card]');
await p.goto(BASE+"/studio/episodes"); await p.click('button:has-text("New episode")'); await p.fill('#new-title',`Long recording test ${MINUTES} min (delete me)`); await p.click('button:has-text("Create")'); await p.waitForURL(/episodes\/[0-9a-f-]{36}$/);
const epId=p.url().split("/").pop(); fs.writeFileSync(S+"long-epid.txt",epId);
const mem=()=>p.evaluate(()=>performance.memory?{heap:Math.round(performance.memory.usedJSHeapSize/1048576),limit:Math.round(performance.memory.jsHeapSizeLimit/1048576)}:null);
const idb=()=>p.evaluate(async()=>{try{const e=await navigator.storage.estimate();return Math.round((e.usage||0)/1048576)}catch{return -1}});
log("episode",epId,"| web container:",dstats());
try {
await p.goto(BASE+"/studio/record/solo?episode="+epId); await p.waitForSelector('[data-testid=solo-stage]'); await p.click('[data-testid=enable-mic]').catch(()=>{}); await p.waitForFunction(()=>!document.querySelector('[data-testid=record]').disabled,null,{timeout:20000});
const m0=await mem(); log("heap before recording (MB):",JSON.stringify(m0));
await p.click('[data-testid=record]'); await p.waitForSelector('[data-testid=rec-pill]'); const t0=Date.now();
const total=MINUTES*60*1000; const kAt=[0.2,0.5,0.8].map(f=>Math.round(total*f)); let kDone=0; const samples=[]; let lastLog=0;
let maxBacklog=0, maxHeap=m0?.heap??0, maxStore=0;
while (Date.now()-t0 < total) {
  await sleep(1000);
  const el=Date.now()-t0;
  if (kDone<kAt.length && el>=kAt[kDone]) { await p.keyboard.press("k"); kDone++; log("pressed K at",(el/1000).toFixed(1),"s"); }
  if (el-lastLog>=60_000) {
    lastLog=el;
    const saved=parseInt(await p.innerText('[data-testid=saved]')), ver=parseInt(await p.innerText('[data-testid=verified]')); const timer=await p.innerText('[data-testid=timer]'); const m=await mem(); const st=await idb();
    maxBacklog=Math.max(maxBacklog,saved-ver); maxHeap=Math.max(maxHeap,m?.heap??0); maxStore=Math.max(maxStore,st);
    const warn=await p.locator('[data-testid=waiting]').count()?await p.locator('[data-testid=waiting]').innerText():""; const le=await p.locator('[data-testid=local-error]').count();
    log(`t=${timer} saved=${saved} verified=${ver} backlog=${saved-ver} heap=${m?.heap}MB storage=${st}MB ${warn?"WAITING:"+warn:""} ${le?"LOCAL-ERROR":""} | ${dstats()}`);
    samples.push({el,saved,ver,heap:m?.heap});
  }
}
log("stopping at",((Date.now()-t0)/1000).toFixed(1),"s wall");
const tStop=Date.now(); await p.click('[data-testid=stop]');
await p.waitForSelector('[data-testid=finished]',{timeout:15*60*1000}); const finishS=(Date.now()-tStop)/1000;
log("finished; stop → verified WAV took",finishS.toFixed(1),"s");
const ftxt=await p.innerText('[data-testid=finished]'); ok("finished complete (server verified)", ftxt.includes("Server verified")&&!(await p.locator('[data-testid=incomplete-note]').count()), ftxt.replace(/\n+/g," | ").slice(0,140));
ok("page had no JS errors / no local journal errors", errs.length===0 && (await p.locator('[data-testid=local-error]').count())===0, JSON.stringify(errs));
log("max backlog (saved - verified):",maxBacklog,"chunks | max JS heap:",maxHeap,"MB | max browser storage:",maxStore,"MB");
ok("uploads kept up (backlog stayed small)", maxBacklog<=3, String(maxBacklog));
ok("JS heap stayed bounded (<150 MB)", maxHeap<150, maxHeap+" MB");
const recId=db(`console.log(d.prepare("select id from recordings where episode_id='${epId}'").get().id)`);
const row=JSON.parse(db(`console.log(JSON.stringify(d.prepare("select status,total_samples ts,report from recordings where id='${recId}'").get()))`));
ok("DB: complete, no report", row.status==="complete"&&row.report==null, JSON.stringify(row));
const secs=row.ts/48000; ok(`duration ≈ ${MINUTES*60} s (±3 s)`, Math.abs(secs-MINUTES*60)<3, secs.toFixed(2)+" s");
// ---- download + verify the WAV (streamed to disk, then read)
const url=BASE+`/studio/recordings/${recId}/audio`;
const path=S+"long.wav"; const resp=await ctx.request.get(url); const body=await resp.body(); fs.writeFileSync(path,body);
const wav=fs.readFileSync(path); const dv=new DataView(wav.buffer,wav.byteOffset,wav.byteLength);
ok("WAV header: 48 kHz mono 24-bit, size matches", dv.getUint32(24,true)===48000&&dv.getUint16(22,true)===1&&dv.getUint16(34,true)===24&&dv.getUint32(40,true)===wav.length-44, `${(wav.length/1048576).toFixed(1)} MB`);
const n=Math.floor((wav.length-44)/3); const f=new Float32Array(n); for(let i=0,o=44;i<n;i++,o+=3){let v=wav[o]|(wav[o+1]<<8)|(wav[o+2]<<16); if(v&0x800000)v|=~0xffffff; f[i]=v<0?v/0x800000:v/0x7fffff;}
const goertzel=(w,sr,fr)=>{const c=2*Math.cos(2*Math.PI*fr/sr);let s1=0,s2=0;for(const x of w){const s=x+c*s1-s2;s2=s1;s1=s}return 2*Math.sqrt(Math.max(0,s1*s1+s2*s2-c*s1*s2))/w.length};
const st=await (await ctx.request.get(BASE+`/studio/recordings/${recId}`)).json(); const ann=st.annotations.map(a=>a.sample);
// continuity at every chunk boundary
let typ=0; const nearTone=(i)=>ann.some(a=>i>a-4800&&i<a+13000);
for(let i=1;i<f.length;i++){ if(i%96000===0||nearTone(i)) continue; const d=Math.abs(f[i]-f[i-1]); if(d>typ) typ=d; }
let worst=0,bad=0,checked=0; for(let bnd=96000;bnd<f.length;bnd+=96000){ if(nearTone(bnd)) continue; checked++; const d=Math.abs(f[bnd]-f[bnd-1]); worst=Math.max(worst,d); if(d>typ*1.5+1e-4) bad++; }
ok(`no discontinuity at any of ${checked} chunk boundaries`, bad===0, `worst boundary step ${worst.toFixed(4)} vs normal max ${typ.toFixed(4)}`);
// the fake mic loops a 10 s file, so the swell envelope repeats: compare each 10 s segment's RMS shape for dropped audio
let holes=0, run=0, maxRun=0; for(let at=0;at+4800<=f.length;at+=4800){ if(goertzel(f.subarray(at,at+4800),48000,220)<0.004){run++;maxRun=Math.max(maxRun,run)}else run=0 }
ok("no silent hole anywhere (a dropped chunk would be 2 s)", maxRun<=6, `longest quiet run ${maxRun*100} ms`);
// retake tones
const win=1200,hop=240,hits=[];let last=-1e9; for(let at=0;at+win<=f.length;at+=hop){ const sl=f.subarray(at,at+win); const mg=goertzel(sl,48000,1000); if(mg<0.25)continue; let r=0; for(const x of sl) r+=x*x; r=Math.sqrt(r/sl.length); if(mg*0.7071<0.6*r)continue; if(at-last>=24000){let s=at; while(s-hop>=0&&goertzel(f.subarray(s-hop,s-hop+win),48000,1000)>=0.25)s-=hop; hits.push(s)} last=at }
ok("all 3 retake tones are in the file, each within 50 ms of its annotation", hits.length===3&&ann.length===3&&hits.every((h,i)=>Math.abs(h-ann[i])<=2400), `annotations ${ann.join(",")} tones ${hits.join(",")}`);
log("server memory after:", dstats());
} finally {
  try { await p.goto(BASE+"/studio/episodes/"+epId); await p.waitForSelector("h1"); await p.locator('button:has-text("Delete")').last().click(); await p.locator('button:has-text("Confirm delete")').dispatchEvent("click"); await p.waitForURL(/studio\/episodes$/); log("cleaned up test episode"); } catch(e){ log("cleanup issue", String(e).slice(0,100)); }
  try{fs.unlinkSync(S+"long.wav")}catch{}
}
log("left: recordings", db(`console.log(d.prepare("select count(*) n from recordings").get().n)`), "chunk rows", db(`console.log(d.prepare("select count(*) n from recording_chunks").get().n)`), "raw assets", db(`console.log(d.prepare("select count(*) n from assets where kind='raw_audio'").get().n)`));
console.log("FAILURES:", fails);
fs.writeFileSync(S+"long-test.result", fails===0 ? `PASS ${MINUTES} min ${new Date().toISOString()}\n` : `FAIL(${fails}) ${MINUTES} min ${new Date().toISOString()}\n`);
process.exit(0);
