#!/bin/bash
# Regression check for the 2026-10-23 "unauthenticated writes" hole: fires mutating POSTs and .data GETs at the
# studio with NO session and fails loudly if the database changes. Needs docker compose + curl; run on the server.
# WARNING: if the guard is broken this WRITES probe rows (it then deletes them) — settings/theme need hand-restoring.
H=studio.tylerwoodward.me
snap() { docker compose -f /home/tylerw/podstudio/deploy/docker-compose.yml exec -T web node - <<'JS'
const D=require("better-sqlite3");const d=new D("/data/podstudio.db");
const t=(n)=>d.prepare(`select count(*) n from ${n}`).get().n;
console.log(JSON.stringify({show:d.prepare("select title,description,website,locked,podcast_tags,settings,theme from shows").get(),
 episodes:d.prepare("select id,title,status,visibility,season,number,explicit,publish_at from episodes order by id").all(),
 counts:{users:t("users"),sessions:t("sessions"),people:t("people"),episode_people:t("episode_people"),show_links:t("show_links"),podroll:t("podroll_items"),txt:t("show_txt_records"),storage:t("storage_targets")}}));
JS
}
post() { curl --resolve $H:443:127.0.0.1 -k -s -o /dev/null -w "%{http_code} " -X POST -H "Origin: https://$H" --data "$2" "https://$H/studio/$1"; }
BEFORE=$(snap)
echo -n "POST statuses: "
post podroll "intent=toggle-public&value=true"; post podroll "intent=add-item&title=Z&feedGuid=11111111-2222-3333-4444-555555555555"
post analytics "intent=toggle-public-overview&value=true"
post public/brand "accent=rose&appearance=dark&corners=round&scope-studio=on"
post public/links "intent=add-link&platform=mastodon&value=@a@b.c"
post publish "intent=schedule&id=x&publishAt=2030-01-01T10:00"
post episodes "intent=create&title=UnauthProbe"
# (feed/tags omitted: its payload would overwrite the real show title; it is guarded by the same middleware)
post feed/lock-verify "intent=add-txt&value=hacked"
post settings/server "intent=add-user&name=E&email=e@e.invalid&password=whatever123&role=admin"
post storage "intent=add-target&provider=minio&label=x&endpoint=http://x&bucket=b&accessKeyId=a&secretAccessKey=s"
echo
for p in storage settings/server episodes feed/tags podroll; do
  printf "GET /studio/%s.data -> " "$p"; curl --resolve $H:443:127.0.0.1 -k -s -o /tmp/dataresp.txt -w "%{http_code} " "https://$H/studio/$p.data"; head -c 70 /tmp/dataresp.txt | tr -d '\n'; echo
done
AFTER=$(snap)
cleanup() { docker compose -f /home/tylerw/podstudio/deploy/docker-compose.yml exec -T web node - <<'JS'
const D=require("better-sqlite3");const d=new D("/data/podstudio.db");d.pragma("foreign_keys = ON");
const keep=new Set(JSON.parse(process.env.KEEP_IDS||"[]"));
for(const {id} of d.prepare("select id from episodes where title=?").all("UnauthProbe")){d.prepare("delete from episode_people where episode_id=?").run(id);d.prepare("delete from episodes where id=?").run(id);}
d.prepare("delete from podroll_items where title=?").run("Z");
d.prepare("delete from show_links where value like ?").run("%@a@b.c%").changes;
d.prepare("delete from show_txt_records where value=?").run("hacked");
d.prepare("delete from users where email=?").run("e@e.invalid");
d.prepare("delete from storage_targets where label=?").run("x");
console.log("cleanup ran");
JS
}
if [ "$BEFORE" == "$AFTER" ]; then echo "RESULT: database identical before/after — no unauthenticated writes"; else echo "RESULT: DATABASE CHANGED (cleaning up probe rows; settings/theme must be restored by hand)"; cleanup; diff <(echo "$BEFORE" | tr ',' '\n') <(echo "$AFTER" | tr ',' '\n') | head -20; fi
