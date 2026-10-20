import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
const origin='https://ewysgpuwvufbklesdhuj.supabase.co';
const headers={apikey:'sb_publishable_itUO45I1N1T3rp06T6p_DA_q-RN6DPI','Content-Type':'application/json'};
const evidence=[];
async function check(name,path,options,verify){const r=await fetch(origin+path,{...options,headers:{...headers,...options?.headers}});const body=await r.json();verify(r,body);evidence.push({name,status:r.status,result:'pass'});console.log('PASS',name,r.status);return body;}
const settings=await check('Email authentication endpoint is reachable','/auth/v1/settings',{},(r,b)=>{assert(r.ok);assert.equal(b.external.email,true);});
await check('Signed-out workspace API is denied','/rest/v1/rpc/planzo_api',{method:'POST',body:JSON.stringify({p_action:'list',p_payload:{}})},(r,b)=>{assert(!r.ok);assert.match(b.message,/permission denied/);});
await check('Invalid invitation returns no shared records','/rest/v1/rpc/planzo_invite_preview',{method:'POST',body:JSON.stringify({p_token:'invalid'})},(r,b)=>{assert(!r.ok);assert.match(b.message,/invalid, expired or revoked/);});
await check('Signed-out trip enumeration is denied','/rest/v1/planzo_trips?select=id',{method:'GET'},(r,b)=>{assert(!r.ok);assert.match(b.message,/permission denied/);});
await check('Fabricated credentials cannot sign in','/auth/v1/token?grant_type=password',{method:'POST',body:JSON.stringify({email:'planzo-smoke-test@example.invalid',password:crypto.randomUUID()})},(r,b)=>{assert(!r.ok);assert.equal(b.error_code,'invalid_credentials');});
await check('Signed-out planning RPC is denied','/rest/v1/rpc/planzo_planning',{method:'POST',body:JSON.stringify({p_action:'get',p_payload:{}})},(r,b)=>{assert(!r.ok);assert.match(b.message,/permission denied/);});
await check('Private plan snapshots are not exposed in REST','/rest/v1/plan_versions?select=id',{method:'GET'},(r,b)=>{assert.equal(r.status,404);assert.equal(b.code,'PGRST205');});
await check('Internal group evaluator is not exposed as a public RPC','/rest/v1/rpc/evaluate_plan',{method:'POST',body:JSON.stringify({})},(r,b)=>{assert.equal(r.status,404);assert.equal(b.code,'PGRST202');});
await writeFile(new URL('../docs/backend/HOSTED_API_TESTS.json',import.meta.url),JSON.stringify({project:'ewysgpuwvufbklesdhuj',emailAutoconfirm:settings.mailer_autoconfirm,tests:evidence,limits:'No real mailbox, verified-user session or cross-device live positive path was tested.'},null,2)+'\n');
