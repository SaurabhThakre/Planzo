import { contextualStepLabel, contextualStepRef } from "./contextualPlanning.ts";
import type { FlowDocument, FlowStep } from "./privatePlanning.ts";
import { destinationDay } from "./routePlanning.ts";

type BookingLink = { label: string; href: string };
type BookingOptions = { category: "Stay" | "Activity" | "Transfer"; links: BookingLink[] };

const searchUrl = (base: string, params: Record<string, string>) =>
    base + "?" + new URLSearchParams(params).toString();
const mapsSearch = (query: string): BookingLink => ({label:"Find local operators / direct contact",href:searchUrl("https://www.google.com/maps/search/",{api:"1",query})});
const activitySearch = (query: string): BookingLink[] => [
    {label:"Compare on Viator",href:searchUrl("https://www.viator.com/searchResults/all",{text:query})},
    {label:"Search activities on GetYourGuide",href:searchUrl("https://www.getyourguide.com/s/",{q:query})},
    {label:"Compare on Klook",href:searchUrl("https://www.klook.com/en-IN/search/result/",{query})},
];
export const bookingSearchName = (title: string) => title.replace(/^stay(?:\s+at)?\s+/i,"").replace(/\s*[·—–-]\s*day\s*\d+\s*$/i,"").trim();

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
        const property = step.ref.endsWith("_alternative") ? "" : reference?.title && bookingSearchName(reference.title);
        const query = [...new Set([property || place, destination])].join(", ");
        const checkin = destinationDay(step.start, document.route?.time_zone);
        const checkout = destinationDay(step.end, document.route?.time_zone);
        if (checkin >= checkout || checkin < destinationDay(new Date(now).toISOString(), document.route?.time_zone)) return null;
        return { category: "Stay", links: [{
            label: "Search stays on Booking.com",
            href: searchUrl("https://www.booking.com/searchresults.html", { ss: query, checkin, checkout }),
        },{
            label:"Compare stays on Expedia",
            href:searchUrl("https://www.expedia.co.in/Hotel-Search",{destination:[...new Set([property,place,goa?"Goa, India":destination].filter(Boolean))].join(", "),startDate:checkin,endDate:checkout}),
        },{...mapsSearch(query+" accommodation"),label:"Find property & direct contact"}] };
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
        }
        const routeQuery=[from && to ? `${from} to ${to}` : item.title,destination,item.mode,"transfer"].join(" ");
        if(item.mode==="taxi"){
            // Direct local contact remains useful where global tour catalogues have no inventory.
            links.push(mapsSearch([item.mode+" service",from||to||item.location,destination].filter(Boolean).join(" ")));
            if(!goa)links.push(...activitySearch(routeQuery));
            else links.push({label:"Compare transfers on GetYourGuide",href:searchUrl("https://www.getyourguide.com/s/",{q:routeQuery})});
        }else{
            links.push(mapsSearch([item.mode+" operator",from,to,destination].filter(Boolean).join(" ")));
            if(from&&to)links.push({label:"Compare the route on Rome2Rio",href:"https://www.rome2rio.com/map/"+encodeURIComponent(from+", "+destination)+"/"+encodeURIComponent(to+", "+destination)});
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
    const query=`${title} ${destination}`;
    if(!majorActivity)links.push({...mapsSearch(query),label:"Find venue / ticket information"});
    // Retain a known exact listing as primary, with independent provider alternatives.
    const searches=activitySearch(query);
    if(links.length)links.push(searches[1],searches[0],searches[2]);else links.push(...searches);
    if(majorActivity)links.push(mapsSearch(query));
    return { category: "Activity", links };
}
