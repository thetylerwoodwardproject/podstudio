# Stage 01: Accounts, shows, episodes

**Goal:** You can sign in, create a show and see an episode list.

At the end of this stage the app must still deploy and everything from earlier stages must keep working.

## Screens (ids from the mockup)
- 01 Sign in
- 02 Episodes & show templates (list + templates; no editor yet)
- 18 Server settings (users, domain/TLS status only)

## Build
- [ ] Better Auth email/password, sessions/accounts/verifications, admin/editor server roles and per-show owner/editor membership
- [ ] Configured email delivery for invites, verification and password reset; only verified owners may perform ownership-sensitive actions
- [ ] New shows get podcast_guid once via UUID v5 namespace `ead4c236-bf58-58c6-a2c6-a6b28d128cb6`, using the canonical feed URL without protocol scheme/trailing slashes; imported shows follow README's separate identity-resolution rules in Stage 06
- [ ] New episodes get immutable UUID v4 GUIDs with `isPermaLink=false`, UNIQUE(show_id, guid), an immutable public_id and a descriptive slug; retain nullable original isPermaLink semantics for import
- [ ] Episodes Data Table (TanStack): search, status badge, pagination of 7, row menu
- [ ] Show templates (save tracks + FX + branding as JSON; apply on new episode)
- [ ] Seed script with The Mic Drop fixtures from the mockup
- [ ] Basic audit events and authorization boundaries for show/user administration; optional OIDC is deferred to Stage 13

## Out of scope
Anything listed in a later stage. Leave stub routes, not half-built features.

## Done when
- [ ] GUID/public_id/original isPermaLink cannot be changed through UI, API or direct SQL; trigger tests include NULL-to-value changes for imported attributes
- [ ] GUID fixtures match the namespace specification; show owners/editors/admins have the intended distinct permissions and email flows work against the test mail service
- [ ] New episode from a template copies its settings
- [ ] Playwright: sign in → create show → create episode → see it in the list
- [ ] Screens match the mockup at 1440×900 (and 390×844 for phone screens)
- [ ] lint, typecheck, unit and e2e tests pass in CI
- [ ] CHANGELOG.md has an entry for this stage

## Demo for review
Sign in, make a show, add two episodes, one from a template.

## Then
Update `STATUS.md`, write a short summary of what changed and anything that was skipped, and **stop**. Don't start the next stage until Tyler says go.
