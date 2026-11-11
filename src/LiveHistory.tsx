import {useEffect,useState} from 'react';
import type {Workspace} from './backend';
import {readableError} from './backend';
import {planningApi} from './planningBackend';
import type {PlanningState} from './planningBackend';
import {bookingApi,reportLabel,taskTitle} from './bookingBackend';
import type {BookingState} from './bookingBackend';
import {Button,Card} from './ui';
import {MilestoneList} from './LiveBookings';
const stamp=(value:string)=>new Date(value).toLocaleString('en-IN',{timeZone:'Asia/Kolkata',dateStyle:'medium',timeStyle:'short'})+' IST';
export function LiveHistory({workspace:w}:{workspace:Workspace}){
 const [p,setPlan]=useState<PlanningState|null>(null),[b,setBooking]=useState<BookingState|null>(null),[error,setError]=useState(''),[tab,setTab]=useState<'decisions'|'bookings'|'progress'>('decisions');
 useEffect(()=>{let active=true;Promise.all([planningApi('get',{trip_id:w.trip.id}),w.trip.workflow_version===2?Promise.resolve(null):bookingApi('get',{trip_id:w.trip.id})]).then(([p,b])=>{if(active){setPlan(p);setBooking(b);}}).catch(e=>{if(active)setError(readableError(e));});return()=>{active=false;};},[w.trip.id,w.trip.revision,w.trip.workflow_version]);
 if(error)return <p className="form-error" role="alert">{error}</p>;
 if(!p||(!b&&w.trip.workflow_version!==2))return <Card title="Opening trip history…"><p>Loading saved decisions and progress.</p></Card>;
 const decisions = <Card title="Decision history" className="decision-history-card"
  sub="Budgets, private notes and individual ballots stay private.">
  {p.history.length ? <ol className="decision-history-events">{p.history.map(event=>
   <li className="history-event" key={event.id}>
    <p>{event.message}</p>
    <time dateTime={event.created_at}>{stamp(event.created_at)}</time>
   </li>
  )}</ol> : <p>No decisions recorded yet.</p>}
  {p.versions.length>0&&<details><summary>Saved plan versions ({p.versions.length})</summary>
   {p.versions.map(version=><p key={version.id}>Plan v{version.version} · {stamp(version.created_at)}</p>)}
  </details>}
 </Card>;
 if(!b) return decisions;
 return <div className="stack"><div className="local-tabs" role="tablist" aria-label="History sections"><Button role="tab" aria-selected={tab==='decisions'} variant={tab==='decisions'?'primary':'secondary'} onClick={()=>setTab('decisions')}>Decision history</Button><Button role="tab" aria-selected={tab==='bookings'} variant={tab==='bookings'?'primary':'secondary'} onClick={()=>setTab('bookings')}>Booking reports</Button><Button role="tab" aria-selected={tab==='progress'} variant={tab==='progress'?'primary':'secondary'} onClick={()=>setTab('progress')}>Progress history</Button></div>
 <div hidden={tab!=='decisions'}>{decisions}</div>
 <div hidden={tab!=='bookings'}><Card title="Booking reports" sub="Shared reports and your own personal reports only. Reports are self-reported, not provider confirmation.">{b.report_history.length?b.report_history.map((r,i)=><div className="history-event" key={r.plan_id+r.task_key+i}><strong>{taskTitle(r.task_key.split(':')[0])} · Plan v{r.version}</strong><p>{reportLabel(r.status)}</p><small>{stamp(r.at)} · task revision {r.task_revision}</small></div>):<p>No booking reports yet.</p>}{b.earlier_handoffs.length>0&&<p>Earlier handoffs: {b.earlier_handoffs.map(x=>'Plan v'+x.version).join(', ')}.</p>}</Card></div>
 <div hidden={tab!=='progress'}><Card title="Progress history"><details><summary>View saved progress changes ({b.milestone_history.length})</summary>{b.milestone_history.map(h=><div className="history-event" key={h.id}><small>{stamp(h.at)}</small><MilestoneList items={h.states}/></div>)}</details></Card></div></div>;
}
