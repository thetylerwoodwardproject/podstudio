import { chromium } from "playwright-core";
import fs from "fs";
import { execSync } from "child_process";
export const BASE="https://studio.tylerwoodward.me";
export const pw = fs.readFileSync("/home/tylerw/podstudio/deploy/.env","utf8").match(/PODSTUDIO_ADMIN_PASSWORD=(.*)/)[1].trim();
export const exe = fs.globSync(process.env.HOME+"/.cache/ms-playwright/chromium_headless_shell-*/*/chrome-headless-shell")[0];
export const MIC = process.env.MIC || process.env.HOME+"/.local/state/podstudio/long-test/mic-test.wav";
export const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
export const db=(body)=>execSync("cd /home/tylerw/podstudio/deploy && docker compose exec -T web node -",{input:`const D=require("better-sqlite3");const d=new D("/data/podstudio.db");${body}`}).toString().trim();
export async function launch(){
  const b = await chromium.launch({executablePath: exe, args:["--ignore-certificate-errors","--host-resolver-rules=MAP studio.tylerwoodward.me 127.0.0.1","--use-fake-ui-for-media-stream","--use-fake-device-for-media-stream","--use-file-for-fake-audio-capture="+MIC,"--autoplay-policy=no-user-gesture-required"]});
  const ctx=await b.newContext({viewport:{width:1440,height:900},ignoreHTTPSErrors:true}); await ctx.grantPermissions(["microphone"],{origin:BASE});
  const p=await ctx.newPage(); const errs=[]; p.on("pageerror",e=>errs.push(String(e))); p.on("console",m=>{ if(m.type()==="error") errs.push("console: "+m.text()) });
  await p.goto(BASE+"/login"); await p.fill('input[type=email]',"tyler@fullymodulated.com"); await p.fill('input[type=password]',pw); await p.click('button[type=submit]'); await p.waitForSelector('[data-testid=show-card]');
  return {b,ctx,p,errs};
}
let fails=0; export const ok=(n,c,x="")=>{if(!c)fails++;console.log(c?"PASS":"FAIL",n,x)}; export const failCount=()=>fails;

export const resetProject=(epId)=>db(`d.prepare("update projects set current_revision_id=null where episode_id=?").run("${epId}");d.prepare("delete from project_revisions where project_id in (select id from projects where episode_id=?)").run("${epId}");d.prepare("delete from projects where episode_id=?").run("${epId}")`);

export async function clearImports(ctx, epId){ const l=(await (await ctx.request.get(BASE+`/studio/projects/${epId}/imports`)).json()).imports; for(const j of l) await ctx.request.delete(BASE+"/studio/exports/"+j.id); }
