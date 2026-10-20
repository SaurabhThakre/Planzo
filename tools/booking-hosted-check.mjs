// Signed-out denial probes only, using the public browser key. No hosted writes.
import {createClient} from '@supabase/supabase-js';
import {writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const db=createClient('https://ewysgpuwvufbklesdhuj.supabase.co','sb_publishable_itUO45I1N1T3rp06T6p_DA_q-RN6DPI',{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
const checks=[];
async function denied(name,request){const r=await request;assert(r.error,name);checks.push({name,result:'pass',http_status:r.status,error_code:r.error.code});console.log('PASS',name);}
await denied('Signed-out booking read denied',db.rpc('planzo_booking',{p_action:'get',p_payload:{trip_id:'a5c044b5-812d-4f2a-8cc7-b0718ce1f767'}}));
await denied('Signed-out booking preparation denied',db.rpc('planzo_booking',{p_action:'prepare',p_payload:{trip_id:'a5c044b5-812d-4f2a-8cc7-b0718ce1f767'}}));
for(const table of ['booking_handoffs','booking_tasks','booking_reports','milestone_events'])await denied('Private table is not exposed: '+table,db.schema('planzo_private').from(table).select('*').limit(1));
await denied('Milestone evaluator is not a public RPC',db.rpc('booking_milestones',{p_trip:'a5c044b5-812d-4f2a-8cc7-b0718ce1f767'}));
await writeFile(new URL('../docs/backend/BOOKING_HOSTED_API_TESTS.json',import.meta.url),JSON.stringify({date:new Date().toISOString(),project:'ewysgpuwvufbklesdhuj',method:'signed-out public client; denial probes only',checks,passed:checks.length,failed:0},null,2)+'\n');
console.log(checks.length+' signed-out checks passed.');
