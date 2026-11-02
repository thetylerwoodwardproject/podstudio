import { launch, BASE, sleep, ok, failCount, resetProject } from "./lib.mjs";
import fs from "fs";
const epId=fs.readFileSync(new URL("./epid.txt",import.meta.url),"utf8").trim();
const {b,ctx,p,errs}=await launch(); resetProject(epId);
const proj=async()=> (await (await ctx.request.get(BASE+"/studio/projects/"+epId)).json());
const saved=()=>p.waitForFunction(()=>/^Saved/.test(document.querySelector('[data-testid=save-status]').textContent),null,{timeout:15000});
await p.goto(BASE+"/studio/editor?episode="+epId); await p.click('[data-testid=start-editing]'); await p.waitForSelector('[data-testid=canvas-host]'); await sleep(500);
await p.click('[data-testid=add-track]'); await p.click('[data-testid=add-track-sfx]'); await sleep(300);
// click the Host title → input, type, Enter
await p.locator('[data-testid=track-host] [data-testid=track-title]').click();
ok("clicking the title opens an inline editor with the text selected", await p.locator('[data-testid=track-title-input]').count()===1);
await p.keyboard.type("Tyler (mic 1)"); await p.keyboard.press("Enter"); await sleep(300);
ok("Enter saves the new name in the header", (await p.locator('[data-testid=track-host] [data-testid=track-title]').innerText())==="Tyler (mic 1)");
await saved(); let d=await proj(); ok("rename persisted as a revision", d.doc.tracks[0].name==="Tyler (mic 1)", d.doc.tracks.map(t=>t.name).join(","));
// typing letters in the field must not fire shortcuts (m, s, x, l, space)
await p.locator('[data-testid=track-sfx] [data-testid=track-title]').click(); await p.keyboard.type("Mix sfx lx m"); await p.keyboard.press("Escape"); await sleep(200);
ok("Esc cancels and nothing leaked to the keyboard shortcuts (still unmuted/unlocked)", (await p.locator('[data-testid=track-sfx]').innerText()).includes("Sfx") && (await p.locator('[data-testid=track-sfx] button[aria-pressed=true]').count())===0);
// click away saves; empty reverts
await p.locator('[data-testid=track-sfx] [data-testid=track-title]').click(); await p.keyboard.type("Stingers"); await p.locator('[data-testid=ruler]').click({position:{x:50,y:10}}); await sleep(300);
ok("clicking away saves", (await p.locator('[data-testid=track-sfx] [data-testid=track-title]').innerText())==="Stingers");
await p.locator('[data-testid=track-sfx] [data-testid=track-title]').click(); await p.keyboard.press("Control+a"); await p.keyboard.press("Backspace"); await p.keyboard.press("Enter"); await sleep(200);
ok("an empty name is refused (keeps the old one)", (await p.locator('[data-testid=track-sfx] [data-testid=track-title]').innerText())==="Stingers");
await saved(); await p.keyboard.press("Control+z"); await sleep(300); ok("rename is undoable", (await p.locator('[data-testid=track-sfx] [data-testid=track-title]').innerText())==="Sfx");
console.log("errors",errs); console.log("FAILS",failCount()); await b.close();
