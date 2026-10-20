# Planzo security verification — 16 October 2026

User resumed setup/security review and manual itinerary preparation. Website remains unpublished; no AI/provider purchase or schema change is part of this verification.

## Completed before ordinary-account probes

- Signed-out entry rendered; old error badge absent.
- User signed in personally; Plan v1 reopened with four Ready responses and Trip agreed / bookings pending. The previous error did not reproduce. Its historical cause remains unknown; no speculative source fix was made.
- Local source hashes still match all 14 application/dependency entries and 11 backend entries. Yesterday's verified dependency patch is retained; no new install or repeated test run was needed.
- Existing real four-account journey, 55 local planning PostgreSQL checks, 26 local identity checks, 22 application tests and eight hosted signed-out checks are earlier evidence, not automatically new ordinary-user access passes.

## Isolated ordinary-user checker

Source: `tools/access-check/index.html` and `tools/access-check/check.js`. Served from a separate temporary directory at `http://127.0.0.1:8744/`, bound to this computer only; not included in Make or the production app. Uses the installed Supabase client and a publishable key only. No administrator/service-role key.

Three distinct existing verified test accounts signed in with codes entered by the user. Clients do not persist sessions, detect callback sessions or share a storage key. No account was created. Authentication state and any necessary private test data stayed in page memory. Existing Planzo profile names were preserved. The checker requested local-scope sign-out for its own sessions and cleared its actor references. Individual sign-out responses were not asserted; immediate JWT invalidation/session revocation is not a verified result. The checker tab was then closed, discarding volatile page state, and its temporary server was stopped.

The user is asked to click Run the access checks. The checker creates two clearly labelled trips, adds B to A's test trip through a transient invitation, and saves known fictional A/B inputs through their own authenticated contexts. C belongs to the separate test trip. No current agreed plan is mutated. Invitations are revoked, both test trips are postponed afterward, and history is retained. Failed cleanup must be reported with safe fixture IDs for follow-up; never silently delete records.

Checks cover idempotent joining; A/B own-only workspace data; forged brief-owner payload; C workspace/planning/row-query denial; profile isolation; private-schema non-exposure; blocked membership self-promotion; forged organiser fields; response actor-field rejection; signed-out RPC denial; minimal invite preview and revoked-invite denial. Denials may correctly be errors or empty RLS result sets depending on the API. The safe report records role fingerprints, test outcomes, HTTP/error codes and fixture IDs, with no raw preferences, invitation token or auth credential.

The forged-response probe checks exact rejection of an unsupported actor field before a write. It uses no valid shared-plan mutation. Do not mislabel it as a full stale/other-version replay exercise. This checker does not cover all A01–A25 cases, every endpoint, session revocation, provider behavior or published-origin behavior. Record individual pass/fail/not-tested results rather than a blanket security certification.

## Result checkpoint

**17 passed, 0 failed**, using three distinct ordinary verified accounts on 16 October 2026 at 03:58:04 UTC (09:28:04 IST). Run ID: `dd622477-192d-4649-98df-310173f4bbef`. The user completed sign-in and pressed Run; the safe result was read back afterward. Per-check HTTP/error codes and scope are recorded in `backend/security-review-2026-10-16/ORDINARY_ACCOUNT_TESTS.json`. Empty outsider/profile queries are successful RLS denials, not missing errors.

Independent read-only metadata verified both fixtures are postponed with zero active invitations. The original agreed trip remains revision 19, four members, one immutable plan version, four acknowledged Ready responses and one agreement event. Fixture history was retained. See `backend/security-review-2026-10-16/CLEANUP_METADATA.json` and `ordinary-account-checks.png` in the same directory. No raw brief, cost, note, invitation token or credential was saved in this evidence packet.

This closes the listed ordinary-account boundary probes, not every A01–A25 case. Full valid-plan stale/other-version response replay, session-revocation guarantees, every endpoint, final-origin email/invitation/recovery, owner MFA, sender DNS/deliverability, backup recovery and published desktop/mobile pilot checks remain unverified. Leaked-password protection remains a known Free-plan limitation. Product work for one itinerary, item votes, missing-step detection and booking handoff/milestones remains separate. See RESUME_HANDOFF.md and AI_ITINERARY_IMPLEMENTATION_PLAN.md.

The earlier nine-document copy to Make was verified byte-exactly, with all 14 app and 11 backend hashes unchanged. This closeout packet adds today's report, safe JSON results, cleanup metadata and screenshots; the Make agent's final copy report records hosted verification. No application logic, SQL, dependencies, auth settings, AI integration or publication changed during these probes or documentation closeout.
