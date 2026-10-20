# Planzo — one itinerary and bounded AI plan

Current implementation checkpoint, 16 October 2026: read `AI_SETUP_HANDOFF.md` for the later authorised preference-parsing implementation and Gemini Free Tier fictional-only boundary. Manual itinerary and B07 booking handoff are already implemented. Catalogue drafting remains later work. The paragraphs below preserve the original planning proposal and are not current deployment claims.

Planning document only; no feature implemented or provider configured. This records the user’s 15 October 2026 clarification, which supersedes the earlier whiteboard’s multiple-concept presentation. User selected finishing setup/security review first and requested a safe stop.

## Intended experience

Private member input → member checks extracted fields → ONE shared itinerary → resolve genuinely conflicting or missing items → detailed budget review → each included traveller explicitly responds to the same saved version → organiser agreement → booking handoff.

Collect hard budget ceilings privately at the beginning. The main detailed budget screen may come after itinerary decisions, but the server must check complete affordability and requirements before presenting actionable votes. Votes cannot override unavailable dates, a ceiling or accessibility. Unknown critical prices remain unresolved.

1. Dates first: find windows compatible with every included person’s confirmed availability. If none, propose new dates, an explicit roster proposal or postponement. Majority voting cannot force an unavailable member into a window.
2. Build a single timeline: outbound travel, each required overnight stay, local travel, food and activities, then return travel. Agreed soft choices carry into the draft; no need to vote on everything.
3. Normalize meaning, not exact wording: “beach day” and “time by the sea” may align. Confirm uncertain extraction with its author. Silence or omission is not a confirmed preference.
4. Vote only on real conflicts: two activities can coexist when time and travel permit. Beach versus church on Day 1 is not automatically a conflict; if both fit, suggest both. Mutually exclusive time/arrangement choices get a targeted poll with at most two feasible alternatives.
5. Fill missing slots: deterministic coverage checks identify gaps; AI suggests supported catalogue items. Suggestions remain labelled and editable. Never describe a suggestion as booked.
6. Review complete per-person costs including origin travel, all stay nights, local transport, food, activities, fees and contingency. Reprice after a changed item, roster or optional attendance. Each person sees only their own estimate.
7. Every shared plan change produces a new immutable review version and fresh responses. Item votes and common preferences never replace final individual readiness.

## Missing-stay example

A three-day trip returning on Day 3 normally needs TWO nights: the nights after Days 1 and 2. Validate check-in/check-out coverage for every required overnight in the destination timezone, rather than looking only for “hotel on Day 1/3.” A missing second-night stay becomes a visible unresolved slot. Hotel/villa candidates need sufficient capacity, dates, requirements and complete supported prices before a binding item poll. Overnight travel counts as coverage only when its arrangement/timing is explicit and valid. AI must not invent availability, provider links, prices or reservations.

## Implementation sequence on resume

1. **Structured manual itinerary and item polls first.** Replace the two-plan gallery with one editable day/item timeline. Persist item IDs, category, date/time, participants, supported catalogue ID, source, cost assumptions, dependencies and status. Preserve existing v1 historical plans. Extend polls with item ID and draft revision; keep one open poll per trip initially. Validate each candidate by substituting it into a COMPLETE draft and recomputing the whole-trip hard checks. Stale item/draft context rejects old ballots.
2. **Preference parsing as the first bounded AI action.** Separate opt-in per member; process only that requesting member’s own text. Preview extracted dates, ceilings, requirements and soft proposals for correction and explicit confirmation. Ambiguous “cheap,” dates or conflicting amounts cannot silently become hard values. Keep a manual route and preserve entered text on outage/retry.
3. **Catalogue drafting/gap suggestions as a separate iteration.** Provide only sanitized supported catalogue facts and anonymous confirmed soft priorities; exclude raw group text, names/emails, ceilings and private reasons. Deterministic code detects coverage/timing gaps. AI may propose supported item IDs and a rationale; the backend validates IDs, coverage, timing, capacity, requirements and costs. Unsupported facts remain unresolved. Existing draft survives failure.
4. **Complete B07 handoff.** Add versioned booking tasks, explicit owners/due dates/provider link type and self-reported status; opening a link stays pending. Derive five milestones from saved state. Validate all ownership and stale versions on the server.
5. **Release candidate and pilot.** Run ordinary A/B/C/signed-out API allow/deny cases and the final-origin email/restore flow; repeat mobile/desktop checks and reconcile exact Make/backend versions. Publish only after a separate explicit user instruction.

## Proposed data/API changes — prepare, review and test before migration

Extend existing compatible tables/RPCs rather than replacing populated records. Add private extraction/consent/request receipts, structured draft items and item proposals; scope all to trip/member and exact revisions. Extend catalogue records for concrete supported item alternatives and full date/night costs. Add item-scoped poll snapshots; retain immutable plan/version/cost/history boundaries and integer-paise allocation. Add booking tasks only in their own slice. Validate structured AI output server-side; derive actor from Auth and role from protected membership. Never trust a client-selected identity or a model’s approval.

No schema is applied by this document. Prepare an additive change package, actor access matrix, errors, acceptance tests and forward-recovery steps before deployment. Test each bounded slice locally and verify hosted state after an authorized deployment.

## Provider/setup decisions still needed

The user has no AI-provider account or chosen final URL. Choose the provider/model and an explicit spending cap on resume; enter secrets only into server-side secret storage. Apply authentication, trip scope, consent, per-user/per-trip limits, token/time/retry limits, safe logging and usage monitoring. Raw preference text and retrieved content are untrusted data, never model instructions. Do not buy a service or put any key in Figma/browser source/chat. No data is sent to an AI provider at this checkpoint.

## Acceptance examples

- Semantically matching confirmed items carry forward without unnecessary polls.
- Day 1 beach plus church can coexist if travel and time fit; impossible overlaps trigger a targeted choice.
- Missing second-night coverage blocks readiness and produces a labelled gap, not a fabricated booking.
- A voted hotel still fails if any included traveller’s complete upper cost/requirement fails.
- AI unknown item IDs/URLs/prices, prompt-injection text, conflicting budgets, ambiguous dates and outages cannot bypass validation or destroy a working draft.
- Optional participants alone pay incremental charges; changed roster/items recalculate exact shares and require current-version review.
- Four voices need not have identical prose. Votes resolve soft differences; hard constraints and final consent remain individual.
