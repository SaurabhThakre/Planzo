import type {FlowDocument,RequirementOutcome} from './privatePlanning';
import {destinationDay} from './routePlanning.ts';
export type OwnRequirementCheck={title:string;kind:string;priority:string}&Omit<RequirementOutcome,'ref'>;
export function requirementCoverage(checks:OwnRequirementCheck[]|undefined,document:FlowDocument,expected?:number){
 const days=[...new Set(document.steps.map(step=>destinationDay(step.start,document.route?.time_zone)))];
 const rows=(checks||[]).map(check=>{
  const label=check.status==='included'?'Included':check.reason==='unverified'?'Needs verification':'Excluded';
  const inDays=[...new Set(check.steps.map(id=>document.steps.find(step=>step.id===id)).filter(Boolean).map(step=>days.indexOf(destinationDay(step!.start,document.route?.time_zone))+1))].sort((a,b)=>a-b);
  const detail=check.status==='included'?(inDays.length?'Day '+inDays.join(', '):'In the plan'):({budget:'Budget',timing:'Not enough time',unverified:'Not promised by this plan',group_decision:'Group decision',scheduled:'Not in this version'}[check.reason]);
  return{...check,label,detail};
 });
 return{rows,included:rows.filter(r=>r.status==='included').length,excluded:rows.filter(r=>r.status==='excluded'&&r.reason!=='unverified').length,unverified:rows.filter(r=>r.status==='excluded'&&r.reason==='unverified').length,missing:expected!==undefined?Math.max(0,expected-rows.length):0,available:checks!==undefined};
}
