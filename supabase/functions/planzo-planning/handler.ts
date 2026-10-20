import {AI_MODEL} from '../../../src/aiProtocol.ts';
import {DAY_PLAN_SCHEMA,DAY_PLAN_INSTRUCTIONS,compileDayPlan} from '../../../src/routeCompiler.ts';
import type {FlowContext} from '../../../src/privatePlanning.ts';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, apikey, x-client-info, content-type','Access-Control-Allow-Methods':'POST, OPTIONS','Cache-Control':'no-store','Content-Type':'application/json'};
const reply=(status:number,data:unknown)=>new Response(JSON.stringify(data),{status,headers:cors});
export class FlowGateError extends Error{status:number;constructor(message:string,status=403){super(message);this.status=status;}}
export function planningProviderFailure(status:number,raw:unknown){
 const message=typeof(raw as {error?:{message?:unknown}})?.error?.message==='string'?(raw as {error:{message:string}}).error.message:'';
 const issue=/unknown name|unrecognized field|unsupported.*field/i.test(message)?'request_field':/api.?key.*(?:invalid|not valid)|API_KEY_INVALID/i.test(message)?'key_invalid':/model.*(?:not found|not supported|unavailable)/i.test(message)?'model_unavailable':/permission|SERVICE_DISABLED|API.*disabled/i.test(message)?'permission':/schema|response.format|complexity/i.test(message)?'schema':'other';
 const field=['minLength','maxLength','maxItems','minItems','additionalProperties','enum','generation_config','response_format','schema','model','max_output_tokens'].find(x=>message.includes(x))||'unspecified';
 return {http_status:status,issue,field};
}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
async function bounded(body:ReadableStream<Uint8Array>|null,max:number){if(!body)throw Error('body');const reader=body.getReader(),parts:Uint8Array[]=[];let n=0;try{while(true){const {done,value}=await reader.read();if(done)break;n+=value.length;if(n>max){await reader.cancel();throw Error('limit');}parts.push(value);}}finally{reader.releaseLock();}const out=new Uint8Array(n);let at=0;for(const part of parts){out.set(part,at);at+=part.length;}return new TextDecoder().decode(out);}
export function createPlanningHandler(deps:{key:()=>string|undefined;gate:(request:Request,action:'generate_reserve'|'generate_finish',payload:Record<string,unknown>)=>Promise<unknown>;fetcher?:typeof fetch;recordFailure?:(failure:ReturnType<typeof planningProviderFailure>)=>void}){
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
   controller=new AbortController();const timeout=setTimeout(()=>controller?.abort(),90000);let response:Response;let text:string;
   try{
    response=await(deps.fetcher||fetch)('https://generativelanguage.googleapis.com/v1/interactions',{method:'POST',redirect:'error',signal:controller.signal,headers:{'x-goog-api-key':key,'Content-Type':'application/json'},body:JSON.stringify({model:AI_MODEL,store:false,stream:false,background:false,tools:[],generation_config:{thinking_level:'minimal',thinking_summaries:'none',max_output_tokens:20000,tool_choice:'none'},
     system_instruction:DAY_PLAN_INSTRUCTIONS,
     input:JSON.stringify({destination:ctx.destination,traveller_count:ctx.traveller_count??1,arrival_instant_utc:new Date(ctx.start).toISOString(),departure_instant_utc:new Date(ctx.end).toISOString(),available_hours:(Date.parse(ctx.end)-Date.parse(ctx.start))/3600000,estimation_date:new Date().toISOString().slice(0,10),shareable_choices:ctx.refs.map(r=>({id:r.id,title:r.title,kind:r.kind,priority:r.priority}))}),response_format:[{type:'text',mime_type:'application/json',schema:DAY_PLAN_SCHEMA}]})});
    if(!response.ok){let raw:unknown;try{raw=JSON.parse(await bounded(response.body,8000));}catch{}deps.recordFailure?.(planningProviderFailure(response.status,raw));return reply(response.status===429?429:503,{error:response.status===429?'Gemini’s Free Tier quota is unavailable or reached. Confirmed inputs are kept; retry later.':'Gemini could not draft the itinerary. Confirmed inputs are kept.'});}
    text=await bounded(response.body,350000);
   }finally{clearTimeout(timeout);}
   const result=JSON.parse(text);if(result.status!=='completed'||!Array.isArray(result.steps)||result.steps.some((s:{type?:string})=>!['model_output','thought'].includes(s.type||'')))throw Error('incomplete');
   const content=result.steps.filter((s:{type:string})=>s.type==='model_output').flatMap((s:{content?:unknown[]})=>s.content||[]);
   if(content.length!==1||content[0].type!=='text'||typeof content[0].text!=='string')throw Error('output');
   const choice=compileDayPlan(JSON.parse(content[0].text),ctx);
   // Re-authorise after the external call; the database constructs the only saved document.
   const state=await deps.gate(req,'generate_finish',{...payload,choice});return reply(200,state);
  }catch(e){if(e instanceof FlowGateError)return reply(e.status,{error:e.message});if(e instanceof Error&&e.message.startsWith('The complete itinerary needs correction:'))return reply(503,{error:e.message+' No new plan was saved; confirmed inputs are kept.'});return reply(503,{error:'The itinerary could not be validated or completed. Your confirmed inputs are unchanged.'});}
  finally{controller?.abort();}
 };
}
