import {test} from'node:test';import assert from'node:assert/strict';import{compactTripDates}from'../src/tripDates.ts';
test('compact trip dates preserve start and end times in IST',()=>{const x=compactTripDates('2026-12-11T00:30:00Z','2026-12-14T16:30:00Z');assert.equal(x.dates,'11–14 Dec 2026');assert.match(x.times,/6:00 am → 10:00 pm/);assert.match(x.full,/11 Dec 2026, 6:00 am → 14 Dec 2026, 10:00 pm IST/);});
test('month and year boundaries remain explicit',()=>{assert.equal(compactTripDates('2026-12-31T18:00:00Z','2027-01-02T18:00:00Z').dates,'31 Dec 2026–2 Jan 2027');assert.equal(compactTripDates('2026-11-30T12:00Z','2026-12-02T12:00Z').dates,'30 Nov–2 Dec 2026');});
test('same-day windows and UTC dates crossing local midnight retain their local date',()=>{assert.equal(compactTripDates('2026-12-10T20:00Z','2026-12-11T12:00Z').dates,'11 Dec 2026');});
test('invalid dates have a clear fallback',()=>{assert.equal(compactTripDates('bad','bad').dates,'Dates pending');});
