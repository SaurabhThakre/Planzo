// Labelled disposable PostgreSQL fixtures; minimal Auth stand-in, never hosted JWTs.
import {readFile,writeFile,mkdtemp,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
const runtime=process.env.PLANZO_TEST_RUNTIME||resolve('.cache/booking-runtime/node_modules');
const {default:EmbeddedPostgres}=await import(pathToFileURL(join(runtime,'embedded-postgres/dist/index.js')));
await mkdir('.cache',{recursive:true});const root=await mkdtemp(resolve('.cache/gemini-db-'));
const pg=new EmbeddedPostgres({databaseDir:join(root,'db'),user:'postgres',password:randomUUID(),port:55485,persistent:false,initdbFlags:['--encoding=UTF8','--locale=C'],onLog:()=>{},onError:()=>{}});
const checks=[],peers=[];let db;
const pass=name=>{checks.push({name,result:'pass'});console.log('PASS',name);};
try{
 await pg.initialise();await pg.start();db=pg.getPgClient();await db.connect();
 await db.query(`create role anon;create role authenticated;create schema auth;create schema extensions;grant usage on schema auth to anon,authenticated;
 create table auth.users(id uuid primary key,email_confirmed_at timestamptz,is_anonymous boolean default false,banned_until timestamptz);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function public.rls_auto_enable() returns event_trigger language plpgsql as $$begin end$$;`);
 for(const name of ['planzo_core','planzo_planning','planzo_invite_lookup_index','planzo_response_withdrawal','planzo_itinerary','planzo_booking'])await db.query(await readFile(new URL('../supabase/changes/'+name+'.sql',import.meta.url),'utf8'));
 const ids=Array.from({length:6},()=>randomUUID()),[a,b,c,d,outside,unverified]=ids;
 for(const id of ids)await db.query('insert into auth.users(id,email_confirmed_at) values($1,$2)',[id,id===unverified?null:new Date()]);
 const actor=async id=>{await db.query('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id||'']);await db.query('set role '+(id?'authenticated':'anon'));};
 const rpc=async(name,action,payload)=>(await db.query('select public.'+name+'($1,$2::jsonb) data',[action,JSON.stringify(payload)])).rows[0].data;
 const core=(action,payload={})=>rpc('planzo_api',action,payload),ai=(action,payload)=>rpc('planzo_ai',action,payload);
 const no=async(name,fn,re)=>{await assert.rejects(fn,re);pass(name);};
 await actor(a);await core('profile',{name:'TEST AI Organiser'});const win=randomUUID();
 const {trip_id:trip}=await core('create_trip',{request_id:randomUUID(),name:'TEST · AI disposable preferences',destination:'Goa',minimum:4,deadline:'2099-10-22T18:29:00Z',windows:[{id:win,start:'2099-11-13T00:30:00Z',end:'2099-11-15T16:30:00Z'}]});
 const invitation=await core('create_invite',{trip_id:trip});
 for(const [i,id] of [b,c,d].entries()){await actor(id);await core('join',{token:invitation.token,name:'TEST AI Member '+i});}
 await actor(a);const prior=await core('workspace',{trip_id:trip});
 await db.query('reset role');const functionsBefore=(await db.query("select p.oid::regprocedure::text signature,md5(p.prosrc) hash from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','planzo_private') order by 1")).rows;
 await db.query(await readFile(new URL('../supabase/changes/planzo_ai.sql',import.meta.url),'utf8'));
 const openAiReceipt=randomUUID();await db.query("insert into planzo_private.operation_receipts(user_id,request_id,action,result,request_hash) values($1,$2,'ai:parse','{}','TEST OLD PROVIDER RECEIPT')",[a,openAiReceipt]);
 const wrapperBefore=(await db.query("select md5(prosrc) hash from pg_proc where oid='public.planzo_ai(text,jsonb)'::regprocedure")).rows[0].hash;
 await db.query(await readFile(new URL('../supabase/changes/planzo_gemini.sql',import.meta.url),'utf8'));
 assert.equal((await db.query("select md5(prosrc) hash from pg_proc where oid='public.planzo_ai(text,jsonb)'::regprocedure")).rows[0].hash,wrapperBefore);pass('Public authenticated AI wrapper unchanged');
 assert.equal((await db.query('select request_hash from planzo_private.operation_receipts where request_id=$1',[openAiReceipt])).rows[0].request_hash,'TEST OLD PROVIDER RECEIPT');pass('Earlier OpenAI usage receipt preserved without consuming Gemini allowance');
 await actor(a);
 assert.deepEqual(await core('workspace',{trip_id:trip}),prior);pass('Additive AI migration preserves the complete prior workspace');
 await db.query('reset role');for(const f of functionsBefore){const h=(await db.query('select md5(prosrc) hash from pg_proc where oid=$1::regprocedure',[f.signature])).rows[0].hash;assert.equal(h,f.hash);}pass('Every earlier application function body remains unchanged');
 await actor(a);const revision=prior.trip.revision;
 const payload=(extra={})=>({trip_id:trip,request_id:randomUUID(),expected_trip_revision:revision,expected_brief_revision:0,text_sha256:'a'.repeat(64),consent:true,fictional_input:true,consent_policy:'planzo-ai-gemini-2026-10-16',...extra});
 await actor(null);await no('Signed-out request denied by function ACL',()=>ai('reserve',payload()),/permission denied/);
 await actor(unverified);await no('Unverified account denied',()=>ai('reserve',payload()),/verified email/);
 await actor(outside);await no('Verified outsider denied',()=>ai('reserve',payload()),/access to this trip/);
 await actor(a);
 for(const [name,change,re] of [
  ['Fictional input acknowledgement required',{fictional_input:false},/Confirm fictional/],['Earlier provider consent cannot be reused',{consent_policy:'planzo-ai-2026-10-16'},/Confirm fictional/],
  ['Separate AI consent required',{consent:false},/Confirm fictional/],['Current consent policy required',{consent_policy:'old'},/Confirm fictional/],
  ['Forged actor denied',{user_id:b},/Unsupported/],['Raw text rejected from receipt endpoint',{text:'PRIVATE TEST CANARY'},/Unsupported/],
  ['Unknown fields rejected',{ceiling_paise:0},/Unsupported/],['Invalid request digest denied',{text_sha256:'bad'},/context/],
  ['Stale trip revision denied',{expected_trip_revision:revision+1},/changed/],['Stale own brief revision denied',{expected_brief_revision:1},/changed/]
 ])await no(name,()=>ai('reserve',payload(change)),re);
 await no('No client can read private usage receipts',()=>db.query('select * from planzo_private.operation_receipts'),/permission denied/);
 await db.query('reset role');await db.query("update public.planzo_trips set name='TEST ordinary trip' where id=$1",[trip]);await actor(a);
 await no('Ordinary trip cannot send private preferences to free Gemini',()=>ai('reserve',payload()),/labelled fictional/);
 await db.query('reset role');await db.query("update public.planzo_trips set name='TEST · AI disposable preferences' where id=$1",[trip]);await actor(a);
 const first=payload();const result=await ai('reserve',first);assert.equal(result.trip_id,trip);assert.equal(result.windows[0].id,win);assert(!JSON.stringify(result).includes('text_sha256'));pass('Own context admits one preview with only safe trip dates and revisions');
 assert.deepEqual(await core('workspace',{trip_id:trip}),prior);pass('Admission does not save a brief, change a trip or create agreement');
 assert.deepEqual(await ai('check',first),result);pass('Post-provider check can revalidate the exact admitted attempt');
 await no('Duplicate request cannot produce another provider attempt',()=>ai('reserve',first),/already used/);
 await no('Changed digest cannot reuse an admitted attempt',()=>ai('check',{...first,text_sha256:'b'.repeat(64)}),/unavailable/);
 await no('Rapid repeat is limited',()=>ai('reserve',payload()),/wait a moment/);
 await actor(b);await no('Another member cannot claim the first member’s receipt',()=>ai('check',first),/unavailable/);
 await actor(a);
 const brief={origin:'Bengaluru',ceiling_paise:1100000,windows:[win],vegetarian:true,step_free:false,stars:{Food:1},text:'TEST PRIVATE FICTIONAL BRIEF',boat:false};
 await core('save_brief',{trip_id:trip,request_id:randomUUID(),expected_revision:0,brief,confirm:false});
 await no('Input edited while provider processes invalidates the earlier preview',()=>ai('check',first),/changed/);
 await db.query('reset role');const receipt=(await db.query("select action,result,request_hash from planzo_private.operation_receipts where action='ai:gemini'")).rows[0];
 for(const key of ['ceiling_paise','PRIVATE','origin','email','text_sha256'])assert(!JSON.stringify(receipt).includes(key));pass('Persisted consent/usage receipt contains no raw text, financial fields or model output');
 await db.query('update auth.users set banned_until=now()+interval \'1 day\' where id=$1',[outside]);await actor(outside);await no('Banned verified account denied',()=>ai('reserve',payload()),/verified email/);
 // Labelled synthetic historical usage, local only: do not run this seeding on hosted projects.
 await db.query('reset role');
 for(let i=0;i<4;i++)await db.query("insert into planzo_private.operation_receipts(user_id,request_id,action,result,request_hash,created_at) values($1,$2,'ai:gemini','{}','TEST SYNTHETIC USAGE',now()-interval '1 hour')",[b,randomUUID()]);
 const current=(await db.query('select revision from public.planzo_trips where id=$1',[trip])).rows[0].revision;
 await actor(b);await no('Per-person daily allowance enforced',()=>ai('reserve',payload({expected_trip_revision:current})),/limit.*today/);
 await db.query('reset role');for(let i=0;i<2;i++)await db.query("insert into planzo_private.operation_receipts(user_id,request_id,action,result,request_hash,created_at) values($1,$2,'ai:gemini','{}','TEST SYNTHETIC USAGE',now()-interval '1 hour')",[a,randomUUID()]);
 for(const id of [c,d]){const peer=pg.getPgClient();await peer.connect();peers.push(peer);await peer.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);await peer.query('set role authenticated');}
 const concurrent=await Promise.allSettled(peers.map(peer=>peer.query('select public.planzo_ai($1,$2::jsonb)', ['reserve',JSON.stringify(payload({expected_trip_revision:current}))])));
 assert.equal(concurrent.filter(x=>x.status==='fulfilled').length,1);assert.equal(concurrent.filter(x=>x.status==='rejected'&&/allowance/.test(x.reason.message)).length,1);pass('Independent connections cannot overspend the last global preview');
 await db.query('reset role');assert.equal(Number((await db.query("select count(*) n from planzo_private.operation_receipts where action='ai:gemini'")).rows[0].n),8);pass('Prototype allowance stays capped at eight total admitted attempts');
 await actor(b);await no('Global allowance has no automatic reset or provider retry',()=>ai('reserve',payload({expected_trip_revision:current})),/allowance/);
 await db.query('reset role');await db.query("update public.planzo_trips set stage='postponed' where id=$1",[trip]);await actor(a);await no('Postponed trip cannot start an AI preview',()=>ai('reserve',payload({expected_trip_revision:current,expected_brief_revision:1})),/postponed/);
 const report={date:new Date().toISOString(),environment:'Disposable local PostgreSQL with minimal Auth stand-in; no hosted JWTs or paid calls',summary:{passed:checks.length,failed:0},checks};
 await writeFile(new URL('../docs/backend/GEMINI_DATABASE_TESTS.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
}finally{for(const peer of peers)await peer.end().catch(()=>{});if(db)await db.end().catch(()=>{});await pg.stop().catch(()=>{});}
