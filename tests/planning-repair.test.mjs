import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlanningHandler, FlowGateError } from '../supabase/functions/planzo-planning/handler.ts';
import { scheduleCorrection, correctionDayBudgets } from '../src/planningRepair.ts';
import { compileBudgetPlans } from '../src/budgetPlanning.ts';
import { directPlanFixture } from './day-plan-fixture.mjs';

const payload = { trip_id: '11111111-1111-4111-8111-111111111111', request_id: '22222222-2222-4222-8222-222222222222', expected_revision: 1, expected_stamp: 'a'.repeat(32) };
const request = () => new Request('https://test.invalid', { method: 'POST', headers: { authorization: 'Bearer TEST_TOKEN', 'content-type': 'application/json' }, body: JSON.stringify(payload) });
function fixture() {
  const { ctx, x } = directPlanFixture(); ctx.stamp = payload.expected_stamp;
  return { ctx, x: { ...x, version: 8, economy_options: [] } };
}
const output = x => Response.json({ status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'text', text: JSON.stringify(x) }] }] });
function harness(change, { stillBad = false, quotaOnRepair = false, recheckError } = {}) {
  const { ctx, x } = fixture(), bad = structuredClone(x); change(bad);
  const calls = [], saves = [], checks = [];
  const handler = createPlanningHandler({ key: () => 'TEST_KEY',
    gate: async (_r, action, data) => {
      if (action === 'generate_reserve') return { ...ctx, ceiling_paise: 777777777, origin: 'PRIVATE_CANARY', hard: 'PRIVATE_CANARY' };
      saves.push(data); return { plan: { id: 'TEST_SAVED' } };
    },
    recheck: async (_r, data) => { checks.push(data); if (recheckError) throw recheckError; },
    fetcher: async (_url, options) => {
      calls.push(JSON.parse(options.body));
      if (quotaOnRepair && calls.length === 2) return new Response('', { status: 429 });
      return output(calls.length === 1 || stillBad ? bad : x);
    },
  });
  return { handler, calls, saves, checks, ctx, x, bad };
}
const missingVisit = x => {
  const day = x.days[0], visits = day.programme.filter(s => s.category === 'visit');
  visits[0].sources = [...new Set(visits.flatMap(s => s.sources))];
  visits[0].duration_minutes = 90;
  let meals = 0;
  day.programme = day.programme.filter(s => s.category === 'visit' ? s === visits[0] : s.category !== 'meal' || ++meals > 1);
};
const overflow = x => { const stop = x.days[2].programme.at(-1); stop.period = 'night'; stop.duration_minutes = 300; };

for (const [name, change, diagnostic] of [
  ['one visit and two meals', missingVisit, /day 1 has 1 visit\(s\) and 2 meal\(s\)/],
  ['an evening spilling into the next day', overflow, /spills into the next day on day 3/],
]) test('a bounded correction repairs ' + name + ' before saving', async () => {
  const h = harness(change);
  assert.throws(() => compileBudgetPlans(h.bad, h.ctx), diagnostic);
  assert.equal((await h.handler(request())).status, 200);
  assert.equal(h.calls.length, 2); assert.equal(h.checks.length, 1); assert.equal(h.saves.length, 1);
  const correction = JSON.parse(h.calls[1].input).correction;
  assert.match(correction.diagnostic, diagnostic);
  assert.equal(correction.destination_days.length, 7);
  assert.equal(correction.destination_days[0].minimum_visits, 2);
  assert.equal(correction.destination_days[0].minimum_meals, 2);
  assert.equal(h.calls[1].generation_config.thinking_level, 'low');
  assert.equal(h.saves[0].request_id, payload.request_id);
  for (const sent of h.calls) {
    const text = JSON.stringify(sent); assert(!text.includes('PRIVATE_CANARY')); assert(!text.includes('777777777'));
    assert(!text.includes(payload.trip_id)); assert(!text.includes(payload.request_id));
    assert.equal(sent.store, false); assert.deepEqual(sent.tools, []);
  }
});

test('a second incomplete schedule never saves and never makes a third provider call', async () => {
  const h = harness(missingVisit, { stillBad: true });
  assert.equal((await h.handler(request())).status, 503);
  assert.equal(h.calls.length, 2); assert.equal(h.saves.length, 0);
});
test('quota failure during a correction is returned without another attempt or save', async () => {
  const h = harness(missingVisit, { quotaOnRepair: true });
  assert.equal((await h.handler(request())).status, 429);
  assert.equal(h.calls.length, 2); assert.equal(h.saves.length, 0);
});
test('membership or input changes prevent sending the correction request', async () => {
  const h = harness(missingVisit, { recheckError: new FlowGateError('TEST stale inputs', 409) });
  assert.equal((await h.handler(request())).status, 409);
  assert.equal(h.calls.length, 1); assert.equal(h.saves.length, 0);
});
test('unknown, price and injected diagnostics are never echoed to Gemini', () => {
  for (const message of ['PRIVATE_CANARY', 'The complete itinerary needs correction: PRIVATE_CANARY', 'Gemini did not provide a complete, bounded INR estimate. No plan was saved.']) {
    assert.equal(scheduleCorrection(new Error(message)), null);
  }
});
test('destination-local correction budgets retain partial arrival/departure days', () => {
  const ctx = { start: '2026-12-11T09:30:00Z', end: '2026-12-13T09:30:00Z' };
  const days = correctionDayBudgets({ route: { time_zone: 'Asia/Kolkata' } }, ctx);
  assert.deepEqual(days.map(d => [d.date, d.minimum_visits, d.minimum_meals]), [['2026-12-11', 0, 0], ['2026-12-12', 2, 2], ['2026-12-13', 0, 0]]);
  assert.equal(days[0].available_from, '15:00'); assert.equal(days[2].finish_by, '15:00');
  assert.deepEqual(correctionDayBudgets({ route: { time_zone: 'not-a-zone' } }, ctx), []);
});
