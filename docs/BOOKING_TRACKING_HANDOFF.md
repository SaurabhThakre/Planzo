# Shared booking tracking — 11 November 2026

User authorized cleaner right-hand provider links, shared booking tracking and publication. Free services only. This supersedes historical phase boundaries for this additive feature.

Bookings now have per-step status, provider, total paid in INR (paise precision), booked-by included traveller, reference and notes. Included group members can collaborate; actual authenticated editor and timestamp are retained in append-only history. This is self-reporting, not a supplier reservation or availability verification. Booking payments do not change itinerary prices, budgets or personal readiness.

Migration `20261111085443 shared_booking_tracking` applied once to `ewysgpuwvufbklesdhuj`; source is `supabase/changes/planzo_booking_tracker.sql`. Do not rerun. Private RLS table has no client grants/policies. Authenticated RPC verifies confirmed nonanonymous identity, inclusion, current locked active plan/stamp, step eligibility, included booker, values and expected revision. Request hash makes retries idempotent. Older versions remain separate; archive read-only.

Local and Make typecheck, 235 tests and production build passed. Hosted transactional script `tests/booking-tracking.hosted.sql`: 24 checks passed; all synthetic inserts/roster/archive edits rolled back. Additional authenticated-role read/save calls passed and rolled back. No real user trips were modified, no provider reservation or purchase was attempted.

Make version 8 (`1af7cfa032197da5b28e4285c308a5e99571042f`) was published, with Published/Just now/No issues confirmed. Live desktop QA passed: malformed decimal rejected without a save; host saved a synthetic stay for INR4200.25 with member1 booked-by; full reload retained it; member1 signed in and read/edited it; history retained both actual editors. A concurrent synthetic update advanced revision to 3: stale UI draft remained intact, save was blocked, and Load latest details recovered the current record. Day2 retained its separate unbooked stay. All 3 committed booking events belong only to the named QA fixture. No real booking/payment occurred.

Follow-up polish makes the workflow2 agreed header neutral (itinerary locked), prioritizes actual provider searches over passenger-information links, and makes the hosted rollback-only tests reusable with existing synthetic events. Browser viewport override had no effect (remained 1280px), so mobile rendering is not verified; responsive CSS stacks the actions at 720px.

QA trip `791e21bb-b93e-470b-a22e-5dbad90b8863`, locked plan `93d9c27c-b9be-4799-8d26-7cbaf0e41eea`, version 2. Use only existing labelled QA accounts for write tests. Do not regenerate locked fixtures. Keep credentials out of source and manifests.

Do not run local Vite servers or embedded PostgreSQL runners in this environment: earlier approval review blocked their telemetry. Standard Node tests/typecheck/build and hosted/browser checks are available.
