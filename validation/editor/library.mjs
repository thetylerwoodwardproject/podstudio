import { launch, BASE, sleep, ok, failCount, resetProject, clearImports, db } from "./lib.mjs";
import fs from "fs";
const epId=fs.readFileSync(new URL("./epid.txt",import.meta.url),"utf8").trim();
const M=new URL("./media/", import.meta.url).pathname;
const {b,ctx,p,errs}=await launch(); const R=48000;
const proj=async()=> (await (await ctx.request.get(BASE+"/studio/projects/"+epId)).json());
const saved=async()=>{ await sleep(400); await p.waitForFunction(()=>/^Saved/.test(document.querySelector('[data-testid=save-status]').textContent),null,{timeout:15000}) };
const items=async()=> (await (await ctx.request.get(BASE+"/studio/library/items")).json()).items;
// clean slate for this episode and the library
for(const i of await items()) await ctx.request.delete(BASE+"/studio/library/items/"+i.id);
resetProject(epId); await clearImports(ctx, epId);
// ---------- the Library page
await p.goto(BASE+"/studio/episodes"); await p.getByRole("link",{name:"Library"}).click(); await p.waitForURL(/\/studio\/library/);
ok("Library is in the sidebar and opens", true);
await p.waitForSelector('[data-testid=lib-empty]'); ok("empty state invites an upload", true);
await p.locator('[data-testid=lib-input]').setInputFiles(M+"music.flac");
await p.click('[data-testid=lib-kind-sfx]'); await p.locator('[data-testid=lib-input]').setInputFiles(M+"sfx.m4a");
await p.waitForFunction(()=>document.querySelectorAll('[data-testid=lib-item][data-status=ready]').length===2,null,{timeout:90000});
ok("two uploads converted and are ready", true);
let list=await items(); const music=list.find(i=>i.filename==="music.flac"), sfx=list.find(i=>i.filename==="sfx.m4a");
ok("kinds follow the toggle at upload time (music / sfx)", music.kind==="music" && sfx.kind==="sfx", `${music.kind}/${sfx.kind}`);
ok("durations are right (10 s and 4 s)", Math.abs(music.durationS-10)<0.05 && Math.abs(sfx.durationS-4)<0.05, `${music.durationS} ${sfx.durationS}`);
// rename inline
const nameBox=p.locator('[data-testid=lib-item]').filter({hasText:"Ready"}).first().locator('[data-testid=lib-name]');
const firstName=await nameBox.inputValue(); await nameBox.fill("Show theme"); await nameBox.press("Enter"); await sleep(700);
list=await items(); ok("rename saves", list.some(i=>i.name==="Show theme"), list.map(i=>i.name).join(","));
const themeItem=list.find(i=>i.name==="Show theme");
// preview does not error
await p.locator('[data-testid=lib-item]').first().locator('[data-testid=lib-play]').click(); await sleep(600);
ok("preview plays without an error", (await p.locator('[data-testid=lib-message]').count())===0);
await p.screenshot({path:"lib-page.png"});
// bad file type refused immediately
let r=await ctx.request.put(BASE+"/studio/library/items",{headers:{"X-Filename":"notes.txt","Content-Type":"application/octet-stream"},data:fs.readFileSync(M+"notes.txt")}); ok("a .txt is refused (415)", r.status()===415);
// bad audio fails with message and can be deleted
await p.locator('[data-testid=lib-input]').setInputFiles(M+"notaudio.mp3");
await p.waitForFunction(()=>document.querySelector('[data-testid=lib-item][data-status=failed]'),null,{timeout:60000}); ok("a fake MP3 ends as Failed", true);
const bad=(await items()).find(i=>i.status==="failed"); ok("the failure keeps ffmpeg's reason", /Invalid data|audio/i.test(bad.error||""), bad.error);
await ctx.request.delete(BASE+"/studio/library/items/"+bad.id); await sleep(300);
// ---------- use it from the editor
await p.goto(BASE+"/studio/editor?episode="+epId); await p.click('[data-testid=start-editing]'); await p.waitForSelector('[data-testid=canvas-host]'); await sleep(600);
await p.click('[data-testid=open-library]'); await p.waitForSelector('[data-testid=library-item]');
ok("the editor's Library lists both ready items", await p.locator('[data-testid=library-item]').count()===2);
await p.locator('[data-testid=library-item]').filter({hasText:"Show theme"}).locator('[data-testid=library-add-new]').click(); await sleep(500); await saved();
let d=await proj(); const clipA=d.doc.clips.find(c=>d.doc.sources.find(s=>s.id===c.sourceId)?.label==="Show theme");
ok("added to a new Music track at the playhead, full length, saved", clipA && d.doc.tracks.find(t=>t.id===clipA.trackId).kind==="music" && Math.abs(clipA.length/R-10)<0.01 && clipA.start===0, JSON.stringify(clipA&&[clipA.start,clipA.length/R]));
const assetRow=JSON.parse(db(`console.log(JSON.stringify(d.prepare("select episode_id e, kind from assets where id='${themeItem.assetId}'").get()))`));
ok("the server accepted the library asset (not tied to an episode)", assetRow.e===null && assetRow.kind==="raw_audio", JSON.stringify(assetRow));
// again, onto the selected track after the first clip: reuses the same source
await p.keyboard.press("End"); await sleep(200);
await p.click('[data-testid=open-library]'); await p.locator('[data-testid=library-item]').filter({hasText:"Show theme"}).locator('[data-testid=library-add-selected]').click(); await sleep(500); await saved(); d=await proj();
const themeClips=d.doc.clips.filter(c=>d.doc.sources.find(s=>s.id===c.sourceId)?.label==="Show theme");
ok("using it twice makes two clips of one source", themeClips.length===2 && d.doc.sources.filter(s=>s.label==="Show theme").length===1, `${themeClips.length} clips`);
// ---------- protection
await p.goto(BASE+"/studio/library"); await p.waitForSelector('[data-testid=lib-item]'); await sleep(500);
ok("library shows it is used in 1 episode", /Used in 1 episode/.test(await p.locator('[data-testid=lib-item]').filter({has:p.locator('input[data-testid=lib-name]')}).first().innerText()) || (await p.locator('[data-testid=lib-status]').allInnerTexts()).some(t=>/Used in 1/.test(t)), (await p.locator('[data-testid=lib-status]').allInnerTexts()).join("|"));
r=await ctx.request.delete(BASE+"/studio/library/items/"+themeItem.id); const rj=await r.json(); ok("deleting an in-use item is refused with a clear message", r.status()===409 && /used in 1 episode/.test(rj.error), rj.error);
// episode deletion must not take library audio with it: delete the episode, item survives
const before=db(`console.log(d.prepare("select count(*) c from assets where id='${themeItem.assetId}'").get().c)`);
await p.goto(BASE+"/studio/episodes/"+epId); await p.waitForSelector("h1"); await p.locator('button:has-text("Delete")').last().click(); await p.locator('button:has-text("Confirm delete")').dispatchEvent("click"); await p.waitForURL(/studio\/episodes$/,{timeout:120000});
const after=db(`console.log(d.prepare("select count(*) c from assets where id='${themeItem.assetId}'").get().c)`);
ok("deleting the episode left the library item and its audio intact", before==="1"&&after==="1"&&(await items()).some(i=>i.id===themeItem.id));
// now unused → deletable, and the files go
for(const i of await items()){ const x=await ctx.request.delete(BASE+"/studio/library/items/"+i.id); ok(`unused item "${i.name}" deletes`, x.status()===200); }
const left=db(`console.log(d.prepare("select count(*) c from assets where kind in ('raw_audio','import_original') and episode_id is null").get().c)`);
ok("no library audio left in storage rows", left==="0", left);
console.log("errors",errs); console.log("FAILS",failCount()); await b.close();
