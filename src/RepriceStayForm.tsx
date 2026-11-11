import { useState } from "react";
import { contextualStepLabel } from "./contextualPlanning";
import { publishedLocalFare } from "./localTransportFare";
import { flowMoney } from "./privatePlanning";
import type { FlowDocument } from "./privatePlanning";
import { confirmedPricePaise, isRepriceableStep } from "./repriceStay";
import { routeStamp } from "./routePlanning";
import { StayRatePanel } from "./StayRatePanel";
import { stayRateRequest } from "./stayRates";
import { Actions, Button, Card, Field } from "./ui";

export function RepriceStayForm({ document, busy, save }: {
    document: FlowDocument;
    busy: boolean;
    save: (stepId: string, amount: string, paise: number) => Promise<void>;
}) {
    const steps = document.steps.filter(step => isRepriceableStep(step, document));
    const [stepId, setStepId] = useState(steps[0]?.id ?? "");
    const [amount, setAmount] = useState("");
    const [confirmed, setConfirmed] = useState(false);
    const [error, setError] = useState("");
    const selected = steps.find(step => step.id === stepId);
    if (!selected) return null;
    const stay = selected.kind === "stay";
    const rate = stayRateRequest(selected, document);
    const fare = publishedLocalFare(selected, document);
    const changeAmount = (value: string) => {
        setAmount(value);
        setConfirmed(false);
        setError("");
    };

    return <Card title="Update a stay or shuttle price">
        <form className="stack" onSubmit={async event => {
            event.preventDefault();
            if (busy || !confirmed) return;
            setError("");
            try {
                await save(stepId, amount, confirmedPricePaise(amount, selected.cost_paise));
            } catch (cause) {
                setError(cause instanceof Error ? cause.message : "The revised price could not be saved.");
            }
        }}>
            <Field label="Stay or airport shuttle">
                <select value={stepId} disabled={busy} onChange={event => {
                    setStepId(event.target.value);
                    changeAmount("");
                }}>
                    {steps.map(step => <option value={step.id} key={step.id}>
                        {contextualStepLabel(step, document.refs)} · {routeStamp(step.start, document)}
                    </option>)}
                </select>
            </Field>
            <p className="caption">Current plan price {flowMoney(selected.cost_paise)} per traveller.</p>
            {rate && <StayRatePanel key={stepId} request={rate} onSelect={changeAmount} disabled={busy}/>}
            {fare && <div className="stack">
                <p className="caption">Published fare {flowMoney(fare.amountPaise)} per passenger.
                    {" "}<a href={fare.sourceUrl} target="_blank" rel="noreferrer">Kadamba Transport, {fare.publishedOn}</a>
                </p>
                <Button type="button" variant="secondary" disabled={busy}
                  onClick={() => changeAmount((fare.amountPaise / 100).toFixed(2))}>Use published fare as a starting point</Button>
            </div>}
            <Field label="All-in INR price per traveller">
                <input type="text" inputMode="decimal" maxLength={12} required disabled={busy}
                  value={amount} onChange={event => changeAmount(event.target.value)}/>
            </Field>
            <label className="check"><input type="checkbox" checked={confirmed} disabled={busy}
              onChange={event => setConfirmed(event.target.checked)}/>
              {stay ? "I checked the stay dates, occupancy, taxes and mandatory charges with the provider."
                  : "I checked the shuttle route, travel date, fare and mandatory charges with the operator."}</label>
            <p className="caption">The new draft checks everyone’s private budget and requires fresh reviews. Earlier versions stay in History.</p>
            {error && <p className="form-error" role="alert">{error}</p>}
            <Actions><Button type="submit" disabled={busy || !confirmed || !amount.trim()}>
                {busy ? "Saving draft…" : "Save price in a new draft"}
            </Button></Actions>
        </form>
    </Card>;
}
