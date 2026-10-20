export type Range = [
    number,
    number
];
export type Slot = "travel" | "stay" | "activity" | "food";
export type Choice = Record<Slot, string>;
export type Person = {
    id: string;
    name: string;
    email?: string;
};
export type Window = {
    id: string;
    start: string;
    end: string;
};
export type Brief = {
    origin: string;
    ceiling: number;
    windows: string[];
    vegetarian: boolean;
    stepFree: boolean;
    stars: Record<string, number>;
    text: string;
    confirmed: boolean;
    boat: boolean;
};
export type Member = Person & {
    role: "organiser" | "member";
    included: boolean;
};
export type Response = {
    personId: string;
    version: number;
    revision: number;
    status: "ready" | "change" | "decline";
    privateReason?: string;
    at: string;
};
export type Poll = {
    slot: Slot;
    revision: number;
    status: "open" | "closed" | "stale" | "unresolved";
    deadline: number;
    ballots: Record<string, string | null>;
    winner?: string;
};
export type Plan = {
    version: number;
    revision: number;
    roster: string[];
    windowId: string;
    choices: Choice;
    at: string;
};
export type BookingTask = {
    id: string;
    title: string;
    ownerId: string;
    due: string;
    status: "pending" | "reported";
    reportedAt?: string;
    reportedVersion?: number;
    reportedBy?: string;
    archived?: boolean;
};
export type Trip = {
    id: string;
    name: string;
    destination: string;
    token: string;
    inviteActive: boolean;
    windows: Window[];
    deadline: string;
    minimum: number;
    tentativeDays?: number;
    members: Member[];
    briefs: Record<string, Brief>;
    revision: number;
    versionCounter: number;
    selected: Choice;
    windowId: string;
    plan: Plan | null;
    responses: Response[];
    polls: Partial<Record<Slot, Poll>>;
    status: "collecting" | "reviewing" | "agreed" | "postponed";
    stayDelta: number;
    unknownPrice: boolean;
    tasks: BookingTask[];
    history: {
        at: string;
        message: string;
    }[];
    sample: boolean;
};
export type State = {
    schema: 1;
    people: Person[];
    trips: Trip[];
    activeTripId: string | null;
};
export const slots: Slot[] = ["travel", "stay", "activity", "food"];
export const slotLabels: Record<Slot, string> = {
    travel: "Return travel",
    stay: "Stay",
    activity: "Saturday afternoon",
    food: "Food and rest",
};
export const defaults: Choice = {
    travel: "train",
    stay: "coast",
    activity: "heritage",
    food: "cafe",
};
export const options: Record<Slot, {
    id: string;
    title: string;
    description: string;
    range: Range;
    icon: string;
    ai?: boolean;
    stepFree?: boolean;
}[]> = {
    travel: [
        {
            id: "train",
            title: "Morning train + transfer",
            description: "Bengaluru ↔ Goa · sample return allowance",
            range: [3500, 4200],
            icon: "plane",
        },
        {
            id: "coach",
            title: "Overnight coach + transfer",
            description: "Same travel window · verify actual departure times",
            range: [3200, 3900],
            icon: "clock",
        },
    ],
    stay: [
        {
            id: "coast",
            title: "Coastal twin-room stay",
            description: "Twin rooms · two nights · step-free access in the sample",
            range: [1600, 2000],
            icon: "bed",
            stepFree: true,
        },
        {
            id: "panaji",
            title: "Quieter Panaji base",
            description: "Twin rooms · two nights · step-free access not verified",
            range: [1500, 1900],
            icon: "leaf",
            stepFree: false,
        },
    ],
    activity: [
        {
            id: "heritage",
            title: "Panaji heritage walk",
            description: "A shared afternoon of culture, then time to unwind",
            range: [300, 500],
            icon: "map",
        },
        {
            id: "beach",
            title: "Longer beach afternoon",
            description: "An easier shared afternoon with fewer paid stops",
            range: [100, 300],
            icon: "sun",
        },
    ],
    food: [
        {
            id: "cafe",
            title: "Vegetarian-friendly cafés",
            description: "Meal allowance for the trip · AI-suggested venue type",
            range: [1400, 1700],
            icon: "coffee",
            ai: true,
        },
        {
            id: "thali",
            title: "Local thali restaurants",
            description: "Meal allowance for the trip · AI-suggested venue type",
            range: [1300, 1600],
            icon: "leaf",
            ai: true,
        },
    ],
};
export const concepts = [
    {
        id: "common",
        title: "Coast & common ground",
        tag: "BEST SHARED FIT",
        description: "Beach, heritage and room for optional adventure.",
        icon: "sun",
        choices: { ...defaults },
    },
    {
        id: "slow",
        title: "Slow Goa",
        tag: "RELAXED PACE",
        description: "More free time, a quieter base and earlier dinners.",
        icon: "coffee",
        choices: { ...defaults, stay: "panaji", activity: "beach" },
    },
    {
        id: "culture",
        title: "Culture & cafés",
        tag: "CULTURE FIRST",
        description: "A heritage-led day with local food alternatives.",
        icon: "map",
        choices: { ...defaults, travel: "coach", food: "thali" },
    },
    {
        id: "flex",
        title: "Together, then explore",
        tag: "FLEXIBLE GROUP",
        description: "Shared anchors with optional smaller-group blocks.",
        icon: "people",
        choices: { ...defaults, activity: "beach", food: "thali" },
    },
];
export const uid = () => globalThis.crypto.randomUUID();
export const now = () => new Date().toISOString();
export const initialState = (): State => ({
    schema: 1,
    people: [],
    trips: [],
    activeTripId: null,
});
export const blankBrief = (trip: Trip): Brief => ({
    origin: "Bengaluru",
    ceiling: 11000,
    windows: [trip.windows[0]?.id].filter(Boolean),
    vegetarian: true,
    stepFree: false,
    stars: { Relaxation: 2, Food: 1, Beach: 0, Culture: 0, Adventure: 0 },
    text: "",
    confirmed: false,
    boat: false,
});
export function makeTrip(person: Person, details?: Partial<Trip>): Trip {
    const windows = [
        { id: uid(), start: "2026-11-13T06:00", end: "2026-11-15T22:00" },
        { id: uid(), start: "2026-11-20T06:00", end: "2026-11-22T22:00" },
    ];
    return {
        id: uid(),
        name: "Goa with the group",
        destination: "Goa",
        token: uid().replaceAll("-", ""),
        inviteActive: true,
        windows,
        deadline: "2026-10-22",
        minimum: 4,
        members: [{ ...person, role: "organiser", included: true }],
        briefs: {},
        revision: 1,
        versionCounter: 0,
        selected: { ...defaults },
        windowId: windows[0].id,
        plan: null,
        responses: [],
        polls: {},
        status: "collecting",
        stayDelta: 0,
        unknownPrice: false,
        tasks: [],
        history: [
            {
                at: now(),
                message: "Trip created. Invitations are separate from participation.",
            },
        ],
        sample: false,
        ...details,
    };
}
export const included = (trip: Trip) => trip.members.filter((m) => m.included);
export function option(slot: Slot, id: string) {
    const value = options[slot].find((o) => o.id === id);
    if (!value)
        throw Error("That option is not in the demo catalogue.");
    return value;
}
export function cost(trip: Trip, personId: string, choices: Choice = trip.selected, roster: string[] = included(trip).map((m) => m.id)): {
    rows: {
        label: string;
        range: Range;
    }[];
    total: Range;
    complete: boolean;
} {
    const n = roster.length || 1;
    const rooms = Math.ceil(n / 2);
    const stay = option("stay", choices.stay).range;
    const rows: {
        label: string;
        range: Range;
    }[] = [
        { label: "Return travel", range: option("travel", choices.travel).range },
        {
            label: "Stay · two nights",
            range: [
                ((stay[0] * 2 + trip.stayDelta) * rooms) / n,
                ((stay[1] * 2 + trip.stayDelta) * rooms) / n,
            ],
        },
        { label: "Local transport", range: [5400 / n, 6600 / n] },
        { label: "Food", range: option("food", choices.food).range },
        {
            label: "Shared activities",
            range: option("activity", choices.activity).range,
        },
        { label: "Fees and incidentals", range: [200, 300] },
    ];
    if (trip.briefs[personId]?.boat)
        rows.push({ label: "Your optional boat activity", range: [800, 1000] });
    const subtotal: Range = [
        rows.reduce((s, r) => s + r.range[0], 0),
        rows.reduce((s, r) => s + r.range[1], 0),
    ];
    rows.push({
        label: "Contingency · 10%",
        range: [subtotal[0] * 0.1, subtotal[1] * 0.1],
    });
    return {
        rows,
        total: [Math.round(subtotal[0] * 1.1), Math.round(subtotal[1] * 1.1)],
        complete: !trip.unknownPrice &&
            trip.briefs[personId]?.origin.toLowerCase().trim() === "bengaluru" &&
            trip.destination.toLowerCase().trim() === "goa",
    };
}
export function briefErrors(trip: Trip, b: Brief): string[] {
    const errors = [];
    if (!Number.isFinite(b.ceiling) || b.ceiling <= 0)
        errors.push("Enter a whole-trip budget greater than zero.");
    if (!b.origin.trim())
        errors.push("Add your starting city.");
    if (!b.windows.some((id) => trip.windows.some((w) => w.id === id)))
        errors.push("Choose at least one complete travel window.");
    if (Object.values(b.stars).some((v) => !Number.isInteger(v) || v < 0 || v > 2) ||
        Object.values(b.stars).reduce((a, b) => a + b, 0) > 3)
        errors.push("Use at most three stars, with no more than two on one interest.");
    return errors;
}
export function feasibility(trip: Trip, choices: Choice = trip.selected, windowId = trip.windowId): string[] {
    const group = included(trip);
    const issues: string[] = [];
    if (group.length < trip.minimum)
        issues.push("The included roster is below the trip's minimum group size.");
    if (group.some((m) => !trip.briefs[m.id]?.confirmed ||
        briefErrors(trip, trip.briefs[m.id]).length))
        issues.push("Some included travellers still need to confirm a complete private brief.");
    if (!trip.windows.some((w) => w.id === windowId))
        issues.push("Choose a valid proposed travel window.");
    if (group.some((m) => trip.briefs[m.id]?.confirmed &&
        !trip.briefs[m.id].windows.includes(windowId)))
        issues.push("This travel window does not fit all included travellers.");
    if (group.some((m) => trip.briefs[m.id]?.stepFree &&
        (!option("stay", choices.stay).stepFree || trip.briefs[m.id]?.boat)))
        issues.push("A hard requirement is not verified for this arrangement.");
    if (group.some((m) => !cost(trip, m.id, choices).complete))
        issues.push("A critical price is unknown. The complete total cannot yet be validated.");
    if (group.some((m) => trip.briefs[m.id]?.confirmed &&
        cost(trip, m.id, choices).total[1] > trip.briefs[m.id].ceiling))
        issues.push("The complete estimate exceeds at least one included traveller's private ceiling.");
    return [...new Set(issues)];
}
export function invalidate(trip: Trip, message: string): void {
    trip.revision++;
    trip.status = "collecting";
    for (const p of Object.values(trip.polls))
        if (p && p.status === "open")
            p.status = "stale";
    trip.history.unshift({ at: now(), message });
}
export function saveBrief(trip: Trip, personId: string, brief: Brief, confirmed: boolean) {
    if (!trip.members.some((m) => m.id === personId))
        throw Error("Join this trip before saving a brief.");
    if (confirmed && briefErrors(trip, brief).length)
        throw Error(briefErrors(trip, brief).join(" "));
    const previous = trip.briefs[personId];
    const next = { ...brief, confirmed };
    const relevant = (b: Brief | undefined) => JSON.stringify(b && { ...b, text: undefined, stars: undefined });
    trip.briefs[personId] = next;
    if (relevant(previous) !== relevant(next))
        invalidate(trip, "A private input changed. Revalidate the plan before fresh responses.");
}
export function chooseDraft(trip: Trip, actor: string, choices: Choice, windowId: string) {
    requireOrganiser(trip, actor);
    const errors = feasibility(trip, choices, windowId);
    if (errors.length)
        throw Error(errors.join(" "));
    if (JSON.stringify(trip.selected) !== JSON.stringify(choices) ||
        trip.windowId !== windowId) {
        trip.selected = { ...choices };
        trip.windowId = windowId;
        invalidate(trip, "A working draft was selected.");
    }
}
export function requireOrganiser(trip: Trip, actor: string) {
    if (!trip.members.some((m) => m.id === actor && m.role === "organiser"))
        throw Error("Only the organiser can perform this action in the demo.");
}
export function publish(trip: Trip, actor: string) {
    requireOrganiser(trip, actor);
    if (trip.status === "postponed")
        throw Error("This trip is postponed. Start a new trip to propose a future journey.");
    const issues = feasibility(trip);
    if (issues.length)
        throw Error(issues.join(" "));
    if (Object.values(trip.polls).some((p) => p?.status === "open" || p?.status === "unresolved"))
        throw Error("Resolve the open or tied poll before publishing.");
    trip.versionCounter++;
    trip.plan = {
        version: trip.versionCounter,
        revision: trip.revision,
        roster: included(trip).map((m) => m.id),
        windowId: trip.windowId,
        choices: { ...trip.selected },
        at: now(),
    };
    trip.status = "reviewing";
    trip.history.unshift({
        at: now(),
        message: "Plan v" + trip.versionCounter + " published for individual review.",
    });
}
export const currentPlan = (trip: Trip) => !!trip.plan && trip.plan.revision === trip.revision;
export function currentResponse(trip: Trip, id: string) {
    return [...trip.responses]
        .reverse()
        .find((r) => r.personId === id &&
        r.version === trip.plan?.version &&
        r.revision === trip.revision);
}
export function respond(trip: Trip, actor: string, status: Response["status"], privateReason = "") {
    if (!currentPlan(trip) || !trip.plan?.roster.includes(actor))
        throw Error("Review a current published plan before responding.");
    if (trip.status === "postponed")
        throw Error("This trip has been postponed.");
    if (status === "ready" && feasibility(trip).length)
        throw Error("The complete plan must pass all hard checks before readiness.");
    trip.responses.push({
        personId: actor,
        version: trip.plan.version,
        revision: trip.revision,
        status,
        privateReason,
        at: now(),
    });
    if (trip.status === "agreed" && status !== "ready")
        trip.status = "reviewing";
}
export function closeRound(trip: Trip, actor: string) {
    requireOrganiser(trip, actor);
    if (trip.status === "postponed")
        throw Error("A postponed trip cannot become agreed without a new decision context.");
    if (!currentPlan(trip) || feasibility(trip).length)
        throw Error("Revalidate and publish the current terms first.");
    if (!trip.plan!.roster.every((id) => currentResponse(trip, id)?.status === "ready"))
        throw Error("Everyone included must explicitly be ready for this version. Silence is still pending.");
    trip.status = "agreed";
    trip.history.unshift({
        at: now(),
        message: "Everyone included confirmed Plan v" +
            trip.plan!.version +
            ". Bookings remain pending.",
    });
    const organiser = trip.members.find((m) => m.role === "organiser")!;
    const sharedOwner = organiser.included ? organiser.id : "";
    const wanted: BookingTask[] = [
        {
            id: uid(),
            title: "Stay · shared rooms",
            ownerId: sharedOwner,
            due: trip.deadline,
            status: "pending",
        },
        {
            id: uid(),
            title: "Local transport",
            ownerId: sharedOwner,
            due: trip.deadline,
            status: "pending",
        },
        ...included(trip).map((m) => ({
            id: uid(),
            title: "Return travel · " + m.name,
            ownerId: m.id,
            due: trip.deadline,
            status: "pending" as const,
        })),
        ...included(trip)
            .filter((m) => trip.briefs[m.id]?.boat)
            .map((m) => ({
            id: uid(),
            title: "Optional boat · " + m.name,
            ownerId: m.id,
            due: trip.deadline,
            status: "pending" as const,
        })),
    ];
    const active = wanted.map((task) => {
        const old = trip.tasks.find((t) => t.title === task.title);
        return old
            ? {
                ...old,
                archived: false,
                due: trip.deadline,
                ownerId: included(trip).some((m) => m.id === old.ownerId)
                    ? old.ownerId
                    : task.title.startsWith("Return travel") ||
                        task.title.startsWith("Optional boat")
                        ? task.ownerId
                        : "",
            }
            : task;
    });
    trip.tasks = [
        ...active,
        ...trip.tasks
            .filter((old) => !active.some((t) => t.id === old.id))
            .map((t) => ({ ...t, archived: true })),
    ];
}
export function openPoll(trip: Trip, actor: string, slot: Slot) {
    requireOrganiser(trip, actor);
    if (Object.values(trip.polls).some((p) => p?.status === "open"))
        throw Error("Close the current item poll before starting another.");
    if (options[slot].filter((o) => !feasibility(trip, { ...trip.selected, [slot]: o.id }).length).length < 2)
        throw Error("Two feasible alternatives are needed for this poll.");
    trip.polls[slot] = {
        slot,
        revision: trip.revision,
        status: "open",
        deadline: Date.now() + 86400000,
        ballots: {},
    };
}
export function vote(trip: Trip, actor: string, slot: Slot, choice: string | null) {
    const p = trip.polls[slot];
    if (!p ||
        p.status !== "open" ||
        p.revision !== trip.revision ||
        Date.now() >= p.deadline)
        throw Error("This poll is closed or stale.");
    if (!included(trip).some((m) => m.id === actor))
        throw Error("Only included travellers can vote.");
    if (choice !== null) {
        option(slot, choice);
        if (feasibility(trip, { ...trip.selected, [slot]: choice }).length)
            throw Error("This option no longer fits the confirmed inputs.");
    }
    p.ballots[actor] = choice;
}
export function closePoll(trip: Trip, actor: string, slot: Slot, clock = Date.now()) {
    requireOrganiser(trip, actor);
    const p = trip.polls[slot];
    if (!p || p.status !== "open" || p.revision !== trip.revision)
        throw Error("This poll is not current.");
    const group = included(trip);
    if (clock < p.deadline && !group.every((m) => m.id in p.ballots))
        throw Error("Wait for every ballot or the stated deadline. Abstaining is allowed.");
    const candidates = options[slot]
        .filter((o) => !feasibility(trip, { ...trip.selected, [slot]: o.id }).length)
        .map((o) => ({
        id: o.id,
        votes: group.filter((m) => p.ballots[m.id] === o.id).length,
        upper: group.reduce((s, m) => s + cost(trip, m.id, { ...trip.selected, [slot]: o.id }).total[1], 0),
    }));
    candidates.sort((a, b) => b.votes - a.votes || a.upper - b.upper);
    if (!candidates.length ||
        candidates.every((c) => c.votes === 0) ||
        (candidates[1] &&
            candidates[0].votes === candidates[1].votes &&
            candidates[0].upper === candidates[1].upper)) {
        p.status = "unresolved";
        return;
    }
    const winner = candidates[0].id;
    p.status = "closed";
    p.winner = winner;
    if (trip.selected[slot] !== winner) {
        trip.selected[slot] = winner;
        invalidate(trip, "A closed item poll updated the draft. Individual readiness is still required.");
    }
}
export function safeSummary(trip: Trip): string {
    const plan = trip.plan;
    const window = trip.windows.find((w) => w.id === (plan?.windowId || trip.windowId));
    return [
        trip.name + " · " + trip.destination,
        "Plan " +
            (plan ? "v" + plan.version : "draft") +
            (currentPlan(trip) ? " · current" : " · requires validation"),
        "Travel: " + window?.start + " → " + window?.end + " (Asia/Kolkata)",
        "Included: " +
            included(trip)
                .map((m) => m.name)
                .join(", "),
        ...slots.map((s) => slotLabels[s] + ": " + option(s, trip.selected[s]).title),
        "Status: " + trip.status,
        "All prices are illustrative. Bookings are separate. No private limits or reasons are included.",
    ].join("\n");
}
export function sampleTrip(): Trip {
    const people = ["Aarav", "Naina", "Arjun", "Meera", "Kabir", "Isha"].map((name, i) => ({
        id: "sample-" + i,
        name,
        email: i === 0 ? "aarav@example.com" : undefined,
    }));
    const t = makeTrip(people[0]);
    t.id = "sample-goa";
    t.token = "planzo-goa-demo";
    t.sample = true;
    t.members = people.map((p, i) => ({
        ...p,
        role: i === 0 ? "organiser" : "member",
        included: true,
    }));
    const ceilings = [15000, 11000, 16000, 14000, 13000, 18000];
    people.forEach((p, i) => {
        t.briefs[p.id] = {
            ...blankBrief(t),
            ceiling: ceilings[i],
            windows: t.windows.map((w) => w.id),
            confirmed: true,
            boat: i === 2 || i === 4,
            text: i === 1 ? "A relaxed pace, good food, and enough time to rest." : "",
        };
    });
    publish(t, people[0].id);
    return t;
}
export function reportBooking(trip: Trip, actor: string, taskId: string) {
    const task = trip.tasks.find((t) => t.id === taskId);
    if (!task ||
        task.archived ||
        task.ownerId !== actor ||
        trip.status !== "agreed" ||
        !currentPlan(trip) ||
        !trip.plan?.roster.includes(actor))
        throw Error("Only the assigned included owner can report a booking for a current agreed plan.");
    task.status = "reported";
    task.reportedAt = now();
    task.reportedVersion = trip.plan.version;
    task.reportedBy = actor;
    trip.history.unshift({
        at: now(),
        message: "Booking reported for " +
            task.title +
            " · Plan v" +
            trip.plan.version +
            ". Provider confirmation is not verified.",
    });
}
