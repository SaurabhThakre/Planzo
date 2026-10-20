import { useState } from "react";
import type { Trip } from "./domain";
import { cost, currentPlan, option, reportBooking } from "./domain";
import type { Navigate } from "./entry";
import type { TripAction } from "./planning";
import { Actions, Badge, Button, Card, Coast, Feature, Field, Note, Total, money, range, } from "./ui";
type Props = {
    trip: Trip;
    personId: string;
    act: TripAction;
    go: Navigate;
};
const categories = [
    "Return travel",
    "Stay",
    "Local travel",
    "Food",
    "Activities",
];
export function BookingComparison({ trip, personId, go }: Omit<Props, "act">) {
    const [category, setCategory] = useState("Return travel");
    const n = trip.members.filter((m) => m.included).length || 1;
    const stayRange = cost(trip, personId).rows.find((r) => r.label.startsWith("Stay"))!.range;
    const item = category === "Return travel"
        ? option("travel", trip.selected.travel).range
        : category === "Stay"
            ? option("stay", trip.selected.stay).range
            : null;
    const offers: Record<string, {
        provider: string;
        price: string;
        description: string;
        url?: string;
        outside?: boolean;
    }[]> = {
        "Return travel": [
            {
                provider: "Skyscanner · flight search",
                price: "₹8,200 return",
                description: "Flight alone exceeds the current travel allowance. It is outside this draft.",
                url: "https://www.skyscanner.co.in/",
                outside: true,
            },
            {
                provider: "IRCTC · train search",
                price: range(item || [3500, 4200]) + " return allowance",
                description: "Sample train range. Verify live seats, timing and transfer costs. This is a generic search, not a listing.",
                url: "https://www.irctc.co.in/",
            },
        ],
        Stay: [
            {
                provider: "Booking.com · stay search",
                price: money(stayRange[0] * n) + " group allowance",
                description: n +
                    " travellers · " +
                    Math.ceil(n / 2) +
                    " twin rooms · two nights. Sample taxes included; verify live cancellation terms.",
                url: "https://www.booking.com/",
            },
            {
                provider: "MakeMyTrip · hotel search",
                price: money(stayRange[1] * n) + " upper group allowance",
                description: "Same room quantity and trip duration. This is an illustrative comparison, not a live quote.",
                url: "https://www.makemytrip.com/hotels/",
            },
        ],
        "Local travel": [
            {
                provider: "GoaMiles · transfer search",
                price: "₹5,400–6,600 group allowance",
                description: "Sample vehicle for up to six. Verify capacity, itinerary, taxes and total fees.",
                url: "https://www.goamiles.com/",
            },
            {
                provider: "Local operator · written quote",
                price: range([5400 / n, 6600 / n]) + " per person",
                description: "A manual quote needs provider verification before booking.",
            },
        ],
        Food: [
            {
                provider: "Vegetarian-friendly cafés",
                price: "₹1,400–1,700 each / trip",
                description: "Suggested total meal allowance. Check menus, dietary requirements and live prices.",
            },
            {
                provider: "Local thali restaurants",
                price: "₹1,300–1,600 each / trip",
                description: "A lower sample meal allowance. The final whole-trip cost must be revalidated if changed.",
            },
        ],
        Activities: [
            {
                provider: option("activity", trip.selected.activity).title,
                price: range(option("activity", trip.selected.activity).range) + " each",
                description: "Core shared activity allowance. Verify access and actual fees directly.",
            },
            {
                provider: trip.briefs[personId]?.boat
                    ? "Your optional boat activity"
                    : "Quiet beach / café time",
                price: trip.briefs[personId]?.boat
                    ? "₹800–1,000 + 10% contingency"
                    : "₹0 extra activity charge",
                description: "Only selected attendees pay the boat charge. Food remains in the meal allowance.",
            },
        ],
    };
    return (<div className="stack">
      <div className="comparison-tabs" role="group" aria-label="Booking categories">
        {categories.map((c) => (<Button key={c} variant={c === category ? "primary" : "secondary"} onClick={() => setCategory(c)} aria-pressed={c === category}>
            {c}
          </Button>))}
      </div>
      <div className="columns">
        <Card title={category + " · compare example offers"} sub="Fictional comparisons for the current arrangement. Opening a provider keeps booking tasks pending.">
          {offers[category].map((o) => (<div className={"offer " + (o.outside ? "peach" : "cream")} key={o.provider}>
              <h3>{o.provider}</h3>
              <p className="price-line">{o.price}</p>
              <p className="small muted">{o.description}</p>
              <Badge tone={o.outside ? "alert" : "neutral"}>
                {o.outside
                ? "Outside current allowance"
                : "Illustrative · verify with provider"}
              </Badge>
              {o.url ? (<a className="button secondary" href={o.url} target="_blank" rel="noopener noreferrer">
                  Open provider search ↗
                </a>) : (<Button variant="secondary" onClick={() => go("bookings")}>
                  View booking responsibility
                </Button>)}
            </div>))}
          <Actions>
            <Button variant="secondary" onClick={() => go("bookings")}>
              Back to booking handoff
            </Button>
            <Button variant="ghost" onClick={() => go("review")}>
              Report a changed price
            </Button>
          </Actions>
        </Card>
        <aside>
          <Card title="Whole-trip budget still matters" tone="mint">
            <Total value={cost(trip, personId).total} complete={cost(trip, personId).complete}/>
            <p className="muted">
              The cheapest item is not automatically the best plan. Recheck the
              combined cost, timing and requirements before changing anything.
            </p>
          </Card>
          <Card title="External booking only" tone="peach">
            <p className="small">
              No live quotes, checkout, payment or reservation is connected.
              Compare live provider terms before committing to a booking.
            </p>
          </Card>
        </aside>
      </div>
    </div>);
}
export function BookingHandoff({ trip, personId, act, go }: Props) {
    const [taskId, setTaskId] = useState<string | null>(null);
    const organiser = trip.members.find((m) => m.id === personId)?.role === "organiser";
    const valid = trip.status === "agreed" && currentPlan(trip);
    const task = trip.tasks.find((t) => t.id === taskId);
    return (<div className="columns">
      <Card title="Booking responsibilities" sub={(trip.plan ? "Plan v" + trip.plan.version : "Draft") +
            " · external providers own inventory, checkout and reservations."}>
        {!valid && (<Note title="Review the current decision first" tone="peach">
            Booking actions require an agreed, current plan. Existing reported
            bookings are historical after a plan change.
          </Note>)}
        {!trip.tasks.length ? (<Note title="No booking tasks yet">
            Close an agreed decision round to prepare the booking handoff.
          </Note>) : (trip.tasks
            .filter((t) => !t.archived)
            .map((t) => (<div className="booking-row" key={t.id}>
                <Feature icon={t.title.startsWith("Stay")
                ? "bed"
                : t.title.startsWith("Local")
                    ? "people"
                    : "plane"} title={t.title}>
                  {trip.members.find((m) => m.id === t.ownerId)?.name ||
                "Unassigned"}{" "}
                  · due {t.due}
                </Feature>
                <Badge tone={t.status === "reported" &&
                t.reportedVersion === trip.plan?.version &&
                valid
                ? "positive"
                : "pending"}>
                  {t.status === "reported"
                ? t.reportedVersion === trip.plan?.version && valid
                    ? "Booking reported"
                    : "Earlier report · v" + t.reportedVersion
                : "Pending"}
                </Badge>
                <Button variant="secondary" onClick={() => setTaskId(t.id)}>
                  View task
                </Button>
              </div>)))}
        {task && (<div className="inline-panel">
            <h3>{task.title}</h3>
            <p className="small muted">
              Owner:{" "}
              {trip.members.find((m) => m.id === task.ownerId)?.name ||
                "Unassigned"}{" "}
              · due {task.due}
            </p>
            <Note title="Check before booking">
              Compare the live total with the saved allowance, timing and
              cancellation terms. A material change needs fresh plan review.
            </Note>
            {organiser && (<Field label="Assign task owner">
                <select value={task.ownerId} onChange={(e) => act((t) => {
                    t.tasks.find((x) => x.id === task.id)!.ownerId =
                        e.target.value;
                }, "Task owner updated.")}>
                  <option value="">Unassigned · choose an owner</option>
                  {trip.members
                    .filter((m) => m.included)
                    .map((m) => (<option key={m.id} value={m.id}>
                        {m.name}
                      </option>))}
                </select>
              </Field>)}
            {task.status === "reported" && (<Note title={task.reportedVersion === trip.plan?.version && valid
                    ? "Booking reported · self-reported"
                    : "Earlier version's booking report"}>
                {task.reportedAt &&
                    new Date(task.reportedAt).toLocaleString("en-IN")}{" "}
                · Plan v{task.reportedVersion} · reported by{" "}
                {trip.members.find((m) => m.id === task.reportedBy)?.name ||
                    "task owner"}
                . Provider confirmation has not been verified.{" "}
                {task.reportedVersion !== trip.plan?.version &&
                    "Check that the booking still fits the current plan before reporting it again."}
              </Note>)}
            {(task.status !== "reported" ||
                task.reportedVersion !== trip.plan?.version) && (<Button disabled={!valid || task.ownerId !== personId} onClick={() => act((t) => reportBooking(t, personId, task.id), "Booking reported. This is self-reported, not provider verification.")}>
                {task.status === "reported"
                    ? "Report booking still fits this version"
                    : "Mark booking as reported"}
              </Button>)}
            <Button variant="ghost" onClick={() => setTaskId(null)}>
              Close task details
            </Button>
          </div>)}
        <Actions>
          <Button onClick={() => go("compare")}>
            Compare booking providers
          </Button>
          <Button variant="secondary" onClick={() => go("review")}>
            View current plan
          </Button>
        </Actions>
      </Card>
      <aside>
        <Card title="The plan is your reference" tone="mint">
          <Coast />
          <p className="muted">
            Live prices may differ. A shared cost or timing change needs a
            revised plan and fresh responses.
          </p>
        </Card>
      </aside>
    </div>);
}
