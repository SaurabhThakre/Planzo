import { useSyncExternalStore } from "react";
import { initialState } from "./domain";
import type { State, Trip } from "./domain";
export const storageKey = "planzo.demo.v1";
let warning = "";
function read(): State {
    try {
        const raw = localStorage.getItem(storageKey);
        if (!raw)
            return initialState();
        const s = JSON.parse(raw);
        if (s.schema !== 1 || !Array.isArray(s.trips) || !Array.isArray(s.people))
            throw Error();
        return s;
    }
    catch {
        warning =
            "Saved demo data could not be read. Your original browser data is preserved; new changes are session-only until you reset or repair it.";
        return initialState();
    }
}
let state = read();
const listeners = new Set<() => void>();
export const storageWarning = () => warning;
export function commit(fn: (s: State) => void) {
    const next = structuredClone(state);
    fn(next);
    if (!warning) {
        try {
            localStorage.setItem(storageKey, JSON.stringify(next));
        }
        catch {
            warning =
                "Browser storage is unavailable or full. Changes work in this session but may not survive a reload.";
        }
    }
    state = next;
    listeners.forEach((f) => f());
}
export function mutateTrip(id: string, fn: (trip: Trip) => void) {
    commit((s) => {
        const t = s.trips.find((t) => t.id === id);
        if (!t)
            throw Error("This trip is no longer available.");
        fn(t);
    });
}
export function useStore() {
    return useSyncExternalStore((cb) => {
        listeners.add(cb);
        return () => {
            listeners.delete(cb);
        };
    }, () => state);
}
window.addEventListener("storage", (e) => {
    if (e.key === storageKey) {
        state = read();
        listeners.forEach((f) => f());
    }
});
