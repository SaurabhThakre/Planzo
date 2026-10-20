import {supabase} from './backend';
import {validateAiInput,validateExtraction} from './aiProtocol';
import type {AiInput,AiReply,AiWindow} from './aiProtocol';
export async function interpretPreferences(input:AiInput,windows:AiWindow[]):Promise<AiReply>{
  validateAiInput(input);
  const {data,error}=await supabase.functions.invoke('planzo-ai-preferences',{body:input});
  if(error){
    let message='AI interpretation is unavailable. Your text is kept; enter preferences manually.';
    if(error.context instanceof Response){try{const body=await error.context.json();if(typeof body.error==='string'&&body.error.length<=300)message=body.error;}catch{}}
    throw Error(message);
  }
  if(!data||data.request_id!==input.request_id||data.trip_revision!==input.expected_trip_revision||data.brief_revision!==input.expected_brief_revision)throw Error('The AI preview is out of date. Your input is unchanged. Refresh before trying again.');
  return {...data,suggestion:validateExtraction(data.suggestion,input.text,windows.map(w=>w.id),windows)};
}
