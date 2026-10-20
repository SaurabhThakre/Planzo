import { useEffect, useState } from "react";
import type { Trip } from "./domain";
import { closeRound, cost, currentPlan, currentResponse, feasibility, included, invalidate, now, option, publish, respond, safeSummary, slots, } from "./domain";
import type { Navigate } from "./entry";
import type { TripAction } from "./planning";
import { Actions, Badge, Button, Card, Coast, Feature, Field, Note, Total, windowText, } from "./ui";
type Props = {
    trip: Trip;
    personId: string;
    act: TripAction;
    go: Navigate;
};
export function Review({ trip, personId, act, go }: Props) {
    const [compact, setCompact] = useState(() => window.matchMedia("(max-width:1150px)").matches);
    useEffect(() => {
        const media = window.matchMedia("(max-width:1150px)");
        const listener = () => setCompact(media.matches);
        media.addEventListener("change", listener);
        return () => media.removeEventListener("change", listener);
    }, []);
    const [ack, setAck] = useState(false), [mode, setMode] = useState<"change" | "decline" | null>(null), [reason, setReason] = useState("");
    const current = currentPlan(trip);
    const plan = trip.plan;
    const issues = feasibility(trip);
    const organiser = trip.members.find((m) => m.id === personId)?.role === "organiser";
    const roster = current ? plan!.roster : included(trip).map((m) => m.id);
    const choice = current ? plan!.choices : trip.selected;
    const quote = cost(trip, personId, choice, roster);
    const response = currentResponse(trip, personId);
    function send(status: "ready" | "change" | "decline") {
        if (act((t) => respond(t, personId, status, reason), "Your " + status + " response was saved to this plan version.")) {
            setMode(null);
            go("outcome");
        }
    }
    return (<div className="columns">
      <Card title={current
            ? "Current published plan · v" + plan!.version
            : "Working draft · fresh validation required"} sub="Your response belongs to these exact terms.">
        {!current && (<Note title={plan
                ? "Your earlier response is historical"
                : "This draft is not yet published"} tone="peach" icon="edit">
            {plan
                ? "A material term changed after v" +
                    plan.version +
                    ". Revalidate and publish a new version before anyone responds."
                : "The organiser publishes the validated plan before individual readiness."}
          </Note>)}
        {issues.length > 0 && (<Note title="A hard check needs attention" tone="peach">
            {issues.join(" ")}
          </Note>)}
        <Feature icon="calendar" title={windowText(trip, current ? plan!.windowId : trip.windowId)}>
          Departure and return boundaries · Asia/Kolkata ·{" "}
          <button className="text-button" onClick={() => go("itinerary")}>
            view the full itinerary
          </button>
        </Feature>
        <Feature icon="people" title={"Included roster · " + roster.length + " travellers"}>
          {roster
            .map((id) => trip.members.find((m) => m.id === id)?.name)
            .join(", ")}
        </Feature>
        <Feature icon="bed" title={option("stay", choice.stay).title}>
          {Math.ceil(roster.length / 2)} twin rooms · two nights.{" "}
          {option("activity", choice.activity).title} is in the shared plan.
        </Feature>
        <Feature icon="boat" title={"Your optional choice · " +
            (trip.briefs[personId]?.boat ? "boat activity" : "quiet beach")}>
          Only selected attendees pay for the boat add-on. Everyone meets again
          for dinner.
        </Feature>
        {compact && (<div className="inline-total">
            <Total value={quote.total} complete={quote.complete}/>
            <Button variant="secondary" onClick={() => go("costs")}>
              Open cost breakdown
            </Button>
          </div>)}
        {response && (<Note title={"Your current response: " +
                (response.status === "ready"
                    ? "Ready to book"
                    : response.status === "change"
                        ? "Needs a change"
                        : "Not joining")}>
            Recorded for v{response.version}.{" "}
            {response.privateReason && (<span>Your private reason: {response.privateReason}</span>)}
          </Note>)}
        {!current && (<Button disabled={!organiser || !!issues.length} onClick={() => {
                if (act((t) => publish(t, personId), "Fresh plan version published."))
                    setAck(false);
            }}>
            Revalidate & publish a fresh version
          </Button>)}
        <label className="check-line">
          <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} disabled={!current}/>
          <span>
            I reviewed the dates, included people, itinerary and complete
            personal estimate.
            <small>
              Ready is a nonbinding intention. It does not reserve or pay for
              travel.
            </small>
          </span>
        </label>
        <Actions>
          <Button disabled={!current ||
            !!issues.length ||
            !ack ||
            !roster.includes(personId) ||
            trip.status === "postponed"} onClick={() => send("ready")}>
            Ready to book this plan
          </Button>
        </Actions>
        <Actions>
          <Button variant="secondary" disabled={!current ||
            !roster.includes(personId) ||
            trip.status === "postponed"} onClick={() => setMode("change")}>
            Needs a change
          </Button>
          <Button variant="secondary" disabled={!current ||
            !roster.includes(personId) ||
            trip.status === "postponed"} onClick={() => setMode("decline")}>
            Not joining
          </Button>
          <Button variant="ghost" onClick={() => go("itinerary")}>
            View itinerary
          </Button>
        </Actions>
        {mode === "change" && (<div className="inline-panel">
            <h3>What needs attention?</h3>
            <Field label="Private change detail · optional">
              <textarea rows={3} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="What would need to change for this trip to work for you?"/>
            </Field>
            <p className="small muted">
              The group sees Needs a change. Your detail stays in your own demo
              view.
            </p>
            <Actions>
              <Button onClick={() => send("change")}>
                Save change request
              </Button>
              <Button variant="ghost" onClick={() => setMode(null)}>
                Cancel
              </Button>
            </Actions>
          </div>)}
        {mode === "decline" && (<div className="inline-panel">
            <h3>It's okay to sit this one out.</h3>
            <p>
              No penalty and no explanation required. Your decision will not
              silently remove you from the roster; the organiser can propose and
              reprice a smaller group.
            </p>
            <Actions>
              <Button onClick={() => send("decline")}>
                Confirm I'm not joining
              </Button>
              <Button variant="secondary" onClick={() => setMode(null)}>
                Keep reviewing
              </Button>
            </Actions>
          </div>)}
      </Card>
      <aside className="review-aside">
        {!compact && (<Card className="review-total" title="Your personal total" tone="mint">
            <Total value={quote.total} complete={quote.complete}/>
            <Button variant="secondary" onClick={() => go("costs")}>
              Open cost breakdown
            </Button>
          </Card>)}
        <Card title="A clear choice">
          <p className="muted">
            A change or decline is equally valid. Friends see your response
            status, not your private reasons.
          </p>
          <p className="caption muted">
            {plan
            ? "Published " + new Date(plan.at).toLocaleString("en-IN")
            : "Awaiting publication"}{" "}
            · provider estimates remain illustrative.
          </p>
        </Card>
      </aside>
    </div>);
}
export function Outcomes({ trip, personId, act, go }: Props) {
    const organiser = trip.members.find((m) => m.id === personId)?.role === "organiser";
    const group = included(trip);
    const ready = group.filter((m) => currentResponse(trip, m.id)?.status === "ready").length;
    const all = currentPlan(trip) && group.length > 0 && ready === group.length;
    const isPostponed = trip.status === "postponed";
    const agreed = trip.status === "agreed" && currentPlan(trip);
    return (<div className="columns">
      <Card title={isPostponed
            ? "Decision recorded · postponed"
            : agreed
                ? "Itinerary agreed · bookings pending"
                : ready + " of " + group.length + " current responses ready"} sub={trip.plan
            ? "Responses apply to Plan v" +
                trip.plan.version +
                " and its included roster."
            : "Publish a plan to request individual responses."}>
        {isPostponed ? (<>
            <Coast variant="large"/>
            <p>
              No one needs to force a yes. The decision history stays available,
              and a future trip can start fresh.
            </p>
            <Button onClick={() => go("setup", "new")}>
              Create another trip
            </Button>
          </>) : (<>
            {group.map((m) => {
                const r = currentResponse(trip, m.id);
                return (<div className="member-row" key={m.id}>
                  <span className="avatar">{m.name[0]}</span>
                  <div>
                    <strong>
                      {m.name}
                      {m.role === "organiser" ? " · Organiser" : ""}
                    </strong>
                    <small>
                      {trip.briefs[m.id]?.confirmed
                        ? "Private input confirmed"
                        : "Input incomplete"}
                    </small>
                  </div>
                  <Badge tone={r?.status === "ready"
                        ? "positive"
                        : r?.status === "change" || r?.status === "decline"
                            ? "alert"
                            : "pending"}>
                    {!currentPlan(trip)
                        ? "Fresh review needed"
                        : r?.status === "ready"
                            ? "Ready to book"
                            : r?.status === "change"
                                ? "Needs a change"
                                : r?.status === "decline"
                                    ? "Not joining"
                                    : "Response pending"}
                  </Badge>
                </div>);
            })}
            <Note title={agreed
                ? "A shared reference, not a reservation"
                : all
                    ? "Every included traveller is ready"
                    : "Silence is still pending"} tone={agreed || all ? "mint" : "peach"}>
              {agreed
                ? "Each booking still needs an owner and provider confirmation."
                : all
                    ? "The organiser can close this decision round after checking the current terms."
                    : "A majority or an expired deadline does not create approval or remove a traveller."}
            </Note>
            <Actions>
              {agreed ? (<Button onClick={() => go("bookings")}>
                  Prepare booking handoff
                </Button>) : (<Button disabled={!organiser || !all} onClick={() => act((t) => closeRound(t, personId), "Plan agreed. Booking tasks have been created.")}>
                  Close this decision round
                </Button>)}
              <Button variant="secondary" onClick={() => go("review")}>
                Review my response
              </Button>
            </Actions>
            {organiser && !agreed && (<Actions>
                <Button variant="secondary" onClick={() => go("setup", "edit")}>
                  Extend deadline
                </Button>
                <Button variant="secondary" onClick={() => go("builder")}>
                  Revise plan
                </Button>
                <Button variant="ghost" onClick={() => act((t) => {
                    t.status = "postponed";
                    t.history.unshift({
                        at: now(),
                        message: "The organiser recorded a postponed outcome. No penalty or automatic exclusion.",
                    });
                }, "Trip postponed without penalty.")}>
                  Postpone trip
                </Button>
              </Actions>)}
          </>)}
      </Card>
      <aside>
        <Card title="Planzo Passport" tone={isPostponed ? "peach" : "mint"}>
          {[
            [
                "Inputs received",
                group.length > 0 &&
                    group.every((m) => trip.briefs[m.id]?.confirmed),
            ],
            ["Feasible options", !feasibility(trip).length],
            [
                "Choices resolved",
                !Object.values(trip.polls).some((p) => p?.status === "open" || p?.status === "unresolved") && !feasibility(trip).length,
            ],
            ["Decision recorded", agreed || isPostponed],
            ["Booking handoff prepared", agreed && trip.tasks.length > 0],
        ].map(([label, done]) => (<Feature key={String(label)} icon={done ? "check" : "calendar"} title={String(label)}>
              {done ? "Complete" : "Pending"}
            </Feature>))}
        </Card>
        {trip.sample && organiser && !isPostponed && !agreed && (<Card title="Demo helper">
            <p className="small muted">
              Fill only pending sample responses. Existing changes or declines
              remain as chosen.
            </p>
            <Button variant="secondary" disabled={!currentPlan(trip) || !!feasibility(trip).length} onClick={() => act((t) => {
                for (const m of included(t))
                    if (!currentResponse(t, m.id))
                        respond(t, m.id, "ready");
            }, "Pending sample responses filled.")}>
              Fill pending sample readiness
            </Button>
          </Card>)}
        <Button variant="secondary" onClick={() => go("history")}>
          View safe decision history
        </Button>
      </aside>
    </div>);
}
export function History({ trip }: {
    trip: Trip;
}) {
    const [copied, setCopied] = useState(false), [error, setError] = useState("");
    async function copy() {
        try {
            await navigator.clipboard.writeText(safeSummary(trip));
            setCopied(true);
        }
        catch {
            setError("Clipboard access is unavailable. Select the summary text below to copy it.");
        }
    }
    return (<div className="columns">
      <Card title="Current plan summary" sub="Safe shared content: no private ceilings or change details.">
        <pre className="summary">{safeSummary(trip)}</pre>
        <Button onClick={copy}>
          {copied ? "Summary copied" : "Copy current summary"}
        </Button>
        {error && (<p role="alert" className="small">
            {error}
          </p>)}
      </Card>
      <Card title="Decision history">
        {trip.history.map((h, i) => (<div className="history-event" key={h.at + i}>
            <span className="caption muted">
              {new Date(h.at).toLocaleString("en-IN")}
            </span>
            <p>{h.message}</p>
          </div>))}
      </Card>
    </div>);
}
export function changeRoster(trip: Trip, id: string, inRoster: boolean) {
    const member = trip.members.find((m) => m.id === id);
    if (!member)
        throw Error("Member not found.");
    member.included = inRoster;
    invalidate(trip, "The included roster was explicitly changed. Reprice and request fresh responses.");
}
