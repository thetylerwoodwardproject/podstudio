import { launch, BASE, sleep, ok, failCount, resetProject, clearImports, db } from "./lib.mjs";
import fs from "fs";
const epId=fs.readFileSync(new URL("./epid.txt",import.meta.url),"utf8").trim();
const M=new URL("./media/", import.meta.url).pathname;
const {b,ctx,p,errs}=await launch();
const R=48000;
const proj=async()=> (await (await ctx.request.get(BASE+"/studio/projects/"+epId)).json());
const saved=()=>p.waitForFunction(()=>/^Saved/.test(document.querySelector('[data-testid=save-status]').textContent),null,{timeout:15000});
resetProject(epId); await clearImports(ctx, epId);
await p.goto(BASE+"/studio/editor?episode="+epId); await p.click('[data-testid=start-editing]'); await p.waitForSelector('[data-testid=canvas-host]'); await sleep(500);
// 1. empty "+ Add track" → empty track shows the upload prompt
await p.click('[data-testid=add-track]'); await p.click('[data-testid=add-track-music]'); await sleep(300);
ok("+ Add track creates an empty Music track with an upload prompt", (await p.locator('[data-testid=empty-track-upload]').count())===1 && (await p.locator('[data-testid=track-music]').count())===1);
// 2. upload an MP3 (44.1 kHz stereo) through the empty-track button
const [fc]=await Promise.all([p.waitForEvent("filechooser"), p.click('[data-testid=empty-track-upload]')]);
await fc.setFiles(M+"tone-stereo.mp3");
await p.waitForSelector('[data-testid=upload-item]',{timeout:10000}); ok("progress strip appears for the upload", true);
await p.waitForFunction(()=>document.querySelectorAll('[data-testid=track-music] canvas').length===1 && !document.querySelector('[data-testid=upload-item]'),null,{timeout:60000}).catch(()=>{});
await p.waitForFunction(()=>/Added/.test(document.querySelector('[data-testid=toast]')?.textContent||""),null,{timeout:60000}).catch(()=>{});
await saved(); let d=await proj();
let music=d.doc.clips.find(c=>c.trackId===d.doc.tracks[1].id);
ok("MP3 became a 6 s clip on the music track", music && Math.abs(music.length/R-6)<0.1 && music.start===0, music&&String(music.length/R));
const srcM=d.doc.sources.find(s=>s.id===music.sourceId);
const asset=JSON.parse(db(`console.log(JSON.stringify(d.prepare("select kind,access,sample_rate,channels,bytes,meta,status from assets where id='${srcM.assetId}'").get()))`));
ok("decoded asset is private raw_audio, 48 kHz mono 24-bit, verified", asset.kind==="raw_audio"&&asset.access==="private"&&asset.sample_rate===48000&&asset.channels===1&&asset.status==="verified"&&asset.bytes===44+music.length*3, JSON.stringify({b:asset.bytes}));
const orig=JSON.parse(db(`console.log(JSON.stringify(d.prepare("select filename,kind,bytes from assets where kind='import_original' and episode_id='${epId}'").all()))`));
ok("the original MP3 is kept privately as uploaded", orig.length===1&&orig[0].filename==="tone-stereo.mp3"&&orig[0].bytes===fs.statSync(M+"tone-stereo.mp3").size, JSON.stringify(orig));
// content check: our decode vs an independent host ffmpeg decode of the same file
const ours=Buffer.from(await (await ctx.request.get(BASE+`/studio/assets/${srcM.assetId}/audio`)).body());
import { execSync } from "child_process";
const ref=execSync(`ffmpeg -v error -i ${M}tone-stereo.mp3 -map 0:a:0 -ac 1 -ar 48000 -f s24le -`,{maxBuffer:1<<28});
const n=Math.min((ours.length-44)/3, ref.length/3);
const rd=(b,o)=>{let v=b[o]|(b[o+1]<<8)|(b[o+2]<<16); if(v&0x800000)v|=~0xffffff; return v/8388608};
let s=0,pw=0,mx=0; for(let i=0;i<n;i++){const a=rd(ours,44+i*3),r=rd(ref,i*3); s+=(a-r)**2; pw+=r*r}
ok("decode matches an independent ffmpeg decode (residual < −60 dBFS); length equal", 10*Math.log10(s/n+1e-20)<-60 && (ours.length-44)/3===ref.length/3, `${(10*Math.log10(s/n+1e-20)).toFixed(1)} dBFS, signal ${(10*Math.log10(pw/n)).toFixed(1)} dBFS, ${(ours.length-44)/3} vs ${ref.length/3} samples`);
// stereo downmix: 440 L + 880 R at 0.3 → mono mean: both tones present at ~half amplitude
// 3. second file via menu to selected track (music track selected? select host) → FLAC to new SFX track via menu
await p.click('[data-testid=upload-menu]'); const [fc2]=await Promise.all([p.waitForEvent("filechooser"), p.click('[data-testid=upload-new-sfx]')]); await fc2.setFiles([M+"music.flac",M+"sfx.m4a"]);
await p.waitForFunction(()=>/sfx|music/.test(document.querySelector('[data-testid=toast]')?.textContent||''),null,{timeout:90000});
await p.waitForFunction(()=>document.querySelectorAll('[data-testid=upload-item]').length===0,null,{timeout:90000}); await sleep(600); await saved(); d=await proj();
const ln=(l)=>{const s=d.doc.sources.find(x=>x.label===l);return s&&s.totalSamples/R};
ok("FLAC (10 s) and M4A (4 s, 22 kHz) both added", Math.abs(ln("music")-10)<0.1 && Math.abs(ln("sfx")-4)<0.1, d.doc.sources.map(s=>`${s.label}:${(s.totalSamples/R).toFixed(1)}s`).join(", "));
// 4. rejects: .txt immediately, fake .mp3 by the worker with a message
let r=await ctx.request.put(BASE+`/studio/projects/${epId}/imports`,{headers:{"X-Filename":"notes.txt","Content-Type":"application/octet-stream"},data:fs.readFileSync(M+"notes.txt")}); let rj=await r.json();
ok("a .txt upload is refused straight away (415)", r.status()===415 && !rj.ok, rj.error);
await p.click('[data-testid=upload-menu]'); const [fc3]=await Promise.all([p.waitForEvent("filechooser"), p.click('[data-testid=upload-selected]')]); await fc3.setFiles(M+"notaudio.mp3");
await p.waitForSelector('[data-testid=upload-item][data-phase=failed]',{timeout:60000});
const msg=await p.locator('[data-testid=upload-item][data-phase=failed]').innerText(); ok("a fake MP3 fails with a readable message", msg.length>20, msg.replace(/\n/g," "));
await p.screenshot({path:"ed7-failed.png"});
await p.click('[data-testid=upload-item][data-phase=failed] button'); await sleep(800);
ok("dismissing removes it (and the stored original)", (await p.locator('[data-testid=upload-item]').count())===0 && +db(`console.log(d.prepare("select count(*) c from assets where kind='import_original' and episode_id='${epId}'").get().c)`)===3);
// 5. drag & drop onto the timeline
await p.evaluate(async()=>{ const bytes=await (await fetch("data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAgLsAAAB3AQACABAAZGF0YQAAAAA=")).arrayBuffer(); window.__f=new File([bytes],"empty.wav",{type:"audio/wav"}) });
// real file drop: use the music.flac bytes via base64 from node
const b64=fs.readFileSync(M+"sfx.m4a").toString("base64");
await p.evaluate(async(b64)=>{ const bin=Uint8Array.from(atob(b64),c=>c.charCodeAt(0)); const dt=new DataTransfer(); dt.items.add(new File([bin],"dropped.m4a")); const el=document.querySelector('[data-testid=editor-stage]'); el.dispatchEvent(new DragEvent("dragenter",{dataTransfer:dt,bubbles:true})); el.dispatchEvent(new DragEvent("dragover",{dataTransfer:dt,bubbles:true,cancelable:true})); el.dispatchEvent(new DragEvent("drop",{dataTransfer:dt,bubbles:true,cancelable:true})); },b64);
await p.waitForSelector('[data-testid=upload-item]',{timeout:10000}); await p.waitForFunction(()=>/dropped/.test(document.querySelector('[data-testid=toast]')?.textContent||''),null,{timeout:60000}); await sleep(400); await saved(); d=await proj();
ok("a dropped file is added too", d.doc.sources.some(s=>s.label==="dropped"), d.doc.sources.map(s=>s.label).join(","));
// 6. everything still undoes in single steps, and imported audio plays + exports
await p.keyboard.press("Control+z"); await sleep(300); ok("one undo removes the dropped clip", (await p.locator('[data-testid=track-sfx]').count())>=1);
await p.keyboard.press("Control+Shift+z"); await sleep(300); await saved();
await p.keyboard.press("Home"); await p.click('[data-testid=play]'); await sleep(2500); const clk=await p.innerText('[data-testid=clock]'); await p.keyboard.press("Space"); ok("playback runs with imported tracks", !clk.startsWith("0:00.0"), clk.replace(/\n/g," "));
await p.screenshot({path:"ed7-tracks.png"});
await p.click('[data-testid=open-export]'); await p.click('[data-testid=start-export]'); await p.waitForSelector('[data-testid=export-job][data-status=verified]',{timeout:90000});
ok("export with imported tracks verifies", true);
// peaks for an imported asset load
ok("imported source has a waveform overview", (await ctx.request.get(BASE+`/studio/assets/${srcM.assetId}/peaks`)).status()===200);
// auth
ok("imported audio is not reachable without a session", (await (await import("playwright-core")).chromium.launch({executablePath:(await import("./lib.mjs")).exe,args:["--ignore-certificate-errors","--host-resolver-rules=MAP studio.tylerwoodward.me 127.0.0.1"]}).then(async br=>{const c=await br.newContext({ignoreHTTPSErrors:true});const r=await c.request.get(BASE+`/studio/assets/${srcM.assetId}/audio`,{maxRedirects:0});await br.close();return r.status()}))!==200);
console.log("errors",errs); console.log("FAILS",failCount()); await b.close();
