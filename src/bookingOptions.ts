import { contextualStepLabel, contextualStepRef } from "./contextualPlanning.ts";
import type { FlowDocument, FlowStep } from "./privatePlanning.ts";
import { destinationDay } from "./routePlanning.ts";

type BookingLink = { label: string; href: string };
type BookingOptions = { category: "Stay" | "Activity" | "Transfer"; links: BookingLink[] };

const searchUrl = (base: string, params: Record<string, string>) =>
    base + "?" + new URLSearchParams(params).toString();

export function bookingOptionsForStep(
    step: FlowStep, document: FlowDocument, destination: string, now = Date.now(),
): BookingOptions | null {
    const start = Date.parse(step.start);
    const end = Date.parse(step.end);
    if (!(end > start && end > now) || !destination.trim()) return null;
    const reference = contextualStepRef(step, document.refs);
    const item = reference?.route_item;
    const goa = /\bgoa\b/i.test(destination);
    const title = contextualStepLabel(step, document.refs);

    if (step.kind === "stay") {
        const area = item ? document.route?.zones.find(zone => zone.id === item.zone) : undefined;
        const place = area?.name || reference?.location || destination;
        const property = step.ref.endsWith("_alternative") ? "" : reference?.title;
        const query = [...new Set([property || place, destination])].join(", ");
        const checkin = destinationDay(step.start, document.route?.time_zone);
        const checkout = destinationDay(step.end, document.route?.time_zone);
        if (checkin >= checkout || checkin < destinationDay(new Date(now).toISOString(), document.route?.time_zone)) return null;
        return { category: "Stay", links: [{
            label: "Search stays on Booking.com",
            href: searchUrl("https://www.booking.com/searchresults.html", { ss: query, checkin, checkout }),
        }] };
    }
    if (step.kind !== "activity") return null;

    if (item?.category === "transfer") {
        const reservable = item.mode === "taxi"
            || ["ferry", "rail", "bus"].includes(item.mode)
                && /\b(?:reserved|private|airport|express|coach|shuttle|high-speed)\b/i.test(item.title);
        if (!reservable) return null;
        const from = document.route?.zones.find(zone => zone.id === item.zone)?.name || "";
        const to = document.route?.zones.find(zone => zone.id === item.end_zone)?.name || "";
        const links: BookingLink[] = [];
        if (goa && item.mode === "taxi") {
            if (/\bdabolim\b/i.test(from) && /\bcalangute\b/i.test(to) && end - start >= 3600000) {
                links.push({ label: "View Dabolim–Calangute transfer on Viator", href: "https://www.viator.com/tours/Goa/Affordable-Goa-Airport-transfer-to-Calangute-Area/d4594-67515P154" });
            }
            links.push(
                { label: "GoaMiles passenger information", href: "https://www.goamiles.com/GoaCare/faqpassenger" },
                { label: "Browse Goa transfers on Viator", href: "https://www.viator.com/Goa-tours/Transfers-and-Ground-Transport/d4594-g15" },
            );
        } else {
            links.push({ label: "Search transport on GetYourGuide", href: searchUrl("https://www.getyourguide.com/s/", {
                q: [from && to ? `${from} to ${to}` : item.title, destination, item.mode, "transfer"].join(" "),
            }) });
        }
        return { category: "Transfer", links };
    }

    const majorActivity = /\b(?:tours?|guided|heritage walk|cruise|class|workshop|safari|scuba|kayak(?:ing)?|surf(?:ing)?|tickets?)\b/i.test(title);
    const freeEntry = item?.price?.low_inr === 0
        || /\bfree (?:entry|admission|access)|\bno (?:entry|admission) fee\b/i.test(item?.price?.assumptions || "");
    if (!majorActivity && freeEntry) return null;
    if ((item && item.category !== "visit") || (!majorActivity && step.cost_paise <= 0)) return null;
    const links: BookingLink[] = [];
    if (goa && /\bfontainhas\b/i.test(title) && /\b(?:guided|heritage walk|tour)\b/i.test(title)) {
        const durationMinutes = (end - start) / 60000;
        if (durationMinutes >= 150) links.push({
            label: "View the 2½-hour Fontainhas Heritage Walk on Viator",
            href: "https://www.viator.com/en-GB/tours/Goa/Fontainhas-Heritage-Walk/d4594-117330P1",
        });
    }
    links.push({ label: "Search activities on GetYourGuide", href: searchUrl("https://www.getyourguide.com/s/", {
        q: `${title} ${destination}`,
    }) });
    return { category: "Activity", links };
}
