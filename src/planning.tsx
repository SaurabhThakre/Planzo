import { useEffect, useState } from "react";
import type { Choice, Slot, Trip } from "./domain";
import { chooseDraft, closePoll, concepts, cost, feasibility, included, openPoll, option, options, publish, saveBrief, slotLabels, slots, vote, } from "./domain";
import type { Navigate } from "./entry";
import { Actions, Badge, Button, Card, Coast, Feature, Field, Hero, Note, Total, range, windowText, } from "./ui";
export type TripAction = (fn: (t: Trip) => void, message?: string) => boolean;
type Props = {
    trip: Trip;
    personId: string;
    act: TripAction;
    go: Navigate;
};
export function Plans({ trip, personId, act, go }: Props) {
    const [loading, setLoading] = useState(true), [failed, setFailed] = useState(false), [windowId, setWindowId] = useState(trip.windowId);
    useEffect(() => {
        const timer = setTimeout(() => setLoading(false), 700);
        return () => clearTimeout(timer);
    }, [trip.id]);
    const organiser = trip.members.find((m) => m.id === personId)?.role === "organiser";
    const stars = Object.values(trip.briefs)
        .filter((b) => b.confirmed)
        .reduce<Record<string, number>>((a, b) => {
        for (const k of Object.keys(b.stars))
            a[k] = (a[k] || 0) + b.stars[k];
        return a;
    }, {});
    const fit = (id: string) => id === "slow"
        ? (stars.Relaxation || 0) * 2
        : id === "culture"
            ? (stars.Culture || 0) * 2 + (stars.Food || 0)
            : id === "flex"
                ? (stars.Adventure || 0) + (stars.Beach || 0)
                : (stars.Relaxation || 0) + (stars.Food || 0);
    const ranked = [...concepts].sort((a, b) => fit(b.id) - fit(a.id));
    if (loading || failed)
        return (<div className="columns">
        <Card title={failed
                ? "The draft could not be generated"
                : "Every voice. One shared starting point."}>
          <Coast variant="large"/>
          <Feature title="Availability and ceilings checked">
            Hard constraints come before ranking interests.
          </Feature>
          <Feature icon="people" title="Shared and optional moments separated">
            Only selected attendees pay for optional activities.
          </Feature>
          <Note title={failed
                ? "Your confirmed inputs are safe"
                : "Sample drafting in progress"} icon="edit">
            {failed
                ? "Retry the local demo; no model request or user input was lost."
                : "This is a rule-based local preview. A live AI service is not connected."}
          </Note>
          {failed ? (<Button onClick={() => {
                    setFailed(false);
                    setLoading(false);
                }}>
              Retry sample generation
            </Button>) : (<Button variant="secondary" onClick={() => {
                    setLoading(false);
                    setFailed(true);
                }}>
              Preview generation failure
            </Button>)}
        </Card>
      </div>);
    return (<div className="stack">
      <Field label="Proposed travel window">
        <select value={windowId} onChange={(e) => setWindowId(e.target.value)}>
          {trip.windows.map((w) => (<option key={w.id} value={w.id}>
              {windowText(trip, w.id)}
            </option>))}
        </select>
      </Field>
      <div className="cards-grid">
        {ranked.map((c, i) => {
            const issues = feasibility(trip, c.choices, windowId);
            const quote = cost(trip, personId, c.choices);
            return (<Card key={c.id} title={c.title}>
              <div className="concept-tag">
                <Feature icon={c.icon} title={c.tag}/>
                <Badge tone={issues.length ? "alert" : "positive"}>
                  {issues.length
                    ? "Needs a rethink"
                    : i === 0
                        ? "Closest soft fit"
                        : "Feasible sample"}
                </Badge>
              </div>
              <p className="muted">{c.description}</p>
              <p className="price-line">
                {quote.complete
                    ? range(quote.total)
                    : "Complete quote unavailable"}{" "}
                per person
              </p>
              <p className="small muted">
                Includes selected shared costs, your optional choice, fees and
                10% contingency.
              </p>
              {issues.length > 0 ? (<Note title="A hard check needs attention" tone="peach">
                  {issues.join(" ")}
                </Note>) : (<Feature title="All included inputs respected">
                  Availability, complete cost and supported requirements checked
                  in this demo.
                </Feature>)}
              <Button disabled={!!issues.length || !organiser} onClick={() => {
                    if (act((t) => chooseDraft(t, personId, c.choices, windowId), "Working draft selected."))
                        go("builder");
                }}>
                Explore this draft
              </Button>
            </Card>);
        })}
      </div>
      {!organiser && (<Note title="You can influence the plan">
          The organiser chooses and publishes the working draft. You can vote on
          open item polls and respond for yourself.
        </Note>)}
      <Note title="Where these suggestions came from" icon="people">
        Concepts are ranked from confirmed interest stars without displaying a
        group score. Missing lunch venues are labelled suggestions. Provider
        prices and inventory are fictional.
      </Note>
      <Actions>
        <Button variant="secondary" onClick={() => go("private")}>
          Review my input
        </Button>
        <Button variant="ghost" onClick={() => go("overview")}>
          Back to workspace
        </Button>
      </Actions>
    </div>);
}
export function Builder({ trip, personId, act, go }: Props) {
    const organiser = trip.members.find((m) => m.id === personId)?.role === "organiser";
    const issues = feasibility(trip);
    const quote = cost(trip, personId);
    return (<div className="stack">
      <Hero trip={trip} title="Your plan, built together." sub={"DRAFT · " +
            included(trip).length +
            " people · " +
            (quote.complete
                ? range(quote.total) + " for you"
                : "A complete quote is still needed")}/>
      <div className="day-strip">
        {[
            ["DAY 1 · Arrive", "Travel → check-in → beach → dinner"],
            ["DAY 2 · Explore", "Breakfast → shared choice → free time"],
            ["DAY 3 · Return", "Slow morning → checkout → home"],
        ].map(([t, d]) => (<Card key={t} title={t} sub={d}/>))}
      </div>
      {issues.length > 0 && (<Note title="Revalidate before publishing" tone="peach">
          {issues.join(" ")}
        </Note>)}
      <div className="cards-grid">
        {slots.map((s) => (<Card key={s} title={slotLabels[s]}>
            <Feature icon={option(s, trip.selected[s]).icon} title={option(s, trip.selected[s]).title}>
              {option(s, trip.selected[s]).description}
            </Feature>
            <Badge tone={s === "food" ? "pending" : "neutral"}>
              {s === "food"
                ? "AI SUGGESTED · review"
                : "2 catalogue alternatives"}
            </Badge>
            <Button variant="secondary" onClick={() => go("poll", s)}>
              Compare options & vote
            </Button>
          </Card>))}
      </div>
      <Actions>
        <Button disabled={!organiser || !!issues.length} onClick={() => {
            if (act((t) => publish(t, personId), "A new plan version is published for individual review."))
                go("review");
        }}>
          Publish for individual review
        </Button>
        <Button variant="secondary" onClick={() => go("itinerary")}>
          Preview itinerary
        </Button>
        <Button variant="ghost" onClick={() => go("plans")}>
          Compare four drafts
        </Button>
      </Actions>
      <p className="caption muted">
        Only the organiser can publish. Votes never count as individual
        readiness.
      </p>
    </div>);
}
export function PollView({ trip, personId, slot, act, go, }: Props & {
    slot: Slot;
}) {
    const poll = trip.polls[slot], organiser = trip.members.find((m) => m.id === personId)?.role === "organiser";
    const current = poll?.revision === trip.revision;
    const open = poll?.status === "open" && current && Date.now() < poll.deadline;
    const eligible = included(trip).some((m) => m.id === personId);
    return (<div className="columns">
      <Card title={"One shared choice · " + slotLabels[slot]} sub="The complete trip cost is rechecked for every alternative.">
        <Badge tone={open ? "pending" : "neutral"}>
          {open
            ? "Open item poll"
            : poll?.status === "stale" || (!current && poll)
                ? "Historical poll"
                : poll?.status === "closed"
                    ? "Poll closed"
                    : poll?.status === "unresolved"
                        ? "Tie remains unresolved"
                        : "Compare alternatives"}
        </Badge>
        {poll && (<p className="small muted">
            Closes {new Date(poll.deadline).toLocaleString("en-IN")} ·{" "}
            {included(trip).length} eligible travellers
          </p>)}
        {options[slot].map((o) => {
            const choice: Choice = { ...trip.selected, [slot]: o.id };
            const issues = feasibility(trip, choice);
            const quote = cost(trip, personId, choice);
            return (<div className="vote-option" key={o.id}>
              <Feature icon={o.icon} title={o.title}>
                {o.description}
              </Feature>
              <p className="small">
                <strong>{range(o.range)}</strong> item allowance · your complete
                total{" "}
                <strong>
                  {quote.complete ? range(quote.total) : "incomplete"}
                </strong>
              </p>
              {o.ai && (<Badge tone="pending">
                  AI suggested · verify with the group
                </Badge>)}
              {!!issues.length && (<p className="small form-error">{issues.join(" ")}</p>)}
              <Button variant={poll?.ballots[personId] === o.id ? "primary" : "secondary"} disabled={!open || !eligible || !!issues.length} onClick={() => act((t) => vote(t, personId, slot, o.id), "Your item ballot is saved. It is not readiness.")}>
                {poll?.ballots[personId] === o.id
                    ? "Your current vote"
                    : "Vote for this option"}
              </Button>
              {poll?.status === "closed" && (<p className="small muted">
                  {Object.values(poll.ballots).filter((v) => v === o.id).length}{" "}
                  votes {poll.winner === o.id ? "· selected result" : ""}
                </p>)}
            </div>);
        })}
        <p className="small muted">
          Live totals stay hidden. Edit one ballot until closure, abstain, or
          ask to revisit the options through your private brief.
        </p>
        <Actions>
          {open ? (<Button variant="secondary" disabled={!eligible} onClick={() => act((t) => vote(t, personId, slot, null), "Abstention saved. It does not confirm readiness.")}>
              Abstain
            </Button>) : (<Button disabled={!organiser} onClick={() => act((t) => openPoll(t, personId, slot), "Item poll opened.")}>
              Open a fresh item poll
            </Button>)}
          {poll?.status === "open" && (<Button disabled={!organiser} onClick={() => act((t) => closePoll(t, personId, slot), "Poll closure checked. Review the outcome below.")}>
              Close poll
            </Button>)}
          <Button variant="ghost" onClick={() => go("builder")}>
            Back to day choices
          </Button>
        </Actions>
        {poll?.status === "unresolved" && (<Note title="No valid tie-break result" tone="peach">
            Equal top votes with equal upper costs, or all abstentions, leave
            the issue unresolved. Open a fresh poll or propose different
            alternatives.
          </Note>)}
      </Card>
      <aside>
        <Card title="A vote is a preference" tone="mint">
          <Feature icon="people" title="Everyone has an equal voice">
            Only included travellers are eligible.
          </Feature>
          <Feature icon="wallet" title="Tie rule announced">
            For a tie, the lower upper shared cost wins. Equal cost stays
            unresolved.
          </Feature>
          <Feature title="Readiness comes later">
            Each person responds to the exact published version.
          </Feature>
        </Card>
        {trip.sample && organiser && open && (<Card title="Demo helper">
            <p className="small muted">
              Simulate the other sample travellers' ballots to test closure in
              one browser.
            </p>
            <Button variant="secondary" onClick={() => act((t) => {
                for (const m of included(t))
                    if (!(m.id in t.polls[slot]!.ballots))
                        vote(t, m.id, slot, t.selected[slot]);
            }, "Remaining sample ballots added.")}>
              Fill remaining sample ballots
            </Button>
          </Card>)}
      </aside>
    </div>);
}
export function Itinerary({ trip, personId, go, }: {
    trip: Trip;
    personId: string;
    go: Navigate;
}) {
    const selected = trip.plan?.revision === trip.revision ? trip.plan.choices : trip.selected;
    return (<div className="columns">
      <Card title={(trip.plan && trip.plan.revision === trip.revision
            ? "Plan v" + trip.plan.version
            : "Working draft") +
            " · " +
            trip.destination} sub={windowText(trip) +
            " · " +
            included(trip).length +
            " included travellers · sample timings"}>
        {[
            [
                "DAY 1",
                "Arrive, settle in, exhale.",
                "06:00 departure · " +
                    option("travel", selected.travel).title +
                    " · check-in · nearby beach · group dinner",
            ],
            [
                "DAY 2",
                "A little culture. A little freedom.",
                "Breakfast · " +
                    option("activity", selected.activity).title +
                    " · " +
                    option("food", selected.food).title +
                    " · optional afternoon · reunion dinner",
            ],
            [
                "DAY 3",
                "One last slow morning.",
                "Breakfast · free time · checkout · return travel · home by 22:00",
            ],
        ].map(([day, t, d]) => (<div className="itinerary-day" key={day}>
            <Badge>{day}</Badge>
            <h3>{t}</h3>
            <p className="muted small">{d}</p>
          </div>))}
        <Actions>
          <Button onClick={() => go("review")}>Review and respond</Button>
          <Button variant="secondary" onClick={() => go("builder")}>
            Vote on each step
          </Button>
        </Actions>
        <p className="caption muted">
          Times are illustrative. Verify actual transport times before booking.
        </p>
      </Card>
      <aside>
        <Card title="Your optional afternoon" tone="mint">
          <Feature icon="boat" title="Boat activity">
            Selected attendees only · ₹880–1,100 extra including contingency.
          </Feature>
          <p className="small muted">
            Non-attendees have quiet beach or café time, then meet for the
            shared dinner.
          </p>
          <Button variant="secondary" onClick={() => go("optional")}>
            Review optional choices
          </Button>
        </Card>
        <Card title="Your full estimate">
          <Total {...quoteProps(trip, personId)}/>
          <Button variant="secondary" onClick={() => go("costs")}>
            Open cost breakdown
          </Button>
        </Card>
      </aside>
    </div>);
}
const quoteProps = (trip: Trip, id: string) => {
    const c = cost(trip, id);
    return { value: c.total, complete: c.complete };
};
export function Costs({ trip, personId, go, }: {
    trip: Trip;
    personId: string;
    go: Navigate;
}) {
    const quote = cost(trip, personId);
    return (<div className="columns">
      <Card title="Your full personal estimate" sub={trip.members.find((m) => m.id === personId)?.name +
            " · " +
            (trip.plan ? "Plan v" + trip.plan.version : "Working draft") +
            " · " +
            included(trip).length +
            " travellers"}>
        {quote.rows.map((row) => (<div className="cost-row" key={row.label}>
            <span>{row.label}</span>
            <strong>{range(row.range)}</strong>
          </div>))}
        <hr />
        <Total value={quote.total} complete={quote.complete}/>
        <Note title={quote.complete &&
            quote.total[1] <= (trip.briefs[personId]?.ceiling || 0)
            ? "Within your private ceiling"
            : "A complete, affordable total is required"} tone={quote.complete &&
            quote.total[1] <= (trip.briefs[personId]?.ceiling || 0)
            ? "mint"
            : "peach"}>
          Your own ceiling is{" "}
          {trip.briefs[personId]?.ceiling
            ? "₹" + trip.briefs[personId].ceiling.toLocaleString("en-IN")
            : "not confirmed"}
          .{" "}
          {quote.complete
            ? "Compare the upper estimate before readiness."
            : "Unknown critical prices are not zero."}
        </Note>
        <Actions>
          <Button onClick={() => go("review")}>Review this plan</Button>
          <Button variant="secondary" onClick={() => go("itinerary")}>
            Back to itinerary
          </Button>
        </Actions>
      </Card>
      <aside>
        <Card title="What this includes" tone="mint">
          <Feature icon="plane" title="Departure to return">
            Origin travel is included for the Bengaluru sample.
          </Feature>
          <Feature icon="wallet" title="10% contingency">
            Applied after your selected costs and fees.
          </Feature>
          <Feature icon="boat" title="Optional attendance">
            Only selected attendees carry the add-on.
          </Feature>
          <p className="caption muted">
            Illustrative fixture · 14 October 2026. Three twin rooms and one
            local vehicle are shared; changed headcount triggers recalculation.
          </p>
        </Card>
      </aside>
    </div>);
}
export function OptionalActivity({ trip, personId, act, go }: Props) {
    const current = trip.briefs[personId];
    if (!current)
        return (<Card title="Confirm your brief first">
        <Button onClick={() => go("private")}>Open my private input</Button>
      </Card>);
    const preview = structuredClone(trip);
    preview.briefs[personId].boat = true;
    const paid = cost(preview, personId), free = structuredClone(trip);
    free.briefs[personId].boat = false;
    const freeQuote = cost(free, personId);
    const over = paid.total[1] > current.ceiling || !paid.complete || current.stepFree;
    const choose = (boat: boolean) => {
        if (act((t) => saveBrief(t, personId, { ...t.briefs[personId], boat }, true), "Optional choice saved. Material changes need revalidation."))
            go("review");
    };
    return (<div className="columns">
      <Card title="Your afternoon, your choice" sub="A shared dinner stays in the plan, whichever option you choose.">
        <Feature icon="boat" title="Boat activity · selected attendees only">
          ₹800–1,000 activity cost, plus 10% contingency.
        </Feature>
        <p className="price-line">
          Your whole trip with boat: {range(paid.total)}
        </p>
        {over && (<Note title="This add-on does not fit your current inputs" tone="peach">
            {current.stepFree
                ? "Step-free access for this sample boat is not verified."
                : "The upper complete estimate exceeds your private ceiling of ₹" +
                    current.ceiling.toLocaleString("en-IN") +
                    "."}
          </Note>)}
        <Button disabled={over} onClick={() => choose(true)}>
          {current.boat ? "Keep boat choice" : "Choose boat activity"}
        </Button>
        <hr />
        <Feature icon="sun" title="Quiet beach or café time">
          ₹0 extra activity charge. Meals remain in the food allowance.
        </Feature>
        <p className="small">
          Your whole trip without boat:{" "}
          <strong>{range(freeQuote.total)}</strong>
        </p>
        <Button variant="secondary" onClick={() => choose(false)}>
          Choose quiet afternoon
        </Button>
        <Button variant="ghost" onClick={() => go("itinerary")}>
          Back to itinerary
        </Button>
      </Card>
      <aside>
        <Card title="Room for different interests" tone="mint">
          <Coast />
          <p>
            No one has to join the add-on. Only selected attendees pay its cost.
          </p>
        </Card>
      </aside>
    </div>);
}
