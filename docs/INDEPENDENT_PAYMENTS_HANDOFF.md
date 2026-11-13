# Independent expenses and compact trip UI — 12 November 2026

User requested removal of booking-to-expense automation, receipt confirmation, cramped traveller names, inconsistent day tabs and overflowing desktop trip dates. Booked status now leads and provider searches are secondary expandable links.

- Booking saves/edits/cancellations no longer write expense data. Existing derived expenses are frozen once as ordinary editable expenses; the migration asserts that this preserves every pre-existing ledger balance before handling pending transfers. Booking history stays intact.
- New settlement records are effective immediately. Either sender or recipient may remove a mistaken record, reversing its balance effect. Other members cannot remove it. No money is transferred by Planzo.
- The one earlier pending transfer was changed to recorded with an audit event, as receipt approval is removed. Previous event history is retained.
- Guarded public RPCs, verified membership checks, paise arithmetic, optimistic concurrency, HTTP 409 translation, idempotency, RLS and grants remain.
- Shared day chips use identical fixed sizing across itinerary, review, editor, final journey and Bookings. Desktop header compresses repeated dates without losing time boundaries; full dates are available in its tooltip. Names use full-width split rows.

Local typecheck, 265 application tests and build pass. The forward migration was rehearsed with 32 rollback-only hosted assertions, applied once, then all 32 assertions passed again against the deployed functions. Checks cover booking isolation, exact/equal splits, refunds, idempotency, stale updates, immediate/full/partial settlements, undo by either party, outsider denial, dropout and archived trips. No Gemini/provider request or real payment was made. Browser/source publication verification is performed by the parent assistant after import.

Source: `supabase/changes/independent_expenses.sql`. Do not repeat it. It includes reviewed-baseline function hashes and transactional balance preservation assertions. `tests/payments.hosted.sql` is the current rollback-only payment suite; old booking-auto-sync expectations were replaced.
