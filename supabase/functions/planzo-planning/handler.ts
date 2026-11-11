import {AI_MODEL} from '../../../src/aiProtocol.ts';
import {BUDGET_PLAN_SCHEMA,BUDGET_PLAN_INSTRUCTIONS,compileBudgetPlans,firstDinnerConflict} from '../../../src/budgetPlanning.ts';
import type {FlowContext} from '../../../src/privatePlanning.ts';
import {scheduleCorrection,correctionDayBudgets,SCHEDULE_CORRECTION_INSTRUCTIONS,DAILY_PLANNING_CHECKLIST} from '../../../src/planningRepair.ts';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, apikey, x-client-info, content-type','Access-Control-Allow-Methods':'POST, OPTIONS','Cache-Control':'no-store','Content-Type':'application/json'};
const reply=(status:number,data:unknown)=>new Response(JSON.stringify(data),{status,headers:cors});
export class FlowGateError extends Error{status:number;constructor(message:string,status=403){super(message);this.status=status;}}
export const ESSENTIAL_BUDGET_ERROR='The route, meals and overnight bases exceed an included private ceiling even without optional visits. Reduce the trip scope or revise private input; no itinerary was saved.';
export class PlanningBudgetError extends FlowGateError{constructor(){super('We could not find a complete itinerary within everyone’s confirmed budget, even using the available compatible economy options. Review the trip length, destination or your own private input. No itinerary was saved and no budget was changed.',400);}}
export function planningSaveFailure(message:string){const known=['Combine duplicate contextual items.','Invalid route item.','Invalid route assumption.','Invalid route area.','Unknown stop area.','Invalid shared source.','Invalid route timetable.','Invalid place or activity details.','Every recommendation needs a scheduled stop or clarification.','The step type or duration does not match its route arrangement.','A usable destination day has too few planned activities or local meals.','Plan an overnight base and at least six hours for sleep.','Allow realistic journey time and transfer buffers.','A route step has no price estimate.','The route has a gap, overlap or missing transfer. Keep each stop in the current area or add the required transfer.','The route must finish in its declared departure area at the shared end time.','The route, meals and overnight bases exceed an included private ceiling even without optional visits. Reduce the trip scope or revise private input; no itinerary was saved.'];return known.includes(message)?'The generated itinerary could not be saved: '+message:'The generated itinerary did not pass the final database check. Confirmed inputs are kept.';}
export function planningProviderFailure(status:number,raw:unknown){
 const message=typeof(raw as {error?:{message?:unknown}})?.error?.message==='string'?(raw as {error:{message:string}}).error.message:'';
 const issue=/unknown name|unrecognized field|unsupported.*field/i.test(message)?'request_field':/api.?key.*(?:invalid|not valid)|API_KEY_INVALID/i.test(message)?'key_invalid':/model.*(?:not found|not supported|unavailable)/i.test(message)?'model_unavailable':/permission|SERVICE_DISABLED|API.*disabled/i.test(message)?'permission':/schema|response.format|complexity/i.test(message)?'schema':'other';
 const field=['minLength','maxLength','maxItems','minItems','additionalProperties','enum','generation_config','response_format','schema','model','max_output_tokens'].find(x=>message.includes(x))||'unspecified';
 return {http_status:status,issue,field};
}
class GeminiDraftError extends Error{
 readonly status:number;
 constructor(message:string,status=503){super(message);this.status=status;}
}
function providerError(status:number,issue:ReturnType<typeof planningProviderFailure>['issue']){
 if(status===429)return new GeminiDraftError('Gemini’s rate limit or quota has been reached. Try again later.',429);
 if(status===408||status===504)return new GeminiDraftError('Gemini took too long to respond. Try again later.');
 if(status>=500)return new GeminiDraftError('Gemini is temporarily unavailable. Try again later.');
 if(status===401||status===403||issue==='key_invalid'||issue==='permission'||issue==='model_unavailable'){
  return new GeminiDraftError('Gemini access or model configuration needs attention.');
 }
 return new GeminiDraftError('Gemini rejected the itinerary request. The planning integration needs attention.');
}
function readGeminiDraft(body:string):unknown{
 let result;
 try{result=JSON.parse(body);}catch{throw new GeminiDraftError('Gemini returned unreadable response data.');}
 if(result?.status==='incomplete')throw new GeminiDraftError('Gemini stopped before completing the itinerary. Try a shorter trip or fewer stops.');
 if(result?.status==='failed'||result?.status==='cancelled'){
  const reason=[result.error?.code,result.error?.type,result.error?.message].join(' ');
  throw new GeminiDraftError(/safety|prohibited|blocked|recitation/i.test(reason)
   ? 'Gemini blocked the draft. Review the shared requests for content that could trigger its safety checks.'
   : 'Gemini did not complete the itinerary. Try again later.');
 }
 if(result?.status!=='completed'||!Array.isArray(result.steps))throw new GeminiDraftError('Gemini did not return a complete itinerary.');
 const parts:string[]=[];
 for(const step of result.steps){
  if(step?.type==='thought')continue;
  if(step?.type!=='model_output'||!Array.isArray(step.content))throw new GeminiDraftError('Gemini returned an unsupported itinerary response.');
  for(const part of step.content){
   if(part?.type!=='text'||typeof part.text!=='string')throw new GeminiDraftError('Gemini returned an unsupported itinerary response.');
   parts.push(part.text);
  }
 }
 if(!parts.join('').trim())throw new GeminiDraftError('Gemini returned an empty itinerary.');
 try{return JSON.parse(parts.join(''));}catch{throw new GeminiDraftError('Gemini returned invalid itinerary data. Try generating again.');}
}

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
async function bounded(body:ReadableStream<Uint8Array>|null,max:number){if(!body)throw Error('body');const reader=body.getReader(),parts:Uint8Array[]=[];let n=0;try{while(true){const {done,value}=await reader.read();if(done)break;n+=value.length;if(n>max){await reader.cancel();throw Error('limit');}parts.push(value);}}finally{reader.releaseLock();}const out=new Uint8Array(n);let at=0;for(const part of parts){out.set(part,at);at+=part.length;}return new TextDecoder().decode(out);}
export function createPlanningHandler(deps:{key:()=>string|undefined;gate:(request:Request,action:'generate_reserve'|'generate_finish',payload:Record<string,unknown>)=>Promise<unknown>;recheck?:(request:Request,payload:Record<string,unknown>)=>Promise<void>;fetcher?:typeof fetch;recordFailure?:(failure:ReturnType<typeof planningProviderFailure>)=>void}){
 return async(req:Request):Promise<Response>=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors});if(req.method!=='POST')return reply(405,{error:'Use Planzo’s itinerary action.'});
  if(!/^Bearer\s+\S+$/i.test(req.headers.get('authorization')||''))return reply(401,{error:'Sign in to generate an itinerary.'});
  let payload:Record<string,unknown>;
  try{if(!req.headers.get('content-type')?.toLowerCase().startsWith('application/json'))throw Error('json');payload=JSON.parse(await bounded(req.body,2000));
   if(!payload||Object.keys(payload).sort().join(',')!=='expected_revision,expected_stamp,request_id,trip_id'||!uuid.test(String(payload.trip_id))||!uuid.test(String(payload.request_id))||!Number.isSafeInteger(payload.expected_revision)||Number(payload.expected_revision)<1||!/^[a-f0-9]{32}$/.test(String(payload.expected_stamp)))throw Error('input');
  }catch{return reply(400,{error:'Refresh the trip before generating. No input was changed.'});}
  let controller:AbortController|undefined;
  try{
   const ctx=await deps.gate(req,'generate_reserve',payload) as FlowContext;
   if(!ctx||ctx.stamp!==payload.expected_stamp||!Array.isArray(ctx.refs)||ctx.refs.length<1||ctx.refs.length>80||ctx.refs.some(r=>!/^ref_\d+$/.test(r.id)||typeof r.title!=='string'||r.title.length>120))throw Error('context');
   const key=deps.key();if(!key)return reply(503,{error:'Gemini is not configured. Confirmed summaries are kept.'});
   const dinnerConflict=firstDinnerConflict(ctx);
   const deadline=Date.now()+110000;
   const shared={destination:ctx.destination,traveller_count:ctx.traveller_count??1,arrival_instant_utc:new Date(ctx.start).toISOString(),departure_instant_utc:new Date(ctx.end).toISOString(),available_hours:(Date.parse(ctx.end)-Date.parse(ctx.start))/3600000,estimation_date:new Date().toISOString().slice(0,10),...(dinnerConflict.length?{unresolved_first_dinner_source_ids:dinnerConflict}:{}),shareable_choices:ctx.refs.map(r=>({id:r.id,title:r.title,kind:r.kind,priority:r.priority}))};
   async function draft(input:unknown,repair=false):Promise<unknown>{
    controller=new AbortController();const active=controller;
    const timeout=setTimeout(()=>active.abort(),Math.max(1,Math.min(repair?110000:90000,deadline-Date.now())));
    try{
     const response=await(deps.fetcher||fetch)('https://generativelanguage.googleapis.com/v1/interactions',{method:'POST',redirect:'error',signal:active.signal,headers:{'x-goog-api-key':key!,'Content-Type':'application/json'},body:JSON.stringify({model:AI_MODEL,store:false,stream:false,background:false,tools:[],generation_config:{thinking_level:repair?'low':'medium',thinking_summaries:'none',max_output_tokens:20000,tool_choice:'none'},system_instruction:BUDGET_PLAN_INSTRUCTIONS+'\n'+DAILY_PLANNING_CHECKLIST+(repair?'\n'+SCHEDULE_CORRECTION_INSTRUCTIONS:''),input:JSON.stringify(input),response_format:[{type:'text',mime_type:'application/json',schema:BUDGET_PLAN_SCHEMA}]})});
     if(!response.ok){let raw:unknown;try{raw=JSON.parse(await bounded(response.body,8000));}catch{}const failure=planningProviderFailure(response.status,raw);deps.recordFailure?.(failure);throw providerError(response.status,failure.issue);}
     return readGeminiDraft(await bounded(response.body,350000));
    }catch(error){if(error instanceof TypeError&&!active.signal.aborted)throw new GeminiDraftError('Planzo could not reach Gemini. Try again later.');throw error;}
    finally{clearTimeout(timeout);}
   }
   const raw=await draft(shared);let plans:ReturnType<typeof compileBudgetPlans>;
   try{plans=compileBudgetPlans(raw,ctx);}
   catch(error){
    const diagnostic=scheduleCorrection(error);
    if(!diagnostic||deadline-Date.now()<15000)throw error;
    // One bounded correction of model-authored schedule only. Never retry a
    // quota/network/auth failure, expose a ceiling, or save an invalid draft.
    await deps.recheck?.(req,payload);
    const corrected=await draft({...shared,correction:{diagnostic,destination_days:correctionDayBudgets(raw,ctx),previous_draft:raw}},true);
    plans=compileBudgetPlans(corrected,ctx);
   }
   // Re-authorise after the external call; the database constructs the only saved document.
   try{return reply(200,await deps.gate(req,'generate_finish',{...payload,choice:plans.standard}));}
   catch(e){if(!(e instanceof PlanningBudgetError))throw e;const economy=plans.economy();if(!economy)throw e;return reply(200,await deps.gate(req,'generate_finish',{...payload,choice:economy}));}
  }catch(e){if(e instanceof FlowGateError)return reply(e.status,{error:e.message});if(e instanceof GeminiDraftError)return reply(e.status,{error:e.message+' No new plan was saved; confirmed inputs are kept.'});if(e instanceof Error&&e.message.startsWith('The complete itinerary needs correction:'))return reply(503,{error:e.message+' No new plan was saved; confirmed inputs are kept.'});const reason=controller?.signal.aborted||e instanceof Error&&e.name==='AbortError'?'Gemini took too long to complete this itinerary.':e instanceof Error&&e.message==='incomplete'?'Gemini did not finish the complete response within its output limit.':e instanceof Error&&e.message==='limit'?'Gemini’s response exceeded the allowed size.':e instanceof Error&&e.message==='Gemini did not provide a complete, bounded INR estimate. No plan was saved.'?'Gemini returned an invalid or missing INR price estimate.':e instanceof SyntaxError?'Gemini returned invalid structured route data.':'The itinerary could not be validated or completed.';return reply(503,{error:reason+' No plan was saved; your confirmed inputs are unchanged.'});}
  finally{controller?.abort();}
 };
}
