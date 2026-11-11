import { supabase } from "./backend";
import { parseCoverScene } from "../supabase/functions/planzo-destination-cover/scene";

export async function loadDestinationIllustration(tripId: string, signal: AbortSignal) {
    const { data, error } = await supabase.functions.invoke("planzo-destination-cover", {
        body: { trip_id: tripId },
        signal,
    });
    return error ? null : parseCoverScene(data?.scene);
}
