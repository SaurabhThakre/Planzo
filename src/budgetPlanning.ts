import {DIRECT_PLAN_SCHEMA,DIRECT_PLAN_INSTRUCTIONS,compileDayPlan} from './routeCompiler.ts';
import type {DirectPlan} from './routeCompiler';
import type {FlowContext} from './privatePlanning';
import {destinationHour} from './routePlanning.ts';
import type {RouteItem} from './routePlanning';
import {validatePriceRange} from './contextualPlanning.ts';

type EconomyOption={ref:string;title:string;description:string;price:RouteItem['price'];compatible_with_must_haves:boolean;requirements_note:string};
export type BudgetPlan=Omit<DirectPlan,'version'>&{version:8;economy_options:EconomyOption[]};
const text={type:'string'},price={type:'object',additionalProperties:false,required:['low_inr','high_inr','assumptions'],properties:{low_inr:{type:'integer'},high_inr:{type:'integer'},assumptions:text}};
const properties={...DIRECT_PLAN_SCHEMA.properties,version:{type:'integer',enum:[8]},economy_options:{type:'array',items:{type:'object',additionalProperties:false,required:['ref','title','description','price','compatible_with_must_haves','requirements_note'],properties:{ref:text,title:text,description:text,price,compatible_with_must_haves:{type:'boolean'},requirements_note:text}}}};
export const BUDGET_PLAN_SCHEMA={type:'object',additionalProperties:false,required:Object.keys(properties),properties};
export const BUDGET_PLAN_INSTRUCTIONS=DIRECT_PLAN_INSTRUCTIONS.replace('version7','version8')+`
If the input supplies unresolved_first_dinner_source_ids, the listed hard rules are mutually exclusive. Describe the clash in a route assumption. Keep any first dinner provisional; don't claim that vegetarian and non-vegetarian options satisfy a vegetarian-only group dinner. Planzo will record both requirements as unresolved. Use conflicts only for real visit options with valid ids. Omit optional votes when in doubt. On a departure day ending before 18:00 local time, plan only a light morning and early afternoon, with enough time for the return journey. Omit evening and night stops. Do not schedule a meal or visit at the departure time.

AFFORDABLE OPTIONS: The primary route should already use practical economical meals and accommodation, not mid-range hotels by default. Follow explicit reviewed must-haves. Also return economy_options: one genuinely cheaper meal/stay option for each programme meal or overnight base wherever compatible. Each option.ref is the exact programme/overnight item id. Describe a concrete affordable meal or lodging type IN THE SAME AREA, at the SAME TIME and duration, with its own realistic positive whole-INR price range. Examples include a local set meal instead of an upscale restaurant, or a suitable hostel/budget inn instead of a mid-range hotel. Do not invent a discount, lower the same item's price without changing the arrangement, or use free food/accommodation. Options do not change transport, activities, fees or source mappings. No economy options for visits, rules or journeys.
compatible_with_must_haves is true ONLY when the option preserves EVERY reviewed must-have applying to that arrangement, including dietary/accessibility/room/privacy requirements. A dorm is not compatible with a required private room. A cheaper meal cannot discard a dietary need. requirements_note briefly explains this compatibility or why an option is unavailable. Mark incompatible/uncertain options false; Planzo will not select them. A flexible upgrade can be adjusted. Use at most80 options, one per referenced item; titles<=120,descriptions<=480,requirements_note<=240,and description plus requirements_note together<=480 characters. Keep route assumptions at most6. Planzo checks affordability privately and may select these options if the primary draft cannot fit. You receive no person's ceiling or derived spending target. All prices remain unverified model estimates; never promise that the trip fits a budget you have not seen.`;

const fail=(s:string):never=>{throw Error('The complete itinerary needs correction: '+s);};
const safeText=(s:unknown,max:number)=>typeof s==='string'&&s.trim().length>0&&s.length<=max&&!/[\u0000-\u001f]|https?:\/\//i.test(s);
// Only flag clear, opposing hard requirements for the same shared first dinner.
export function firstDinnerConflict(ctx:FlowContext){
 const dinner=ctx.refs.filter(r=>r.kind==='food'&&r.priority==='hard'&&/\bfirst shared dinner\b/i.test(r.title));
 const vegetarian=dinner.filter(r=>/\bfirst shared dinner\s+must\s+be\s+(?:strictly\s+)?vegetarian[- ]only\b/i.test(r.title));
 const meat=dinner.filter(r=>/\bmust\s+(?:be served|serve|include|contain)\s+(?:a\s+)?(?:meat|seafood|fish)\b(?![- ]free|\s+substitute)/i.test(r.title)&&!vegetarian.includes(r));
 return vegetarian.length&&meat.length?[...vegetarian,...meat].map(r=>r.id):[];
}
function compileBudgetRoute(plan:DirectPlan,ctx:FlowContext,dinnerConflict:readonly string[]){
 try{return compileDayPlan(plan,ctx,dinnerConflict);}
 catch(error){
  const isDepartureOverrun=(e:unknown)=>e instanceof Error&&/^(The complete itinerary needs correction: )(the final day needs a shorter programme before departure|the proposed journeys do not fit before departure)\.$/.test(e.message);
  if(!isDepartureOverrun(error)||destinationHour(ctx.end,plan.route.time_zone)>=18)throw error;
  const candidate=structuredClone(plan),day=candidate.days.at(-1)!;
  const hard=new Set(ctx.refs.filter(ref=>ref.priority==='hard').map(ref=>ref.id));
  // Drop only optional trailing stops that leave the route and its return leg intact.
  for(let removed=0;removed<2;removed++){
   const stop=day.programme.at(-1);
   if(!stop||stop.travel.length||stop.sources.some(id=>hard.has(id))
    ||stop.category==='meal'&&!day.programme.slice(0,-1).some(item=>item.category==='meal'))throw error;
   day.programme.pop();
   const {period,duration_minutes,travel,...unplaced}=stop;
   if(unplaced.sources.length)candidate.additional_choices.push(unplaced);
   candidate.conflicts=candidate.conflicts.filter(choice=>choice.a!==stop.id&&choice.b!==stop.id);
   if(removed===0)candidate.route.assumptions.push('Optional departure-day stops that would overrun your confirmed departure were left unscheduled. The route and return journey are preserved.');
   try{return compileDayPlan(candidate,ctx,dinnerConflict);}
   catch(next){if(!isDepartureOverrun(next))throw next;}
  }
  throw error;
 }
}
export function compileBudgetPlans(raw:unknown,ctx:FlowContext){
 const x=raw as BudgetPlan;
 if(!x||typeof x!=='object'||x.version!==8)fail('invalid budget-option format.');
 const {economy_options,version,...rest}=x;
 const primary={...rest,version:7 as const};
 const dinnerConflict=firstDinnerConflict(ctx);
 const standard=compileBudgetRoute(primary,ctx,dinnerConflict);
 const targets=new Map(primary.days.flatMap(day=>[...day.programme.filter(s=>s.category==='meal'),...day.overnight]).map(s=>[s.id,s]));
 const seen=new Set<string>(),chosen=new Map<string,EconomyOption>();
 // An optional economy suggestion cannot invalidate a usable primary route.
 for(const option of Array.isArray(economy_options)?economy_options.slice(0,80):[]){
  if(!option||!safeText(option.ref,64)||!targets.has(option.ref))continue;
  if(seen.has(option.ref)){chosen.delete(option.ref);continue;}
  seen.add(option.ref);
  if(Object.keys(option).sort().join('|')!==['ref','title','description','price','compatible_with_must_haves','requirements_note'].sort().join('|')
   ||option.compatible_with_must_haves!==true||!safeText(option.title,120)||!safeText(option.description,480)
   ||!safeText(option.requirements_note,240)||option.description.length+1+option.requirements_note.length>480)continue;
  try{validatePriceRange(option.price,true);}catch{continue;}
  if(option.price.high_inr<targets.get(option.ref)!.price.high_inr)chosen.set(option.ref,option);
 }
 // Raw ceilings never leave the database. This variant is tried only after its
 // private affordability check rejects the primary; no second provider call.
 const economy=()=>{
  if(!chosen.size)return null;
  const candidate=structuredClone(primary);
  const apply=<T extends {id:string;title:string;description:string;price:RouteItem['price']}>(item:T):T=>{const option=chosen.get(item.id);return option?{...item,title:option.title,description:option.description+' '+option.requirements_note,price:option.price}:item;};
  for(const day of candidate.days){day.programme=day.programme.map(s=>apply(s));day.overnight=day.overnight.map(s=>apply(s));}
  if(candidate.route.assumptions.length<9)candidate.route.assumptions.push('Planzo selected lower-cost meals or accommodation proposed by Gemini after a private affordability check. Original times,areas,journeys and source requests remain; verify these arrangements before booking.');
  try{return compileBudgetRoute(candidate,ctx,dinnerConflict);}catch{return null;}
 };
 return{standard,economy,cheaperOptions:chosen.size};
}
