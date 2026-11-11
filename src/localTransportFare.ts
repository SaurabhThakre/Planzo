import { routeRef } from "./routePlanning.ts";
import type { FlowDocument, FlowStep } from "./privatePlanning.ts";

const publishedFareSource = "https://www.goa.gov.in/wp-content/uploads/2026/01/CITIZEN-CHARTER-KTCL.pdf";
const fares = [
    { airport: /\b(?:mopa|manohar international airport|gox)\b/i, destination: /^panaji(?: bus (?:stand|station))?$/i, rupees: 200 },
    { airport: /\b(?:mopa|manohar international airport|gox)\b/i, destination: /^mapusa(?: bus (?:stand|station))?$/i, rupees: 150 },
    { airport: /\b(?:mopa|manohar international airport|gox)\b/i, destination: /^calangute beach$/i, rupees: 200 },
    { airport: /\b(?:mopa|manohar international airport|gox)\b/i, destination: /^margao(?: bus (?:stand|station))?$/i, rupees: 400 },
    { airport: /\b(?:dabolim|goi)\b/i, destination: /^panaji(?: bus (?:stand|station))?$/i, rupees: 150 },
    { airport: /\b(?:dabolim|goi)\b/i, destination: /^calangute beach$/i, rupees: 200 },
];

export function publishedLocalFare(step: FlowStep, document: FlowDocument) {
    const item = routeRef(step, document.refs)?.route_item;
    if (!item || item.category !== "transfer" || !["bus", "local_transit"].includes(item.mode)
        || !/shuttle/i.test(item.title)) return null;
    const from = document.route?.zones.find(zone => zone.id === item.zone)?.name.trim();
    const to = document.route?.zones.find(zone => zone.id === item.end_zone)?.name.trim();
    if (!from || !to) return null;
    const fare = fares.find(entry => entry.airport.test(from) && entry.destination.test(to));
    return fare ? { amountPaise: fare.rupees * 100, sourceUrl: publishedFareSource, publishedOn: "28 Jan 2026" } : null;
}
