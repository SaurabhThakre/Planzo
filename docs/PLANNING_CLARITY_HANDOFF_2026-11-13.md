# Planning clarity — 13 November 2026

## Current status

Implemented and tested in the local project. **Not installed in Figma Make and not published.** Browser/computer control used for the previous releases is not exposed in this session. The Figma connector rejects `create_session` for this populated Make file; its code-import tool supports a blank destination rather than safe replacement of the existing populated project. Do not create a replacement project or change the published URL.

Destination remains Make `4tPr5AkQO1g0L1esRvGRjz`, published `https://person-siren-40913121.figma.site/` and Supabase project `ewysgpuwvufbklesdhuj`.

## Changes

1. Split explicit positive clauses and sentence connectors before bucketing requests. Preserve negation, conditions, qualifiers and raw private text. Corrected the reported Vietnam paragraph into separate cities, food, water-activity and nightlife requests; rooftop-pool accommodation stays a Stay request. Owners can correct wording, type and priority in the review step. No extra Gemini call.
2. Add an overview panel above the group/passport: next action, confirmed count, progress bar and names of included travellers whose input is pending. Refreshes on focus and every 15 seconds through the existing guarded API. Solo organisers go to the itinerary after confirming inputs; group members go to the status overview. Generation is still an explicit action with unchanged server gates.
3. Shared itinerary ordering: timeline, estimate, own request coverage, stay/shuttle repricing, fair-planning explanation, group management last.
4. Personal coverage uses only `own_requirement_checks`. Included requests show destination-local day numbers. Excluded and unverified results have separate labels/reasons. Missing/legacy coverage is explicit; nothing is inferred from other travellers' requests.
5. Final journey uses the same stop-row component and day controls as the itinerary, with static compact rows and no per-step details expanders. Estimate and own coverage follow.
6. Bookings: one direct provider link, a single alternative-provider disclosure, visible unverified availability, and 10px/12px panel padding. Existing status prominence and independent expenses remain.
7. Remove the repeated Gemini/Google paragraph from private-summary review. Keep the actual user review acknowledgement and existing privacy policy.

## Verification

- TypeScript check passed.
- 277 application tests passed, including 12 new requirement/progress/coverage cases.
- Five rendered-component checks passed (actual React markup, no browser): final static rows, coverage privacy, editable bucket controls, shared row labels/times and direct-provider disclosure structure.
- Production build passed; existing large-chunk advisory remains informational.
- No new dependencies, schema migrations, Edge deployments, provider calls, emails, reservations, funds transfers or user-data mutations.
- Live browser QA, current remote-source comparison and publication remain unverified. Do not report this as live.

## Safe installation after browser access returns

The release archive includes a data-only `Planzo_Planning_Clarity.json` list of exact path/before/after/content records. Its `before` hashes refer to the local baseline matching the last known independent-payments release. Validate all current remote bytes before any target writes; stop on mismatches and preserve the friend's intervening changes. For null `before`, require absence. Validate unique safe relative paths, strict base64 decoding and every decoded output hash. Only then install exact bytes and verify readback.

Run `pnpm run typecheck`, `pnpm test`, `node tools/check-planning-clarity-render.mjs`, `pnpm run build` and scoped whitespace checks. Then perform browser QA with labelled dummy fixtures: compound input bucket correction, solo confirm-to-itinerary, organiser/member pending-status display, group roster dropout, private coverage, final static day view and direct/alternative booking links. Do not regenerate real trips or repeat earlier migrations. Publish only the existing project after these checks pass.
