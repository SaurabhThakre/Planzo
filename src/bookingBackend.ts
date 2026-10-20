import {supabase} from './backend';
export type Milestone={id:string;label:string;status:'complete'|'pending'|'needs_review'|'not_applicable'};
export type BookingTask={key:string;revision:number;category:string;personal:boolean;owner_id:string|null;due_at:string|null;provider_id:string;saved_at:string;
 report:{revision:number;task_revision:number;status:string;reporter:string;at:string;current_task:boolean}|null};
export type BookingState={revision:number;stage:string;plan:{id:string;version:number;current:boolean;agreed:boolean;roster:string[];created_at:string}|null;
 handoff_revision:number;tasks:BookingTask[];providers:{id:string;label:string;type:string;url:string|null}[];
 earlier_handoffs:{plan_id:string;version:number;created_at:string}[];
 report_history:{plan_id:string;version:number;task_key:string;task_revision:number;status:string;reporter:string;at:string}[];
 milestones:Milestone[];milestone_history:{id:string;revision:number;states:Milestone[];at:string}[]};
export async function bookingApi<T=BookingState>(action:string,payload:Record<string,unknown>):Promise<T>{
 const {data,error}=await supabase.rpc('planzo_booking',{p_action:action,p_payload:payload});
 if(error)throw new Error(error.message);return data as T;
}
export const taskTitle=(category:string)=>({travel:'My return travel',personal:'My activity arrangements',stay:'Both overnight stays',local:'Shared local transport',food:'Shared meal arrangements',activities:'Shared activities and free time'}[category]||'Booking task');
export const reportLabel=(status:string)=>({pending:'Pending',reported:'Booking reported · self-reported',not_needed:'No reservation needed · self-reported',link_problem:'Link problem · pending',changed_terms:'Changed terms · needs plan review'}[status]||status);
