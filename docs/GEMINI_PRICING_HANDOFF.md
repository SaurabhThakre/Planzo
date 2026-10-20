# Gemini price estimates — verified 19 October 2026

The user asked to fetch tentative prices from Gemini. This update is installed in existing Make 4tPr5AkQO1g0L1esRvGRjz and Trip Pact ewysgpuwvufbklesdhuj only. It supersedes the earlier fixed reference-cost limitation for newly generated priced drafts. Earlier saved plans and history remain unchanged. No publishing, purchases, billing activation or reservations.

## Result

Gemini now returns per-person INR lower/upper price estimates with assumptions for each proposed activity, meal and stay, plus basic daily local travel and other trip fees. Destination, common dates, traveller count and estimation date inform the request. Prices are model estimates from general knowledge, not live quotes or search-grounded data. The interface labels the source, units and assumptions in the itinerary, historical version reader and final journey.

Budget admission and remaining allowance use the upper estimate, including Planzo's fixed 10% contingency. The lower estimate appears alongside it. Arrival/return transport, unpriced rules and extra personal spending remain outside this shared estimate for Phase 2. A free self-guided activity can explicitly cost zero; an unresolved or unpriced condition remains unverified and cannot silently become a free promise. Missing, malformed or incomplete prices fail validation with no fixed-price fallback. Host-entered overrides are labelled separately and require a fresh version/review. Replaced arrangements cannot retain stale overrides.

Private ceilings, raw must-have/flexible answers, starting cities and user identifiers are not sent to Gemini. Only consented reviewed shared requests and common trip context are sent. Existing identity, admission, membership, stale-state, owner exclusion acknowledgement, exact-version review and organiser lock gates remain intact.

## Installed source and deployment

Application51/backend77/fixture2 tracked files (126 unique paths) exactly match a downloaded Make code archive. Fifteen prepared records including both source manifests were also verified. Figma AI credits are exhausted, so the normal direct file editor was used. All106 automated tests, typecheck and production build passed locally; do not claim they ran in Make. The exported Make code matches that tested source byte for byte. See backend/PRICING_MAKE_SOURCE_VERIFICATION.json.

Forward migration20261019043452_gemini_pricing was applied once. Do not reapply it, edit the frozen migration, or rerun its builder. Its prepared timestamp was20261019042919; the canonical local filename matches the actual hosted43452 migration. Four private invoker pricing helpers and two dispatcher changes were verified against canonical SQL, with empty search paths and no client execution. No tables, public API wrappers, existing saved rows or grants were changed. Security findings are unchanged. Edge planzo-planning v8 is ACTIVE, JWT verification true, all five returned runtime sources match canonical code. Interpreter v6 is unchanged. Model remains gemini-3.5-flash-lite.

Pricing runtime code was consolidated into existing contextualPlanning.ts and ContextualStepDetails.tsx. Do not recreate superseded temporary geminiPricing.ts, PlanningPrices.tsx or gemini-pricing.test.mjs. The isolated checker is intentionally root-level gemini-pricing-check.mjs, not under tools/. No new runtime dependency was added.

## Verification and live fixture

All24 isolated database cases passed, including malformed and missing prices, upper-cost budget exclusion, zero-cost custom arrangements, host overrides, concern-majority repricing, fresh exact-version reviews, old snapshot preservation and private access denial. These used local Auth/model stand-ins, not hosted accounts or provider calls. See backend/PRICING_DATABASE_TESTS.json.

One live Gemini call, no automatic retries, created fixture47273221-88c6-486f-976d-bc24669feb75, labelled TEST · Gemini pricing 2026-10-19. It is a fictional one-person Goa trip,20–22November2026, with four reviewed requests: guided parasailing, independent Fontainhas walk, hostel stay and Goan meals. The generated version1 has parasailing INR800–1500, walk INR0, nine meals at INR400–1200, two nights at INR800–2000, daily local travel INR300–1000 times3 and other fees INR0–200. Subtotal INR6900–19500 plus10% yields INR7590–21450. The fictional private ceiling INR25000 leaves INR3550 unallocated using the upper end.

The ordinary signed-in organiser confirmed the exact-version review and locked version1; History and Final journey display the saved ranges and assumptions. Fixture has one input, one plan, one generation admission used once, one review and one lock. No further provider call is needed to inspect it. See backend/PRICING_LIVE_REVIEW.json (13 observed checks) and backend/PRICING_LIVE_DESKTOP.jpg (actual Make screenshot, not synthetic).

The pre-task baseline25 trips/36 input versions/24 plans/10 locks/16 reviews/8 polls/11 ballots and complete trip/input/plan row fingerprints match exactly after excluding only this fixture. See backend/PRICING_HOSTED_BEFORE.json and the live review report. Do not regenerate or modify an existing user trip to demonstrate this update.

## Limits and next steps

Existing snapshots keep their original reference prices; only a new draft adopts Gemini pricing. Locked trips require the normal reopen/new-review flow. Do not mass-regenerate user trips. Timetable allocation still uses deterministic server blocks, and price validation cannot prove provider accuracy, semantic fulfilment or geographical feasibility. No exhaustive multi-person semantic or live-provider price accuracy certification is claimed. Booking and actual transport/availability checks remain Phase2. No local checker service is left running.

Historical playbook/worksheet and contextual handoffs remain useful context but predate these price changes. Keep all earlier history and private-data boundaries. Use only the named Supabase project and Make file; do not repeat completed migrations, provider calls or checks without a concrete new reason.
