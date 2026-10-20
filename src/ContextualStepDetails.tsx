import type{FlowStep,FlowRef,FlowDocument}from'./privatePlanning';
import{contextualStepRef,contextualMealName}from'./contextualPlanning';
export function ContextualStepDetails({step,refs}:{step:FlowStep;refs:FlowRef[]}){
 const r=contextualStepRef(step,refs);if(!r?.description||step.kind==='rest'&&r.route_item&&r.route_item.category!=='rest')return null;
 return <div className="stack"><p className="caption"><strong>Where:</strong> {r.location}</p>{step.kind==='food'&&!r.route_item&&<p className="caption">Choose a {contextualMealName(step.start).toLowerCase()}-appropriate meal using this shared cuisine and dietary brief. Menu and provider still need checking.</p>}<p>{r.description}</p>{r.needs_confirmation&&<p className="notice">Suggested interpretation: check that this is the place or activity you meant. Any change after agreement needs a fresh review.</p>}</div>;
}


import{flowMoney}from'./privatePlanning';
const range=(lo:number,hi:number)=>lo===hi?flowMoney(hi):flowMoney(lo)+'–'+flowMoney(hi);
export function StepPrice({step:s,document:d}:{step:FlowStep;document:FlowDocument}){
 if(d.pricing_version!==1)return <p className="caption">{flowMoney(s.cost_paise)} per person · illustrative estimate</p>;
 if(s.kind==='rest')return <p className="caption">No scheduled cost · personal spending is separate.</p>;
 const p=s.estimate;if(!p)return <p role="alert">Price unavailable. Review this arrangement before agreement.</p>;
 return <div className="stack"><p className="caption"><strong>{range(p.low_paise,p.high_paise)}</strong> per person {s.kind==='stay'?'per night':s.kind==='food'?'per meal':s.kind==='activity'&&d.refs.find(r=>r.id===s.ref)?.route_item?.category==='transfer'?'per journey':'per visit'} · {p.source==='host'?'Host estimate':'Gemini estimate'}</p><p className="caption">{p.assumptions}</p></div>;
}
export function PricingSummary({document:d}:{document:FlowDocument}){
 const p=d.pricing;if(d.pricing_version!==1||!p)return <p className="small">Illustrative reference estimates: food ₹350 per meal block, activities/local travel use illustrative allowances (surfing ₹2,500, scuba ₹4,500, sailing ₹2,000; other activities ₹550 each), stay ₹1,500 per night, ₹50 fees and 10% contingency. Accommodation, food and activities are suggestions; availability and live prices are unverified.</p>;
 return <div className="notice"><p><strong>Gemini cost estimates · INR · {new Date(p.estimated_at).toLocaleDateString('en-IN',{timeZone:'Asia/Kolkata',dateStyle:'medium'})}</strong></p><p>Planning range: {range(d.cost_low_paise??d.cost_paise,d.cost_paise)} per person, including 10% contingency. Budget checks and remaining allowance use the upper end. These are model estimates, not live quotes; check actual prices before booking. Host-entered costs are labelled separately.</p><details><summary>Local expenses and pricing assumptions</summary><p>{d.route_version?'Transfers are individually scheduled and priced above. No additional daily transport allowance is charged. ':''}Basic local travel: {range(p.local_travel.low_paise,p.local_travel.high_paise)} per person per day × {p.days} destination days.</p><p className="caption">{p.local_travel.assumptions}</p><p>Other fees: {range(p.fees.low_paise,p.fees.high_paise)} per person for this trip.</p><p className="caption">{p.fees.assumptions}</p><p>Activity estimates exclude basic local transfers counted above; fees exclude admissions already in activities. Arrival/return transport, unpriced requests and extra personal spending are outside this shared estimate and remain Phase 2 checks.</p></details></div>;
}

export function RouteOverview({document:d}:{document:FlowDocument}){if(!d.route)return null;return <div className="notice"><p><strong>Gemini day-by-day route · destination local time ({d.route.time_zone})</strong></p><p>{d.route.summary}</p><p>Timings, transfer durations, coordinates and prices are planning estimates. Check actual schedules, entry/exit cities and opening hours before agreement; booking is Phase 2.</p><details open><summary>Route assumptions to review</summary><ul>{d.route.assumptions.map((a,i)=><li key={i}>{a}</li>)}</ul></details></div>;}
