import { destinationDay, routeRef } from "./routePlanning.ts";
import type { FlowDocument, FlowStep } from "./privatePlanning.ts";

const hotels = [{
    name: "Taj Fort Aguada Resort & Spa",
    key: "g1165042-d304837",
    source: "https://www.tripadvisor.com/Hotel_Review-g1165042-d304837-Reviews-Taj_Fort_Aguada_Resort_Spa_Goa-Sinquerim_North_Goa_District_Goa.html",
}, {
    name: "Calangute Residency",
    key: "g306995-d1178946",
    source: "https://www.tripadvisor.in/Hotel_Review-g306995-d1178946-Reviews-Calangute_Residency-Calangute_North_Goa_District_Goa.html",
}, {
    name: "Taj Holiday Village Resort & Spa",
    key: "g1165042-d304835",
    source: "https://www.tripadvisor.in/Hotel_Review-g1165042-d304835-Reviews-Taj_Holiday_Village_Resort_Spa_Goa-Sinquerim_North_Goa_District_Goa.html",
}, {
    name: "Goa Marriott Resort & Spa",
    key: "g303877-d307517",
    source: "https://www.tripadvisor.in/Hotel_Review-g303877-d307517-Reviews-Goa_Marriott_Resort_Spa-Panjim_North_Goa_District_Goa.html",
}];
const normalizeName = (name: string) => name.toLowerCase().replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ").trim();

export function stayRateRequest(step: FlowStep, document: FlowDocument) {
    if (step.kind !== "stay" || step.ref.endsWith("_alternative")) return null;
    const name = routeRef(step, document.refs)?.title
        .replace(/^(?:stay|overnight) at\s+/i, "")
        .replace(/\s*[·-]\s*day\s+\d+$/i, "");
    if (!name) return null;
    const hotel = hotels.find(entry => [entry.name, entry.name + " Goa"].some(alias =>
        normalizeName(alias) === normalizeName(name)));
    if (!hotel) return null;
    const checkIn = destinationDay(step.start, document.route?.time_zone);
    const checkOut = destinationDay(step.end, document.route?.time_zone);
    if (checkIn >= checkOut) return null;
    return { hotel, checkIn, checkOut };
}

export type StayRateRequest = NonNullable<ReturnType<typeof stayRateRequest>>;
export type StayRate = { provider: string; nightly: number };
export type RoomOccupancy = 1 | 2;
const dayMs = 86400000;

export function stayPricePerTraveller(request: StayRateRequest, rate: StayRate, adults: RoomOccupancy) {
    const nights = (Date.parse(request.checkOut) - Date.parse(request.checkIn)) / dayMs;
    return Math.round(rate.nightly * nights * 100 / adults) / 100;
}
export type StayRateResult = { status: "live" | "stale"; collectedAt: number; rates: StayRate[] };

export async function loadStayRates(request: StayRateRequest, signal: AbortSignal, adults: RoomOccupancy = 2): Promise<StayRateResult | null> {
    const { hotel, checkIn, checkOut } = request;
    const url = new URL("https://data.xotelo.com/api/rates");
    url.search = new URLSearchParams({
        hotel_key: hotel.key, chk_in: checkIn, chk_out: checkOut, currency: "INR", rooms: "1", adults: String(adults),
    }).toString();
    const response = await fetch(url, { signal, credentials: "omit", referrerPolicy: "no-referrer" });
    if (!response.ok) return null;
    const { error, result, timestamp } = await response.json();
    if (error || result?.chk_in !== checkIn || result.chk_out !== checkOut || result.currency !== "INR"
        || !Array.isArray(result.rates) || !Number.isFinite(timestamp) || timestamp <= 0) return null;
    const collectedAt = timestamp < 1e11 ? timestamp * 1000 : timestamp;
    const age = Date.now() - collectedAt;
    if (age < -300000) return null;
    const rates = result.rates.flatMap((rate: { name?: unknown; rate?: unknown } | null): StayRate[] =>
        typeof rate?.name === "string" && rate.name.trim().length > 0 && rate.name.length <= 80
        && typeof rate.rate === "number" && Number.isFinite(rate.rate) && rate.rate > 0 && rate.rate <= 100000000
            ? [{ provider: rate.name.trim(), nightly: rate.rate }] : [])
        .sort((a: StayRate, b: StayRate) => a.nightly - b.nightly)
        .slice(0, 5);
    return rates.length ? { status: age > dayMs ? "stale" : "live", collectedAt, rates } : null;
}
