# Targeted planning edge cases — 17 October 2026

The human asked to test concerns on entries, different travellers' must-haves, actual Gemini generation and other edge cases. This extends the verified FULL_REGRESSION_HANDOFF.md baseline; it does not replace or rerun completed migrations. Use only Make `4tPr5AkQO1g0L1esRvGRjz` and Trip Pact `ewysgpuwvufbklesdhuj`. Preserve earlier trips, private inputs and immutable history. No purchases, billing activation, provider booking submissions or publishing.

## Confirmed gaps — do not describe these as passing

- `backend/PLANNING_CONFLICT_DIAGNOSTICS.json`: **two failing diagnostic cases** on the latest migration chain in disposable local PostgreSQL. Explicitly contradictory vegetarian-only/non-vegetarian-only meal requirements both receive `included` outcomes on the same generic meals. Exclusive North Goa-only/South Goa-only accommodation requirements likewise both receive `included` outcomes on the same generic stays. These use deterministic document construction, not a real Gemini call. Food/stay association currently checks entry kind, not semantic compatibility or real-world fulfilment. A verification caveat does not resolve the contradiction.
- Source review: Gemini returns an ordered list of supplied references and optional activity alternative pairs. The server constructs the dated timetable, meal/stay blocks and fictional reference costs. The desired fully Gemini-authored detailed itinerary is **not implemented**. A successful provider request must not be represented as proof of that broader capability.
- Entry concerns currently propose supported replacements and collect accept/reject/abstain votes. Free-text entry questions/discussion are **not implemented**.

These are recorded product gaps. No application, Edge or database functions have been changed during this targeted test preparation.

## Prepared live scenario

`tools/varied-requirements-access/` is an ordinary-account checker for the same four previously verified test identities. Sign-ins remain only in page memory; no credentials/sessions are exported. The checker has saved in-memory checkpoints and will not repeat its provider call on retry. Do not edit served JavaScript after the human signs in. It creates one new `TEST · AI varied requirements <run>` trip and makes at most one real Gemini request. Do not mutate the previous full-regression fixture to run this scenario.

Twenty-six checkpoints preflighted successfully in disposable local PostgreSQL using local Auth stand-ins and stubbed AI (`backend/VARIED_REQUIREMENTS_PREFLIGHT.json`). This is **not hosted or Gemini evidence**. The scenario covers four different shared request sets, private data boundaries, differing personal availability, every personal requirement outcome, excluded unverified conditions, four simultaneous activity/meal/stay/rest concerns, duplicate concern rejection, incomplete ballots, majority/rejection/tie/abstention outcomes, affected-person acceptance, review invalidation, organiser-only exact-version lock and immutable prior versions.

The live checker pauses after opening four concerns so the new fixture can be inspected in the existing Make preview. After that screen check, click **Continue voting checks**. New runs must not be mistaken for read-only inspection; the initial button makes the one bounded Gemini request. The previous `4c3ff90e-77a2-4c0f-8bba-842298c6a930` trip remains protected.

Current checkpoint: local preparation complete; the human has been asked to sign in to the new checker with the four existing verified accounts. **No new hosted fixture or Gemini call yet.** Fresh baseline captures 18 existing trips and 45 function bodies/permissions. Complete the real run, Make observations and restricted before/after preservation comparison before reporting hosted success. Keep local failures visible in the final result.
