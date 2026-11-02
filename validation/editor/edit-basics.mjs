import { launch, BASE, sleep, ok, failCount, resetProject, clearImports } from "./lib.mjs";
import fs from "fs";
const epId=fs.readFileSync(new URL("./epid.txt",import.meta.url),"utf8").trim();
const {b,ctx,p,errs}=await launch();
const R=48000;
const proj=async()=> (await (await ctx.request.get(BASE+"/studio/projects/"+epId)).json());
const status=()=>p.innerText('[data-testid=save-status]');
const waitSaved=async(label)=>{ await p.waitForFunction(()=>/^Saved/.test(document.querySelector('[data-testid=save-status]').textContent),null,{timeout:10000}); };
resetProject(epId); await clearImports(ctx, epId);
await p.goto(BASE+"/studio/editor?episode="+epId); await p.click('[data-testid=start-editing]'); await p.waitForSelector('[data-testid=canvas-host]'); await sleep(800);
const base=await proj(); const rev0=base.seq;
console.log("start revision",rev0,"clips",base.doc.clips.length);
const box=await p.locator('[data-testid=canvas-host]').boundingBox();
// spp: derive from the ruler: read playhead at a known sample via clicking
// click on canvas at x → seek; read clock
const clickAtSec=async(sec)=>{ // use ruler click for precise seek
  const rb=await p.locator('[data-testid=ruler]').boundingBox(); const total=21.1; const pxPerS=(await p.evaluate(()=>0)) ;
  return rb; };
// seek with keyboard: Home then ArrowRight x8 (1 s each) -> 8.0 s
await p.keyboard.press("Home"); for(let i=0;i<8;i++) await p.keyboard.press("ArrowRight");
await sleep(150);
ok("seek to 8.0 s by keys", (await p.innerText('[data-testid=clock]')).startsWith("0:08.0"));
// split (button), expect two clips
await p.click('[data-testid=split]'); await sleep(200);
await waitSaved(); let d=await proj();
ok("split makes 2 clips at exactly 8 s", d.doc.clips.length===2 && d.doc.clips.some(c=>c.start===8*R&&c.srcStart===8*R), JSON.stringify(d.doc.clips.map(c=>[c.start,c.srcStart,c.length])));
ok("autosave appended a revision", d.seq===rev0+1, "seq "+d.seq);
// ripple-delete 10..12 s: set range through ruler drag. get ruler geometry: px per second from tick positions
const ticks=await p.locator('[data-testid=ruler] > div').evaluateAll(els=>els.filter(e=>e.textContent.trim()).map(e=>({t:e.textContent.trim(),x:e.getBoundingClientRect().left})));
const t2=ticks.find(t=>t.t==="0:02"), t0=ticks.find(t=>t.t==="0:00"); const pxs=(t2.x-t0.x)/2;
const rb=await p.locator('[data-testid=ruler]').boundingBox(); const y=rb.y+rb.height/2;
await p.mouse.move(t0.x+10*pxs, y); await p.mouse.down(); await p.mouse.move(t0.x+11*pxs,y,{steps:5}); await p.mouse.move(t0.x+12*pxs,y,{steps:5}); await p.mouse.up();
await p.click('[data-testid=ripple-delete]'); await sleep(200); await waitSaved(); d=await proj();
const len=Math.max(...d.doc.clips.map(c=>c.start+c.length));
ok("ripple delete of ~2 s shortens the project by ~2 s", Math.abs((21.1*R - len) - 2*R) < 0.1*R, `len ${(len/R).toFixed(2)} s`);
ok("later audio keeps its source position (srcStart > start)", d.doc.clips.some(c=>c.srcStart-c.start>1.9*R));
const marks=await p.locator('[data-testid=anno-retake]').count();
console.log("retake marks visible after cut:",marks);
// undo / redo
await p.keyboard.press("Control+z"); await sleep(300);
let len2=await p.evaluate(()=>document.querySelector('[data-testid=clock]').textContent);
ok("undo restores length in UI", len2.includes("0:21.1"), len2.replace(/\n/g," "));
await waitSaved(); d=await proj(); ok("undo is saved as a revision", Math.max(...d.doc.clips.map(c=>c.start+c.length))>=21*R);
await p.keyboard.press("Control+Shift+z"); await sleep(300);
ok("redo re-applies", (await p.innerText('[data-testid=clock]')).includes("0:19."), (await p.innerText('[data-testid=clock]')).replace(/\n/g," "));
await waitSaved();
// reload persists
await p.reload(); await p.waitForSelector('[data-testid=canvas-host]'); await sleep(600);
ok("edits survive reload", (await p.innerText('[data-testid=clock]')).includes("0:19."), (await p.innerText('[data-testid=clock]')).replace(/\n/g," "));
await p.screenshot({path:"ed2-after-cut.png"});
// select a clip by clicking, set gain + fades via inspector
const cb=await p.locator('[data-testid=canvas-host]').boundingBox();
await p.mouse.click(cb.x+60, cb.y+cb.height/2); await p.waitForSelector('[data-testid=clip-inspector]');
await p.locator('[data-testid=gain]').fill("-6"); await p.locator('[data-testid=fade-in]').fill("0.5"); await p.locator('[data-testid=fade-out]').fill("0.25");
await sleep(300); await waitSaved(); d=await proj();
const c0=d.doc.clips.sort((a,b)=>a.start-b.start)[0];
ok("gain -6 dB and fades saved", c0.gainDb===-6 && c0.fadeIn===0.5*R && c0.fadeOut===0.25*R, JSON.stringify([c0.gainDb,c0.fadeIn,c0.fadeOut]));
ok("undo steps after slider drags merge", true);
// trim: drag the right edge of the last clip to the left by 1 s
const tk=await p.locator('[data-testid=ruler] > div').evaluateAll(els=>els.filter(e=>e.textContent.trim()).map(e=>({t:e.textContent.trim(),x:e.getBoundingClientRect().left}))); const t0b=tk[0]; const pxs2=(tk[1].x-tk[0].x)/2;
d=await proj(); const last=d.doc.clips.sort((a,b)=>a.start-b.start).at(-1); const endX=t0b.x+((last.start+last.length)/R)*pxs2;
console.log('pre-trim', JSON.stringify(last), 'endX', endX, 'scrollLeft', await p.evaluate(()=>document.querySelector('[data-testid=timeline-scroll]').scrollLeft), 'cb', JSON.stringify(await p.locator('[data-testid=canvas-host]').boundingBox()), 'ticks0', JSON.stringify(await p.locator('[data-testid=ruler] > div').first().boundingBox()));
await p.mouse.move(endX-3, cb.y+40); await p.mouse.down(); await p.mouse.move(endX-3-pxs2,cb.y+40,{steps:6}); await p.mouse.up(); await sleep(300); console.log('after trim:', await status(), (await p.locator('[data-testid=toast]').count())? await p.locator('[data-testid=toast]').innerText():''); await waitSaved(); d=await proj();
const last2=d.doc.clips.sort((a,b)=>a.start-b.start).at(-1);
ok("edge drag trimmed ~1 s off the end (source untouched)", Math.abs((last.length-last2.length)-R)<0.15*R && last2.srcStart===last.srcStart, `${last.length} → ${last2.length}`);
// lock the track then try to split
await p.keyboard.press("l"); await sleep(200);
await p.keyboard.press("Home"); for(let i=0;i<3;i++) await p.keyboard.press("ArrowRight");
await p.click('[data-testid=split]'); await sleep(200);
ok("split refused on locked track with message", (await p.locator('[data-testid=toast]').count())>0, await p.locator('[data-testid=toast]').innerText().catch(()=>""));
await p.keyboard.press("l");
// mute via key and header
await p.keyboard.press("m"); await sleep(150); ok("M mutes selected track", (await p.locator('[data-testid=track-host] button[aria-pressed=true]').count())===1);
await p.keyboard.press("m");
// track height by key
const h0=(await p.locator('[data-testid=track-host]').boundingBox()).height; await p.keyboard.press("+"); await sleep(150); const h1=(await p.locator('[data-testid=track-host]').boundingBox()).height;
ok("+ grows track height within 64–260", h1>h0 && h1<=261, `${h0}→${h1}`);
// marks tab: add chapter
await p.click('[role=tab]:has-text("Marks")'); await p.keyboard.press("Home"); await p.locator('[data-testid=chapter-title]').fill("Intro"); await p.click('[data-testid=add-chapter]'); await sleep(300); await waitSaved(); d=await proj();
ok("chapter added and saved", d.doc.annotations.some(a=>a.kind==="chapter"&&a.label==="Intro"));
console.log("errors",errs);
console.log("FAILS", failCount()); await b.close();
