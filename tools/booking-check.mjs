// Disposable local PostgreSQL with a minimal Auth stand-in. Never hosted identities.
import {readFile,writeFile,mkdtemp,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const runtime=process.env.PLANZO_TEST_RUNTIME||resolve('.cache/booking-runtime/node_modules');
const {default:EmbeddedPostgres}=await import(pathToFileURL(join(runtime,'embedded-postgres/dist/index.js')));
const cache=resolve('.cache');await mkdir(cache,{recursive:true});const root=await mkdtemp(join(cache,'booking-db-'));
assert(root.startsWith(cache+requireSeparator()));function requireSeparator(){return process.platform==='win32'?'\\':'/';}
const pg=new EmbeddedPostgres({databaseDir:join(root,'db'),user:'postgres',password:randomUUID(),port:55483,persistent:false,initdbFlags:['--encoding=UTF8','--locale=C'],onLog:()=>{},onError:()=>{}});
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
 const sql=await readFile(new URL('../supabase/changes/planzo_booking.sql',import.meta.url),'utf8');await db.query('reset role');await db.query(sql);await actor(a);
 assert.deepEqual(await planning('get',{trip_id:trip}),before);pass('Additive booking migration preserves the agreed legacy version, costs and responses');
 const get=()=>booking('get',{trip_id:trip});
 const body=async(payload={})=>{const s=await get();return {trip_id:trip,plan_id:s.plan?.id,expected_revision:s.revision,expected_handoff_revision:s.handoff_revision,request_id:randomUUID(),...payload};};
 const mutate=async(action,payload={})=>booking(action,await body(payload));
 const task=async key=>(await get()).tasks.find(t=>t.key===key);
 const taskBody=async(key,payload={})=>{const t=await task(key);return body({task_key:key,expected_task_revision:t.revision,expected_report_revision:t.report?.revision||0,...payload});};
 const taskMutate=async(action,key,payload={})=>booking(action,await taskBody(key,payload));
 let state=await get();assert.equal(state.handoff_revision,0);assert.equal(state.milestone_history.length,0);pass('Read-only legacy access derives milestones without backfill or writes');
 assert.deepEqual(state.milestones.map(x=>x.status),['complete','complete','complete','complete','pending']);pass('Agreed legacy trip has four earned milestones and booking handoff pending');
 await actor(null);await no('Signed-out booking read denied',get,/permission denied/);
 await actor(unverified);await no('Unverified identity denied',get,/verified email/);
 await actor(outsider);await no('Outside-trip booking read denied',get,/do not have access/);
 await no('Outside-trip booking mutation denied',()=>booking('prepare',{trip_id:trip}),/do not have access/);
 await actor(b);await no('Member cannot prepare group handoff',()=>mutate('prepare'),/Only the organiser/);
 await actor(a);await no('Forged actor or private price field rejected',()=>mutate('prepare',{user_id:b,price:0}),/Unsupported request field/);
 for(const table of ['booking_handoffs','booking_tasks','booking_reports','milestone_events'])await no('No client table read/write path: '+table,()=>db.query('select * from planzo_private.'+table),/permission denied/);
 await no('Private milestone evaluation is not client-executable',()=>db.query('select planzo_private.booking_milestones($1)',[trip]),/permission denied/);
 const prepare=await body();await booking('prepare',prepare);await booking('prepare',prepare);state=await get();assert.equal(state.handoff_revision,1);assert.equal(state.tasks.length,6);assert.equal(state.revision,before.revision);assert.equal(state.plan.agreed,true);pass('Idempotent handoff creation leaves planning revision and agreement unchanged');
 assert(state.tasks.every(t=>!t.report));pass('Opening handoff starts every task pending without fabricated booking reports');
 const ser=JSON.stringify(state);for(const value of ['PRIVATE BOOKING CANARY','PRIVATE REPORT REASON','ceiling_paise','own_cost'])assert(!ser.includes(value));pass('Booking output excludes private briefs, reasons and personal costs');
 assert(!state.tasks.some(t=>t.key.includes(b)));await actor(b);state=await get();assert(state.tasks.some(t=>t.key==='travel:'+b));assert(!state.tasks.some(t=>t.key.includes(a)));pass('Organiser and member each see shared tasks plus only their own personal tasks');
 await no('Member cannot assign an unowned shared task',()=>taskMutate('save_task','stay',{owner_id:b,due_at:'2099-11-01T00:00:00Z',provider_id:'booking'}),/Only the organiser/);
 await actor(a);await no('Cross-trip owner denied',()=>taskMutate('save_task','stay',{owner_id:outsider,due_at:'2099-11-01T00:00:00Z',provider_id:'booking'}),/included owner/);
 await no('Another member’s personal task is unavailable',async()=>booking('save_task',await body({task_key:'travel:'+b,expected_task_revision:1,owner_id:a,provider_id:'manual',due_at:null})),/unavailable/);
 await no('Arbitrary provider URL payload denied',()=>taskMutate('save_task','stay',{owner_id:a,due_at:null,provider_id:'manual',url:'https://example.test'}),/Unsupported request field/);
 await no('Wrong-category provider denied',()=>taskMutate('save_task','stay',{owner_id:a,due_at:null,provider_id:'irctc'}),/supported handoff method/);
 await no('Due time after departure denied',()=>taskMutate('save_task','stay',{owner_id:a,due_at:'2099-12-01T00:00:00Z',provider_id:'manual'}),/no later than departure/);
 await no('Due time in past denied',()=>taskMutate('save_task','stay',{owner_id:a,due_at:'2000-01-01T00:00:00Z',provider_id:'manual'}),/future due/);
 const due='2099-11-01T00:00:00Z';
 for(const key of ['stay','local','food','activities'])await taskMutate('save_task',key,{owner_id:key==='stay'?b:a,due_at:due,provider_id:key==='stay'?'booking':'manual'});
 await no('Organiser cannot report a shared task assigned to another owner',()=>taskMutate('report','stay',{status:'reported',acknowledged:true}),/Only the assigned task owner/);
 for(const id of users.slice(0,4)){await actor(id);for(const cat of ['travel','personal'])await taskMutate('save_task',cat+':'+id,{owner_id:id,due_at:due,provider_id:cat==='travel'?'irctc':'manual'});}
 assert.equal((await get()).milestones.at(-1).status,'complete');pass('Handoff milestone completes only after shared and all personal task details are saved');
 await actor(b);await no('Booking report requires explicit verification acknowledgement',()=>taskMutate('report','stay',{status:'reported',acknowledged:false}),/Explicitly acknowledge/);
 const report=await taskBody('stay',{status:'reported',acknowledged:true});await booking('report',report);const once=await get();await booking('report',report);assert.deepEqual(await get(),once);pass('Owner booking report saves once with its plan, task revision and timestamp');
 const previousReport=(await task('stay')).report;assert.equal(previousReport.status,'reported');assert.equal(previousReport.reporter,b);assert(previousReport.at);pass('Reported booking is timestamped and attributed without claiming provider verification');
 await no('Reused request identifier with changed data denied',()=>booking('report',{...report,status:'not_needed'}),/already used/);
 await no('Stale handoff request denied',()=>booking('report',{...report,request_id:randomUUID()}),/handoff changed/);
 await taskMutate('report','stay',{status:'link_problem'});assert.equal((await task('stay')).report.status,'link_problem');assert.equal((await get()).milestones.at(-1).status,'pending');pass('A broken link leaves a pending task and blocks prepared-handoff milestone');
 await taskMutate('report','stay',{status:'pending'});await taskMutate('report','stay',{status:'not_needed',acknowledged:true});assert.equal((await task('stay')).report.status,'not_needed');pass('Explicit no-reservation-needed status is separate from a booking report');
 await actor(a);const earlier=(await task('stay')).revision;await taskMutate('save_task','stay',{owner_id:a,due_at:due,provider_id:'manual'});assert.equal((await task('stay')).report.current_task,false);assert.equal((await task('stay')).revision,earlier+1);pass('Reassignment preserves earlier report and requires fresh owner verification');
 await actor(b);await no('Former owner cannot update reassigned task',()=>taskMutate('report','stay',{status:'reported',acknowledged:true}),/Only the assigned task owner/);
 await actor(a);
 const concurrent=await taskBody('local',{owner_id:a,due_at:due,provider_id:'manual'});
 const peers=[];for(let j=0;j<2;j++){const client=pg.getPgClient();await client.connect();extra.push(client);await client.query("select set_config('request.jwt.claim.sub',$1,false)",[a]);await client.query('set role authenticated');peers.push(client);}
 const results=await Promise.allSettled(peers.map((client,index)=>client.query('select public.planzo_booking($1,$2::jsonb)',['save_task',JSON.stringify({...concurrent,request_id:randomUUID()})])));
 assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(results.filter(x=>x.status==='rejected').length,1);pass('Independent connections serialize competing handoff edits and reject the stale edit');
 const unchanged=await planning('get',{trip_id:trip});assert.deepEqual(unchanged.plan,before.plan);assert.equal(unchanged.revision,before.revision);assert.equal(unchanged.stage,before.stage);pass('Assignment and report activity preserves every original plan and readiness record');
 await taskMutate('flag_change','stay',{acknowledged:true});state=await get();assert.equal(state.stage,'revise');assert.equal(state.plan.current,false);assert.equal(state.milestones.at(-1).status,'needs_review');assert(state.report_history.some(x=>x.status==='reported'));pass('Material provider change invalidates agreement while preserving booking and milestone history');
 await no('Historical handoff cannot accept fresh completion',()=>taskMutate('report','stay',{status:'reported',acknowledged:true}),/current agreed plan/);
 await itemMutate('prepare',{window_id:window});await itemMutate('publish_plan');let p=(await planning('get',{trip_id:trip})).plan;assert.equal(p.version,2);
 await no('Unagreed new version cannot prepare booking tasks',()=>mutate('prepare'),/current agreed plan/);
 for(const id of users.slice(0,4)){await actor(id);await planningMutate('respond',{plan_id:p.id,status:'ready',private_reason:'',acknowledged:true,expected_response_revision:0});}
 await actor(a);await planningMutate('close_round',{plan_id:p.id});await mutate('prepare');state=await get();assert.equal(state.tasks.length,6);assert(state.tasks.every(t=>!t.report));assert(state.earlier_handoffs.some(h=>h.plan_id===oldPlan.id));pass('Newly agreed manual itinerary gets fresh pending tasks; old reports never carry forward');
 const oldReplay=await body({plan_id:oldPlan.id});await no('Valid older plan ID rejected after a fresh agreement',()=>booking('prepare',oldReplay),/current agreed plan/);
 await planningMutate('postpone');state=await get();assert.equal(state.milestones.at(-1).status,'not_applicable');assert.equal(state.milestones[3].status,'complete');assert(state.milestone_history.some(h=>h.states.at(-1).status==='complete'));pass('Postponement records a decision with no booking milestone and retains previously earned progress');
 await actor(a);const freshWindow=randomUUID();const fresh=await core('create_trip',{request_id:randomUUID(),name:'TEST · new booking milestone lifecycle',destination:'Goa',minimum:4,deadline:'2099-10-22T18:29:00Z',windows:[{id:freshWindow,start:'2099-11-13T00:30:00Z',end:'2099-11-15T16:30:00Z'}]});
 const freshState=await booking('get',{trip_id:fresh.trip_id});assert.equal(freshState.plan,null);assert.deepEqual(freshState.milestones.map(x=>x.status),['pending','pending','pending','pending','pending']);pass('New trip creation still works and starts with five pending milestones');
 const freshInvite=await core('create_invite',{trip_id:fresh.trip_id});await actor(b);await core('join',{token:freshInvite.token,name:'TEST lifecycle member'});await core('save_brief',{trip_id:fresh.trip_id,request_id:randomUUID(),expected_revision:0,brief:{...brief,windows:[freshWindow]},confirm:true,acknowledged:true});
 assert.equal((await booking('get',{trip_id:fresh.trip_id})).milestones[0].status,'needs_review');pass('New membership and private-input saves survive the deferred milestone trigger');
 await no('Cross-trip plan or task cannot be used for an unagreed trip',()=>booking('prepare',{trip_id:fresh.trip_id,plan_id:p.id,request_id:randomUUID(),expected_revision:3,expected_handoff_revision:0}),/current agreed plan|trip changed/);
 await db.query('reset role');
 for(const table of ['booking_tasks','booking_reports','milestone_events'])await no('Immutable append-only history: '+table,()=>db.query('delete from planzo_private.'+table),/immutable/);
 const rights=(await db.query(`select count(*)::int n from information_schema.role_table_grants where table_schema='planzo_private' and table_name in ('booking_handoffs','booking_tasks','booking_reports','milestone_events') and grantee in ('anon','authenticated','PUBLIC')`)).rows[0].n;assert.equal(rights,0);pass('New tables have no direct client grants');
 const rls=(await db.query(`select count(*)::int n from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='planzo_private' and c.relname in ('booking_handoffs','booking_tasks','booking_reports','milestone_events') and c.relrowsecurity`)).rows[0].n;assert.equal(rls,4);pass('All four new private tables use default-deny RLS');
 await writeFile(new URL('../docs/backend/BOOKING_DATABASE_TESTS.json',import.meta.url),JSON.stringify({date:new Date().toISOString(),target:'disposable-local-postgresql-only',auth:'minimal local stand-in; not hosted JWTs',sql_sha256:createHash('sha256').update(sql).digest('hex'),checks,passed:checks.length,failed:0},null,2)+'\n');
 console.log(JSON.stringify({passed:checks.length,failed:0}));
}catch(e){console.error(e);process.exitCode=1;}finally{for(const c of extra)await c.end().catch(()=>{});if(db)await db.end().catch(()=>{});await pg.stop().catch(()=>{});}
