import { useState } from "react";
import type { Person, State, Trip, Window } from "./domain";
import { uid } from "./domain";
import { assets } from "./assets";
import { Actions, Badge, Button, Card, Coast, Feature, Field, Note, windowText, } from "./ui";
export type Navigate = (view: string, arg?: string) => void;
export function Welcome({ go, loadSample, }: {
    go: Navigate;
    loadSample: () => void;
}) {
    return (<div className="columns welcome">
      <Card title="Plan together. Travel together." sub="Private preferences. Feasible plans. Clear decisions." tone="mint">
        <Coast variant="large"/>
        <div className="benefits">
          <Feature icon="lock" title="Private limits"/>
          <Feature icon="wallet" title="Full costs"/>
          <Feature icon="people" title="Equal say"/>
        </div>
      </Card>
      <aside>
        <Card title="Your next good trip">
          <p className="muted">
            Agree on the dates, cost and plan before anyone books.
          </p>
          <Button onClick={() => go("signup")}>Create a trip</Button>
          <Button variant="secondary" onClick={() => go("join")}>
            Join with an invite
          </Button>
          <Note title="Your group, your pace" tone="cream" icon="heart">
            A respectful no or a postponed trip is a useful outcome.
          </Note>
          <Button variant="secondary" onClick={() => go("signin")}>
            I already have an account
          </Button>
        </Card>
        <Button variant="ghost" onClick={loadSample}>
          Explore the Goa sample →
        </Button>
        <p className="caption muted">
          Interactive local demo. Sample accounts and trips stay in this
          browser.
        </p>
      </aside>
    </div>);
}
export function Account({ mode, state, onEnter, go, }: {
    mode: string;
    state: State;
    onEnter: (p: Person) => void;
    go: Navigate;
}) {
    const [name, setName] = useState(""), [email, setEmail] = useState(""), [error, setError] = useState(""), [sent, setSent] = useState(false);
    function submit(e: React.SubmitEvent<HTMLFormElement>) {
        e.preventDefault();
        setError("");
        if (mode === "signup" && !name.trim()) {
            setError("Enter your name to create a demo account.");
            return;
        }
        const address = email.trim().toLowerCase();
        const existing = state.people.find((p) => p.email?.toLowerCase() === address);
        if (mode === "recovery") {
            setSent(true);
            return;
        }
        if (mode === "signin") {
            if (!existing) {
                setError("No demo account with this email exists in this browser. Create a demo account or open the sample.");
                return;
            }
            onEnter(existing);
        }
        else {
            if (existing) {
                setError("A local demo account with this email already exists. Use sign in.");
                return;
            }
            onEnter({ id: uid(), name: name.trim(), email: address });
        }
    }
    return (<div className="columns account-layout">
      <Card title="Less chasing. More planning." tone="mint" className="account-context">
        <img className="coast" src={mode === "signup" ? assets.signup.imgEditableIllustrationGoaCoast : assets.signin.imgEditableIllustrationGoaCoast} alt="Illustrated Goa coastline with a palm tree, sailboat and warm sunset"/>
        <Feature icon="people" title="Everyone gets a voice">
          Private preferences and a shared plan.
        </Feature>
        <Feature icon="wallet" title="No surprise costs">
          Whole-trip estimates before readiness.
        </Feature>
      </Card>
      <Card className="account-form" title={mode === "signup"
            ? "Create your Planzo account"
            : mode === "recovery"
                ? "Reset your password"
                : "Sign in to Planzo"}>
        {sent ? (<>
            <Note title="Recovery preview">
              No email was sent. This demo uses a local email identifier and
              does not store or verify passwords.
            </Note>
            <Button onClick={() => go("signin")}>Return to demo sign in</Button>
          </>) : (<form onSubmit={submit} className="stack">
            <div className={mode === "signup" ? "field-grid" : "stack"}>
            {mode === "signup" && (<Field label="Your name">
                <input required maxLength={50} value={name} autoComplete="given-name" onChange={(e) => setName(e.target.value)}/>
              </Field>)}
            <Field label="Email address">
              <input type="email" required maxLength={150} value={email} autoComplete="email" onChange={(e) => setEmail(e.target.value)}/>
            </Field>
            </div>
            {mode !== "recovery" && (<Field label="Password · visual demo field" hint="Do not use a real password. This optional field is neither saved nor checked.">
                <input type="password" autoComplete="off" placeholder="Sample only"/>
              </Field>)}
            {error && (<p className="form-error" role="alert">
                {error}
              </p>)}
            <Button type="submit">
              {mode === "signup"
                ? "Create demo account"
                : mode === "recovery"
                    ? "Preview recovery confirmation"
                    : "Enter local demo"}
            </Button>
            <p className="caption muted">
              Local demo identity only. No real authentication or email delivery
              is connected.
            </p>
            {mode === "signin" ? (<>
                <Button variant="ghost" onClick={() => go("recovery")}>
                  Forgot password?
                </Button>
                <Button variant="secondary" onClick={() => go("signup")}>
                  Create an account
                </Button>
              </>) : (<Button variant="secondary" onClick={() => go("signin")}>
                Already a member? Sign in
              </Button>)}
          </form>)}
        <Note title="One organiser account is enough to start">
          Invite friends with a link. They enter their name and contribute as guests.
        </Note>
      </Card>
    </div>);
}
export function Setup({ person, existing, onSave, onCancel, }: {
    person: Person;
    existing?: Trip;
    onSave: (details: Partial<Trip>) => void;
    onCancel: () => void;
}) {
    const [name, setName] = useState(existing?.name || "Goa with the group"), [destination, setDestination] = useState(existing?.destination || "Goa"), [deadline, setDeadline] = useState(existing?.deadline || "2026-10-22"), [minimum, setMinimum] = useState(existing?.minimum || 4);
    const [windows, setWindows] = useState<Window[]>(existing?.windows || [
        { id: uid(), start: "2026-11-13T06:00", end: "2026-11-15T22:00" },
        { id: uid(), start: "2026-11-20T06:00", end: "2026-11-22T22:00" },
    ]);
    const [error, setError] = useState("");
    function submit(e: React.SubmitEvent<HTMLFormElement>) {
        e.preventDefault();
        const valid = windows.every((w) => {
            const a = new Date(w.start), b = new Date(w.end);
            return (Number.isFinite(a.getTime()) &&
                b > a &&
                Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) -
                    Date.UTC(a.getFullYear(), a.getMonth(), a.getDate()) ===
                    2 * 86400000);
        });
        if (!valid) {
            setError("Use valid departure and return boundaries spanning three calendar days / two nights. This demo catalogue covers that duration.");
            return;
        }
        if (new Set(windows.map((w) => w.start + "|" + w.end)).size !== windows.length) {
            setError("Each candidate window must be different.");
            return;
        }
        onSave({
            name: name.trim(),
            destination: destination.trim(),
            windows,
            windowId: existing && windows.some((w) => w.id === existing.windowId)
                ? existing.windowId
                : windows[0].id,
            deadline,
            minimum,
        });
    }
    return (<div className="columns">
      <Card title="The basics" sub={"Started by " +
            person.name +
            ". One destination, a few possible windows, one clear deadline."}>
        <form onSubmit={submit} className="stack">
          <Field label="Group / trip name">
            <input required maxLength={80} value={name} onChange={(e) => setName(e.target.value)}/>
          </Field>
          <div className="field-grid">
            <Field label="Destination" hint="Goa has the sample price catalogue. Other destinations are saved but need live data later.">
              <input required maxLength={80} value={destination} onChange={(e) => setDestination(e.target.value)}/>
            </Field>
            <Field label="Duration">
              <input value="3 days · 2 nights" readOnly/>
            </Field>
          </div>
          {windows.map((w, i) => (<fieldset key={w.id}>
              <legend>Candidate window {i + 1} · Asia/Kolkata</legend>
              <div className="field-grid">
                <Field label={"Departure " + (i + 1)}>
                  <input type="datetime-local" required value={w.start} onChange={(e) => setWindows((v) => v.map((x) => x.id === w.id ? { ...x, start: e.target.value } : x))}/>
                </Field>
                <Field label={"Return " + (i + 1)}>
                  <input type="datetime-local" required value={w.end} onChange={(e) => setWindows((v) => v.map((x) => x.id === w.id ? { ...x, end: e.target.value } : x))}/>
                </Field>
              </div>
              {windows.length > 1 && (<Button variant="ghost" onClick={() => setWindows((v) => v.filter((x) => x.id !== w.id))}>
                  Remove window {i + 1}
                </Button>)}
            </fieldset>))}
          {windows.length < 3 && (<Button variant="secondary" onClick={() => setWindows((v) => [...v, { id: uid(), start: "", end: "" }])}>
              Add another date window
            </Button>)}
          <div className="field-grid">
            <Field label="Response deadline">
              <input type="date" required value={deadline} onChange={(e) => setDeadline(e.target.value)}/>
            </Field>
            <Field label="Minimum travellers">
              <select value={minimum} onChange={(e) => setMinimum(Number(e.target.value))}>
                {[4, 5, 6].map((n) => (<option value={n} key={n}>
                    {n} friends
                  </option>))}
              </select>
            </Field>
          </div>
          <Note title="Travel time counts">
            Departure and return boundaries are part of availability, not just
            destination dates. This sample supports groups of up to six.
          </Note>
          {error && (<p className="form-error" role="alert">
              {error}
            </p>)}
          <Actions>
            <Button type="submit">
              {existing ? "Save trip settings" : "Create trip"}
            </Button>
            <Button variant="secondary" onClick={onCancel}>
              Cancel
            </Button>
          </Actions>
        </form>
      </Card>
      <aside>
        <Card title="A small start, a better plan" tone="mint">
          <Coast />
          <Feature icon="calendar" title="Flexible dates">
            Up to three windows help find common ground.
          </Feature>
          <Feature icon="people" title="Invite your people">
            Everyone gives their own input and response.
          </Feature>
        </Card>
      </aside>
    </div>);
}
export function Join({ trip, onJoin, go, }: {
    trip: Trip | undefined;
    onJoin: (name: string, trip: Trip) => void;
    go: Navigate;
}) {
    const [name, setName] = useState(""), [token, setToken] = useState("");
    if (!trip || !trip.inviteActive)
        return (<Card title="Join your friends" sub="Paste the invite link or code shared by the organiser.">
        <form className="stack" onSubmit={(e) => {
                e.preventDefault();
                const raw = token.trim();
                let code = raw;
                try {
                    if (raw.includes("#/join/"))
                        code = decodeURIComponent(raw.split("#/join/")[1].split(/[?&]/)[0]);
                }
                catch { }
                go("join", code);
            }}>
          <Field label="Invitation link or code">
            <input required value={token} onChange={(e) => setToken(e.target.value)} placeholder="Paste a Planzo invite link"/>
          </Field>
          <Button type="submit">Open invitation</Button>
        </form>
        <Note title="An expired or unknown link stays private" tone="peach">
          If this invitation is unavailable in this browser, ask the organiser
          for a fresh link. Local demo links work only with this browser's saved
          trip data.
        </Note>
      </Card>);
    return (<div className="columns">
      <Card title="Plan together. Travel together." tone="mint">
        <Coast variant="large"/>
        <div className="benefits">
          <Feature icon="lock" title="Private limits"/>
          <Feature icon="wallet" title="Full costs"/>
          <Feature icon="people" title="Equal say"/>
        </div>
      </Card>
      <Card title={trip.name}>
        <Badge tone="positive">Valid invitation</Badge>
        <h3>{windowText(trip, trip.windows[0].id)}</h3>
        <p className="small muted">
          {trip.destination} · 3 days · Created by{" "}
          {trip.members.find((m) => m.role === "organiser")?.name}
        </p>
        <Note title="Your input stays private">
          Enter your name and contribute as a guest. No signup form is needed.
        </Note>
        <form className="stack" onSubmit={(e) => {
            e.preventDefault();
            onJoin(name.trim(), trip);
        }}>
          <Field label="Your name">
            <input required minLength={1} maxLength={50} value={name} onChange={(e) => setName(e.target.value)}/>
          </Field>
          <Button type="submit" disabled={trip.members.length >= 6}>
            Join as guest
          </Button>
          {trip.members.length >= 6 && (<p className="small muted">
              This demo trip is full. Ask the organiser to use an existing local
              persona for testing.
            </p>)}
        </form>
        <p className="caption muted">
          Guest identity is a local demonstration. Returning access and
          verification will be added with the backend.
        </p>
      </Card>
    </div>);
}
