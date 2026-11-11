import assert from "node:assert/strict";
import { test } from "node:test";
import { loadStayRates, stayRateRequest } from "../src/stayRates.ts";
import { publishedLocalFare } from "../src/localTransportFare.ts";

const step = {
    id: "1", kind: "stay", ref: "stay", route_ref: "hotel",
    start: "2026-12-14T19:00:00Z", end: "2026-12-15T04:00:00Z",
};
const itinerary = {
    route: { time_zone: "Asia/Kolkata" },
    refs: [{ id: "hotel", title: "Taj Fort Aguada Resort & Spa, Goa" }],
};

test("routine stay labels preserve exact property matching across repeated nights", () => {
    const overnight = { ...step, start: "2026-12-14T15:00:00Z" };
    const labelled = title => ({ ...itinerary, refs: [{ id: "hotel", title }] });
    for (const title of ["Stay at Calangute Residency", "Stay at Calangute Residency · day 2"]) {
        assert.equal(stayRateRequest(overnight, labelled(title)).hotel.key, "g306995-d1178946");
    }
    assert.equal(stayRateRequest(overnight, labelled("Stay at Calangute Residency Annex")), null);
});

test("hotel rates require an exact property and use destination-local nights", () => {
    assert.equal(stayRateRequest(step, itinerary), null);
    const overnight = { ...step, start: "2026-12-14T15:00:00Z" };
    const request = stayRateRequest(overnight, itinerary);
    assert.equal(request.hotel.key, "g1165042-d304837");
    assert.equal(request.checkIn, "2026-12-14");
    assert.equal(request.checkOut, "2026-12-15");
    assert.equal(stayRateRequest({ ...overnight, ref: "stay_alternative" }, itinerary), null);
    assert.equal(stayRateRequest(overnight, { ...itinerary, refs: [{ id: "hotel", title: "Aguada guest house" }] }), null);
});

test("dated INR rates distinguish live, stale and unavailable responses", async (t) => {
    const request = stayRateRequest({ ...step, start: "2026-12-14T15:00:00Z" }, itinerary);
    const signal = new AbortController().signal;
    let timestamp = Date.now();
    let currency = "INR";
    let date = request.checkIn;
    t.mock.method(globalThis, "fetch", async (input, options) => {
        const url = new URL(input);
        assert.equal(url.hostname, "data.xotelo.com");
        assert.deepEqual(Object.fromEntries(url.searchParams), {
            hotel_key: request.hotel.key, chk_in: request.checkIn, chk_out: request.checkOut,
            currency: "INR", rooms: "1", adults: "2",
        });
        assert.equal(options.credentials, "omit");
        return Response.json({ timestamp, result: { currency, chk_in: date, chk_out: request.checkOut, rates: [
            { name: "Provider A", rate: 5000 }, { name: "Provider B", rate: 4500 }, { name: "Invalid", rate: -2 },
        ] } });
    });
    let value = await loadStayRates(request, signal);
    assert.equal(value.status, "live");
    assert.deepEqual(value.rates.map(rate => rate.nightly), [4500, 5000]);
    timestamp = Math.floor((Date.now() - 90000000) / 1000);
    assert.equal((await loadStayRates(request, signal)).status, "stale");
    currency = "USD";
    assert.equal(await loadStayRates(request, signal), null);
    currency = "INR";
    date = "2026-12-13";
    assert.equal(await loadStayRates(request, signal), null);
});

test("published Goa fare applies only to matching airport shuttle directions", () => {
    const transfer = { ...step, kind: "activity", ref: "transfer" };
    const item = { category: "transfer", mode: "bus", title: "Airport shuttle", zone: "mopa", end_zone: "panaji" };
    const document = {
        route: { zones: [{ id: "mopa", name: "Manohar International Airport" }, { id: "panaji", name: "Panaji" }] },
        refs: [{ id: "transfer", route_item: item }],
    };
    assert.equal(publishedLocalFare(transfer, document).amountPaise, 20000);
    item.mode = "taxi";
    assert.equal(publishedLocalFare(transfer, document), null);
    item.mode = "bus";
    item.zone = "panaji";
    item.end_zone = "mopa";
    assert.equal(publishedLocalFare(transfer, document), null);
});

test("prefilling a current nightly room rate spreads the full stay across the quoted adults", async () => {
    const { stayPricePerTraveller } = await import("../src/stayRates.ts");
    const request = { checkIn: "2026-12-14", checkOut: "2026-12-17" };
    assert.equal(stayPricePerTraveller(request, { nightly: 4500.01 }, 2), 6750.02);
    assert.equal(stayPricePerTraveller(request, { nightly: 4500.01 }, 1), 13500.03);
});
