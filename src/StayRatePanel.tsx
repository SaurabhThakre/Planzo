import { useEffect, useRef, useState } from "react";
import { loadStayRates, stayPricePerTraveller } from "./stayRates";
import type { RoomOccupancy, StayRateRequest, StayRateResult } from "./stayRates";
import { Button, Field } from "./ui";

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" });

export function StayRatePanel({ request, onSelect, disabled = false }: {
    request: StayRateRequest;
    onSelect?: (amount: string) => void;
    disabled?: boolean;
}) {
    const [adults, setAdults] = useState<RoomOccupancy>(2);
    const [result, setResult] = useState<StayRateResult | null>(null);
    const [state, setState] = useState<"idle" | "loading" | "complete">("idle");
    const active = useRef<AbortController | null>(null);
    useEffect(() => () => active.current?.abort(), []);

    async function refresh() {
        if (active.current) return;
        const controller = new AbortController();
        active.current = controller;
        const timeout = setTimeout(() => controller.abort(), 7000);
        setState("loading");
        try {
            setResult(await loadStayRates(request, controller.signal, adults));
        } catch {
            setResult(null);
        } finally {
            clearTimeout(timeout);
            active.current = null;
            setState("complete");
        }
    }

    return <div className="stack">
        {onSelect && <Field label="Adults sharing this room">
            <select value={adults} disabled={disabled || state === "loading"} onChange={event => {
                setAdults(event.target.value === "1" ? 1 : 2);
                setState("idle");
                setResult(null);
                onSelect("");
            }}>
                <option value="1">1 adult</option>
                <option value="2">2 adults</option>
            </select>
        </Field>}
        <Button type="button" variant="secondary" onClick={() => void refresh()} disabled={disabled || state === "loading"}>
            {state === "loading" ? "Checking stay rates…" : state === "idle" ? "Check current stay rates" : "Refresh stay rates"}
        </Button>
        {state === "complete" && (result ? <div>
            <p className="caption"><strong>{result.status === "live" ? "Current provider rates" : "Stale provider rates"}</strong> · {request.checkIn} to {request.checkOut} · 1 room, {adults} {adults === 1 ? "adult" : "adults"}</p>
            <ul>{result.rates.map((rate, index) => <li key={rate.provider + index}>
                {rate.provider} · {inr.format(rate.nightly)} per room per night
                {onSelect && result.status === "live" && <Button type="button" variant="ghost" disabled={disabled}
                  onClick={() => onSelect(stayPricePerTraveller(request, rate, adults).toFixed(2))}>
                    Use {rate.provider} rate as a starting point
                </Button>}
            </li>)}</ul>
            <p className="caption">Collected {new Date(result.collectedAt).toLocaleString("en-IN")}. Source: Xotelo. Check final taxes and availability with the provider. Only a price saved and reviewed by the group changes the agreed total.</p>
            <a href={request.hotel.source} target="_blank" rel="noreferrer">View property and compare rates</a>
        </div> : <p className="caption" role="status">A dated provider rate is unavailable. The planning estimate is shown above.</p>)}
    </div>;
}
