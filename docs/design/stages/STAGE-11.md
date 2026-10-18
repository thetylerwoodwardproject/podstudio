# Stage 11: Analytics, podroll, moving

**Goal:** Open stats, recommendations and a safe way out.

At the end of this stage the app must still deploy and everything from earlier stages must keep working.

## Screens (ids from the mockup)
- 31 Analytics
- 32 Podroll
- 17b Move podcast

## Build
- [ ] OP3: enclosure prefix toggle (keep existing prefixes); nightly sync into analytics tables; public-data warning
- [ ] Analytics screen: ranges, KPIs, chart, top apps, per-episode Day 1/7/30, countries; public overview switch
- [ ] Podcast Index client: search, byguid verification, pubnotify/podping on publish, Listed status
- [ ] Podroll editor + <podcast:podroll> writer (feedGuid required); public page section + switch
- [ ] Move podcast: destination identity/inventory validator, owner-consent unlock, coordinated destination itunes:new-feed-url metadata, 301 feed/media mapping, 30-day confirm and day counter (90 days recommended)
- [ ] Directory status records last old-feed observation separately from affirmative confirmation/evidence; user-agent silence remains unconfirmed, not "Moved"
- [ ] Disable redirect restores the origin response/re-locks, but explains cached 301s/subscriber moves may not reverse; retention-window reminders never claim all subscribers migrated
- [ ] OP3 download metrics and local player events remain separately labelled; protected shares never use OP3 or appear in public rollups

## Out of scope
Anything listed in a later stage. Leave stub routes, not half-built features.

## Done when
- [ ] Podroll entry without feedGuid is rejected
- [ ] During a move the old feed URL returns 301 with Location set to the new feed
- [ ] Missing directory requests do not mark migration confirmed; cancellation copy and destination-metadata checks match README
- [ ] Analytics page never calls OP3 live (reads local tables)
- [ ] Screens match the mockup at 1440×900 (and 390×844 for phone screens)
- [ ] lint, typecheck, unit and e2e tests pass in CI
- [ ] CHANGELOG.md has an entry for this stage

## Demo for review
Turn on OP3, add three shows to the podroll, dry-run a move to a test feed.

## Then
Update `STATUS.md`, write a short summary of what changed and anything that was skipped, and **stop**. Don't start the next stage until Tyler says go.
