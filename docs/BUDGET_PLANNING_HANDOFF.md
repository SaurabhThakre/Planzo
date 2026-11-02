# Budget-aware route planning — 20 October 2026

Status: installed in existing Make 4tPr5AkQO1g0L1esRvGRjz and Trip Pact ewysgpuwvufbklesdhuj. Local and read-only database checks pass. A successful new live generation is NOT verified: the final Gemini response omitted a second meal on day 3 and was correctly rejected. Read backend/BUDGET_VERIFICATION.json and backend/BUDGET_SOURCE_READBACK.json. The prior Edge v30 successful route/lock checkpoint remains historical evidence, not proof of this patch.

## What changed

The reported error means that the proposed meals, nightly bases and travel still exceeded an included person's private ceiling after visits were removed. That does not prove that no cheaper real trip exists. Gemini previously had no opportunity to supply a different affordable meal or lodging arrangement after the database rejected its proposal.

The active version8 provider contract requests practical economical primary arrangements and same-area, same-time economy alternatives for meals and overnight bases in the SAME Gemini response. Alternatives have their own concrete arrangements, positive INR ranges, assumptions and compatibility explanations. Planzo retains the model's prices; it does not scale them down or invent discounts.

The server first attempts the complete primary plan. Only the exact essential-budget rejection permits a second database check using compatible, strictly cheaper alternatives. Both checks use the same receipt and input stamp. There is still ONE provider request per user action and no automatic provider retry. A failed first database transaction does not consume the receipt or insert a partial plan. An authorisation/stale-input/other error cannot trigger fallback. If no compatible option fits, no plan is saved and the user gets a clear budget explanation. Budgets are never increased automatically.

Only meal/stay title, description and price can change in the economy variant. Source mappings, locations, travel, activities and sleep remain. Incompatible or uncertain options are ignored. Compatibility is a Gemini assessment, not a deterministic proof of every dietary, room, access or other semantic requirement. Personal exact-version review and exclusion acknowledgement remain necessary.

Private origins, exact ceilings, raw must-have/flexible paragraphs and a derived spending target never enter the planning provider request. Its whitelist remains destination, traveller count, shared absolute arrival/departure, available hours, estimate date and reviewed shareable reference IDs/titles/types/priorities. Supabase performs affordability checks privately, including 10% contingency. Estimates remain unverified model estimates; Phase 2 still owns actual booking options and quotes.

The live attempts also exposed small transport-duration mismatches. The compiler now extends model-authored journeys up to the conservative distance minimum when the shortfall is at most30 minutes, discloses the added time, and recalculates the timetable. It never shortens a journey, changes its mode/place/source/price, adds an invented route, or accepts a larger shortfall. All departure, daily coverage and sleep checks still apply. Tests cover2,15,30-minute additions and rejection beyond30.

## Verification

- 209 application tests pass; typecheck and production build pass. No dependencies changed. Existing bundle-size advisory remains.
- 25 budget-specific tests cover primary fit, same-receipt economy fallback, impossible budgets, malformed/free/incompatible alternatives, preserved model output and timed/source mappings, and no fallback on401/403/409.
- Three new READ-ONLY hosted route_document calls used synthetic fixture data. A standard proposal was rejected above a fictional private cap; its economy alternative saved no rows but validated62 steps at621500paise against the same646250paise cap; a100paise cap still rejected. No migration or DDL ran.
- Planning Edge v33 ACTIVE, verify_jwt=true, eight returned runtime files exactly match the prepared deployment. Interpreter and auth configuration are unchanged.
- Two new files and seven other changed paths are synchronized to Make. Eleven guarded/readback operations cover nine unique paths; the last manifest record is current. Manifests contain59 application,87 backend,2 fixture entries and142 distinct runtime paths.
- All30 pre-existing trips,28 plans,43 input versions,12 locks,18 reviews,8 polls and11 ballots match the baseline. Trip,plan,input-version fingerprints match exactly, including actual user trip4dd3bd1f-288c-49b7-8aae-b745997a9a51. route_document remains MD5 02cffd15760a81b0d7f81e34b48fc4ce. No actual user trip was regenerated.

## Labelled live fixture and limits

Only new fixture cc715a95-1a53-450f-974c-de382f67c778, TEST · Economy planning 2026-10-20, was written through the ordinary signed-in UI. It has seven Japan destination days, one member and explicitly fictional inputs. Four deliberate provider requests were observed, each from a separate test action:
1. v31:20-minute transport needed22; no save.
2. v32:primary and available economy options could not pass the fictional INR90000 ceiling; honest budget failure, no save.
3. After reopening ONLY this fixture and changing its fictional ceiling toINR200000, v32:5-minute journey needed20; no save.
4. v33:day3 had three visits but only one meal; no save.

Final fixture metadata:0 plans,4 generation admissions,0 used receipts,2 immutable input versions,1 confirmed input. Admissions are not generally a provider-call counter; four provider requests were observed in this bounded run. The user’s actual budget was neither read out nor changed. No further calls are needed merely to repeat these failures. Screenshot backend/budget-planning-fixture.jpg shows the labelled fixture overview, not a successful itinerary.

The economy fallback has local handler and real read-only database evidence. Do NOT claim a successful live economy selection or a complete new live saved itinerary. Gemini completeness remains a separate unresolved issue; investigate a stronger daily-meal/output structure using local fixtures before another reasoned live check. Keep the human-used trip unchanged.

## Continuation

Do not reapply frozen route/pricing migrations or repeat the passed checks without a new reason. Preserve the prior v30 route evidence and all immutable history. Future work should address missing daily meals and model-output reliability, then verify one successful ordinary-account save on the existing labelled fixture. Do not raise any real budget to force a pass, bypass coverage checks, silently discard must-haves, expose private ceilings, buy credits or publish.
