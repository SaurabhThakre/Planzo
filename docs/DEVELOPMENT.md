# Planzo development guide

This guide describes the shared app as of the 11 November 2026 release. The [published site](https://person-siren-40913121.figma.site/) runs from the [working prototype in Figma Make](https://www.figma.com/make/4tPr5AkQO1g0L1esRvGRjz/Planzo-%E2%80%94-Working-Prototype). See the [README](../README.md#run-locally) for setup. The [handoff archive](HANDOFF.md) and [original prototype test report](TEST_REPORT.md) capture earlier checkpoints.

## App structure

[`src/main.tsx`](../src/main.tsx) mounts `LiveApp`. [`LiveApp.tsx`](../src/LiveApp.tsx) owns hash routes, account and trip loading, the shared header, and the footer. The signed-out home links to `#/help/walkthrough`. Help and Privacy Policy live at `#/help` and `#/privacy`. The public entry point opens the shared app. The Goa sample has no public entry in the current build.

Trip routes are relative to `#/trip/<tripId>`. [`TripWorkspaceNav.tsx`](../src/TripWorkspaceNav.tsx) defines the navigation. Workflow 2 uses [`LivePrivatePlanning.tsx`](../src/LivePrivatePlanning.tsx) for the planning and post-lock views. Earlier saved trips retain their legacy workflow and [booking handoff](BOOKING_SLICE_HANDOFF.md).

| View | Route suffix | Source and behaviour |
| --- | --- | --- |
| Overview | Trip root | [`LiveApp.tsx`](../src/LiveApp.tsx) shows the trip stage, dates, members and organiser controls. |
| My private input | `/preferences` | [`PrivateConversation.tsx`](../src/PrivateConversation.tsx) collects and confirms each traveller's availability, budget and planning preferences. |
| Itinerary and review | `/plan`, `/voting`, `/review` | [`LivePrivatePlanning.tsx`](../src/LivePrivatePlanning.tsx) shows the current version, step decisions and personal review. The organiser can lock the itinerary after the outstanding decisions and checks are resolved and every included traveller confirms that version. |
| Final journey | `/journey` | [`FinalJourney.tsx`](../src/FinalJourney.tsx) shows the exact locked plan by destination-local day. |
| Bookings | `/bookings` | [`BookingOptionsPanel.tsx`](../src/BookingOptionsPanel.tsx) shows one day's checklist and the trip-wide progress summary for the current locked itinerary. |
| Payments | `/payments` | [`PaymentsPanel.tsx`](../src/PaymentsPanel.tsx) shows the shared, trip-wide ledger after the itinerary is locked. |
| History | `/history` | [`LivePrivatePlanning.tsx`](../src/LivePrivatePlanning.tsx) shows earlier itinerary versions and planning events. |

[`flowBackend.ts`](../src/flowBackend.ts) connects planning to `planzo_flow`, `planzo_refine` and the `planzo-planning` Edge Function. Assisted planning uses travellers' reviewed shared requests. Raw private input and individual budget ceilings stay out of the shared itinerary and Gemini generation payload. Hard constraints and personal checks still apply. A material revision needs fresh responses. See the [private planning](PRIVATE_PLANNING_HANDOFF.md) and [budget planning](BUDGET_PLANNING_HANDOFF.md) handoffs.

## Bookings and Payments

### Bookings

- [`bookingOptions.ts`](../src/bookingOptions.ts) derives external provider links for eligible itinerary steps. Travellers verify availability and price with the provider and make reservations outside Planzo.
- Included travellers can report status, provider, total paid in INR, booked-by traveller, reference and notes. The trip group can see those details. History retains the actual editor and timestamp separately from the booked-by traveller.
- The organiser's [stay repricing form](../src/RepriceStayForm.tsx) updates the planning estimate through a new itinerary version that goes through review again. Report actual spending in the booking record.
- [`bookingTrackingBackend.ts`](../src/bookingTrackingBackend.ts) calls `planzo_booking_tracker`. The [SQL source](../supabase/changes/planzo_booking_tracker.sql) keys records by itinerary version and step, restricts writes to the current locked plan on an active trip, and checks per-step revisions. Request IDs make retries idempotent. Earlier records remain available in history. See the [booking tracking handoff](BOOKING_TRACKING_HANDOFF.md) for deployment and verification.

### Payments

- The ledger combines reported booking costs with manual expenses and refunds. Travellers choose a payer and use equal or exact splits. Amounts and shares use integer paise so they reconcile to the recorded total.
- A positive booking amount with a recorded payer appears once per plan and step. The ledger uses the latest report with both values, and includes earlier locked versions. The first financial report captures split participants. Edit the amount or payer in Bookings and the split in Payments. If an amount change invalidates an exact split, the entry needs review and stays out of balances until corrected. New settlements are blocked while a split needs review. Cancelling a booking without correcting its reported amount retains the last paid report. Record a refund separately.
- Record a transfer after sending it outside Planzo. A pending transfer leaves balances unchanged. The recipient can confirm or reject it, and the sender can cancel it while pending. Only confirmed transfers affect balances.
- [`paymentsBackend.ts`](../src/paymentsBackend.ts) calls `planzo_payments`. The [SQL source](../supabase/changes/planzo_shared_payments.sql) checks verified included membership and the ledger stamp, and records mutation receipts and activity history. Booking and payment writes use the same trip-row lock. Archived, deleted and postponed trips are read-only. Booking reports and ledger entries leave itinerary estimates and private planning budgets intact. See the [payments handoff](PAYMENTS_HANDOFF.md) for deployment and verification.

The booking tracker and payments SQL above were applied to the existing hosted project under migration versions `20261111085443` and `20261111110812`. The handoffs record those deployments. Treat the files in `supabase/changes/` as implementation references when reviewing the hosted project.

## Layout and day switching

- [`ItineraryDays.ts`](../src/ItineraryDays.ts) groups steps by destination-local date. Bookings deduplicates incoming steps by ID, then renders one day panel with [`ItineraryDayTabs.tsx`](../src/ItineraryDayTabs.tsx). Selecting the active tab is a no-op. Keep the checklist and summary mounted once when switching days.
- [`bookingOptions.css`](../src/bookingOptions.css) places the booking summary on the sticky right at widths of 1120 px and above. The summary sits above the checklist at narrower widths. The day controls use the shared header height as their sticky offset.
- [`DeadlineAlerts.tsx`](../src/DeadlineAlerts.tsx) renders the signed-in reminder as a single row inside [`AppHeader.tsx`](../src/AppHeader.tsx). [`presentation.ts`](../src/presentation.ts) measures the complete header so sticky elements stay below it when the reminder appears or is dismissed.

## Verification and publishing

- Run `pnpm run typecheck`, `pnpm test` and `pnpm run build`. The 11 November frontend release passed 246 automated tests. Relevant suites include [provider links](../tests/booking-options.test.mjs), [booking records](../tests/booking-tracking.test.mjs) and [ledger reconciliation](../tests/payments.test.mjs).
- On a labelled test trip, verify the pre-lock and post-lock navigation. In Bookings, scroll down, click Day 2 repeatedly, switch back to Day 1, and alternate between days. Check that there is one selected-day panel and one progress summary. Check keyboard tab selection, desktop sticky placement, mobile stacking and header clearance with a reminder visible.
- For backend coverage, the rollback-only [booking](../tests/booking-tracking.hosted.sql) and [payments](../tests/payments.hosted.sql) suites cover access, revisions, retries and settlement state. Their deployment handoffs record 24 booking checks and 41 payments checks. Use labelled fixtures for hosted writes. Confirm that a paid booking appears once and that a transfer affects balances only after recipient confirmation.
- For frontend releases, verify the working Make preview at desktop and mobile widths, update the existing site, then confirm the published build and its GitHub mirror. See the [cloud publishing workflow](../.github/PLANZO_CLOUD_SYNC.md) for the Make-to-GitHub process.
