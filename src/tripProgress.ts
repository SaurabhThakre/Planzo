import type {Workspace} from './backend';
import type {FlowState} from './flowBackend';
export const afterInputDestination=(included:number,organiser:boolean)=>included===1&&organiser?'plan':'';
export function tripProgress(workspace:Workspace,userId:string,state:FlowState|null){
 const members=workspace.members.filter(m=>m.included),own=members.find(m=>m.id===userId),organiser=own?.role==='organiser';
 const pending=members.filter(m=>!m.confirmed),confirmed=members.length-pending.length;
 const base={members,pending,confirmed,total:members.length,title:'Checking trip progress',body:'Your latest planning status will appear here.',action:'Open itinerary',tab:'plan',tone:'pending'};
 if(['archived','postponed'].includes(workspace.trip.stage))return{...base,title:workspace.trip.stage==='archived'?'Trip archived':'Trip postponed',body:'Saved plans and decisions are in History.',action:'View history',tab:'history'};
 if(!own)return{...base,title:'You are an observer',body:'Included travellers are planning this trip.',action:'View itinerary'};
 if(!state||state.trip_id!==workspace.trip.id)return base;
 const plan=state.plan;
 if(plan?.locked)return{...base,title:'Itinerary locked',body:'Arrange your bookings and add expenses when you need to.',action:'Open Bookings',tab:'bookings',tone:'complete'};
 if(!own.confirmed)return{...base,title:'Your private input is next',body:'Confirm your dates, budget and requests so planning can move forward.',action:'Add my private input',tab:'preferences'};
 if(state.confirmed<state.included||pending.length)return{...base,title:'Waiting for '+Math.max(pending.length,state.included-state.confirmed)+' '+(Math.max(pending.length,state.included-state.confirmed)===1?'traveller':'travellers'),body:'Your input is confirmed. The itinerary can be created once every included traveller confirms.',action:'Review my input',tab:'preferences'};
 if(state.blocker)return{...base,title:'Planning needs attention',body:state.blocker,action:organiser?'Resolve planning issue':'Review my input',tab:organiser?'plan':'preferences'};
 if(!plan)return{...base,title:organiser?'Ready to create your itinerary':'All private inputs are confirmed',body:organiser?'Your dates and requests are ready. Continue to create the itinerary.':'The organiser can now create the itinerary.',action:organiser?'Create itinerary':'View planning status',tone:'ready'};
 const decisions=state.polls.filter(p=>['open','unresolved'].includes(p.status)).length;
 if(decisions)return{...base,title:decisions+' step '+(decisions===1?'decision needs':'decisions need')+' attention',body:'Review the proposed changes before confirming the itinerary.',action:'Open step decisions',tab:'voting'};
 if(state.personal_checks_pending||plan.requirements_legacy||plan.document.unplaced.length)return{...base,title:'The itinerary needs a review',body:'Resolve outstanding requests or step decisions before confirming.',action:'Review itinerary',tab:state.personal_checks_pending?'voting':'plan'};
 if(plan.review_count===state.included)return{...base,title:organiser?'Ready to lock the itinerary':'Everyone confirmed the itinerary',body:organiser?'Every included traveller has said yes to this version. Review and lock it when ready.':'The organiser can now lock this version.',action:organiser?'Review and lock':'View itinerary',tab:'review',tone:'ready'};
 return{...base,title:plan.reviewed?'Waiting for itinerary reviews':'Your itinerary review is next',body:plan.review_count+' of '+state.included+' travellers confirmed this version.',action:plan.reviewed?'View review progress':'Review my itinerary',tab:'review'};
}
