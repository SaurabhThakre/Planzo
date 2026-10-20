import {supabase} from './backend';
import type {FlowContext,FlowDocument,PersonalInput,RequirementOutcome,FlowRef} from './privatePlanning';
export type FlowPoll={id:string;step_id:string;mode:'choice'|'concern';options:string[];deadline:string;status:'open'|'closed'|'unresolved'|'stale';result:null|{counts:Record<string,number>;winner:string|null;missing:number;abstain:number};own_ballot:null|{choice:string;revision:number};responded:number;own_requirement:boolean;personal_resolved:boolean|null};
export type FlowState={trip_id:string;revision:number;stage:string;stamp:string;included:number;confirmed:number;blocker:string|null;context:FlowContext|null;own:null|{revision:number;confirmed:boolean;content:PersonalInput};ai_available:boolean;
 plan:null|{id:string;version:number;document:FlowDocument;locked:boolean;reviewed:boolean;review_count:number;own_total_paise:number;own_over_budget:boolean;requirements_legacy?:boolean;own_requirement_checks?:({title:string;kind:string;priority:string;interpretations?:FlowRef[]}&Omit<RequirementOutcome,'ref'>)[]};polls:FlowPoll[];personal_checks_pending:boolean;history:{id:string;version:number;created_at:string;locked:boolean}[]};
export async function flowApi(action:string,payload:Record<string,unknown>):Promise<FlowState>{
 const {data,error}=await supabase.rpc('planzo_flow',{p_action:action,p_payload:payload});if(error)throw Error(error.message);return data as FlowState;
}
export async function refineApi<T=FlowState>(action:'edit_trip'|'edit_plan',payload:Record<string,unknown>):Promise<T>{
 const {data,error}=await supabase.rpc('planzo_refine',{p_action:action,p_payload:payload});if(error)throw Error(error.message);return data as T;
}
export async function generateFlow(payload:{trip_id:string;expected_revision:number;expected_stamp:string;request_id:string}):Promise<FlowState>{
 const {data,error}=await supabase.functions.invoke('planzo-planning',{body:payload});
 if(error){let message='Gemini could not generate this itinerary. Your confirmed inputs are kept.';if(error.context instanceof Response){try{const b=await error.context.json();if(typeof b.error==='string'&&b.error.length<300)message=b.error;}catch{}}throw Error(message);}
 if(!data||data.trip_id!==payload.trip_id||data.stamp!==payload.expected_stamp||!data.plan)throw Error('The returned plan is out of date. Refresh to see the current trip.');
 return data as FlowState;
}
