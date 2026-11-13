import type {FlowDocument} from './privatePlanning';
import {requirementCoverage} from './requirementCoverage';
import type {OwnRequirementCheck} from './requirementCoverage';
import {Card} from './ui';
import './planningClarity.css';
export function MyRequirements({checks,document,expected}:{checks:OwnRequirementCheck[]|undefined;document:FlowDocument;expected?:number}){
 const coverage=requirementCoverage(checks,document,expected);
 return <Card title="My requests in this plan" className="my-requirements">
  {!coverage.available||coverage.missing>0?<p className="small muted">{coverage.missing?coverage.missing+' requests do not have a coverage result in this version.':'Coverage is unavailable for this earlier version.'} Review your private input before creating a new draft.</p>:null}
  {coverage.rows.length>0?<><div className="requirement-counts"><span>{coverage.included} included</span>{coverage.excluded>0&&<span>{coverage.excluded} excluded</span>}{coverage.unverified>0&&<span>{coverage.unverified} need verification</span>}</div><ul>{coverage.rows.map((r,i)=><li key={i}><div><strong>{r.title}</strong><small>{r.priority==='hard'?'Must-have':'Flexible'} · {r.detail}</small></div><span className={'requirement-outcome '+(r.status==='included'?'included':r.reason==='unverified'?'unverified':'excluded')}>{r.label}</span></li>)}</ul><p className="caption muted">Included means scheduled in the plan. Booking availability is unverified.</p></>:coverage.available&&!coverage.missing&&<p className="small muted">{expected===0?'No specific requests were shared for this version.':'No coverage results were saved for this version.'}</p>}
 </Card>;
}
