import {datedAvailability} from './aiAvailability.ts';
// Shared validation is used at the server boundary and again before UI rendering.
export const AI_CONSENT_POLICY = 'planzo-ai-owner-consent-2026-10-18';
export const AI_MODEL = 'gemini-3.5-flash-lite';
export const AI_MAX_TEXT = 2000;
export const AI_MAX_OUTPUT_TOKENS = 1200;
export const interests = ['Relaxation','Food','Beach','Culture','Adventure'] as const;
export const uncertainties = ['budget_scope','conflicting_amounts','ambiguous_dates','unmatched_date_windows','unsupported_meal_requirement','vague_budget','unclear_requirement','unsupported_request'] as const;
export type AiWindow = {id:string;start:string;end:string};
export type AiInput = {trip_id:string;request_id:string;expected_trip_revision:number;expected_brief_revision:number;text:string;consent:true;fictional_input:boolean;consent_policy:typeof AI_CONSENT_POLICY};
export type AiExtraction = {
  origin:string|null;ceiling_inr:number|null;ceiling_scope:'whole_trip'|'unclear'|'not_stated';
  window_ids:string[];vegetarian:boolean|null;step_free:boolean|null;soft_interests:string[];uncertainties:string[];
  evidence:{origin:string|null;ceiling:string|null;dates:string|null;vegetarian:string|null;step_free:string|null};
};
export type AiReply = {request_id:string;trip_revision:number;brief_revision:number;suggestion:AiExtraction};
const nullableString = {type:['string','null']};
export const AI_SCHEMA = {
  type:'object',additionalProperties:false,
  required:['origin','ceiling_inr','ceiling_scope','window_ids','vegetarian','step_free','soft_interests','uncertainties','evidence'],
  properties:{origin:nullableString,ceiling_inr:{type:['number','null']},ceiling_scope:{type:'string',enum:['whole_trip','unclear','not_stated']},
    window_ids:{type:'array',items:{type:'string',enum:['window_1','window_2','window_3']}},
    vegetarian:{type:['boolean','null']},step_free:{type:['boolean','null']},soft_interests:{type:'array',items:{type:'string',enum:interests}},
    uncertainties:{type:'array',items:{type:'string',enum:uncertainties}},evidence:{type:'object',additionalProperties:false,
      required:['origin','ceiling','dates','vegetarian','step_free'],properties:{origin:nullableString,ceiling:nullableString,dates:nullableString,vegetarian:nullableString,step_free:nullableString}}}
};
const object = (v:unknown):v is Record<string,unknown> => !!v&&typeof v==='object'&&!Array.isArray(v);
const exact = (v:Record<string,unknown>,keys:string[]) => Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const list = (v:unknown,allowed:readonly string[],max:number):v is string[] => Array.isArray(v)&&v.length<=max&&new Set(v).size===v.length&&v.every(x=>typeof x==='string'&&allowed.includes(x));
export function validateAiInput(raw:unknown):AiInput {
  if(!object(raw)||!exact(raw,['trip_id','request_id','expected_trip_revision','expected_brief_revision','text','consent','fictional_input','consent_policy'])||
    typeof raw.trip_id!=='string'||typeof raw.request_id!=='string'||![raw.trip_id,raw.request_id].every(x=>/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(x))||
    !Number.isSafeInteger(raw.expected_trip_revision)||Number(raw.expected_trip_revision)<1||Number(raw.expected_trip_revision)>999999999||
    !Number.isSafeInteger(raw.expected_brief_revision)||Number(raw.expected_brief_revision)<0||Number(raw.expected_brief_revision)>999999999||
    typeof raw.text!=='string'||!raw.text.trim()||raw.text.length>AI_MAX_TEXT||raw.consent!==true||typeof raw.fictional_input!=='boolean'||raw.consent_policy!==AI_CONSENT_POLICY) throw Error('Review your text and allow Gemini to interpret it. Manual entry is always available.');
  return raw as AiInput;
}
export function validateExtraction(raw:unknown,text:string,allowedWindows:string[],windows?:AiWindow[]):AiExtraction {
  if(!object(raw)||!exact(raw,['origin','ceiling_inr','ceiling_scope','window_ids','vegetarian','step_free','soft_interests','uncertainties','evidence'])||
    !(raw.origin===null||(typeof raw.origin==='string'&&raw.origin.trim().length>0&&raw.origin.length<=80))||
    !(raw.ceiling_inr===null||(typeof raw.ceiling_inr==='number'&&Number.isFinite(raw.ceiling_inr)&&raw.ceiling_inr>0&&raw.ceiling_inr<=1000000&&Math.abs(raw.ceiling_inr*100-Math.round(raw.ceiling_inr*100))<0.00001))||
    !['whole_trip','unclear','not_stated'].includes(String(raw.ceiling_scope))||
    !list(raw.window_ids,allowedWindows,3)||![raw.vegetarian,raw.step_free].every(x=>x===null||typeof x==='boolean')||
    !list(raw.soft_interests,interests,5)||!list(raw.uncertainties,uncertainties,uncertainties.length)||!object(raw.evidence)||!exact(raw.evidence,['origin','ceiling','dates','vegetarian','step_free'])) throw Error('The AI preview could not be validated. Your structured input is unchanged; enter it manually or try again.');
  for(const value of Object.values(raw.evidence)) if(value!==null&&(typeof value!=='string'||!value.trim()||value.length>200||!text.includes(value))) throw Error('The AI preview included unsupported evidence. Your input is unchanged.');
  const result=structuredClone(raw) as AiExtraction;
  for(const [key,evidence] of [['origin','origin'],['ceiling_inr','ceiling'],['vegetarian','vegetarian'],['step_free','step_free']] as const)
    if(result[key]!==null&&!result.evidence[evidence]) throw Error('The AI preview included an unsupported field. Your input is unchanged.');
  if(result.window_ids.length&&!result.evidence.dates) throw Error('The AI preview included unsupported dates. Your input is unchanged.');
  if(result.origin!==null&&!result.evidence.origin?.toLowerCase().includes(result.origin.toLowerCase()))throw Error('The AI preview included an unsupported origin. Your input is unchanged.');
  const warn=(name:typeof uncertainties[number])=>{if(!result.uncertainties.includes(name))result.uncertainties.push(name);};
  // Conservative protection even if a model overlooks common conflicting amounts.
  const amounts=[...text.toLowerCase().matchAll(/(?:₹|rs\.?\s*|inr\s*|under\s+|budget\s+(?:of\s+)?)([\d,]+(?:\.\d+)?)\s*(k|thousand)?/g)].map(m=>Number(m[1].replaceAll(',',''))*(m[2]?1000:1));
  if(new Set(amounts).size>1)warn('conflicting_amounts');
  if(result.ceiling_inr!==null&&new Set(amounts).size===1&&amounts[0]!==result.ceiling_inr)throw Error('The AI preview included an unsupported amount. Your input is unchanged.');
  if(result.ceiling_scope!=='whole_trip'||result.uncertainties.some(x=>['budget_scope','conflicting_amounts','vague_budget'].includes(x))){
    if(result.ceiling_inr!==null&&result.ceiling_scope!=='whole_trip')warn('budget_scope');result.ceiling_inr=null;
  }
  // Weekdays alone must never silently map to a particular dated travel window.
  if(result.window_ids.length&&(!/\b20\d{2}\b/.test(result.evidence.dates||'')||result.uncertainties.includes('ambiguous_dates'))){result.window_ids=[];warn('ambiguous_dates');}
  if(windows){
    const available=datedAvailability(text,windows);
    if(available&&available.ids.every(id=>allowedWindows.includes(id))){
      result.window_ids=available.ids;result.evidence.dates=available.evidence;
      result.uncertainties=result.uncertainties.filter(x=>!['ambiguous_dates','unmatched_date_windows'].includes(x));
      if(!available.ids.length)warn('unmatched_date_windows');
    }
  }
  // Non-vegetarian availability does not mean declining vegetarian meals.
  // The current brief cannot enforce this separate requirement.
  if(/\bnon[-\s]?veg(?:etarian)?\b/i.test(text)){
    result.vegetarian=null;result.evidence.vegetarian=null;warn('unsupported_meal_requirement');
  }
  return result;
}
export const uncertaintyText:Record<string,string>={budget_scope:'Confirm whether your amount covers the entire trip, including travel, fees and contingency.',conflicting_amounts:'Different amounts were mentioned. Enter your intended whole-trip ceiling manually.',ambiguous_dates:'The AI could not safely match your availability to the trip’s date options. Check the dated windows above.',unmatched_date_windows:'Your dated availability is clear, but none of this trip’s complete travel windows fits within it. Do not select a window you cannot attend.',unsupported_meal_requirement:'Non-vegetarian meals are not a supported hard-requirement field yet. Your wording remains in the text above; this requirement has not been added to the plan. Check the vegetarian field separately if needed.',vague_budget:'Words such as “cheap” do not set a budget. Enter your own whole-trip ceiling.',unclear_requirement:'A requirement needs clarification. Check the manual fields.',unsupported_request:'Some text is outside preference interpretation. It has not been applied.'};
