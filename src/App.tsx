import { useEffect, useState } from "react";
import type { Person, Slot, Trip } from "./domain";
import { briefErrors, concepts, cost, currentPlan, currentResponse, feasibility, included, invalidate, makeTrip, now, publish, respond, sampleTrip, uid, } from "./domain";
import { commit, mutateTrip, storageWarning, useStore } from "./store";
import { Account, Join, Setup, Welcome } from "./entry";
import { Preferences } from "./preferences";
import { Builder, Costs, Itinerary, OptionalActivity, Plans, PollView, } from "./planning";
import { changeRoster, History, Outcomes, Review } from "./decisions";
import { BookingComparison, BookingHandoff } from "./bookings";
import { Actions, Badge, Button, Card, Coast, Feature, Hero, Icon, Note, Total, windowText, } from "./ui";
function readRoute() {
    try {
        const [view, arg] = location.hash.replace(/^#\/?/, "").split("/");
        return { view: view || "entry", arg: arg ? decodeURIComponent(arg) : "" };
    }
    catch {
        return { view: "entry", arg: "" };
    }
}
const titles: Record<string, [
    string,
    string
]> = {
    entry: [
        "Make room for everyone.",
        "Plan a trip your whole group can say yes to.",
    ],
    signup: [
        "A shared trip starts with you.",
        "Create your organiser account. Friends can join by invite without signup.",
    ],
    signin: ["Welcome back.", "Return to a demo account saved in this browser."],
    recovery: ["Let's get you back in.", "Account recovery preview."],
    join: [
        "Your friends are planning a trip.",
        "Join with a link and your name. No signup needed.",
    ],
    setup: [
        "A good trip starts here.",
        "Choose the destination and a few possible dates.",
    ],
    created: [
        "Your trip is ready for friends.",
        "Share the invitation in your group chat.",
    ],
    overview: [
        "Your plan, your people.",
        "One clear next step, without chasing every reply.",
    ],
    private: [
        "Tell us what works for you.",
        "Your limits stay private. Your voice stays part of the plan.",
    ],
    plans: [
        "Four ways to find common ground.",
        "Sample concepts use confirmed inputs. Hard limits are checked first.",
    ],
    builder: [
        "Make the itinerary yours, together.",
        "Explore choices within each step, then publish a plan for individual review.",
    ],
    poll: [
        "A fair choice for one step.",
        "Votes shape a draft. They do not confirm readiness.",
    ],
    itinerary: [
        "A few days, well spent.",
        "Shared moments, room for different interests.",
    ],
    costs: [
        "The whole cost, in one place.",
        "See what is included before you say you are ready.",
    ],
    optional: [
        "Your afternoon, your choice.",
        "Optional activities never become a compulsory shared cost.",
    ],
    review: [
        "Does this plan work for you?",
        "Review the dates, people, itinerary and your full cost.",
    ],
    outcome: [
        "Everyone makes their own choice.",
        "Ready, needs a change, or not joining. Silence remains pending.",
    ],
    bookings: [
        "Know who books what.",
        "A clear handoff from an agreed plan to external booking.",
    ],
    compare: [
        "Compare, then book with confidence.",
        "Illustrative third-party offers by itinerary item.",
    ],
    history: [
        "One shared reference.",
        "Current terms and a safe decision history.",
    ],
    scenarios: [
        "Explore the Planzo demo.",
        "Choose a journey or inspect a rule. Each scenario creates a separate sample trip.",
    ],
};
function getSession() {
    try {
        return sessionStorage.getItem("planzo.person") || "";
    }
    catch {
        return "";
    }
}
export default function App() {
    const state = useStore(), [route, setRoute] = useState(readRoute), [personId, setPersonId] = useState(getSession), [notice, setNotice] = useState<{
        text: string;
        error?: boolean;
    } | null>(null), [menu, setMenu] = useState(false), [failSave, setFailSave] = useState(false);
    useEffect(() => {
        const listener = () => {
            setRoute(readRoute());
            setMenu(false);
            window.scrollTo({ top: 0, behavior: "instant" });
        };
        window.addEventListener("hashchange", listener);
        return () => window.removeEventListener("hashchange", listener);
    }, []);
    useEffect(() => {
        document.title = (titles[route.view]?.[0] || "Planzo") + " · Planzo";
    }, [route.view]);
    const go = (view: string, arg = "") => {
        location.hash = "/" + view + (arg ? "/" + encodeURIComponent(arg) : "");
    };
    const setPerson = (id: string) => {
        setPersonId(id);
        try {
            sessionStorage.setItem("planzo.person", id);
        }
        catch { }
    };
    const person = state.people.find((p) => p.id === personId);
    const trip = state.trips.find((t) => t.id === state.activeTripId);
    const member = trip?.members.find((m) => m.id === personId);
    const publicPage = ["entry", "signup", "signin", "recovery", "join", "scenarios"].includes(route.view) || !person;
    const notify = (text: string, error = false) => setNotice({ text, error });
    const act = (fn: (t: Trip) => void, message?: string) => {
        try {
            if (failSave) {
                setFailSave(false);
                throw Error("Simulated save failure. Your current form is preserved. Retry the action to save it.");
            }
            if (!trip)
                throw Error("Open a trip first.");
            mutateTrip(trip.id, fn);
            if (message)
                notify(message);
            return true;
        }
        catch (e) {
            notify(e instanceof Error ? e.message : "That action could not be completed.", true);
            return false;
        }
    };
    const loadSample = (scenario = "review") => {
        const t = sampleTrip();
        t.id = uid();
        t.token = uid().replaceAll("-", "");
        if (scenario === "pending") {
            for (const m of t.members.slice(0, 5))
                respond(t, m.id, "ready");
        }
        if (scenario === "budget") {
            t.briefs["sample-1"].ceiling = 8000;
            invalidate(t, "A private input changed. Check feasibility again.");
        }
        if (scenario === "roster") {
            changeRoster(t, "sample-5", false);
        }
        if (scenario === "changed") {
            for (const m of t.members)
                respond(t, m.id, "ready");
            t.stayDelta = 80;
            invalidate(t, "The stay quote changed. Old readiness is historical.");
        }
        if (scenario === "unknown") {
            t.unknownPrice = true;
            invalidate(t, "A critical quote is no longer verified.");
        }
        if (scenario === "missing") {
            for (const m of t.members.slice(4))
                t.briefs[m.id].confirmed = false;
            invalidate(t, "Not all included briefs are confirmed.");
        }
        if (scenario === "dates") {
            t.briefs["sample-1"].windows = [t.windows[1].id];
            for (const m of t.members.filter((m) => m.id !== "sample-1"))
                t.briefs[m.id].windows = [t.windows[0].id];
            invalidate(t, "There is no common confirmed travel window.");
        }
        commit((s) => {
            s.trips.push(t);
            s.activeTripId = t.id;
            for (const m of t.members)
                if (!s.people.some((p) => p.id === m.id))
                    s.people.push({ id: m.id, name: m.name, email: m.email });
        });
        setPerson(["pending", "missing", "dates"].includes(scenario)
            ? "sample-0"
            : "sample-1");
        go(scenario === "pending"
            ? "outcome"
            : scenario === "missing" ||
                scenario === "dates" ||
                scenario === "budget" ||
                scenario === "unknown"
                ? "plans"
                : scenario === "optional"
                    ? "optional"
                    : scenario === "builder"
                        ? "builder"
                        : "review");
    };
    const enter = (p: Person) => {
        commit((s) => {
            if (!s.people.some((x) => x.id === p.id))
                s.people.push(p);
            const own = s.trips.find((t) => t.members.some((m) => m.id === p.id));
            s.activeTripId = own?.id || null;
        });
        setPerson(p.id);
        go(state.trips.some((t) => t.members.some((m) => m.id === p.id))
            ? "overview"
            : "setup", "new");
    };
    const saveSetup = (details: Partial<Trip>) => {
        if (!person)
            return;
        try {
            if (route.arg === "edit" && trip) {
                if (member?.role !== "organiser")
                    throw Error("Only the organiser can update trip settings.");
                if (act((t) => {
                    const changed = t.destination !== details.destination ||
                        JSON.stringify(t.windows) !== JSON.stringify(details.windows) ||
                        t.minimum !== details.minimum ||
                        t.windowId !== details.windowId;
                    Object.assign(t, details);
                    if (changed) {
                        for (const b of Object.values(t.briefs))
                            b.confirmed = false;
                        invalidate(t, "Trip dates, destination or minimum changed. Everyone must confirm their private brief again.");
                    }
                }, "Trip settings saved."))
                    go("overview");
            }
            else {
                const t = makeTrip(person, details);
                commit((s) => {
                    s.trips.push(t);
                    s.activeTripId = t.id;
                });
                go("created");
                notify("Trip created. Invited friends are not participants until they join.");
            }
        }
        catch (e) {
            notify((e as Error).message, true);
        }
    };
    const onJoin = (name: string, t: Trip) => {
        try {
            if (!name)
                throw Error("Enter your display name.");
            if (!t.inviteActive || t.members.length >= 6)
                throw Error("This invitation is no longer available.");
            const p: Person = { id: uid(), name };
            commit((s) => {
                const target = s.trips.find((x) => x.id === t.id)!;
                if (!target.inviteActive || target.members.length >= 6)
                    throw Error("This invitation is no longer available.");
                target.members.push({ ...p, role: "member", included: true });
                invalidate(target, "A guest joined the proposed roster. Confirm inputs and revalidate.");
                s.people.push(p);
                s.activeTripId = target.id;
            });
            setPerson(p.id);
            go("private");
            notify("Joined as a guest. Add your own private preferences.");
        }
        catch (e) {
            notify((e as Error).message, true);
        }
    };
    const mainTitle = titles[route.view] || [
        "Page not found",
        "Choose a section from the navigation.",
    ];
    let content;
    if (route.view === "entry")
        content = <Welcome go={go} loadSample={() => loadSample()}/>;
    else if (["signup", "signin", "recovery"].includes(route.view))
        content = (<Account key={route.view} mode={route.view} state={state} onEnter={enter} go={go}/>);
    else if (route.view === "join")
        content = (<Join key={route.arg} trip={state.trips.find((t) => t.token === route.arg)} onJoin={onJoin} go={go}/>);
    else if (route.view === "scenarios")
        content = (<div className="stack">
        <Hero trip={trip || sampleTrip()} title="A trip that works for everyone." sub="Start with the happy path, then inspect the decisions that keep planning honest."/>
        <div className="cards-grid">
          {[
                [
                    "Review a current plan",
                    "Review the full personal total, then choose your response.",
                    "review",
                ],
                [
                    "Build day by day",
                    "Compare itinerary choices and test item-level voting.",
                    "builder",
                ],
                [
                    "Five of six ready",
                    "Check why a majority cannot close the trip.",
                    "pending",
                ],
                [
                    "Plan changed",
                    "Earlier readiness must become historical.",
                    "changed",
                ],
                [
                    "Headcount changed",
                    "Five travellers can cost more per person.",
                    "roster",
                ],
                [
                    "Over budget",
                    "Hard constraints come before popular choices.",
                    "budget",
                ],
                [
                    "Missing price",
                    "An unknown quote must not become zero.",
                    "unknown",
                ],
                [
                    "Awaiting input",
                    "Four confirmed briefs do not represent all six.",
                    "missing",
                ],
                [
                    "No common dates",
                    "Compare genuine availability incompatibility.",
                    "dates",
                ],
                [
                    "Optional participation",
                    "A no-charge alternative remains workable.",
                    "optional",
                ],
            ].map(([t, d, k]) => (<Card key={k} title={t} sub={d}>
              <Button variant="secondary" onClick={() => loadSample(k)}>
                Explore scenario
              </Button>
            </Card>))}
        </div>
        <Note title="Every scenario creates a separate local trip">
          Your other demo trips stay saved. No real friends, messages, bookings
          or backend records are created.
        </Note>
      </div>);
    else if (!person)
        content = (<Card title="Enter the demo to continue">
        <p>Use an organiser demo account or join with an invitation.</p>
        <Actions>
          <Button onClick={() => go("signin")}>Sign in to local demo</Button>
          <Button variant="secondary" onClick={() => go("entry")}>
            Back to start
          </Button>
        </Actions>
      </Card>);
    else if (route.view === "setup" &&
        route.arg === "edit" &&
        member?.role !== "organiser")
        content = (<Card title="The organiser manages trip settings">
        <Button onClick={() => go("overview")}>Return to workspace</Button>
      </Card>);
    else if (route.view === "setup")
        content = (<Setup key={route.arg + trip?.id} person={person} existing={route.arg === "edit" && member?.role === "organiser"
                ? trip
                : undefined} onSave={saveSetup} onCancel={() => go(trip ? "overview" : "entry")}/>);
    else if (!trip || !member)
        content = (<Card title="Your next trip starts here">
        <Coast />
        <Actions>
          <Button onClick={() => go("setup", "new")}>Create a trip</Button>
          <Button variant="secondary" onClick={() => go("join")}>
            Join with an invite
          </Button>
          <Button variant="ghost" onClick={() => loadSample()}>
            Explore the Goa sample
          </Button>
        </Actions>
      </Card>);
    else {
        const p = { trip, personId, act, go };
        switch (route.view) {
            case "created":
                content =
                    member.role === "organiser" ? (<InvitePanel trip={trip} act={act} go={go} notify={notify}/>) : (<Card title="Ask the organiser for an invitation">
              <p>The organiser manages this trip's invitation link.</p>
              <Button onClick={() => go("overview")}>
                Return to workspace
              </Button>
            </Card>);
                break;
            case "overview":
                content = <Overview {...p}/>;
                break;
            case "private":
                content = (<Preferences key={trip.id + personId} trip={trip} personId={personId} act={act} onDone={() => go("plans")}/>);
                break;
            case "plans":
                content = <Plans {...p}/>;
                break;
            case "builder":
                content = <Builder {...p}/>;
                break;
            case "poll":
                content = (<PollView {...p} slot={["travel", "stay", "activity", "food"].includes(route.arg)
                        ? route.arg as Slot
                        : "activity"}/>);
                break;
            case "itinerary":
                content = <Itinerary {...p}/>;
                break;
            case "costs":
                content = <Costs {...p}/>;
                break;
            case "optional":
                content = <OptionalActivity {...p}/>;
                break;
            case "review":
                content = (<Review key={trip.id + personId + trip.revision + trip.plan?.version} {...p}/>);
                break;
            case "outcome":
                content = <Outcomes {...p}/>;
                break;
            case "bookings":
                content = <BookingHandoff {...p}/>;
                break;
            case "compare":
                content = <BookingComparison {...p}/>;
                break;
            case "history":
                content = <History trip={trip}/>;
                break;
            default:
                content = (<Card title="That page isn't available">
            <Button onClick={() => go("overview")}>Open workspace</Button>
          </Card>);
        }
    }
    const active = [
        "builder",
        "plans",
        "poll",
        "itinerary",
        "costs",
        "optional",
        "review",
    ].includes(route.view)
        ? "Plan"
        : ["outcome", "history"].includes(route.view)
            ? "Decisions"
            : ["bookings", "compare"].includes(route.view)
                ? "Bookings"
                : "Overview";
    const yourTrips = state.trips.filter((t) => t.members.some((m) => m.id === personId));
    return (<>
      <a href="#main" className="skip-link" onClick={(e) => {
            e.preventDefault();
            document.getElementById("main")?.focus();
        }}>
        Skip to content
      </a>
      <header className="topbar">
        <button className="brand" onClick={() => go("entry")} aria-label="Planzo home">
          <Icon brand/>
          <span>planzo</span>
        </button>
        <p className="tagline">Good trips start with common ground.</p>
        <Badge>Interactive local demo</Badge>
        <Button variant="ghost" onClick={() => go("scenarios")}>
          Scenarios
        </Button>
        <span className="persona">{publicPage ? "Welcome" : person?.name}</span>
        {!publicPage && (<button className="mobile-toggle" aria-expanded={menu} onClick={() => setMenu((v) => !v)} aria-label="Toggle navigation">
            ☰
          </button>)}
      </header>
      <div className={publicPage ? "public-shell" : "app-shell"}>
        {!publicPage && (<aside className={"sidebar " + (menu ? "is-open" : "")}>
            <span className="eyebrow">
              {trip?.name.toUpperCase() || "YOUR NEXT TRIP"}
            </span>
            <nav aria-label="Main navigation">
              {[
                ["Overview", "home", "overview"],
                ["Plan", "map", "itinerary"],
                ["Decisions", "people", "outcome"],
                ["Bookings", "wallet", "bookings"],
            ].map(([label, icon, view]) => (<button className={active === label ? "active" : ""} onClick={() => go(view)} aria-current={active === label ? "page" : undefined} key={view}>
                  <Icon name={icon}/>
                  <span>{label}</span>
                </button>))}
            </nav>
            <hr />
            <Button variant="secondary" onClick={() => go("private")}>
              My private input
            </Button>
            <p className="caption muted">
              Only your own raw budget and private requirements are shown in
              your current view.
            </p>
            {member?.role === "organiser" && (<Button variant="ghost" onClick={() => go("setup", "edit")}>
                Trip settings
              </Button>)}
            <Button variant="ghost" onClick={() => go("history")}>
              Plan summary & history
            </Button>
            {yourTrips.length > 0 && (<label className="field">
                <span>Saved demo trips</span>
                <select aria-label="Saved demo trips" value={trip?.id || ""} onChange={(e) => {
                    commit((s) => {
                        s.activeTripId = e.target.value;
                    });
                    go("overview");
                }}>
                  {yourTrips.map((t) => (<option key={t.id} value={t.id}>
                      {t.name} {t.sample ? "· sample" : ""}
                    </option>))}
                </select>
              </label>)}
            <Button variant="ghost" onClick={() => go("setup", "new")}>
              Create another trip
            </Button>
            <Button variant="ghost" onClick={() => {
                setPerson("");
                go("entry");
            }}>
              Leave demo session
            </Button>
            <p className="caption muted">
              Illustrative prices
              <br />
              No live reservations
            </p>
          </aside>)}
        <main id="main" tabIndex={-1}>
          <div className="page-heading">
            <h1>
              {route.view === "overview" && trip ? trip.name : mainTitle[0]}
            </h1>
            <p className="muted">{mainTitle[1]}</p>
          </div>
          {!publicPage && trip && (<div className="demo-toolbar">
              <span>
                <strong>Demo persona</strong> · test the group journey
              </span>
              <label>
                <span className="sr-only">Act as demo member</span>
                <select value={personId} onChange={(e) => {
                setPerson(e.target.value);
                if (route.view === "setup")
                    go("overview");
            }}>
                  {trip.members.map((m) => (<option key={m.id} value={m.id}>
                      {m.name} ·{" "}
                      {m.role === "organiser" ? "organiser" : "guest"}
                      {m.included ? "" : " · observer"}
                    </option>))}
                </select>
              </label>
              <button className="text-button" onClick={() => {
                setFailSave(true);
                notify("The next trip save will fail once. Retry will preserve your current form.");
            }}>
                Test save retry
              </button>
              <span className="caption">
                Same browser only · no real authentication
              </span>
            </div>)}
          {notice && (<div role={notice.error ? "alert" : "status"} className={"toast " + (notice.error ? "error" : "")}>
              <span>{notice.text}</span>
              <button onClick={() => setNotice(null)} aria-label="Dismiss notification">
                ×
              </button>
            </div>)}
          {storageWarning() && (<Note title="Browser storage needs attention" tone="peach">
              {storageWarning()}
            </Note>)}
          {content}
          <footer>
            Planzo demo · sample AI and provider prices · saved on this browser
            only
          </footer>
        </main>
      </div>
    </>);
}
function Overview({ trip, personId, act, go, }: {
    trip: Trip;
    personId: string;
    act: (fn: (t: Trip) => void, message?: string) => boolean;
    go: (v: string, a?: string) => void;
}) {
    const group = included(trip);
    const completed = group.filter((m) => trip.briefs[m.id]?.confirmed &&
        !briefErrors(trip, trip.briefs[m.id]).length).length;
    const organiser = trip.members.find((m) => m.id === personId)?.role === "organiser";
    return (<div className="stack">
      <Hero trip={trip} title={trip.name} sub={group.length +
            " included travellers · " +
            completed +
            " confirmed private briefs · " +
            (trip.plan ? "Plan v" + trip.plan.version : "Collecting input")}/>
      <div className="columns">
        <div className="stack">
          <Card title="Your next small step" sub="The right plan starts with complete, confirmed input.">
            <Badge tone={currentPlan(trip) ? "positive" : "pending"}>
              {trip.status === "postponed"
            ? "Trip postponed"
            : currentPlan(trip)
                ? "Plan v" + trip.plan!.version + " ready to review"
                : "Collecting / revising"}
            </Badge>
            <Actions>
              <Button onClick={() => go(trip.briefs[personId]?.confirmed ? "review" : "private")}>
                {trip.briefs[personId]?.confirmed
            ? "Review the plan"
            : "Add my private input"}
              </Button>
              <Button variant="secondary" onClick={() => go("plans")}>
                Explore sample drafts
              </Button>
            </Actions>
          </Card>
          <Card title="Everyone has a voice" sub={completed +
            " of " +
            group.length +
            " included briefs confirmed. No one sees another person's raw ceiling."}>
            {trip.members.map((m) => (<div className="member-row" key={m.id}>
                <span className="avatar">{m.name[0]}</span>
                <div>
                  <strong>
                    {m.name}
                    {m.role === "organiser" ? " · Organiser" : ""}
                  </strong>
                  <small>
                    {m.included ? "Included traveller" : "Workspace observer"}
                  </small>
                </div>
                <Badge tone={trip.briefs[m.id]?.confirmed ? "positive" : "pending"}>
                  {trip.briefs[m.id]?.confirmed
                ? "Input confirmed"
                : "Input needed"}
                </Badge>
                {organiser && (<label className="roster-check">
                    <input type="checkbox" aria-label={"Include " + m.name + " in travelling roster"} checked={m.included} onChange={(e) => act((t) => changeRoster(t, m.id, e.target.checked), "Proposed roster updated. Reprice and publish before fresh readiness.")}/>
                    Included
                  </label>)}
              </div>))}
            {organiser && (<p className="caption muted">
                Changing the roster is explicit. Declining travel does not
                automatically remove someone. A smaller group must be repriced.
              </p>)}
          </Card>
        </div>
        <aside>
          <Card title="Planzo Passport" tone="mint">
            {[
            [
                "Inputs received",
                completed === group.length && group.length > 0,
            ],
            [
                "Feasible options",
                concepts.some((c) => !feasibility(trip, c.choices).length),
            ],
            [
                "Choices resolved",
                !Object.values(trip.polls).some((p) => p?.status === "open" || p?.status === "unresolved") && completed === group.length,
            ],
            [
                "Decision recorded",
                ["agreed", "postponed"].includes(trip.status),
            ],
            [
                "Booking handoff prepared",
                trip.status === "agreed" && trip.tasks.length > 0,
            ],
        ].map(([t, done]) => (<Feature key={String(t)} title={String(t)} icon={done ? "check" : "calendar"}>
                {done ? "Complete" : "Pending"}
              </Feature>))}
          </Card>
          <Card title="Your complete estimate" tone="peach">
            <Total value={cost(trip, personId).total} complete={cost(trip, personId).complete}/>
            <Button variant="secondary" onClick={() => go("builder")}>
              Build day-by-day plan
            </Button>
          </Card>
          {organiser && (<Button variant="secondary" onClick={() => go("created")}>
              Invite friends
            </Button>)}
        </aside>
      </div>
    </div>);
}
function InvitePanel({ trip, act, go, notify, }: {
    trip: Trip;
    act: (fn: (t: Trip) => void, message?: string) => boolean;
    go: (v: string, a?: string) => void;
    notify: (t: string, error?: boolean) => void;
}) {
    const link = location.href.split("#")[0] + "#/join/" + trip.token;
    return (<div className="stack">
      <Hero trip={trip} title={trip.destination + " is on the horizon."} sub="Your trip is created. Now make it a group decision."/>
      <div className="columns">
        <Card title="Invite your friends" sub="Friends join with a link and a display name. No signup needed.">
          <label className="field">
            <span>Invitation link</span>
            <input readOnly value={link} onFocus={(e) => e.target.select()}/>
          </label>
          <Badge tone={trip.inviteActive ? "positive" : "alert"}>
            {trip.inviteActive ? "Invitation active" : "Invitation revoked"}
          </Badge>
          <Actions>
            <Button onClick={async () => {
            try {
                await navigator.clipboard.writeText(link);
                notify("Invite link copied. Share it yourself in your group chat.");
            }
            catch {
                notify("Select the invitation field to copy the link manually.", true);
            }
        }}>
              Copy invite link
            </Button>
            <Button variant="secondary" onClick={() => go("join", trip.token)}>
              Preview friend invitation
            </Button>
          </Actions>
          <Note title="You decide where to share">
            No messages are sent automatically. Local demo invitations work only
            with trip data already saved in this browser; they do not sync
            across devices.
          </Note>
          <Actions>
            <Button variant="ghost" onClick={() => act((t) => {
            t.inviteActive = !t.inviteActive;
        }, "Invitation availability updated.")}>
              {trip.inviteActive
            ? "Revoke invitation"
            : "Reactivate invitation"}
            </Button>
            <Button variant="secondary" onClick={() => go("overview")}>
              Open workspace
            </Button>
          </Actions>
        </Card>
        <Card title="Next steps" tone="mint">
          <Feature icon="lock" title="Add your own input">
            Organisers have the same private brief as everyone else.
          </Feature>
          <Feature icon="people" title="Wait for confirmed inputs">
            Invited does not mean joined or ready.
          </Feature>
          <Button onClick={() => go("private")}>Add my private input</Button>
        </Card>
      </div>
    </div>);
}
