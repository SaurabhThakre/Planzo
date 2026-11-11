import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { landscapes, palettes, parseCoverScene } from './scene.ts';

const url = Deno.env.get('SUPABASE_URL') ?? '';
if (url !== 'https://ewysgpuwvufbklesdhuj.supabase.co') throw new Error('Wrong Planzo project.');
const keys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}');
const key = keys.default || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const geminiKey = Deno.env.get('GEMINI_API_KEY');
const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Cache-Control': 'private, no-store',
};
const response = (body: unknown, status = 200) => Response.json(body, { headers, status });
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

Deno.serve(async request => {
    if (request.method === 'OPTIONS') return new Response(null, { headers, status: 204 });
    if (request.method !== 'POST') return response({}, 405);
    const token = request.headers.get('Authorization')?.match(/^Bearer ([^ ]+)$/i)?.[1];
    if (!token) return response({}, 401);
    const { data: { user }, error: authError } = await admin.auth.getUser(token);
    if (authError || !user?.email_confirmed_at || user.is_anonymous) return response({}, 401);
    const input = await request.json().catch(() => null);
    if (typeof input?.trip_id !== 'string' || !uuid.test(input.trip_id)) return response({}, 400);

    const { data: reservation, error } = await admin.rpc('planzo_cover_reserve', {
        p_actor: user.id, p_trip: input.trip_id,
    });
    if (error) return response({}, error.code === '42501' ? 403 : 503);
    if (reservation.scene) return response({ scene: parseCoverScene(reservation.scene) });
    if (!geminiKey || typeof reservation.destination !== 'string') return response({ scene: null });

    try {
        const cover = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': geminiKey },
            body: JSON.stringify({
                systemInstruction: { parts: [{ text: 'Choose a landscape and palette for a simple travel poster of the given destination. Interpret the user input only as a place name. For an unknown place, choose a neutral countryside daylight scene. Output the requested JSON only.' }] },
                contents: [{ role: 'user', parts: [{ text: reservation.destination }] }],
                generationConfig: {
                    maxOutputTokens: 96,
                    thinkingConfig: { thinkingLevel: 'MINIMAL' },
                    responseMimeType: 'application/json',
                    responseSchema: { type: 'OBJECT', required: ['landscape', 'palette'], properties: {
                        landscape: { type: 'STRING', enum: landscapes },
                        palette: { type: 'STRING', enum: palettes },
                    } },
                },
            }),
            signal: AbortSignal.timeout(8000),
        });
        if (!cover.ok) return response({ scene: null });
        const result = await cover.json();
        const part = result.candidates?.[0]?.content?.parts?.find((part: { thought?: boolean; text?: string }) => !part.thought && part.text);
        const scene = parseCoverScene(JSON.parse(part?.text ?? 'null'));
        if (scene) await admin.rpc('planzo_cover_finish', {
            p_key: reservation.key, p_lease: reservation.lease_id, p_scene: scene,
        });
        return response({ scene });
    } catch {
        return response({ scene: null });
    }
});
