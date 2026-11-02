import { launch, BASE, sleep, ok, failCount, resetProject } from "./lib.mjs";
import fs from "fs";
const epId=fs.readFileSync(new URL("./epid.txt",import.meta.url),"utf8").trim();
const {b,ctx,p,errs}=await launch();
await p.goto(BASE+"/studio/editor?episode="+epId); if(await p.locator('[data-testid=start-editing]').count()) await p.click('[data-testid=start-editing]');
await p.waitForSelector('[data-testid=canvas-host]'); await sleep(700);
await p.click('[data-testid=add-track]'); await p.click('[data-testid=add-track-music]'); await sleep(300);
// 1. lanes continue across the full width
const geo=await p.evaluate(()=>{const sc=document.querySelector('[data-testid=timeline-scroll]').getBoundingClientRect();const rows=[...document.querySelectorAll('[data-track-id]')].filter(e=>e.getAttribute('data-testid')!=='track-name'&&e.getAttribute('data-testid')!=='track-resize').map(e=>e.getBoundingClientRect());const ruler=document.querySelector('[data-testid=ruler]').getBoundingClientRect();return {scRight:sc.right,rowsRight:rows.map(r=>Math.round(r.right)),rulerRight:Math.round(ruler.right)}});
ok("track lanes and ruler reach the right edge of the timeline", geo.rowsRight.every(r=>r>=geo.scRight-12) && geo.rulerRight>=geo.scRight-12, JSON.stringify(geo));
// 2. sliders styled
const sl=await p.evaluate(()=>{const r=document.querySelector('input[type=range]');const cs=getComputedStyle(r);return {cls:r.className,appearance:cs.appearance||cs.webkitAppearance,fill:r.style.getPropertyValue('--fill')}});
ok("sliders use the styled range (appearance none, fill var set)", /ps-range/.test(sl.cls)&&sl.appearance==="none"&&sl.fill.endsWith("%"), JSON.stringify(sl));
// 3. wheel (2026-11-02, Tyler): wheel = tracks up/down, Shift+wheel = timeline sideways
for (let i=0;i<6;i++){ await p.click('[data-testid=add-track]'); await p.click('[data-testid=add-track-sfx]'); await sleep(150); }
await p.click('[data-testid=zoom-in]'); await p.click('[data-testid=zoom-in]'); await sleep(300);
await p.evaluate(()=>{document.querySelector('[data-testid=timeline-scroll]').scrollTop=0}); await sleep(100);
const sb=await p.locator('[data-testid=timeline-scroll]').boundingBox(); const cb={x:sb.x+208,y:sb.y+sb.height/2-40}; await p.mouse.move(cb.x+300,cb.y+40);
const pos=()=>p.evaluate(()=>{const e=document.querySelector('[data-testid=timeline-scroll]');return {x:e.scrollLeft,y:e.scrollTop}});
const q0=await pos();
await p.mouse.wheel(0,300); await sleep(200); const q1=await pos();
ok("wheel scrolls the tracks down, not sideways", q1.y>q0.y+40 && q1.x===q0.x, JSON.stringify([q0,q1]));
await p.mouse.wheel(0,-300); await sleep(200);
await p.keyboard.down("Shift"); await p.mouse.wheel(0,300); await p.keyboard.up("Shift"); await sleep(200); const q2=await pos();
ok("Shift+wheel scrolls the timeline sideways", q2.x>q0.x+150, JSON.stringify(q2));
await p.keyboard.down("Shift"); await p.mouse.wheel(0,-150); await p.keyboard.up("Shift"); await sleep(200); const q3=await pos();
ok("…and back", q3.x<q2.x, JSON.stringify(q3));
const s0=q0.x;
// 4. ctrl+wheel zooms around the pointer: the sample under the cursor stays put
const probe=async()=>p.evaluate((x)=>{const sc=document.querySelector('[data-testid=timeline-scroll]');const r=[...document.querySelectorAll('[data-testid=ruler] > div')].filter(e=>e.textContent.trim());const a=r[0].getBoundingClientRect().left,b2=r[1].getBoundingClientRect().left;const sec=(t)=>{const m=t.match(/(\d+):(\d+(?:\.\d+)?)/);return +m[1]*60+ +m[2]};const pps=(b2-a)/(sec(r[1].textContent.trim())-sec(r[0].textContent.trim()));return {pps,sAtX:sec(r[0].textContent.trim())+(x-a)/pps}},cb.x+400);
const before=await probe();
await p.keyboard.down("Control"); await p.mouse.move(cb.x+400,cb.y+40); await p.mouse.wheel(0,-100); await p.keyboard.up("Control"); await sleep(500);
const after=await probe();
ok("ctrl+wheel zooms in", after.pps>before.pps*1.3, `${before.pps.toFixed(1)} → ${after.pps.toFixed(1)} px/s`);
ok("zoom keeps the time under the pointer fixed (±0.15 s)", Math.abs(after.sAtX-before.sAtX)<0.15, `${before.sAtX.toFixed(2)} → ${after.sAtX.toFixed(2)} s`);
// 5. no stranded playhead after a cut: select all, ripple delete a range, clock <= length
await p.keyboard.press("End"); await sleep(200);
await p.screenshot({path:"wheel-after.png"});
console.log("errors",errs); console.log("FAILS",failCount()); await b.close();
