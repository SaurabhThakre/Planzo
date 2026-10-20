# Planzo planning, voting and trip confirmation

Completed 15 October 2026 in the existing Make file `4tPr5AkQO1g0L1esRvGRjz`, connected only to Trip Pact Supabase `ewysgpuwvufbklesdhuj`. The website remains unpublished, as requested. This extends the working identity/trips/private-input slice; authentication and email settings were preserved.

## Result and live verification

The labelled fictional trip “Planzo connection check (test)” completed planning → voting → individual review → explicit organiser agreement through the authenticated Make UI. Four real verified accounts were used; no hosted Auth users were fabricated or seeded.

- All four included members confirmed the supported fictional fixture through their own accounts. Fresh preparation found both options feasible for the complete 13–15 November 2026 window, two twin rooms and complete personal cost estimates.
- One poll opened for four members. While open, the UI showed participation only. All four ballots saved; organiser closure showed Easy beach 4, Coast 0, with no abstentions, different-option requests or missing ballots. The result selected a working draft and did not grant readiness.
- Plan v1 was shared privately with all four. Readiness started at 0/4. The organiser’s test Ready response made it 1/4 and the agreement button remained disabled.
- The user completed the three guest responses and reported successful guest sign-out/sign-in restoration of the plan, own ballot and own Ready response. This returning-guest result is user-confirmed; the assistant did not enter or read email codes/passwords.
- Organiser UI showed 4/4 explicitly Ready. Confirm trip agreement saved “Trip agreed · bookings pending.” A fresh server refresh retained the agreed state. No reservation, payment or provider booking was made.
- Hosted readback of counts/status only confirmed stage agreed, trip/source revision 19, Plan v1, roster 4, four cost snapshots, four acknowledged Ready responses, four ballots, one closed poll and one agreement event. No raw briefs, private reasons, individual ceilings or other travellers’ costs were administratively read.

Evidence: `backend/planning-open-poll.png`, `backend/planning-review-v1.png` (1/4 gate), `backend/planning-agreed.png` and `backend/PLANNING_DEPLOYMENT.json`. Earlier two-person and incompatible-input blockers were observed before the valid fixture was confirmed; no minimum, budget, date or accessibility rule was weakened for the test.

## Database and rules

Read the Prototype Playbook v1 B05/B06 and voting subset of B07, plus the earlier identity handoff and EMAIL_SETUP.md. Eight private RLS tables were added: planning_catalogues, planning_drafts, plan_versions, plan_costs, plan_responses, plan_polls, poll_ballots and planning_events. There are now 17 application RLS tables. The existing operation receipt table gains nullable request_hash. No populated tables were dropped.

The public `planzo_planning` endpoint is SECURITY INVOKER with authenticated execute only; its restricted private implementation verifies confirmed nonanonymous Auth and protected trip membership/role. Clients have no direct private table grants or evaluator access. The server checks private group inputs but returns only safe blockers and the caller’s own costs/notes. No raw ceiling/reason is copied to shared data. Ballots remain private until closed aggregate results. Writes serialize on the trip row; request UUID plus payload hash makes retries safe. Ballots and responses additionally check their own revision.

Actions: get, prepare, select, open_poll, vote, close_poll, cancel_poll, publish_plan (share a private trip version only), respond, close_round, roster, revise, extend and postpone. One open poll, at most two feasible options, explicit abstain/different-option, and editable ballots. Ties choose the lower upper shared cost excluding optional add-ons; equal costs/no preference votes/different-option requests remain unresolved.

Immutable plan versions preserve roster, input revisions, catalogue facts and content, with own cost snapshots. Every included traveller explicitly acknowledges the exact current version. Silence/deadline expiry never grants consent. Material changes require fresh pricing/version/review; decline retains membership/roster until an explicit roster proposal. Deadline extension and postponement are explicit and recorded. Change/decline can withdraw readiness even after the deadline; new late Ready/agreement is blocked. Agreement is a nonbinding intention with bookings pending.

Catalogue `goa-reference-v1` is a labelled fictional playbook arithmetic fixture dated 15 October 2026: Bengaluru to Goa, three calendar days/two nights, twin rooms, one vehicle up to eight. Amounts/shares use integer paise with deterministic residual allocation, fees and 10% contingency. Optional boat charges reach only attendees. Unsupported origins/dates/missing prices block feasibility. Required step-free access blocks because provider accessibility is unverified. This is not live pricing, availability, provider verification or an accessibility guarantee. No AI, payment, reservation or booking tasks were added in this slice.

## Source, migrations and checks

`src/LivePlanning.tsx` and `src/planningBackend.ts` add Plan, Voting and Review & confirm to `src/LiveApp.tsx`, extending existing visual tokens in `src/index.css`. New planning data is not stored in browser persistence. Checked polling/focus/manual refresh keeps shared state current. Failed writes preserve entered intent; retry IDs stay in component memory. The original `?demo=1` journey remains separate.

Applied canonical migration chain:

1. `20261015154643_planzo_identity_trips_private_briefs` (earlier slice).
2. `20261015170744_planzo_planning_voting_confirmation`.
3. `20261015170844_planzo_invitation_membership_index`.
4. `20261015171734_planzo_allow_deadline_withdrawal`.

Development SQL is in `supabase/changes`; byte-identical applied files are in `supabase/migrations`. Do not edit applied migrations retroactively. The final private planning function body SHA-256 matches hosted: `363ee8a1c72abf1377a2ae087bec67bbf76a1f01574fca3fe512cd850b8c3cb8`.

- 55 disposable PostgreSQL planning checks pass, including privacy/grants, exact costs, stale/idempotent requests, independent-connection concurrent publication and agreement/withdrawal, minimum/coverage/accessibility blockers, immutable history, late withdrawal and fresh review. These use a minimal local Auth stand-in, not real email/JWT penetration tests. See `backend/PLANNING_DATABASE_TESTS.json`.
- 26 identity/private-input regressions pass with the complete migration chain. See `backend/LOCAL_DATABASE_TESTS.json`.
- Local and Make typecheck, 22 application tests and production build pass. Existing hosted chunk-size advisory remains.
- Eight hosted endpoint checks pass, including signed-out planning denial and private-table/evaluator non-exposure. See `backend/HOSTED_API_TESTS.json`.
- Before edits, Make matched all 12 prior source/dependency hashes. Initial five-file install and four-file deadline follow-up were byte exact, with all 14 final app/dependency hashes matching and no unexpected paths.
- Backend source sync copied eight SQL plaintext attachments plus the manifest exactly (9/9), with all 11 backend hashes and 14 app hashes matching. SQL was not rerun in Make. Documentation checkpoint also verified 9/9 exact files and valid JSON.

Current fingerprints: `backend/SOURCE_HASHES.json` (14 app/dependency files) and `backend/SUPABASE_SOURCE_HASHES.json` (11 backend files). The source manifest SHA-256 is `14f5f40439945b660ec4ec8b1039a04ec5bc1f4f5d6f15f9b5e3d2499e8be9cf`.

## Release limits and recovery

Security advisors report 12 intentional default-deny private tables with no direct client grants and one existing Auth warning: leaked-password protection disabled. Review https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection before release. Performance advisors report only unused-index INFO entries; the invitation foreign-key covering-index finding was fixed. Auth/SMTP settings were not changed during this slice.

Choose the final published origin and update Supabase Site URL/allowed redirects; then repeat real-email and invite flows on that origin before launch. Make preview origins may refresh after source updates and require a fresh sign-in. Preview-origin success is not published-origin verification. Prices/providers, verified accessibility, booking task assignment/reports, payments, AI, a real-group pilot and public publication remain separate work. Do not mark all playbook backend or pilot/release stages complete based on this bounded slice.

For recovery, restore the prior Make frontend version if needed; preserve additive database records and immutable history. Prefer a forward correction migration. Do not drop populated tables, remove Auth identities, expose private tables or weaken feasibility/consent rules. No approval is pending for this implementation; the user explicitly authorized this slice and required the website to remain unpublished.
