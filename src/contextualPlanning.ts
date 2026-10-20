import type {FlowRef,FlowStep} from './privatePlanning';
export type ContextualItem={id:string;sources:string[];title:string;kind:'activity'|'food'|'stay'|'rule';location:string;description:string;needs_confirmation:boolean};
export type ContextualChoice={version:1;items:ContextualItem[];conflicts:{a:string;b:string}[]};
// Gemini's schema subset does not accept string minLength/maxLength. Enforce them below and in SQL.
const text=(max:number)=>({type:'string',description:'Plain text,1-'+max+' characters. No URLs.'});
export const CONTEXTUAL_CHOICE_SCHEMA={type:'object',additionalProperties:false,required:['version','items','conflicts'],properties:{version:{type:'integer',description:'Always1.'},items:{type:'array',items:{type:'object',additionalProperties:false,required:['id','sources','title','kind','location','description','needs_confirmation'],properties:{id:text(12),sources:{type:'array',items:text(12)},title:text(120),kind:{type:'string',enum:['activity','food','stay','rule']},location:text(120),description:text(480),needs_confirmation:{type:'boolean'}}}},conflicts:{type:'array',items:{type:'object',additionalProperties:false,required:['a','b'],properties:{a:text(12),b:text(12)}}}}};
const safeText=(x:unknown,max:number)=>typeof x==='string'&&x.trim().length>0&&x.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]|https?:\/\//i.test(x);
export function validateContextualChoice(raw:unknown,refs:FlowRef[]):ContextualChoice{
 const x=raw as ContextualChoice,allowed=new Set(refs.map(r=>r.id)),covered=new Set<string>(),seen=new Set<string>();
 if(!x||Object.keys(x).sort().join(',')!=='conflicts,items,version'||x.version!==1||!Array.isArray(x.items)||x.items.length<1||x.items.length>120||!Array.isArray(x.conflicts)||x.conflicts.length>12)throw Error('The contextual itinerary has an invalid structure.');
 for(const [i,r]of x.items.entries()){
  if(!r||Object.keys(r).sort().join(',')!=='description,id,kind,location,needs_confirmation,sources,title'||r.id!=='idea_'+(i+1)||!Array.isArray(r.sources)||r.sources.length<1||r.sources.length>80||new Set(r.sources).size!==r.sources.length||r.sources.some(id=>!allowed.has(id))||!['activity','food','stay','rule'].includes(r.kind)||!safeText(r.title,120)||!safeText(r.location,120)||!safeText(r.description,480)||typeof r.needs_confirmation!=='boolean')throw Error('A proposed place or activity could not be validated.');
  const key=[r.kind,r.title.trim().toLowerCase(),r.location.trim().toLowerCase()].join(':');if(seen.has(key))throw Error('Repeated itinerary ideas must be combined.');seen.add(key);r.sources.forEach(id=>covered.add(id));
 }
 if(covered.size!==allowed.size)throw Error('Every reviewed shared request must have an interpretation or an explicit clarification.');
 const conflicts=new Set<string>();for(const c of x.conflicts){if(!c||Object.keys(c).sort().join(',')!=='a,b'||c.a===c.b||conflicts.has(c.a)||![c.a,c.b].every(id=>x.items.some(r=>r.id===id&&r.kind==='activity')))throw Error('The proposed activity alternatives could not be validated.');conflicts.add(c.a);}
 return x;
}
export function contextualStepRef(step:FlowStep,refs:FlowRef[]){return refs.find(r=>r.id===(step.kind==='activity'?step.ref:step.route_ref|| (step.ref===step.kind?step.detail_ref:undefined)));}
export function contextualMealName(start:string){const hour=new Date(Date.parse(start)+19800000).getUTCHours();return hour<11?'Breakfast':hour<16?'Lunch':'Dinner';}
export function contextualStepLabel(step:FlowStep,refs:FlowRef[]){const r=contextualStepRef(step,refs);if(r?.route_item&&!(step.kind==='rest'&&r.route_item.category!=='rest'))return r.title;if(r&&step.kind==='food')return contextualMealName(step.start)+' · '+r.location;return r?.title||(step.kind==='activity'?(refs.find(r=>r.id===step.ref)?.title||'Free time / rest'):step.kind==='food'?'Meal break and local arrangements':step.kind==='stay'?'Stay / overnight rest':'Free time / rest');}

export type PriceRangeINR={low_inr:number;high_inr:number;assumptions:string};
export type PricedChoice={version:2;currency:'INR';items:(ContextualItem&{price:PriceRangeINR})[];conflicts:{a:string;b:string}[];essentials:{meal:PriceRangeINR;stay:PriceRangeINR;local_travel:PriceRangeINR;fees:PriceRangeINR}};
const priceSchema={type:'object',additionalProperties:false,required:['low_inr','high_inr','assumptions'],properties:{low_inr:{type:'integer',description:'Whole INR,0 to1000000. Lower estimate per person per unit.'},high_inr:{type:'integer',description:'Whole INR,at least low_inr and at most1000000. Conservative upper estimate.'},assumptions:{type:'string',description:'1-240 characters explaining unit, inclusions, season and uncertainty. No URLs or claims of verification.'}}};
const old=CONTEXTUAL_CHOICE_SCHEMA;
export const PRICED_CHOICE_SCHEMA={...old,required:['version','currency','items','conflicts','essentials'],properties:{...old.properties,version:{type:'integer',description:'Always2.'},currency:{type:'string',enum:['INR']},items:{...old.properties.items,items:{...old.properties.items.items,required:[...old.properties.items.items.required,'price'],properties:{...old.properties.items.items.properties,price:priceSchema}}},essentials:{type:'object',additionalProperties:false,required:['meal','stay','local_travel','fees'],properties:{meal:priceSchema,stay:priceSchema,local_travel:priceSchema,fees:priceSchema}}}};
const exact=(x:unknown,keys:string[]):x is Record<string,unknown>=>!!x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).sort().join(',')===[...keys].sort().join(',');
export function validatePriceRange(x:unknown,paidEssential=false):PriceRangeINR{
 if(!exact(x,['low_inr','high_inr','assumptions'])||![x.low_inr,x.high_inr].every(n=>Number.isSafeInteger(n)&&Number(n)>=0&&Number(n)<=1000000)||Number(x.high_inr)<Number(x.low_inr)||(paidEssential&&Number(x.high_inr)===0)||typeof x.assumptions!=='string'||!x.assumptions.trim()||x.assumptions.length>240||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]|https?:\/\//i.test(x.assumptions))throw Error('Gemini did not provide a complete, bounded INR estimate. No plan was saved.');
 return x as PriceRangeINR;
}
export function validatePricedChoice(raw:unknown,refs:FlowRef[]):PricedChoice{
 if(!exact(raw,['version','currency','items','conflicts','essentials'])||raw.version!==2||raw.currency!=='INR'||!Array.isArray(raw.items)||!exact(raw.essentials,['meal','stay','local_travel','fees']))throw Error('Gemini did not return the priced itinerary format. No plan was saved.');
 const items=raw.items.map(item=>{if(!item||typeof item!=='object')throw Error('Invalid priced item.');const {price,...rest}=item;validatePriceRange(price,['food','stay'].includes(item.kind));if(item.kind==='rule'&&(price.low_inr!==0||price.high_inr!==0||item.needs_confirmation!==true))throw Error('Unpriced conditions must remain explicit unverified rules.');return rest;});
 validateContextualChoice({version:1,items,conflicts:raw.conflicts},refs);
 for(const k of ['meal','stay','local_travel','fees'] as const)validatePriceRange(raw.essentials[k],k==='meal'||k==='stay');
 return raw as PricedChoice;
}
