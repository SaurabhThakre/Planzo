import test from "node:test"
import assert from "node:assert/strict"
import {
  sampleTrip,
  cost,
  feasibility,
  included,
  saveBrief,
  briefErrors,
  publish,
  respond,
  currentResponse,
  currentPlan,
  closeRound,
  invalidate,
  openPoll,
  vote,
  closePoll,
  safeSummary,
  chooseDraft,
  defaults,
  reportBooking,
} from "../src/domain.ts"
const organiser = "sample-0",
  naina = "sample-1"
test("the complete fixture includes fees and contingency; optional costs reach attendees only", () => {
  const t = sampleTrip()
  assert.deepEqual(cost(t, naina).total, [8690, 10780])
  assert.deepEqual(cost(t, "sample-2").total, [9570, 11880])
  assert.equal(
    cost(t, naina).rows.some((r) => r.label.includes("boat")),
    false,
  )
  assert.deepEqual(feasibility(t), [])
})
test("a five-person roster shares three rooms and a fixed vehicle; the limit is rechecked", () => {
  const t = sampleTrip()
  t.members[5].included = false
  invalidate(t, "Roster changed.")
  assert.deepEqual(cost(t, naina).total, [9240, 11462])
  assert.ok(feasibility(t).some((x) => x.includes("private ceiling")))
  assert.throws(() => publish(t, organiser))
})
test("an unknown critical quote and unsupported origins block readiness", () => {
  const t = sampleTrip()
  t.unknownPrice = true
  assert.equal(cost(t, naina).complete, false)
  assert.throws(() => respond(t, naina, "ready"))
  t.unknownPrice = false
  t.briefs[naina].origin = "Delhi"
  assert.ok(feasibility(t).some((x) => x.includes("unknown")))
})
test("unconfirmed briefs and incompatible dates cannot become a feasible draft", () => {
  const t = sampleTrip()
  t.briefs[naina].confirmed = false
  assert.throws(() => chooseDraft(t, organiser, defaults, t.windowId))
  t.briefs[naina].confirmed = true
  t.briefs[naina].windows = [t.windows[1].id]
  assert.ok(feasibility(t).some((x) => x.includes("window")))
})
test("star and whole-trip ceiling validation is enforced on confirmed input", () => {
  const t = sampleTrip()
  const b = structuredClone(t.briefs[naina])
  b.stars.Relaxation = 3
  assert.ok(briefErrors(t, b).length)
  assert.throws(() => saveBrief(t, naina, b, true))
  b.stars.Relaxation = 2
  b.ceiling = 0
  assert.throws(() => saveBrief(t, naina, b, true))
})
test("five ready responses and an expired deadline never create agreement", () => {
  const t = sampleTrip()
  t.deadline = "2000-01-01"
  for (const m of t.members.slice(0, 5)) respond(t, m.id, "ready")
  assert.throws(() => closeRound(t, organiser))
  assert.notEqual(t.status, "agreed")
})
test("material changes preserve historical readiness but require a new version and fresh responses", () => {
  const t = sampleTrip()
  for (const m of t.members) respond(t, m.id, "ready")
  invalidate(t, "Stay quote changed.")
  assert.equal(currentPlan(t), false)
  assert.equal(currentResponse(t, naina), undefined)
  assert.throws(() => closeRound(t, organiser))
  assert.throws(() => respond(t, naina, "ready"))
  publish(t, organiser)
  assert.equal(t.plan.version, 2)
  assert.equal(currentResponse(t, naina), undefined)
  respond(t, naina, "ready")
  assert.equal(currentResponse(t, naina).version, 2)
  assert.equal(t.responses.filter((r) => r.version === 1).length, 6)
})
test("decline and private change details do not silently alter the included roster", () => {
  const t = sampleTrip()
  respond(t, naina, "change", "PRIVATE-REASON")
  assert.equal(included(t).length, 6)
  assert.equal(safeSummary(t).includes("PRIVATE-REASON"), false)
  assert.equal(safeSummary(t).includes("11000"), false)
  respond(t, naina, "decline")
  assert.equal(included(t).length, 6)
  assert.throws(() => closeRound(t, organiser))
})
test("only the organiser publishes and closes; all included people must be ready", () => {
  const t = sampleTrip()
  assert.throws(() => publish(t, naina))
  for (const m of t.members) respond(t, m.id, "ready")
  assert.throws(() => closeRound(t, naina))
  closeRound(t, organiser)
  assert.equal(t.status, "agreed")
  assert.ok(t.tasks.length)
  assert.ok(t.tasks.every((x) => x.status === "pending"))
})
test("votes reject strangers and infeasible options; one ballot can be edited", () => {
  const t = sampleTrip()
  openPoll(t, organiser, "travel")
  assert.throws(() => vote(t, "stranger", "travel", "train"))
  vote(t, naina, "travel", "train")
  vote(t, naina, "travel", "coach")
  assert.equal(Object.keys(t.polls.travel.ballots).length, 1)
  assert.equal(t.polls.travel.ballots[naina], "coach")
  assert.throws(() => vote(t, naina, "travel", "bogus"))
  assert.throws(() => closePoll(t, organiser, "travel"))
})
test("a tied poll prefers lower upper shared cost but does not grant readiness", () => {
  const t = sampleTrip()
  openPoll(t, organiser, "travel")
  for (const [i, m] of t.members.entries())
    vote(t, m.id, "travel", i < 3 ? "train" : "coach")
  closePoll(t, organiser, "travel")
  assert.equal(t.selected.travel, "coach")
  assert.equal(currentPlan(t), false)
  assert.equal(t.responses.length, 0)
})
test("all abstentions remain unresolved instead of inventing a winning choice", () => {
  const t = sampleTrip()
  openPoll(t, organiser, "travel")
  for (const m of t.members) vote(t, m.id, "travel", null)
  closePoll(t, organiser, "travel")
  assert.equal(t.polls.travel.status, "unresolved")
  assert.throws(() => publish(t, organiser))
})
test("a relevant input change invalidates an open poll", () => {
  const t = sampleTrip()
  openPoll(t, organiser, "travel")
  saveBrief(t, naina, { ...t.briefs[naina], ceiling: 12000 }, true)
  assert.equal(t.polls.travel.status, "stale")
  assert.throws(() => vote(t, naina, "travel", "train"))
})
test("an unverified step-free stay cannot be voted into feasibility", () => {
  const t = sampleTrip()
  t.briefs[naina].stepFree = true
  assert.ok(
    feasibility(t, { ...defaults, stay: "panaji" }).some((x) =>
      x.includes("requirement"),
    ),
  )
  assert.throws(() => openPoll(t, organiser, "stay"))
})

test("booking reports remain versioned, and another owner cannot report them", () => {
  const t = sampleTrip()
  for (const m of t.members) respond(t, m.id, "ready")
  closeRound(t, organiser)
  const task = t.tasks.find((t) => t.title.startsWith("Stay"))
  assert.throws(() => reportBooking(t, naina, task.id))
  reportBooking(t, organiser, task.id)
  assert.equal(task.reportedVersion, 1)
  assert.equal(task.reportedBy, organiser)
  invalidate(t, "Stay changed.")
  assert.throws(() => reportBooking(t, organiser, task.id))
  publish(t, organiser)
  for (const m of t.members) respond(t, m.id, "ready")
  closeRound(t, organiser)
  const preserved = t.tasks.find((t) => t.id === task.id)
  assert.equal(preserved.reportedVersion, 1)
  assert.notEqual(preserved.reportedVersion, t.plan.version)
  reportBooking(t, organiser, preserved.id)
  assert.equal(preserved.reportedVersion, 2)
})
test("postponing a trip cannot turn historical ready responses into agreement", () => {
  const t = sampleTrip()
  for (const m of t.members) respond(t, m.id, "ready")
  t.status = "postponed"
  assert.throws(() => closeRound(t, organiser))
  assert.throws(() => publish(t, organiser))
  assert.throws(() => respond(t, naina, "ready"))
})
test("an optional boat cannot bypass an unverified step-free requirement", () => {
  const t = sampleTrip()
  t.briefs[naina].boat = true
  t.briefs[naina].stepFree = true
  assert.ok(feasibility(t).some((x) => x.includes("requirement")))
})
