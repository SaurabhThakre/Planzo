import {DIRECT_PLAN_SCHEMA,DIRECT_PLAN_INSTRUCTIONS,compileDayPlan} from './routeCompiler.ts';
import type {DirectPlan} from './routeCompiler';
import type {FlowContext} from './privatePlanning';
import type {RouteItem} from './routePlanning';
import {validatePriceRange} from './contextualPlanning.ts';

type EconomyOption={ref:string;title:string;description:string;price:RouteItem['price'];compatible_with_must_haves:boolean;requirements_note:string};
export type BudgetPlan=Omit<DirectPlan,'version'>&{version:8;economy_options:EconomyOption[]};
const text={type:'string'},price={type:'object',additionalProperties:false,required:['low_inr','high_inr','assumptions'],properties:{low_inr:{type:'integer'},high_inr:{type:'integer'},assumptions:text}};
const properties={...DIRECT_PLAN_SCHEMA.properties,version:{type:'integer',enum:[8]},economy_options:{type:'array',items:{type:'object',additionalProperties:false,required:['ref','title','description','price','compatible_with_must_haves','requirements_note'],properties:{ref:text,title:text,description:text,price,compatible_with_must_haves:{type:'boolean'},requirements_note:text}}}};
export const BUDGET_PLAN_SCHEMA={type:'object',additionalProperties:false,required:Object.keys(properties),properties};
export const BUDGET_PLAN_INSTRUCTIONS=DIRECT_PLAN_INSTRUCTIONS.replace('version7','version8')+`
AFFORDABLE OPTIONS: The primary route should already use practical economical meals and accommodation, not mid-range hotels by default. Follow explicit reviewed must-haves. Also return economy_options: one genuinely cheaper meal/stay option for each programme meal or overnight base wherever compatible. Each option.ref is the exact programme/overnight item id. Describe a concrete affordable meal or lodging type IN THE SAME AREA, at the SAME TIME and duration, with its own realistic positive whole-INR price range. Examples include a local set meal instead of an upscale restaurant, or a suitable hostel/budget inn instead of a mid-range hotel. Do not invent a discount, lower the same item's price without changing the arrangement, or use free food/accommodation. Options do not change transport, activities, fees or source mappings. No economy options for visits, rules or journeys.
compatible_with_must_haves is true ONLY when the option preserves EVERY reviewed must-have applying to that arrangement, including dietary/accessibility/room/privacy requirements. A dorm is not compatible with a required private room. A cheaper meal cannot discard a dietary need. requirements_note briefly explains this compatibility or why an option is unavailable. Mark incompatible/uncertain options false; Planzo will not select them. A flexible upgrade can be adjusted. Use at most80 options, one per referenced item; titles<=120,descriptions<=480,requirements_note<=240,and description plus requirements_note together<=480 characters. Keep route assumptions at most6. Planzo checks affordability privately and may select these options if the primary draft cannot fit. You receive no person's ceiling or derived spending target. All prices remain unverified model estimates; never promise that the trip fits a budget you have not seen.`;

const fail=(s:string):never=>{throw Error('The complete itinerary needs correction: '+s);};
const safeText=(s:unknown,max:number)=>typeof s==='string'&&s.trim().length>0&&s.length<=max&&!/[\u0000-\u001f]|https?:\/\//i.test(s);
export function compileBudgetPlans(raw:unknown,ctx:FlowContext){
 const x=raw as BudgetPlan;
 if(!x||typeof x!=='object'||x.version!==8||Object.keys(x).sort().join('|')!==Object.keys(properties).sort().join('|')||!Array.isArray(x.economy_options)||x.economy_options.length>80)fail('invalid budget-option format.');
 const {economy_options,version,...rest}=x;
 const primary={...rest,version:7 as const};
 const standard=compileDayPlan(primary,ctx);
 const targets=new Map(primary.days.flatMap(day=>[...day.programme.filter(s=>s.category==='meal'),...day.overnight]).map(s=>[s.id,s]));
 const seen=new Set<string>(),chosen=new Map<string,EconomyOption>();
 for(const option of economy_options){
  if(!option||Object.keys(option).sort().join('|')!==['ref','title','description','price','compatible_with_must_haves','requirements_note'].sort().join('|')||typeof option.ref!=='string'||seen.has(option.ref)||!targets.has(option.ref)||typeof option.compatible_with_must_haves!=='boolean'||!safeText(option.title,120)||!safeText(option.description,480)||!safeText(option.requirements_note,240))fail('an economy option has invalid details or does not refer to one meal or overnight base.');
  seen.add(option.ref);validatePriceRange(option.price,true);
  if(option.compatible_with_must_haves&&option.price.high_inr<targets.get(option.ref)!.price.high_inr)chosen.set(option.ref,option);
 }
 // Raw ceilings never leave the database. This variant is tried only after its
 // private affordability check rejects the primary; no second provider call.
 const economy=()=>{
  if(!chosen.size)return null;
  const candidate=structuredClone(primary);
  const apply=<T extends {id:string;title:string;description:string;price:RouteItem['price']}>(item:T):T=>{const option=chosen.get(item.id);return option?{...item,title:option.title,description:option.description+' '+option.requirements_note,price:option.price}:item;};
  for(const day of candidate.days){day.programme=day.programme.map(s=>apply(s));day.overnight=day.overnight.map(s=>apply(s));}
  // Keep the combined description bounded without silently cutting a requirement.
  if(candidate.days.flatMap(d=>[...d.programme,...d.overnight]).some(i=>i.description.length>480))fail('keep each economy description and its requirement note within480 characters.');
  if(candidate.route.assumptions.length<9)candidate.route.assumptions.push('Planzo selected lower-cost meals or accommodation proposed by Gemini after a private affordability check. Original times,areas,journeys and source requests remain; verify these arrangements before booking.');
  return compileDayPlan(candidate,ctx);
 };
 return{standard,economy,cheaperOptions:chosen.size};
}
