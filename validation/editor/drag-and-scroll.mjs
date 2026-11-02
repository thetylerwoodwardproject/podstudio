import { launch, BASE, sleep, ok, failCount, resetProject, clearImports } from "./lib.mjs";
import fs from "fs";
const epId=fs.readFileSync(new URL("./epid.txt",import.meta.url),"utf8").trim();
const {b,ctx,p,errs}=await launch(); const R=48000;
const proj=async()=> (await (await ctx.request.get(BASE+"/studio/projects/"+epId)).json());
const saved=()=>p.waitForFunction(()=>/^Saved/.test(document.querySelector('[data-testid=save-status]').textContent),null,{timeout:15000});
resetProject(epId); await clearImports(ctx,epId);
await p.goto(BASE+"/studio/editor?episode="+epId); await p.click('[data-testid=start-editing]'); await p.waitForSelector('[data-testid=canvas-host]'); await sleep(600);
const spp=async()=>p.evaluate(()=>{const r=[...document.querySelectorAll('[data-testid=ruler] > div')].filter(e=>e.textContent.trim());const a=r[0].getBoundingClientRect().left,b=r[1].getBoundingClientRect().left;const t=r[1].textContent.trim();const s=t.includes(":")?(+t.split(":")[0]*60+ +t.split(":")[1]):+t;return {pxPerS:(b-a)/s}});
// 1. split at 8 s, drag the right clip 100 px, expect +100px worth of samples
await p.keyboard.press("Home"); for(let i=0;i<8;i++) await p.keyboard.press("ArrowRight"); await sleep(150); await p.click('[data-testid=split]'); await sleep(300); await saved();
let {pxPerS}=await spp(); const cb=await p.locator('[data-testid=canvas-host]').boundingBox(); const y=cb.y+cb.height/2; const gx=cb.x+9*pxPerS+30;
await p.mouse.move(gx,y); await p.mouse.down(); await p.mouse.move(gx+40,y,{steps:8}); await p.mouse.move(gx+100,y,{steps:8}); await p.mouse.up(); await sleep(300); await saved();
let d=await proj(); let right=d.doc.clips.sort((a,b)=>a.start-b.start)[1];
const moved=(right.start-8*R)/R*pxPerS;
ok("dragging a clip 100 px moved it by 100 px of timeline (±1.5 px)", Math.abs(moved-100)<1.5, moved.toFixed(2)+" px");
ok("moving never changed which audio the clip plays", right.srcStart===8*R);
// 2. zoom in, scroll far right, click the canvas: playhead must land where the pixel says
for(let i=0;i<3;i++){ await p.click('[data-testid=zoom-in]'); await sleep(120); }
await sleep(300);
await p.evaluate(()=>{document.querySelector('[data-testid=timeline-scroll]').scrollLeft=3000}); await sleep(500);
const info=await p.evaluate(()=>{const sc=document.querySelector('[data-testid=timeline-scroll]');const cv=document.querySelector('[data-testid=canvas-host]');const r=[...document.querySelectorAll('[data-testid=ruler] > div')].filter(e=>e.textContent.trim());const a=r[0].getBoundingClientRect().left,b=r[1].getBoundingClientRect().left;const t0=r[0].textContent.trim(),t1=r[1].textContent.trim();const sec=(t)=>t.includes(":")?(+t.split(":")[0]*60+ +t.split(":")[1]):+t;return {scroll:sc.scrollLeft,canvasLeft:cv.getBoundingClientRect().left,tick0:{x:a,s:sec(t0)},tick1:{x:b,s:sec(t1)}}});
const pps=(info.tick1.x-info.tick0.x)/(info.tick1.s-info.tick0.s); const clickX=700; const expected=info.tick0.s+(clickX-info.tick0.x)/pps;
await p.mouse.click(clickX, y); await sleep(200);
const clk=await p.evaluate(()=>document.querySelector('[data-testid=clock] span').textContent); const m=clk.match(/(\d+):(\d+\.\d)/); const got=+m[1]*60+ +m[2];
ok("after scrolling 3000 px, a click lands within 0.1 s of where the ruler says", Math.abs(got-expected)<0.1, `expected ${expected.toFixed(2)} s, got ${got}`);
// 3. wide scroll: no blank frames across tile re-centres
const blank=await p.evaluate(async()=>{const sc=document.querySelector('[data-testid=timeline-scroll]');const cv=document.querySelector('[data-testid=canvas-host]');sc.scrollLeft=0;await new Promise(r=>setTimeout(r,300));let blank=0,frames=0;for(let i=0;i<150;i++){sc.scrollLeft+=40;await new Promise(r=>requestAnimationFrame(r));frames++;const r=cv.getBoundingClientRect(),s=sc.getBoundingClientRect();if(r.left>s.left+208+0.5||r.right<s.right-0.5)blank++}return {blank,frames}});
ok("fast scroll across several tile re-centres never shows an undrawn gap", blank.blank===0, JSON.stringify(blank));
console.log("errors",errs); console.log("FAILS",failCount()); await b.close();
