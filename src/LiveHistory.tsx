import {useEffect,useState} from 'react';
import type {Workspace} from './backend';
import {readableError} from './backend';
import {planningApi} from './planningBackend';
import type {PlanningState} from './planningBackend';
import {bookingApi,reportLabel,taskTitle} from './bookingBackend';
import type {BookingState} from './bookingBackend';
import {Card} from './ui';
import {MilestoneList} from './LiveBookings';
const stamp=(value:string)=>new Date(value).toLocaleString('en-IN',{timeZone:'Asia/Kolkata',dateStyle:'medium',timeStyle:'short'})+' IST';
export function LiveHistory({workspace:w}:{workspace:Workspace}){
 const [p,setPlan]=useState<PlanningState|null>(null),[b,setBooking]=useState<BookingState|null>(null),[error,setError]=useState('');
 useEffect(()=>{let active=true;Promise.all([planningApi('get',{trip_id:w.trip.id}),w.trip.workflow_version===2?Promise.resolve(null):bookingApi('get',{trip_id:w.trip.id})]).then(([p,b])=>{if(active){setPlan(p);setBooking(b);}}).catch(e=>{if(active)setError(readableError(e));});return()=>{active=false;};},[w.trip.id,w.trip.revision,w.trip.workflow_version]);
 if(error)return <p className="form-error" role="alert">{error}</p>;
 if(!p||(!b&&w.trip.workflow_version!==2))return <Card title="Opening trip history…"><p>Loading saved decisions and progress.</p></Card>;
 return <div className="stack"><Card title="Decision history" sub="Shared decisions stay here. Raw budgets, private notes and individual ballots remain private.">{p.history.length?p.history.map(h=><div className="history-event" key={h.id}><p>{h.message}</p><small>{stamp(h.created_at)}</small></div>):<p>No decisions recorded yet.</p>}{p.versions.length>0&&<details><summary>Saved plan versions ({p.versions.length})</summary>{p.versions.map(v=><p key={v.id}>Plan v{v.version} · {stamp(v.created_at)}</p>)}</details>}</Card>
 {b&&<><Card title="Booking reports" sub="Shared reports and your own personal reports only. Reports are self-reported, not provider confirmation.">{b.report_history.length?b.report_history.map((r,i)=><div className="history-event" key={r.plan_id+r.task_key+i}><strong>{taskTitle(r.task_key.split(':')[0])} · Plan v{r.version}</strong><p>{reportLabel(r.status)}</p><small>{stamp(r.at)} · task revision {r.task_revision}</small></div>):<p>No booking reports yet.</p>}{b.earlier_handoffs.length>0&&<p>Earlier handoffs: {b.earlier_handoffs.map(x=>'Plan v'+x.version).join(', ')}.</p>}</Card>
 <Card title="Progress history"><details><summary>View saved progress changes ({b.milestone_history.length})</summary>{b.milestone_history.map(h=><div className="history-event" key={h.id}><small>{stamp(h.at)}</small><MilestoneList items={h.states}/></div>)}</details></Card></>}</div>;
}
