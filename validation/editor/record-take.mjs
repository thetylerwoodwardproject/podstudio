import { launch, BASE, sleep, db } from "./lib.mjs";
import fs from "fs";
const {b,p,errs}=await launch();
await p.goto(BASE+"/studio/episodes"); await p.click('button:has-text("New episode")'); await p.fill('#new-title',"Editor speech take (delete me)"); await p.click('button:has-text("Create")'); await p.waitForURL(/episodes\/[0-9a-f-]{36}$/);
const epId=p.url().split("/").pop(); fs.writeFileSync(new URL("./epid.txt",import.meta.url),epId);
await p.goto(BASE+"/studio/record/solo?episode="+epId); await p.waitForSelector('[data-testid=solo-stage]'); await p.click('[data-testid=enable-mic]').catch(()=>{}); await p.waitForFunction(()=>!document.querySelector('[data-testid=record]').disabled,null,{timeout:20000});
await p.click('[data-testid=record]'); await p.waitForSelector('[data-testid=rec-pill]');
for (const s of [6,9,16]) { await sleep(s===6?6700:s===9?4200:8500); await p.keyboard.press("k"); }
await sleep(5000);
await p.click('[data-testid=stop]'); await p.waitForSelector('[data-testid=finished]',{timeout:60000});
console.log("episode",epId, db(`console.log(JSON.stringify(d.prepare("select id,status,total_samples,annotations from recordings where episode_id='${epId}'").all()))`));
console.log("errors",errs); await b.close();
