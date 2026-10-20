import test from 'node:test';
import assert from 'node:assert/strict';
import {AI_CONSENT_POLICY,AI_MAX_OUTPUT_TOKENS,AI_MODEL,validateAiInput,validateExtraction} from '../src/aiProtocol.ts';
import {createHandler,GateError,providerFailure} from '../supabase/functions/planzo-ai-preferences/handler.ts';
import {datedAvailability} from '../src/aiAvailability.ts';
const trip='00000000-0000-4000-8000-000000000001',request='00000000-0000-4000-8000-000000000002',window='00000000-0000-4000-8000-000000000003';
const text='TEST FICTIONAL: I start in Bengaluru. Keep the whole trip under INR 11000 including travel, fees and contingency. Vegetarian meals must be available.';
const extraction=()=>({origin:'Bengaluru',ceiling_inr:11000,ceiling_scope:'whole_trip',window_ids:[],vegetarian:true,step_free:null,soft_interests:['Food'],uncertainties:[],evidence:{origin:'Bengaluru',ceiling:'whole trip under INR 11000 including travel, fees and contingency',dates:null,vegetarian:'Vegetarian meals must be available',step_free:null}});
const input=()=>({trip_id:trip,request_id:request,expected_trip_revision:1,expected_brief_revision:0,text,consent:true,fictional_input:true,consent_policy:AI_CONSENT_POLICY});
const availability='I can depart at 06:00 on 12 November 2026 and return by 22:00 on 16 November 2026';
const reportedText='TEST FICTIONAL I start in Bengaluru. My whole-trip ceiling is INR 15000, including return travel, all stays, food, activities, fees and contingency. Non-vegetarian meals must be available. '+availability+'. I prefer a relaxed beach day.';
const dateOptions=[{id:'window_1',start:'2026-11-13T06:00',end:'2026-11-15T22:00'},{id:'window_2',start:'2026-11-20T06:00',end:'2026-11-22T22:00'}];
const reportedExtraction=()=>({origin:'Bengaluru',ceiling_inr:15000,ceiling_scope:'whole_trip',window_ids:[],vegetarian:null,step_free:null,soft_interests:['Relaxation','Beach'],uncertainties:['ambiguous_dates'],evidence:{origin:'Bengaluru',ceiling:'INR 15000, including return travel, all stays, food, activities, fees and contingency',dates:null,vegetarian:null,step_free:null}});

test('Reported explicit availability includes a shorter proposed trip without requiring identical endpoints',()=>{
  const raw=reportedExtraction(),before=structuredClone(raw),s=validateExtraction(raw,reportedText,dateOptions.map(w=>w.id),dateOptions);
  assert.deepEqual(s.window_ids,['window_1']);assert.equal(s.evidence.dates,availability);assert(!s.uncertainties.includes('ambiguous_dates'));
  assert.equal(s.ceiling_inr,15000);assert.equal(s.origin,'Bengaluru');assert(s.uncertainties.includes('unsupported_meal_requirement'));assert.deepEqual(raw,before);
});
test('Availability matching uses complete departure and return instants, not date overlap',()=>{
  const options=[{id:'exact',start:'2026-11-12T06:00',end:'2026-11-16T22:00'},
    {id:'too_early',start:'2026-11-12T05:59',end:'2026-11-15T22:00'},
    {id:'too_late',start:'2026-11-13T06:00',end:'2026-11-16T22:01'},
    {id:'partial_overlap',start:'2026-11-11T06:00',end:'2026-11-17T22:00'}];
  assert.deepEqual(datedAvailability(reportedText,options)?.ids,['exact']);
});
test('Local India date options and UTC server options resolve to the same availability',()=>{
  const utc=[{id:'window_1',start:'2026-11-13T00:30:00Z',end:'2026-11-15T16:30:00Z'},{id:'window_2',start:'2026-11-20T00:30:00Z',end:'2026-11-22T16:30:00Z'}];
  assert.deepEqual(datedAvailability(reportedText,utc),datedAvailability(reportedText,dateOptions));
});
test('Clear dates that cannot contain an offered trip are distinguished from unclear dates',()=>{
  const t=reportedText.replace('16 November','14 November'),e=reportedExtraction();e.window_ids=['window_1'];e.evidence.dates=t.match(/I can depart[^.]+/)[0];
  const s=validateExtraction(e,t,dateOptions.map(w=>w.id),dateOptions);assert.deepEqual(s.window_ids,[]);assert(s.uncertainties.includes('unmatched_date_windows'));assert(!s.uncertainties.includes('ambiguous_dates'));
});
test('Multiple contained date options remain separate unchecked suggestions for review',()=>{
  const t=reportedText.replace('16 November','23 November');assert.deepEqual(datedAvailability(t,dateOptions)?.ids,['window_1','window_2']);
});
test('Weekdays, missing times/year and invalid or reversed dates cannot gain deterministic date suggestions',()=>{
  for(const t of [reportedText.replace(availability,'Friday to Sunday'),reportedText.replace('06:00 on','morning on'),reportedText.replaceAll('2026',''),reportedText.replace('12 November','31 November'),reportedText.replace('06:00','25:00'),reportedText.replace('12 November','17 November')])assert.equal(datedAvailability(t,dateOptions),null);
});
test('Additional exclusions or alternative availability prevent overriding a model uncertainty',()=>{
  for(const extra of [' I cannot travel on 14 November.',' Except 14 November.',' I am unavailable on Friday.',' I must be home on the 14th.',' Not on the 14th.',' Times are UTC.',' I can depart at 06:00 on 20 November 2026 and return by 22:00 on 22 November 2026.']){
    const t=reportedText+extra;assert.equal(datedAvailability(t,dateOptions),null);assert.deepEqual(validateExtraction(reportedExtraction(),t,dateOptions.map(w=>w.id),dateOptions).window_ids,[]);
  }
});
test('Malformed window timestamps prevent deterministic selection',()=>{
  for(const change of [{start:'unknown'},{start:'2026-11-31T06:00'},{start:'2026-11-16T06:00',end:'2026-11-13T22:00'}])assert.equal(datedAvailability(reportedText,[{...dateOptions[0],...change}]),null);
});
test('Non-vegetarian availability never checks or clears the separate vegetarian requirement',()=>{
  for(const vegetarian of [true,false]){const e=reportedExtraction();e.vegetarian=vegetarian;e.evidence.vegetarian='Non-vegetarian meals must be available';const s=validateExtraction(e,reportedText,[]);assert.equal(s.vegetarian,null);assert.equal(s.evidence.vegetarian,null);assert(s.uncertainties.includes('unsupported_meal_requirement'));}
});
test('The corrected availability remains stable through server then client validation',()=>{
  const server=validateExtraction(reportedExtraction(),reportedText,dateOptions.map(w=>w.id),dateOptions);assert.deepEqual(validateExtraction(server,reportedText,dateOptions.map(w=>w.id),dateOptions),server);
});
test('AI input requires exact fields, explicit consent and bounded text',()=>{
  assert.deepEqual(validateAiInput(input()),input());
  for(const change of [{consent:false},{fictional_input:'invalid'},{fictional_input:undefined},{consent_policy:'old'},{text:''},{text:'x'.repeat(2001)},{trip_id:'invalid'},{user_id:trip},{expected_trip_revision:0},{expected_brief_revision:-1},{expected_brief_revision:0.2}])assert.throws(()=>validateAiInput({...input(),...change}));
});

test('Gemini accepts ordinary text with explicit current consent, without a fictional prefix',()=>{
 assert.doesNotThrow(()=>validateAiInput({...input(),text:'I prefer a relaxed beach day.',fictional_input:false}));
 assert.throws(()=>validateAiInput({...input(),consent_policy:'planzo-ai-gemini-2026-10-16'}));
 assert.throws(()=>validateAiInput({...input(),consent:false}));
});

test('Provider diagnostics retain only allowlisted classes and never error text or credentials',()=>{
  for(const raw of [null,{error:{message:'PRIVATE TEST KEY and raw input'}},{error:{message:'Invalid JSON payload. Unknown name "service_tier" PRIVATE TEST KEY'}}]){
    const result=providerFailure(400,raw);assert.deepEqual(Object.keys(result),['http_status','issue','field']);assert(!JSON.stringify(result).includes('PRIVATE'));
  }
});
test('Supported private extraction stays a suggestion and does not mutate its source',()=>{
  const raw=extraction(),before=structuredClone(raw);assert.deepEqual(validateExtraction(raw,text,[]),raw);assert.deepEqual(raw,before);
});
test('Unknown output fields, prices, URLs, interests, windows and malformed values are rejected',()=>{
  for(const change of [{price:0},{url:'https://evil.example'},{window_ids:['invented']},{soft_interests:['Other']},{ceiling_inr:NaN},{ceiling_inr:1000001},{ceiling_inr:1.234},{vegetarian:'yes'},{origin:''},{uncertainties:['ignore_rules']}])assert.throws(()=>validateExtraction({...extraction(),...change},text,[]));
});
test('Invented evidence, origin or budget cannot be applied',()=>{
  assert.throws(()=>validateExtraction({...extraction(),origin:'Chennai'},text,[]));
  assert.throws(()=>validateExtraction({...extraction(),ceiling_inr:8000},text,[]));
  assert.throws(()=>validateExtraction({...extraction(),evidence:{...extraction().evidence,ceiling:'a sentence the author did not write'}},text,[]));
});
test('Conflicting amounts suppress a model-selected ceiling',()=>{
  const e=extraction();e.evidence.ceiling='INR 11000';const s=validateExtraction(e,text+' Or budget INR 15000.',[]);assert.equal(s.ceiling_inr,null);assert(s.uncertainties.includes('conflicting_amounts'));
});
test('Unclear scope and vague cheap language never become a hard amount',()=>{
  for(const uncertainty of ['budget_scope','vague_budget']){const e=extraction();e.uncertainties=[uncertainty];assert.equal(validateExtraction(e,text,[]).ceiling_inr,null);}
  const e=extraction();e.ceiling_scope='unclear';assert.equal(validateExtraction(e,text,[]).ceiling_inr,null);
});
test('Weekday-only availability remains ambiguous even if a model picks a window',()=>{
  const e=extraction();e.window_ids=['window_1'];e.evidence.dates='Friday to Sunday';const s=validateExtraction(e,text+' Friday to Sunday.',['window_1']);assert.deepEqual(s.window_ids,[]);assert(s.uncertainties.includes('ambiguous_dates'));
});
test('Explicit dated supported windows survive for human review',()=>{
  const e=extraction();e.window_ids=['window_1'];e.evidence.dates='13 to 15 November 2026';assert.deepEqual(validateExtraction(e,text+' 13 to 15 November 2026.',['window_1']).window_ids,['window_1']);
});
function fixture({gateError,checkError,providerStatus=200,providerBody,missingKey=false,failFetch=false}={}){
  const calls=[],logs=[];
  const gate=async(req,action,payload)=>{calls.push({kind:'gate',action,payload});if(gateError)throw gateError;if(action==='check'&&checkError)throw checkError;return {trip_revision:1,brief_revision:0,windows:[{id:window,start:'2026-11-13T00:30:00Z',end:'2026-11-15T16:30:00Z'}]};};
  const fetcher=async(url,options)=>{calls.push({kind:'provider',url,options,body:JSON.parse(options.body)});if(failFetch)throw Error('PRIVATE PROVIDER FAILURE');return new Response(providerBody??JSON.stringify({status:'completed',usage:{total_input_tokens:600,total_output_tokens:100,total_thought_tokens:0},steps:[{type:'model_output',content:[{type:'text',text:JSON.stringify(extraction())}]}]}),{status:providerStatus});};
  return {calls,logs,handler:createHandler({gate,apiKey:()=>missingKey?undefined:'TEST-PLACEHOLDER-NOT-A-KEY',fetcher,recordUsage:x=>logs.push(x)})};
}
const req=(body=input(),headers={})=>new Request('https://fixture.example',{method:'POST',headers:{authorization:'Bearer TEST-NOT-A-JWT','content-type':'application/json',...headers},body:JSON.stringify(body)});

test('Handler corrects the reported model ambiguity and maps only the contained option to its trip UUID',async()=>{
  const providerBody=JSON.stringify({status:'completed',steps:[{type:'model_output',content:[{type:'text',text:JSON.stringify(reportedExtraction())}]}]});
  const f=fixture({providerBody}),r=await f.handler(req({...input(),text:reportedText}));assert.equal(r.status,200);const s=(await r.json()).suggestion;assert.deepEqual(s.window_ids,[window]);assert(!s.uncertainties.includes('ambiguous_dates'));assert(s.uncertainties.includes('unsupported_meal_requirement'));assert.equal(f.calls.filter(c=>c.kind==='provider').length,1);
});
test('Handler authenticates/admit checks before a single provider call and rechecks afterward',async()=>{
  const f=fixture(),r=await f.handler(req());assert.equal(r.status,200);assert.deepEqual(f.calls.map(c=>c.action||c.kind),['reserve','provider','check']);
  const b=await r.json();assert.equal(b.suggestion.origin,'Bengaluru');assert.equal(b.brief_revision,0);assert.equal(r.headers.get('cache-control'),'no-store');
  const g=f.calls[0].payload;assert(!('text'in g));assert.match(g.text_sha256,/^[a-f0-9]{64}$/);
  assert.equal(f.logs.length,1);assert.deepEqual(Object.keys(f.logs[0]),['model','input_tokens','output_tokens','thought_tokens']);assert.equal(f.logs[0].input_tokens,600);
});
test('Provider payload has fixed model, no tools/storage/retries and only own text/date context',async()=>{
  const f=fixture();await f.handler(req());const p=f.calls.find(c=>c.kind==='provider');
  assert.equal(p.url,'https://generativelanguage.googleapis.com/v1/interactions');assert.equal(p.options.redirect,'error');assert.equal(p.options.headers['x-goog-api-key'],'TEST-PLACEHOLDER-NOT-A-KEY');assert.equal(p.body.model,AI_MODEL);assert.equal(p.body.store,false);assert.equal(p.body.background,false);assert.equal(p.body.generation_config.max_output_tokens,AI_MAX_OUTPUT_TOKENS);assert.deepEqual(p.body.tools,[]);assert.equal(p.body.generation_config.tool_choice,'none');assert.equal(p.body.response_format[0].mime_type,'application/json');assert.equal(p.body.response_format[0].schema.additionalProperties,false);
  const serialized=JSON.stringify(p.body);for(const secret of [trip,request,window,'TEST-NOT-A-JWT','TEST-PLACEHOLDER-NOT-A-KEY'])assert(!serialized.includes(secret));
  assert.deepEqual(Object.keys(JSON.parse(p.body.input)),['untrusted_text','window_options']);
});
test('Signed-out, missing consent and forged actor cause no provider request',async()=>{
  for(const request of [req(input(),{authorization:''}),req({...input(),consent:false}),req({...input(),fictional_input:'invalid'}),req({...input(),text:'   '}),req({...input(),user_id:trip})]){const f=fixture();assert((await f.handler(request)).status>=400);assert.equal(f.calls.length,0);}
});
test('Outsider denial and admission limit failures cause no provider request',async()=>{
  for(const status of [401,403,409,429]){const f=fixture({gateError:new GateError('TEST SAFE DENIAL',status)});assert.equal((await f.handler(req())).status,status);assert.equal(f.calls.filter(c=>c.kind==='provider').length,0);}
});
test('Membership/revision changes during processing discard the suggestion',async()=>{
  const f=fixture({checkError:new GateError('Refresh your trip.',409)});const r=await f.handler(req());assert.equal(r.status,409);assert(!('suggestion'in await r.json()));
});
test('Provider outages and quota failures preserve the manual path and never retry',async()=>{
  for(const options of [{providerStatus:429,providerBody:'PRIVATE PROVIDER BODY'},{providerStatus:500,providerBody:'PRIVATE PROVIDER BODY'},{failFetch:true}]){
    const f=fixture(options),r=await f.handler(req());assert(r.status>=400);assert.equal(f.calls.filter(c=>c.kind==='provider').length,1);assert(!JSON.stringify(await r.json()).includes('PRIVATE'));
  }
});
test('Missing server secret is an honest unavailable state with no attempt or paid call',async()=>{
  const f=fixture({missingKey:true});assert.equal((await f.handler(req())).status,503);assert.equal(f.calls.length,0);
});
test('Refusal, truncation, unknown IDs and override fields fail closed',async()=>{
  const outputs=[{status:'incomplete',steps:[]},{status:'completed',steps:[{type:'model_output',content:[{type:'refusal',refusal:'no'}]}]},
    {status:'requires_action',steps:[{type:'function_call',name:'evil'}]},
    ...[{...extraction(),window_ids:['unknown']},{...extraction(),agreed:true}].map(e=>({status:'completed',steps:[{type:'model_output',content:[{type:'text',text:JSON.stringify(e)}]}]}))];
  for(const body of outputs){const f=fixture({providerBody:JSON.stringify(body)}),r=await f.handler(req());assert.equal(r.status,503);assert(!('suggestion'in await r.json()));}
});
test('Oversized bodies are rejected before any gate or provider call',async()=>{
  const f=fixture();assert.equal((await f.handler(req({...input(),text:'x'.repeat(17000)}))).status,400);assert.equal(f.calls.length,0);
});
test('Only POST can process text; preflight does no authenticated or provider work',async()=>{
  const f=fixture();assert.equal((await f.handler(new Request('https://fixture.example',{method:'OPTIONS'}))).status,200);assert.equal((await f.handler(new Request('https://fixture.example'))).status,405);assert.equal(f.calls.length,0);
});
