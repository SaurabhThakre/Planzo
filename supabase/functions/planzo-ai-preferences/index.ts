import {createClient} from 'npm:@supabase/supabase-js@2.118.0';
import {createHandler,GateError} from './handler.ts';
// No service-role client: every database request keeps the caller's own identity.
const url=Deno.env.get('SUPABASE_URL')||'';
if(url!=='https://ewysgpuwvufbklesdhuj.supabase.co')throw Error('Wrong project configuration.');
const keys=JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS')||'{}');
const publicKey=keys.default||Deno.env.get('SUPABASE_ANON_KEY')||'';
Deno.serve(createHandler({apiKey:()=>Deno.env.get('GEMINI_API_KEY'),recordUsage:usage=>console.info(JSON.stringify({event:'planzo_ai_usage',provider:'gemini',...usage})),recordFailure:failure=>console.info(JSON.stringify({event:'planzo_ai_provider_failure',provider:'gemini',...failure})),gate:async(request,action,payload)=>{
  const authorization=request.headers.get('authorization')||'';
  const client=createClient(url,publicKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{headers:{Authorization:authorization}}});
  const {data:{user},error:authError}=await client.auth.getUser(authorization.replace(/^Bearer\s+/i,''));
  if(authError||!user||user.is_anonymous||!user.email_confirmed_at)throw new GateError('Sign in with a verified email to use the AI preview.',401);
  const {data,error}=await client.rpc('planzo_ai',{p_action:action,p_payload:payload});
  if(error){
    const safe:Record<string,string>={
      '42501':'You do not have access to this AI preview. Sign in to the correct trip.',
      '40001':'Your trip or saved input changed. Refresh before requesting another AI preview.'
    };
    const known=['Review what will be sent and allow Gemini to interpret it, or use the manual form.','The prototype AI allowance is used up. You can still enter all preferences manually.','Your AI preview limit is reached for today. Manual entry still works.','Please wait a moment before requesting another AI preview.','This preview attempt was already used. Request a new preview if needed; nothing was saved to your brief.','This trip is postponed or archived. Manual input and history remain available.'];
    throw new GateError(safe[error.code]||(known.includes(error.message)?error.message:'The AI request could not be admitted. Your preferences are unchanged; manual entry still works.'),error.code==='40001'?409:error.code==='42501'?403:429);
  }
  return data;
}}));
