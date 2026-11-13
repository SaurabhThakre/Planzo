import assert from "node:assert/strict";
import { test } from "node:test";
import { bookingOptionsForStep, bookingSearchName } from "../src/bookingOptions.ts";

const now = Date.parse("2026-12-01T00:00:00Z");
test("optional shopping spend does not turn a free market visit into a booking", () => {
    const market = { refs: [{ id: "market", title: "Anjuna Flea Market Visit", route_item: {
        category: "visit", price: { low_inr: 0, high_inr: 200, assumptions: "Free entry, optional shopping." },
    } }] };
    assert.equal(bookingOptionsForStep({ kind: "activity", ref: "market", start: "2026-12-14T09:00:00Z", end: "2026-12-14T10:00:00Z", cost_paise: 20000 }, market, "Goa", now), null);
});
const document = {
    route: { time_zone: "Asia/Kolkata", zones: [
        { id: "airport", name: "Dabolim Airport" },
        { id: "beach", name: "Calangute" },
    ] },
    refs: [
        { id: "hotel", title: "Calangute Residency", route_item: { category: "stay", zone: "beach" } },
        { id: "walk", title: "Fontainhas guided heritage walk", route_item: { category: "visit" } },
        { id: "transfer", title: "Dabolim airport taxi", route_item: { title: "Dabolim airport taxi", category: "transfer", mode: "taxi", zone: "airport", end_zone: "beach" } },
        { id: "beach", title: "Walk along the beach", route_item: { category: "visit" } },
    ],
};
const step = { kind: "stay", ref: "stay", route_ref: "hotel", start: "2026-12-14T14:30:00Z", end: "2026-12-15T04:30:00Z", cost_paise: 300000 };

test("stay comparisons include independent providers and avoid ambiguous Goa airport searches", () => {
    const options=bookingOptionsForStep(step,document,"Goa",now);
    assert.deepEqual(options.links.map(link=>new URL(link.href).hostname),["www.booking.com","www.expedia.co.in","www.google.com"]);
    const comparison=new URL(options.links[1].href);
    assert.equal(comparison.searchParams.get("destination"),"Calangute Residency, Calangute, Goa, India");
    assert.equal(comparison.searchParams.get("startDate"),"2026-12-14");
    assert.equal(comparison.searchParams.get("endDate"),"2026-12-15");
    for(const name of ["Stay at Calangute Residency · day 2","Stay Calangute Residency — day 3","Calangute Residency - day 4"])assert.equal(bookingSearchName(name),"Calangute Residency");
});

test("major activities offer multiple catalogues and an encoded local-operator search",()=>{
    const title="Kayaking & boat tour / café";
    const doc={...document,refs:[{id:"kayak",title,route_item:{category:"visit"}}]};
    const options=bookingOptionsForStep({...step,kind:"activity",ref:"kayak",route_ref:undefined},doc,"Udaipur",now);
    assert.deepEqual(options.links.map(link=>new URL(link.href).hostname),["www.viator.com","www.getyourguide.com","www.klook.com","www.google.com"]);
    assert.equal(new URL(options.links[0].href).searchParams.get("text"),title+" Udaipur");
    const maps=new URL(options.links[3].href);
    assert.equal(maps.searchParams.get("api"),"1");
    assert.equal(maps.searchParams.get("query"),title+" Udaipur");
});

test("non-Goa transfers include direct operators and transport route information",()=>{
    const taxi=bookingOptionsForStep({...step,kind:"activity",ref:"transfer"},document,"Udaipur",now);
    assert.equal(new URL(taxi.links[0].href).hostname,"www.google.com");
    assert.ok(new URL(taxi.links[0].href).searchParams.get("query").includes("Udaipur"));
    const rail={...document,refs:document.refs.map(ref=>ref.id==="transfer"?{...ref,route_item:{...ref.route_item,title:"Reserved express train",mode:"rail"}}:ref)};
    const options=bookingOptionsForStep({...step,kind:"activity",ref:"transfer"},rail,"India",now);
    assert.equal(options.links.length,2);
    assert.equal(new URL(options.links[1].href).hostname,"www.rome2rio.com");
    assert.ok(options.links.every(link=>!link.href.includes("getyourguide")));
});

test("stay search uses the exact destination-local dates and changes the search for an alternative stay", () => {
    const option = bookingOptionsForStep(step, document, "Goa", now);
    assert.equal(option.category, "Stay");
    const url = new URL(option.links[0].href);
    assert.equal(url.hostname, "www.booking.com");
    assert.deepEqual(Object.fromEntries(url.searchParams), {
        ss: "Calangute Residency, Goa", checkin: "2026-12-14", checkout: "2026-12-15",
    });
    const alternative = bookingOptionsForStep({ ...step, ref: "stay_alternative" }, document, "Goa", now);
    assert.equal(new URL(alternative.links[0].href).searchParams.get("ss"), "Calangute, Goa");
});

test("a verified listing is offered only when the actual route and allotted time fit", () => {
    const transfer = { ...step, kind: "activity", ref: "transfer" };
    const options = bookingOptionsForStep(transfer, document, "Goa", now);
    assert.equal(options.category, "Transfer");
    assert.match(options.links[0].href, /67515P154$/);
    assert.equal(options.links[1].href, "https://www.goamiles.com/GoaCare/faqpassenger");
    const tooShort = bookingOptionsForStep({ ...transfer, end: "2026-12-14T15:00:00Z" }, document, "Goa", now);
    assert.equal(tooShort.links.some(link => link.href.endsWith("67515P154")), false);
    const activity = bookingOptionsForStep({ ...step, kind: "activity", ref: "walk" }, document, "Goa", now);
    assert.equal(activity.category, "Activity");
    assert.match(activity.links[0].href, /117330P1$/);
    assert.equal(new URL(activity.links[1].href).searchParams.get("q"), "Fontainhas guided heritage walk Goa");
});

test("meal, rest, walking transfers, ordinary free activities and past steps have no booking options", () => {
    for (const [kind, ref] of [["food", "food"], ["rest", "rest"], ["activity", "beach"]]) {
        assert.equal(bookingOptionsForStep({ ...step, kind, ref, cost_paise: 0 }, document, "Goa", now), null);
    }
    const walking = { ...document, refs: document.refs.map(ref => ref.id === "transfer"
        ? { ...ref, route_item: { ...ref.route_item, mode: "walk" } } : ref) };
    assert.equal(bookingOptionsForStep({ ...step, kind: "activity", ref: "transfer" }, walking, "Goa", now), null);
    assert.equal(bookingOptionsForStep(step, document, "Goa", Date.parse(step.end)), null);
});
