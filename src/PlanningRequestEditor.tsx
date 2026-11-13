import type {PlanningRequest} from './privatePlanning';
import {Button} from './ui';
import './planningClarity.css';
export function PlanningRequestEditor({requests,disabled,onChange}:{requests:PlanningRequest[];disabled:boolean;onChange:(next:PlanningRequest[])=>void}){
 const update=(index:number,patch:Partial<PlanningRequest>)=>onChange(requests.map((r,i)=>i===index?{...r,...patch}:r));
 return <section className="request-editor" aria-label="Review planning requests"><div className="request-editor-heading"><h3>Planning requests</h3><p>Check each request. You can edit its wording, type or priority.</p></div>
  {requests.length?requests.map((request,index)=><div className="request-editor-row" key={index}>
   <label className="request-title"><span className="sr-only">Request {index+1}</span><input maxLength={120} value={request.title} disabled={disabled} onChange={e=>update(index,{title:e.target.value})}/></label>
   <label><span className="sr-only">Type for request {index+1}</span><select value={request.kind} disabled={disabled} onChange={e=>update(index,{kind:e.target.value as PlanningRequest['kind']})}><option value="activity">Activity or place</option><option value="food">Food</option><option value="stay">Stay</option><option value="rule">Travel condition</option></select></label>
   <label><span className="sr-only">Priority for request {index+1}</span><select value={request.priority} disabled={disabled} onChange={e=>update(index,{priority:e.target.value as PlanningRequest['priority']})}><option value="hard">Must-have</option><option value="soft">Flexible</option></select></label>
   <button type="button" className="request-remove" disabled={disabled} aria-label={'Remove request '+(index+1)} onClick={()=>onChange(requests.filter((_,i)=>i!==index))}>×</button>
  </div>):<p className="small muted">No specific requests.</p>}
  <Button variant="ghost" disabled={disabled||requests.length>=20} onClick={()=>onChange([...requests,{title:'',kind:'activity',priority:'soft'}])}>+ Add request</Button>
 </section>;
}
