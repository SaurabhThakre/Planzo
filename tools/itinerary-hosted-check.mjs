// Signed-out hosted API probes only. No identity, email or application row is created.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
const source=await readFile(new URL('./hosted-smoke.mjs',import.meta.url),'utf8');
const origin='https://ewysgpuwvufbklesdhuj.supabase.co';
const key=source.match(/apikey:'([^']+)'/)?.[1];assert(key?.startsWith('sb_publishable_'));
const headers={apikey:key,'Content-Type':'application/json'},tests=[];
for(const action of ['get','prepare']){
 const r=await fetch(origin+'/rest/v1/rpc/planzo_itinerary',{method:'POST',headers,body:JSON.stringify({p_action:action,p_payload:{}})}),b=await r.json();
 assert.equal(r.status,401);assert.match(b.message,/permission denied/);tests.push({name:'Signed-out itinerary '+action+' denied',status:r.status,result:'pass'});
}
for(const table of ['itinerary_drafts','itinerary_polls','itinerary_ballots']){
 const r=await fetch(origin+'/rest/v1/'+table+'?select=*',{headers}),b=await r.json();assert.equal(r.status,404);assert.equal(b.code,'PGRST205');tests.push({name:'Private '+table+' is not exposed',status:r.status,result:'pass'});
}
const r=await fetch(origin+'/rest/v1/rpc/evaluate_itinerary',{method:'POST',headers,body:'{}'}),b=await r.json();assert.equal(r.status,404);assert.equal(b.code,'PGRST202');tests.push({name:'Private itinerary evaluator is not exposed',status:r.status,result:'pass'});
await writeFile(new URL('../docs/backend/ITINERARY_HOSTED_API_TESTS.json',import.meta.url),JSON.stringify({project:'ewysgpuwvufbklesdhuj',date:new Date().toISOString(),tests,scope:'Signed-out REST/RPC boundaries; not a substitute for ordinary signed-in A/B/C verification.'},null,2)+'\n');
console.log(tests.length+' hosted itinerary checks passed.');
