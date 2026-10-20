// Disposable local PostgreSQL with a minimal Auth stand-in. Never hosted identities.
import {readFile,writeFile,mkdtemp,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const runtime=process.env.PLANZO_TEST_RUNTIME||resolve('.cache/booking-runtime/node_modules');
const {default:EmbeddedPostgres}=await import(pathToFileURL(join(runtime,'embedded-postgres/dist/index.js')));
const cache=resolve('.cache');await mkdir(cache,{recursive:true});const root=await mkdtemp(join(cache,'setup-db-'));
assert(root.startsWith(cache+requireSeparator()));function requireSeparator(){return process.platform==='win32'?'\\':'/';}
const pg=new EmbeddedPostgres({databaseDir:join(root,'db'),user:'postgres',password:randomUUID(),port:55489,persistent:false,initdbFlags:['--encoding=UTF8','--locale=C'],onLog:()=>{},onError:()=>{}});
let db;const extra=[];const checks=[];const pass=name=>{checks.push({name,result:'pass'});console.log('PASS',name);};
try{
 await pg.initialise();await pg.start();db=pg.getPgClient();await db.connect();
 await db.query(`create role anon;create role authenticated;create schema auth;create schema extensions;grant usage on schema auth to anon,authenticated;
 create table auth.users(id uuid primary key,email_confirmed_at timestamptz,is_anonymous boolean default false,banned_until timestamptz);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function public.rls_auto_enable() returns event_trigger language plpgsql as $$begin end$$;`);
 for(const file of ['planzo_core','planzo_planning','planzo_invite_lookup_index','planzo_response_withdrawal','planzo_itinerary'])await db.query(await readFile(new URL('../supabase/changes/'+file+'.sql',import.meta.url),'utf8'));
 const users=Array.from({length:6},()=>randomUUID()),[a,b,c,d,outsider,unverified]=users;
 for(const id of users)await db.query('insert into auth.users(id,email_confirmed_at) values($1,$2)',[id,id===unverified?null:new Date()]);
 const actor=async id=>{await db.query('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id||'']);await db.query('set role '+(id?'authenticated':'anon'));};
 const call=async(endpoint,action,payload)=>(await db.query('select public.'+endpoint+'($1,$2::jsonb) data',[action,JSON.stringify(payload)])).rows[0].data;
 const core=(action,payload={})=>call('planzo_api',action,payload),planning=(action,payload={})=>call('planzo_planning',action,payload),items=(action,payload={})=>call('planzo_itinerary',action,payload),booking=(action,payload={})=>call('planzo_booking',action,payload);
 const no=async(name,fn,re)=>{await assert.rejects(fn,re);pass(name);};
 const window=randomUUID();await actor(a);await core('profile',{name:'TEST Booking Organiser'});
 const {trip_id:trip}=await core('create_trip',{request_id:randomUUID(),name:'TEST · disposable booking workflow',destination:'Goa',minimum:4,deadline:'2099-10-22T18:29:00Z',windows:[{id:window,start:'2099-11-13T00:30:00Z',end:'2099-11-15T16:30:00Z'}]});
 const invite=await core('create_invite',{trip_id:trip});
 for(const [i,id] of users.slice(1,4).entries()){await actor(id);await core('join',{token:invite.token,name:'TEST Booking Member '+i});}
 const brief={origin:'Bengaluru',ceiling_paise:3000000,windows:[window],vegetarian:true,step_free:false,stars:{Food:1,Relaxation:2},text:'PRIVATE BOOKING CANARY',boat:false};
 for(const id of users.slice(0,4)){await actor(id);await core('save_brief',{trip_id:trip,request_id:randomUUID(),expected_revision:0,brief:{...brief,boat:id===b},confirm:true,acknowledged:true});}
 await actor(a);
 const planningMutate=async(action,payload={})=>planning(action,{trip_id:trip,request_id:randomUUID(),expected_revision:(await planning('get',{trip_id:trip})).revision,...payload});
 const itemMutate=async(action,payload={})=>items(action,{trip_id:trip,request_id:randomUUID(),expected_revision:(await items('get',{trip_id:trip})).revision,...payload});
 await planningMutate('prepare',{window_id:window});await planningMutate('select',{option_id:'easy'});await planningMutate('publish_plan');
 let oldPlan=(await planning('get',{trip_id:trip})).plan;
 for(const id of users.slice(0,4)){await actor(id);await planningMutate('respond',{plan_id:oldPlan.id,status:'ready',private_reason:'PRIVATE REPORT REASON',acknowledged:true,expected_response_revision:0});}
 await actor(a);await planningMutate('close_round',{plan_id:oldPlan.id});
 const before=await planning('get',{trip_id:trip});
 await db.query('reset role');await db.query(await readFile(new URL('../supabase/changes/planzo_booking.sql',import.meta.url),'utf8'));
 const oldFunctions=(await db.query("select p.oid::regprocedure::text signature,md5(prosrc) hash from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='planzo_private' or (n.nspname='public' and p.proname like 'planzo_%')")).rows;
 const immutableBefore=(await db.query("select md5(string_agg(to_jsonb(v)::text,'' order by id)) hash from planzo_private.plan_versions v")).rows[0].hash;
 await db.query(await readFile(new URL('../supabase/changes/planzo_setup.sql',import.meta.url),'utf8'));
 await actor(a);assert.deepEqual(await planning('get',{trip_id:trip}),before);pass('Existing agreed plan, costs and every readiness response survive the migration');
 await db.query('reset role');const changed=[];for(const f of oldFunctions){if((await db.query('select md5(prosrc) hash from pg_proc where oid=$1::regprocedure',[f.signature])).rows[0].hash!==f.hash)changed.push(f.signature);}
 assert.deepEqual(changed.sort(),['planzo_private.api(text,jsonb)','planzo_private.evaluate_itinerary(uuid,uuid,jsonb)'].sort());pass('Only two reviewed existing function bodies change; auth and all other behavior remain');
 const manage=(action,payload={})=>call('planzo_manage_trip',action,payload);
 const revision=async id=>(await core('workspace',{trip_id:id})).trip.revision;
 const managementBody=async(id,extra={})=>({trip_id:id,request_id:randomUUID(),expected_revision:await revision(id),acknowledged:true,...extra});
 await actor(null);await no('Signed-out lifecycle endpoint is denied',()=>manage('get',{trip_id:trip}),/permission denied/);
 await actor(unverified);await no('Unverified identity cannot manage trips',()=>manage('get',{trip_id:trip}),/verified email/);
 await actor(outsider);await no('Cross-trip metadata and mutations are denied',()=>manage('get',{trip_id:trip}),/access to this trip/);
 await actor(b);await no('Joined member cannot archive a shared trip',async()=>manage('archive',await managementBody(trip)),/Only the organiser/);
 await actor(a);await no('Unknown or forged actor fields are rejected',async()=>manage('archive',await managementBody(trip,{user_id:b})),/Unsupported/);
 await no('Explicit acknowledgement is required',async()=>manage('archive',await managementBody(trip,{acknowledged:false})),/Confirm/);
 await no('Stale trip revision cannot remove a trip',async()=>manage('archive',await managementBody(trip,{expected_revision:1})),/trip changed/);
 await no('Shared agreed trip cannot be deleted as an unused draft',async()=>manage('delete_unused',await managementBody(trip)),/used or shared/);
 const create=(extra={})=>core('create_trip',{request_id:randomUUID(),name:'TEST · setup disposable',destination:'Goa',minimum:2,tentative_days:5,deadline:'2099-10-22T18:29:00Z',windows:[{id:randomUUID(),start:'2099-11-12T00:30:00Z',end:'2099-11-16T16:30:00Z'}],...extra});
 for(const [min,days] of [[1,1],[2,5],[9,14],[100,365]]){const x=await create({minimum:min,tentative_days:days}),w=await core('workspace',{trip_id:x.trip_id});assert.equal(w.trip.minimum_group_size,min);assert.equal(w.trip.tentative_days,days);}pass('Editable 1–100 minimum and 1–365 duration values persist through workspace readback');
 for(const [minimum,tentative_days] of [[0,3],[101,3],[1.5,3],[2,0],[2,366],[2,2.5]])await assert.rejects(()=>create({minimum,tentative_days}));pass('Database rejects unsupported or fractional setup values');
 const {trip_id:unused}=await create();assert.equal((await manage('get',{trip_id:unused})).can_delete,true);pass('A genuinely unused organiser-only draft is deletable');
 const del=await managementBody(unused);await manage('delete_unused',del);await manage('delete_unused',del);
 let listed=(await core('list')).trips.find(t=>t.id===unused);assert.equal(listed.removal_kind,'deleted_draft');assert.equal(listed.stage,'archived');assert.equal(await revision(unused),2);pass('Draft deletion is recoverable and idempotent without removing records');
 await no('Changed action cannot reuse a delete receipt',()=>manage('archive',del),/already used/);
 await no('Deleted draft cannot accept new private input',()=>core('save_brief',{trip_id:unused,request_id:randomUUID(),expected_revision:0,brief,confirm:false}),/archived/);
 await manage('restore',await managementBody(unused));assert.equal((await core('workspace',{trip_id:unused})).trip.stage,'collecting');pass('Deleted draft restores to collecting without reviving agreement');
 const {trip_id:invited}=await create();await core('create_invite',{trip_id:invited});await no('Even an unused invitation makes the trip shared, requiring archive',async()=>manage('delete_unused',await managementBody(invited)),/used or shared/);
 const {trip_id:saved}=await create();const ownWindow=(await core('workspace',{trip_id:saved})).windows[0].id;await core('save_brief',{trip_id:saved,request_id:randomUUID(),expected_revision:0,brief:{...brief,windows:[ownWindow]},confirm:false});
 await no('A saved private draft is preserved through archive instead of unused deletion',async()=>manage('delete_unused',await managementBody(saved)),/used or shared/);
 await manage('archive',await managementBody(saved));assert.equal((await core('workspace',{trip_id:saved})).own_brief.content.text,brief.text);pass('Archive preserves the author’s saved private input');
 await manage('archive',await managementBody(trip));let archived=await planning('get',{trip_id:trip});assert.equal(archived.stage,'archived');assert.equal(archived.plan.current,false);
 assert(archived.history.some(h=>h.message.includes('archived')));pass('Archiving preserves shared history and makes earlier agreement historical');
 await actor(b);const memberView=await core('workspace',{trip_id:trip});assert.equal(memberView.own_brief.content.text,brief.text);assert.equal(memberView.trip.stage,'archived');pass('Members retain their own saved input and archived shared workspace');
 const serial=JSON.stringify(await manage('get',{trip_id:trip}));assert(!serial.includes(brief.text)&&!serial.includes('ceiling'));pass('Lifecycle metadata does not expose raw briefs or budgets');
 await actor(a);await manage('restore',await managementBody(trip));const restored=await planning('get',{trip_id:trip});assert.equal(restored.stage,'revise');assert.equal(restored.plan.current,false);pass('Restored shared plan requires fresh review and cannot reuse earlier readiness as agreement');
 await db.query('reset role');assert.equal((await db.query("select md5(string_agg(to_jsonb(v)::text,'' order by id)) hash from planzo_private.plan_versions v")).rows[0].hash,immutableBefore);pass('Immutable version bytes remain unchanged through archive and restore');
 await actor(a);await no('No direct trip update grant is introduced',()=>db.query("update public.planzo_trips set minimum_group_size=1 where id=$1",[trip]),/permission denied/);
 await no('Internal unused-trip helper is not client callable',()=>db.query('select planzo_private.unused_trip($1)',[trip]),/permission denied/);
 const {trip_id:large}=await create({minimum:9}),link=await core('create_invite',{trip_id:large});
 await db.query('reset role');const more=Array.from({length:9},()=>randomUUID());for(const id of more)await db.query('insert into auth.users(id,email_confirmed_at) values($1,now())',[id]);
 for(const [i,id] of more.entries()){await actor(id);await core('join',{token:link.token,name:'TEST setup group '+i});}
 await actor(a);assert.equal((await core('workspace',{trip_id:large})).members.length,10);pass('Group collection can exceed the earlier eight-member cap');
 const pending=await managementBody(large);const peers=[];for(let i=0;i<2;i++){const peer=pg.getPgClient();await peer.connect();extra.push(peer);await peer.query("select set_config('request.jwt.claim.sub',$1,false)",[a]);await peer.query('set role authenticated');peers.push(peer);}
 const race=await Promise.allSettled(peers.map(peer=>peer.query('select public.planzo_manage_trip($1,$2::jsonb)',['archive',JSON.stringify({...pending,request_id:randomUUID()})])));assert.equal(race.filter(x=>x.status==='fulfilled').length,1);assert.equal(race.filter(x=>x.status==='rejected').length,1);pass('Concurrent lifecycle changes serialize and reject the stale action');
 await actor(a);const {trip_id:small}=await create({minimum:1,tentative_days:3,windows:[{id:randomUUID(),start:'2099-11-13T00:30:00Z',end:'2099-11-15T16:30:00Z'}]});const smallWindow=(await core('workspace',{trip_id:small})).windows[0].id;
 await core('save_brief',{trip_id:small,request_id:randomUUID(),expected_revision:0,brief:{...brief,windows:[smallWindow],ceiling_paise:9000000},confirm:true,acknowledged:true});
 await planning('prepare',{trip_id:small,request_id:randomUUID(),expected_revision:await revision(small),window_id:smallWindow});await planning('select',{trip_id:small,request_id:randomUUID(),expected_revision:await revision(small),option_id:'easy'});await planning('publish_plan',{trip_id:small,request_id:randomUUID(),expected_revision:await revision(small)});
 assert.equal((await planning('get',{trip_id:small})).plan.roster.length,1);pass('A supported one-person plan can publish without the old four-person table constraint');
 const report={date:new Date().toISOString(),environment:'Disposable local PostgreSQL with minimal Auth stand-in; labelled fictional fixtures only',summary:{passed:checks.length,failed:0},checks};
 await writeFile(new URL('../docs/backend/SETUP_DATABASE_TESTS.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
}finally{for(const peer of extra)await peer.end().catch(()=>{});if(db)await db.end().catch(()=>{});await pg.stop().catch(()=>{});}
