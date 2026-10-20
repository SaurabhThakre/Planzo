import {supabase} from './backend';
export type CostSnapshot={rows:{label:string;range:[number,number]}[];total:[number,number];complete:boolean;boat:boolean};
export type Catalogue={label:string;source:string;source_date:string;illustrative:boolean;currency:string;assumptions:string[]};
export type PlanningOption={id:string;title:string;description:string;blockers:string[];own_cost:CostSnapshot|null;rooms:number;catalogue:Catalogue};
export type PlanningState={revision:number;stage:string;deadline:string;catalogue:Catalogue;
 draft:{source_revision:number;current:boolean;window_id:string;selected_option:string|null;options:PlanningOption[]}|null;
 plan:{id:string;version:number;source_revision:number;window_id:string;option_id:string;roster:string[];content:{title:string;rooms:number;itinerary:string[];optional:string};catalogue:Catalogue;created_at:string;current:boolean;own_cost:CostSnapshot|null;responses:{user_id:string;status:string;at:string}[];own_response:{status:string;revision:number;private_reason:string;acknowledged:boolean}|null}|null;
 poll:{id:string;source_revision:number;roster:string[];deadline:string;status:string;responded:number;own_ballot:{choice:string;revision:number}|null;result:{common:number;easy:number;abstain:number;different:number;missing:number;winner:string|null}|null}|null;
 history:{id:string;message:string;created_at:string}[];versions:{id:string;version:number;created_at:string}[]};
export async function planningApi<T=PlanningState>(action:string,payload:Record<string,unknown>):Promise<T>{
 const {data,error}=await supabase.rpc('planzo_planning',{p_action:action,p_payload:payload});
 if(error)throw new Error(error.message);return data as T;
}
export const paise=(n:number)=>'₹'+new Intl.NumberFormat('en-IN',{minimumFractionDigits:n%100?2:0,maximumFractionDigits:2}).format(n/100);
export const costRange=(r:[number,number])=>paise(r[0])+'–'+paise(r[1]);
export const planStage=(stage:string)=>({collecting:'Collecting inputs',planning:'Planning',reviewing:'Reviewing current plan',agreed:'Trip agreed · bookings pending',revise:'Needs fresh review',postponed:'Trip postponed',archived:'Archived'}[stage]||stage);
export function planningSummary(name:string,s:PlanningState,members:{id:string;name:string}[],windows:{id:string;start:string;end:string}[]){
 const p=s.plan,w=windows.find(w=>w.id===p?.window_id);
 return [name,p?'Plan v'+p.version+' · '+(p.current?'current':'historical / needs review'):'No plan shared yet',p?.content.title||'',w?'Travel: '+w.start+' → '+w.end+' IST':'',p?'Included: '+members.filter(m=>p.roster.includes(m.id)).map(m=>m.name).join(', '):'',...(p?.content.itinerary||[]),'Status: '+planStage(s.stage),'Illustrative estimates only. Ready is a nonbinding intention; no booking or payment is made.'].filter(Boolean).join('\n');
}
