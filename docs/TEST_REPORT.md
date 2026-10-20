## Latest status — hosted preview reviewed, 15 October 2026

The existing Planzo — Working Prototype in GFMB Project runs, and the signup/sign-in layout and loading copy were corrected in this same file. Read docs/HOSTED_QA_2026-10-15.md first for the current hosted test results, project links, source hashes, limitations and resume prompt. It supersedes older preparation statements below that hosted preview or import is unverified. M01 is complete for the agreed browser-saved demo implementation/import/preview scope. M02 backend integration, B01–B07, AI01 and P01 remain pending. No publication, Supabase connection, live AI or GitHub push occurred. Next: team review, followed by the next user-authorized deployment or backend task.

Earlier sections below are preparation history.

---

# Planzo local prototype — verification report
15 October 2026. Scope: interactive browser-saved demo prepared for complete editable-source import into Figma Make.

## Passed
| Check | Result |
|---|---|
| TypeScript type check | Pass |
| Production build using the supplied Figma Make-compatible scaffold | Pass |
| Pure rule tests | 17 passed |
| Automated browser journey checks | 13 passed |
| Desktop viewport | 1440 × 1120 |
| Mobile viewport | 390 × 844; no horizontal overflow in welcome, review and preferences |
| Mobile readiness placement | Complete estimate appears before the readiness action |
| Exact Figma SVGs | 142 local files downloaded; all parse as SVG with nonzero root dimensions |
| Runtime images on the tested views | Loaded from the local app, with nonzero natural sizes |
| Fonts | Four local Inter font weights; OFL license included |
| Production deployment-path smoke check | /planzo-test/ loaded, assets rendered and sample navigation worked |
| Tested browser runtime errors | None observed |

The final source was checked again after correcting a syntax issue in the reference formatter. The project now uses tools/format.mjs with TypeScript's printer.

## Rule cases
The test runner verifies full personal totals, attendee-only optional charges, five-person shared cost, unknown prices, unsupported origins, incomplete briefs, incompatible dates, star limits, ceilings, pending responses, stale readiness, fresh publication, private reasons, decline without silent removal, organiser capabilities, explicit agreement, ballot edits, invalid voters, infeasible options, tie rules, all-abstain outcomes, stale polls, access requirements, versioned booking reports, assigned owners and postponement.

## Browser cases
See [browser-results.json](test-evidence/browser-results.json) for the final machine-readable record. It covers:

- Welcome structure and local asset loading.
- Acknowledgement before readiness.
- Editable fields, one simulated save failure, retry and reload.
- Budget failure after changed input.
- Five-person cost recalculation.
- Changed plan and fresh review version.
- Five of six pending, then explicit agreement.
- Booking report persistence.
- Five comparison categories and generic external provider anchors.
- Six persona ballots closing an item poll and changing the actual complete total.
- New organiser signup simulation, trip creation, and guest entry in another tab without signup.
- No stored password value.
- Mobile scrolling and estimate placement.
- No uncaught browser errors in these journeys.

Source and tests use fictional data. Browser automation uses fresh profiles and does not access the user's existing browser sessions.

## Visual review
Desktop welcome and comparisons, plus mobile welcome, review and private preferences were rendered and inspected. The original Figma coast illustrations and icons are local SVG files, with their exported geometry preserved. Responsive scaling preserves their proportions.

Screenshots and browser result JSON are included in docs/test-evidence for the complete-source import.

## Not established by these tests
- Successful source import or preview inside the user's actual Make project.
- Hosted deployment, public URL, or published pilot.
- Real authentication, secure guest identity, RLS, cross-device persistence or multi-user backend concurrency.
- Live AI inference, audio capture, speech recognition or provider prices.
- Actual third-party availability, checkout, payment or confirmed reservations.
- Human usability validation, full accessibility audit, or testing every browser/device.

The code is prepared for connector import into the new working Make file. Preview startup hooks were updated to use a supervised foreground server, frozen dependency installation and guarded build outputs. This source preparation does not establish hosted preview or deployment success.

