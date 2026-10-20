// Shared bounded protocol. Personal answers never become shared itinerary prose.
export const FLOW_INTERESTS=['Beach','Relaxation','Culture','Nature','Food','Adventure','Nightlife','Shopping'] as const;
export type PlanningRequest={title:string;kind:'activity'|'food'|'stay'|'rule';priority:'hard'|'soft'};
export type RequirementOutcome={ref:string;status:'included'|'excluded';reason:'scheduled'|'budget'|'timing'|'unverified'|'group_decision';steps:string[]};
export type PersonalInput={version?:2|3;origin:string;window_id:string;start:string;end:string;outbound_minutes:number;return_minutes:number;ceiling_paise:number;travel_reserve_paise:number;interests:string[];places:string[];hard:string;soft:string;fictional:boolean;ai_consent:boolean;requests?:PlanningRequest[];requests_reviewed?:boolean};
export type PlanningEstimate={low_paise:number;high_paise:number;assumptions:string;source:'gemini'|'host'};
export type FlowRef={id:string;title:string;kind?:PlanningRequest['kind'];priority?:PlanningRequest['priority'];cost_paise?:number;sources?:string[];location?:string;description?:string;needs_confirmation?:boolean;price?:PlanningEstimate;route_item?:import('./routePlanning').RouteItem};
export type FlowContext={stamp:string;start:string;end:string;destination:string;refs:FlowRef[];traveller_count?:number};
export type FlowStep={id:string;start:string;end:string;kind:'food'|'stay'|'activity'|'rest';ref:string;cost_paise:number;alternatives:string[];detail_ref?:string;route_ref?:string;time_zone?:string;estimate?:PlanningEstimate;price_ref?:string};
export type FlowDocument={start:string;end:string;steps:FlowStep[];refs:FlowRef[];unplaced:string[];cost_paise:number;basis:'fictional_reference_v1'|'gemini_estimate_v1';route_version?:1;route?:import('./routePlanning').RouteInfo;requirements_version?:1;outcomes?:RequirementOutcome[];contextual_version?:1;source_refs?:FlowRef[];pricing_version?:1;cost_low_paise?:number;pricing?:{currency:'INR';estimated_at:string;model:string;days:number;meal:PlanningEstimate;stay:PlanningEstimate;local_travel:PlanningEstimate;fees:PlanningEstimate}};
export type FlowChoice={sequence:string[];conflicts:{a:string;b:string}[]};
export const localDate=(s:string)=>new Date(new Date(s).getTime()+19800000).toISOString().slice(0,16);
export const instant=(s:string)=>/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)?s+':00+05:30':s;
export function validatePersonal(b:PersonalInput,windows:{id:string;start:string;end:string}[]){
 const w=windows.find(x=>x.id===b.window_id),s=Date.parse(instant(b.start)),e=Date.parse(instant(b.end));
 if(!b.origin.trim()||b.origin.length>80)throw Error('Enter your starting city.');
 if(!w||!Number.isFinite(s)||!Number.isFinite(e)||s<Date.parse(instant(w.start))||e>Date.parse(instant(w.end))||e<=s)throw Error('Choose personal times inside this tentative date option, with return after departure.');
 if([b.outbound_minutes,b.return_minutes].some(x=>!Number.isSafeInteger(x)||x<0||x>4320)||e-s<=(b.outbound_minutes+b.return_minutes)*60000)throw Error('Enter outbound and return travel durations that leave some time at the destination.');
 if(!Number.isSafeInteger(b.ceiling_paise)||b.ceiling_paise<100||b.ceiling_paise>10000000000)throw Error('Enter a whole-trip ceiling in INR.');
 if(!Number.isSafeInteger(b.travel_reserve_paise)||b.travel_reserve_paise<0||b.travel_reserve_paise>=b.ceiling_paise)throw Error('Reserve an amount below your ceiling for return travel and time outside the shared itinerary.');
 if(b.interests.length>8||new Set(b.interests).size!==b.interests.length||b.interests.some(x=>!(FLOW_INTERESTS as readonly string[]).includes(x)))throw Error('Choose the interests that fit.');
 if(b.places.length>6||b.places.some(x=>!x.trim()||x.length>80)||new Set(b.places).size!==b.places.length)throw Error('Enter up to six different shareable places, one per line.');
 if(b.hard.length>1500||b.soft.length>1500||!b.hard.trim()||!b.soft.trim())throw Error('Answer the must-have and flexible questions; “None” is fine.');
 if(b.requests!==undefined)validatePlanningRequests(b.requests,b.requests_reviewed);
 if(b.version!==3&&b.ai_consent&&!b.fictional)throw Error('Gemini Free Tier is available only for separately consented fictional answers.');
 if(b.version===3&&(b.outbound_minutes!==0||b.return_minutes!==0||b.travel_reserve_paise!==0))throw Error('Destination availability has no separate travel buffers or upfront personal allowance.');
 return {...b,start:instant(b.start),end:instant(b.end),origin:b.origin.trim()};
}
export function validateFlowChoice(raw:unknown,refs:FlowRef[]):FlowChoice{
 const x=raw as FlowChoice,allowed=new Set(refs.map(r=>r.id));
 if(!x||Object.keys(x).sort().join(',')!=='conflicts,sequence'||!Array.isArray(x.sequence)||x.sequence.length!==refs.length||new Set(x.sequence).size!==refs.length||x.sequence.some(k=>!allowed.has(k))||!Array.isArray(x.conflicts)||x.conflicts.length>12)throw Error('Gemini did not return every shareable choice in the expected format. Nothing was saved.');
 const seen=new Set<string>();for(const c of x.conflicts){if(!c||Object.keys(c).sort().join(',')!=='a,b'||!allowed.has(c.a)||!allowed.has(c.b)||c.a===c.b||seen.has(c.a))throw Error('The proposed alternatives could not be checked.');seen.add(c.a);}
 return x;
}
const costFor=(kind:FlowStep['kind'])=>kind==='food'?35000:kind==='stay'?150000:kind==='activity'?55000:0;
// Deterministic time/fee/contingency checks surround Gemini's ordering decision.
export function buildFlowDocument(context:FlowContext,choice:FlowChoice):FlowDocument{
 validateFlowChoice(choice,context.refs);
 const start=Date.parse(context.start),end=Date.parse(context.end);
 if(!Number.isFinite(start)||!Number.isFinite(end)||end-start<3600000||end-start>366*86400000)throw Error('A shared interval of at least one hour is needed.');
 const steps:FlowStep[]=[];let cursor=start,index=0;
 const seen=new Set<string>();
 while(cursor<end){
  const local=new Date(cursor+19800000),hour=local.getUTCHours()+local.getUTCMinutes()/60;
  const [boundary,kind]:[number,FlowStep['kind']]=hour<6?[6,'stay']:hour<9?[9,'food']:hour<12?[12,'activity']:hour<14?[14,'food']:hour<18?[18,'activity']:hour<21?[21,'food']:[24,'stay'];
  const midnight=Date.UTC(local.getUTCFullYear(),local.getUTCMonth(),local.getUTCDate())-19800000;
  const until=Math.min(end,midnight+boundary*3600000),previous=steps.at(-1);
  let ref=kind==='activity'?(choice.sequence[index++%Math.max(1,choice.sequence.length)]||'rest'):kind;
  let actualKind:FlowStep['kind']=ref==='rest'?'rest':kind;
  if(actualKind==='activity'&&until-cursor<3600000){ref='rest';actualKind='rest';index--;}
  if(actualKind==='activity')seen.add(ref);
  const alt=choice.conflicts.find(c=>c.a===ref)?.b;
  if(previous&&actualKind==='stay'&&previous.kind==='stay')previous.end=new Date(until).toISOString();
  else steps.push({id:'step_'+(steps.length+1),start:new Date(cursor).toISOString(),end:new Date(until).toISOString(),kind:actualKind,ref,cost_paise:costFor(actualKind),alternatives:alt?[alt]:[]});
  cursor=until;
 }
 const base=steps.reduce((n,s)=>n+s.cost_paise,0)+5000;
 return {start:new Date(start).toISOString(),end:new Date(end).toISOString(),steps,refs:context.refs,unplaced:choice.sequence.filter(r=>!seen.has(r)),cost_paise:Math.ceil(base*11/10),basis:'fictional_reference_v1'};
}
export const FLOW_CHOICE_SCHEMA={type:'object',additionalProperties:false,required:['sequence','conflicts'],properties:{sequence:{type:'array',items:{type:'string'},maxItems:80},conflicts:{type:'array',maxItems:12,items:{type:'object',additionalProperties:false,required:['a','b'],properties:{a:{type:'string'},b:{type:'string'}}}}}};
export const flowMoney=(paise:number)=>new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0}).format(paise/100);
export const flowStamp=(s:string)=>new Date(instant(s)).toLocaleString('en-IN',{timeZone:'Asia/Kolkata',dateStyle:'medium',timeStyle:'short'});

// Draft suggestions stay local. The owner edits and explicitly approves each shared request.
export function suggestPlanningRequests(hard:string,soft:string):PlanningRequest[]{
 const result:PlanningRequest[]=[];
 for(const [text,priority] of [[hard,'hard'],[soft,'soft']] as const){
  const raw=text.replace(/TEST\s*FICTIONAL\s*:?/gi,'');
  // Separate explicit positive requests; keep negations and conditional wording intact for owner review.
  const parts=/\b(no|not|avoid|without|only|unless|except|if)\b/i.test(raw)?raw:raw.replace(/,\s*(?=(?:I\s+)?(?:also\s+)?(?:want|prefer|must|would like|need)\b)|\s+(?:and\s+)?I\s+(?:also\s+)?(?:want|prefer|must|would like|need)(?:\s+to)?\s+|\s+and\s+(?=(?:eat|visit|rent|do|stay)\b)/gi,'; ');
  for(let title of parts.split(/[;\n]+/).map(x=>x.trim()).filter(x=>x&&!/^(none|no other preferences)[.!]?$/i.test(x))){
   const kind:PlanningRequest['kind']=/meal|vegetarian|vegan|food|diet/i.test(title)?'food':/hotel|hostel|guesthouse|room|accommodation|stay/i.test(title)?'stay':/no overnight|avoid|accessib|wheelchair|step.free|\brent(?:al)?\b|\bhire\b/i.test(title)?'rule':'activity';
   const named=kind==='activity'?title.match(/scuba diving|surfing|sailing|snorkell?ing|kayaking|hiking|relaxed beach day/gi):null;
   // Only split a simple positive list; negation and extra conditions remain in full for owner review.
   const names=named&&named.length>1&&!/\b(no|not|avoid|without|only|unless|except|if)\b/i.test(title)?named:[title];
   for(const name of names)result.push({title:name.trim(),kind,priority});
  }
 }
 return result;
}
export function validatePlanningRequests(requests:PlanningRequest[],reviewed?:boolean){
 if(!reviewed)throw Error('Review the planning requests that may be shared, including every must-have you want considered.');
 if(!Array.isArray(requests))throw Error('Review the planning request list before confirming.');
 if(requests.length>20)throw Error('There are '+requests.length+' planning requests. Combine related requests or remove extras to use at most 20.');
 const seen=new Set<string>();for(const [i,r]of requests.entries()){
  const label='Planning request '+(i+1);
  if(!r||Object.keys(r).sort().join(',')!=='kind,priority,title'||!['activity','food','stay','rule'].includes(r.kind)||!['hard','soft'].includes(r.priority)||typeof r.title!=='string')throw Error(label+': choose a type and priority.');
  if(!r.title.trim())throw Error(label+' is empty. Enter a short request or remove it.');
  if(r.title.length>120)throw Error(label+' has '+r.title.length+' characters. Shorten it to 120 or split it into separate requests; your private answer above stays unchanged.');
  const key=r.kind+':'+r.title.trim().toLowerCase();if(seen.has(key))throw Error(label+' repeats an earlier request of the same type. Edit it or remove the duplicate.');seen.add(key);
 }
}
export const requirementReason=(reason:RequirementOutcome['reason'])=>({scheduled:'Included in the proposed plan; availability still needs booking verification.',budget:'Excluded: the planning estimate does not fit the shared budget after essentials and personal travel reserves.',timing:'Excluded: there is not enough suitable shared time.',unverified:'Excluded from the promised plan: this condition cannot be verified by the current planner. Review it before agreeing.',group_decision:'Excluded following the group’s step decision.'}[reason]);
