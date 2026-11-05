import { launch, BASE, sleep, ok, failCount, resetProject, clearImports } from "./lib.mjs";
import fs from "fs";
const epId=fs.readFileSync(new URL("./epid.txt",import.meta.url),"utf8").trim();
const M=new URL("./media/", import.meta.url).pathname;
const {b,ctx,p,errs}=await launch(); const R=48000;
const proj=async()=> (await (await ctx.request.get(BASE+"/studio/projects/"+epId)).json());
const saved=async()=>{ await sleep(400); await p.waitForFunction(()=>/^Saved/.test(document.querySelector('[data-testid=save-status]').textContent),null,{timeout:15000}) };
resetProject(epId); await clearImports(ctx, epId);
for(const j of (await (await ctx.request.get(BASE+`/studio/projects/${epId}/exports`)).json()).exports) await ctx.request.delete(BASE+'/studio/exports/'+j.id);
await p.goto(BASE+"/studio/editor?episode="+epId); if(await p.locator('[data-testid=start-editing]').count()) await p.click('[data-testid=start-editing]'); await p.waitForSelector('[data-testid=canvas-host]'); await sleep(600);
// ---------- fades by dragging the top corners
const pps=async()=>p.evaluate(()=>{const r=[...document.querySelectorAll('[data-testid=ruler] > div')].filter(e=>e.textContent.trim());const sec=(t)=>{const m=t.match(/(\d+):(\d+(?:\.\d+)?)/);return +m[1]*60+ +m[2]};return (r[1].getBoundingClientRect().left-r[0].getBoundingClientRect().left)/(sec(r[1].textContent.trim())-sec(r[0].textContent.trim()))});
const cb=await p.locator('[data-testid=canvas-host]').boundingBox(); const k=await pps();
await p.mouse.move(cb.x+6,cb.y+6); await sleep(100);
const tip=await p.locator('[data-testid=canvas-host]').evaluate(e=>[e.style.cursor,e.title]); ok("hovering the top-left corner shows a fade cursor and hint", tip[0]==="ew-resize"&&/fade/i.test(tip[1]), JSON.stringify(tip));
await p.mouse.down(); await p.mouse.move(cb.x+6+k*1.5/2,cb.y+8,{steps:6}); await p.mouse.move(cb.x+6+k*1.5,cb.y+8,{steps:6}); await p.mouse.up(); await saved(); let d=await proj();
let c=d.doc.clips[0]; ok("dragging the top-left corner in 1.5 s sets a ~1.5 s fade-in (±0.15 s)", Math.abs(c.fadeIn/R-1.5)<0.15 && c.fadeOut===0, (c.fadeIn/R).toFixed(2)+" s");
const endX=cb.x+(c.length/R)*k-6;
await p.mouse.move(endX,cb.y+6); await p.mouse.down(); await p.mouse.move(endX-k*0.5,cb.y+8,{steps:6}); await p.mouse.up(); await saved(); d=await proj(); c=d.doc.clips[0];
ok("dragging the top-right corner in 0.5 s sets a ~0.5 s fade-out", Math.abs(c.fadeOut/R-0.5)<0.15, (c.fadeOut/R).toFixed(2)+" s");
ok("fade drag did not move or trim the clip", c.start===0&&c.srcStart===0&&c.length>20*R);
await p.keyboard.press("Control+z"); await sleep(300); await p.keyboard.press("Control+z"); await sleep(300); await saved(); d=await proj(); ok("two undos remove both fades", d.doc.clips[0].fadeIn===0&&d.doc.clips[0].fadeOut===0);
await p.keyboard.press("Control+Shift+z"); await sleep(300); await p.keyboard.press("Control+Shift+z"); await sleep(300); await saved();
// ---------- add a music track from the library, then turn ducking on in its FX popover
const NAME="ZZ duck bed (delete me)";
const items=async()=>(await (await ctx.request.get(BASE+"/studio/library/items")).json()).items;
for(const i of await items()) if(i.name===NAME) await ctx.request.delete(BASE+"/studio/library/items/"+i.id);
await ctx.request.put(BASE+"/studio/library/items",{headers:{"X-Filename":"music.flac","X-Name":encodeURIComponent(NAME),"X-Kind":"music"},data:fs.readFileSync(M+"music.flac")});
for(let i=0;i<60&&(await items()).find(x=>x.name===NAME)?.status!=="ready";i++) await sleep(1000);
await p.reload(); await p.waitForSelector("[data-testid=canvas-host]"); await sleep(800); await p.fill("[data-testid=library-sidebar-search]",NAME).catch(()=>{}); await sleep(400);
await p.locator("[data-testid=library-sidebar-item]").filter({hasText:NAME}).locator("[data-testid=library-sidebar-add]").click({force:true}); await saved();
d=await proj(); const music=d.doc.tracks.find(t=>t.kind==="music"), host=d.doc.tracks.find(t=>t.kind==="host");
ok("library + added the bed on a music track", !!music && d.doc.clips.some(c=>c.trackId===music.id));
ok("no ducking yet", !(d.doc.ducking??[]).length);
await p.locator("[data-testid=track-music] [data-testid=track-fx-button]").click(); await p.waitForSelector("[data-testid=fx-popover] [data-testid=fx-chain]");
await p.click("[data-testid=fx-popover] [data-testid=fx-duck-on]"); await saved(); d=await proj();
ok("Ducking switch makes a rule for exactly the music track, under host + guest", d.doc.ducking.length===1 && JSON.stringify(d.doc.ducking[0].targets)===JSON.stringify([music.id]) && d.doc.ducking[0].triggers==="speech", JSON.stringify(d.doc.ducking));
await p.click("[data-testid=fx-popover] [data-testid=fx-duck-picked]"); await saved();
d=await proj(); ok("picked-tracks mode pre-selects host", Array.isArray(d.doc.ducking[0].triggers) && d.doc.ducking[0].triggers.includes(host.id));
await p.locator(`[data-testid=fx-duck-trigger-${host.id}]`).click(); await sleep(300);
ok("with nothing picked it warns", (await p.locator("[data-testid=fx-popover] [data-testid=fx-duck]").innerText()).includes("Nothing triggers it yet"));
await p.locator(`[data-testid=fx-duck-trigger-${host.id}]`).click(); await p.click("[data-testid=fx-popover] [data-testid=fx-duck-speech]"); await saved();
// turn the amount up by keyboard on the knob
const before=(await proj()).doc.ducking[0].amountDb;
await p.locator("[data-testid=fx-popover] [data-testid=fx-duck-amount] [role=slider]").first().focus(); for(let i=0;i<3;i++) await p.keyboard.press("ArrowDown"); await saved();
d=await proj(); ok("amount knob changes the rule", d.doc.ducking[0].amountDb!==before && d.doc.ducking[0].triggers==="speech", `${before} → ${d.doc.ducking[0].amountDb}`);
await p.screenshot({path:"duck-ui.png"});
await p.keyboard.press("Escape"); await sleep(200);
// ---------- export and compare to an independent reference computed here
await p.click('[data-testid=open-export]'); await p.click('[data-testid=fmt-wav]'); await p.click('[data-testid=ch-mono]'); await p.click('[data-testid=start-export]'); await p.waitForSelector('[data-testid=export-job][data-status=verified]',{timeout:90000});
const jobs=(await (await ctx.request.get(BASE+`/studio/projects/${epId}/exports`)).json()).exports; const dl=new Uint8Array(await (await ctx.request.get(BASE+"/studio/exports/"+jobs[0].id)).body());
const dec=(bytes,off,n)=>{const o=new Float32Array(n);for(let i=0,q=off;i<n;i++,q+=3){let v=bytes[q]|(bytes[q+1]<<8)|(bytes[q+2]<<16); if(v&0x800000)v|=~0xffffff; o[i]=v/8388608}return o};
const hostClip=d.doc.clips.find(c=>c.trackId===host.id), musicClip=d.doc.clips.find(c=>c.trackId===music.id);
const hostSrc=d.doc.sources.find(s=>s.id===hostClip.sourceId), musicSrc=d.doc.sources.find(s=>s.id===musicClip.sourceId);
const wav=async(a)=>new Uint8Array(await (await ctx.request.get(BASE+`/studio/assets/${a}/audio`)).body());
const hw=await wav(hostSrc.assetId), mw=await wav(musicSrc.assetId);
// sources may be stereo now (imports keep stereo): read the channel count from the WAV header and fold to mono as the mono export does ((L+R)/2)
const decAny=(w)=>{const ch=new DataView(w.buffer).getUint16(22,true); const all=dec(w,44,(w.length-44)/3); if(ch===1) return all; const n=all.length/ch, m=new Float32Array(n); for(let i=0;i<n;i++) m[i]=(all[2*i]+all[2*i+1])/2; return m;};
const H=decAny(hw), Mu=decAny(mw);
const len=Math.max(hostClip.start+hostClip.length, musicClip.start+musicClip.length); const hostT=new Float32Array(len), musT=new Float32Array(len);
const gainAt=(c,t)=>{let g=10**(c.gainDb/20); if(c.fadeIn>0&&t<c.start+c.fadeIn)g*=(t-c.start)/c.fadeIn; const os=c.start+c.length-c.fadeOut; if(c.fadeOut>0&&t>os)g*=(c.start+c.length-t)/c.fadeOut; return g};
for(let t=hostClip.start;t<hostClip.start+hostClip.length;t++) hostT[t]=H[hostClip.srcStart+t-hostClip.start]*gainAt(hostClip,t);
for(let t=musicClip.start;t<musicClip.start+musicClip.length;t++) musT[t]=Mu[musicClip.srcStart+t-musicClip.start]*gainAt(musicClip,t);
const r=d.doc.ducking[0]; const thr=10**(r.thresholdDb/20), low=10**(r.amountDb/20), dd=Math.exp(-1/(0.08*R)), ac=1-Math.exp(-1/(r.attackMs/1000*R)), rc=1-Math.exp(-1/(r.releaseMs/1000*R));
let level=0,gain=1,minG=1; const expd=new Float32Array(len); for(let t=0;t<len;t++){const x=Math.abs(hostT[t]); level=x>level?x:level*dd; const tg=level>thr?low:1; gain+=(tg-gain)*(tg<gain?ac:rc); if(gain<minG)minG=gain; expd[t]=hostT[t]+musT[t]*gain}
// exports are loudness-normalised: compare against the reference × the reported gain (the limiter must not have worked here)
const ng=jobs[0].summary?.normalise; ok("export normalised to −19 LUFS without limiting", ng && ng.targetLufs===-19 && ng.limitedSamples===0, JSON.stringify(ng));
const kg=10**((ng?.gainDb??0)/20);
const got=dec(dl,44,(dl.length-44)/3); let s=0; for(let t=0;t<len;t++) s+=(got[t]-expd[t]*kg)**2; const res=10*Math.log10(s/len+1e-20);
ok("export matches an independent reference of fades + ducking × normalisation gain (residual < −60 dBFS)", res<-60 && got.length===len, `${res.toFixed(1)} dBFS, deepest dip ${(20*Math.log10(minG)).toFixed(1)} dB`);
ok("the dip actually happened (≈ the rule's amount at its deepest)", Math.abs(20*Math.log10(minG)-r.amountDb)<1, `${(20*Math.log10(minG)).toFixed(1)} vs ${r.amountDb}`);
for(const i of await items()) if(i.name===NAME) await ctx.request.delete(BASE+"/studio/library/items/"+i.id); resetProject(epId);
console.log("errors",errs); console.log("FAILS",failCount()); await b.close();
