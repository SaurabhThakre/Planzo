# Planzo pre-launch review — 15 October 2026

Updated 16 October: the manual one-itinerary slice is now applied; read ITINERARY_SLICE_HANDOFF.md for the current verification checkpoint. The intended AI-assisted product is not ready for publication. User requested setup/security review and an implementation plan, followed by a safe stop. Website remains unpublished. Read RESUME_HANDOFF.md for the latest exact state and verified Make patch result.

| Area | Current evidence / remaining work |
|---|---|
| Real identity and shared data | Four verified accounts completed the labelled test; private input and returning access work. |
| Planning and agreement | Earlier Plan v1 and four Ready responses preserved. New planning uses one structured manual itinerary, item polls and next-version review; 16 live ordinary-account checks and 12 Make UI checks passed. |
| AI extraction and one itinerary | Manual one itinerary implemented on 16 October; no AI extraction or automatic consensus inference. See ITINERARY_SLICE_HANDOFF.md and AI_ITINERARY_IMPLEMENTATION_PLAN.md. |
| Missing-night detection / item voting | Deterministic required-slot/night checks and complete-candidate item polls implemented in Supabase/Make. 49 local actor checks and six hosted signed-out probes pass; 16 real-account checks and 12 Make UI checks pass. |
| Booking tasks / milestones | Remaining B07 work; provider clicks must not imply a reservation. |
| Auth setup fixes | Server password minimum saved at 12; current preview Site URL and three exact callbacks added, older preview retained; verified after reload. |
| Auth controls | Email confirmation on, anonymous sign-in off, 8-digit OTP/1-hour lifetime, resend and verification limits retained, custom SMTP on. No credentials changed/read. |
| Database boundary | 20 RLS tables after the additive itinerary migration; zero private table grants/direct public writes/client schema CREATE; restricted RPC execution and search paths. No private Realtime exposure or storage buckets. |
| Advisor warning | Leaked-password protection disabled; available on Pro+. Current project is Free. Owner decision remains; no subscription change. |
| Build dependencies | 10 advisories patched locally; fresh audit zero, typecheck/22 tests/build pass. Make frozen install, audit, typecheck, 22 tests and build also pass; 14 app/11 backend hashes match. On 16 October the old error badge did not reproduce; signed-in agreed-plan restoration passed. Historical cause is unknown. |
| Actual access tests | On 16 October, 17/17 ordinary-account checks passed with three distinct verified users: own-only raw input, outsider RPC/table denial, blocked role promotion, actor-field rejection and revoked invites. Fixtures postponed; original agreed trip unchanged. Eight earlier hosted signed-out checks, 55/26 local DB checks and four-account happy path are separate evidence. The 16 October item run also rejected a valid older-version response replay. Session revocation, remaining cross-context variants and other A01–A25 cases are not implied passes. See SECURITY_CHECKS_2026-10-16.md. |
| Final URL and email | User has no final address yet. Configure exact production callbacks when chosen; repeat outside-user confirmation, OTP, invite return and recovery there. Preview success is insufficient. |
| Operational setup | Sender-domain authentication/deliverability, owner MFA, backup/restore and pilot capacity need owner verification. Do not expose credentials or dump private member data into this handoff. |
| Public release | P01 and published desktop/mobile tests remain pending. Do not click Publish. |

The earlier security-only review changed no SQL/application logic. The separately authorized 16 October manual itinerary slice adds three private RLS tables, checked RPCs and the itinerary interface; see its handoff for exact applied sources. Price data remains illustrative, accessibility unverified, no AI/provider account is configured, and no booking or payment occurs.

Sources: [Supabase password security](https://supabase.com/docs/guides/auth/password-security), [production checklist](https://supabase.com/docs/guides/deployment/going-into-prod), [Vite advisory](https://github.com/advisories/GHSA-fx2h-pf6j-xcff), [PostCSS advisory](https://github.com/advisories/GHSA-fxqj-rqcc-2cmp), [nanoid advisory](https://github.com/advisories/GHSA-2v37-7h3g-55p8), [source-map-js advisory](https://github.com/advisories/GHSA-68fv-2mgg-jv7q). The playbook’s B07, AI01, A01–A25 and P01 remain the acceptance reference; not-tested cases are not passes.
