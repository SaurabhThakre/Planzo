import type { FlowDocument, FlowStep } from "./privatePlanning.ts";
import type { MasterStepEdit } from "./MasterPlanEditor";
import { publishedLocalFare } from "./localTransportFare.ts";

export function isRepriceableStep(step: FlowStep, document: FlowDocument) {
    return step.kind === "stay" || (document.route_version === 1 && Boolean(publishedLocalFare(step, document)));
}

export function confirmedPricePaise(amount: string, previous: number) {
    if (!/^\d{1,9}(?:\.\d{1,2})?$/.test(amount.trim())) {
        throw Error("Enter the all-in INR price per traveller, with up to two decimals.");
    }
    const [rupees, fraction = ""] = amount.trim().split(".");
    const paise = Number(rupees) * 100 + Number(fraction.padEnd(2, "0"));
    if (paise > 10000000000) throw Error("The price exceeds the supported amount.");
    if (paise === previous) throw Error("This is already the reviewed amount.");
    return paise;
}

export function repriceStay(document: FlowDocument, stepId: string, amount: string): MasterStepEdit[] {
    const stay = document.steps.find(step => step.id === stepId && step.kind === "stay");
    if (!stay) throw Error("Choose a stay from this itinerary version.");
    const paise = confirmedPricePaise(amount, stay.cost_paise);
    return document.steps.map(step => ({
        start: step.start,
        end: step.end,
        kind: step.kind,
        ref: step.ref,
        title: document.refs.find(ref => ref.id === step.ref)?.title ?? "",
        cost_paise: step.id === stay.id ? paise : step.cost_paise,
        ...(document.route_version === 1 ? { route_ref: step.route_ref } : {}),
    }));
}
