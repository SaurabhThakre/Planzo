import {createClient} from 'npm:@supabase/supabase-js@2.118.0';
import {createPlanningHandler,FlowGateError} from './handler.ts';
const url=Deno.env.get('SUPABASE_URL')||'';
if(url!=='https://ewysgpuwvufbklesdhuj.supabase.co')throw Error('Wrong project.');
const keys=JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS')||'{}'),key=keys.default||Deno.env.get('SUPABASE_ANON_KEY')||'';
Deno.serve(createPlanningHandler({key:()=>Deno.env.get('GEMINI_API_KEY'),recordFailure:failure=>console.info(JSON.stringify({event:'planzo_planning_provider_failure',...failure})),gate:async(req,action,payload)=>{
 const authorization=req.headers.get('authorization')||'';
 const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{headers:{Authorization:authorization}}});
 const {data:{user},error:authError}=await client.auth.getUser(authorization.replace(/^Bearer\s+/i,''));
 if(authError||!user||user.is_anonymous||!user.email_confirmed_at)throw new FlowGateError('Sign in with a verified email.',401);
 const {data,error}=await client.rpc('planzo_flow',{p_action:action,p_payload:payload});
 if(error){const status=error.code==='42501'?403:error.code==='40001'?409:400;
 const safe=['Wait for every included traveller to confirm, and meet the minimum group size.','Personal availability has no shared interval. Each person must review their own dates; a vote cannot override availability.','Every included traveller must review the shared requests and separately allow Gemini.','Please wait a moment before generating again.','This generation attempt was already used.','The generation attempt expired or inputs changed.','The deadline passed. Extend it before generating.'];
 throw new FlowGateError(safe.includes(error.message)?error.message:status===409?'Group inputs changed. Refresh before generating.':'This request could not be admitted. Confirmed inputs are kept.',status);}
 return data;
}}));
