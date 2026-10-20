import {useEffect,useRef,useState} from 'react';
import {DateTimeField} from './DateTimeField';
import type {Workspace} from './backend';
import {readableError} from './backend';
import {bookingApi,reportLabel,taskTitle} from './bookingBackend';
import type {BookingState,BookingTask,Milestone} from './bookingBackend';
import {planningApi,costRange} from './planningBackend';
import type {PlanningState} from './planningBackend';
import {Actions,Badge,Button,Card,Coast,Field,Note} from './ui';
const stamp=(s:string)=>new Date(s).toLocaleString('en-IN',{timeZone:'Asia/Kolkata',dateStyle:'medium',timeStyle:'short'})+' IST';
const localTime=(s:string|null)=>s?new Date(new Date(s).getTime()+330*60000).toISOString().slice(0,16):'';
const milestoneLabel=(s:string)=>({complete:'Complete',pending:'Pending',needs_review:'Needs review',not_applicable:'Not applicable'}[s]||s);
export function MilestoneList({items}:{items:Milestone[]}){return <ol className="milestone-list">{items.map(x=><li key={x.id}><span>{x.label}</span><Badge tone={x.status==='complete'?'positive':x.status==='needs_review'?'alert':'pending'}>{milestoneLabel(x.status)}</Badge></li>)}</ol>;}
export function LiveMilestones({tripId,revision}:{tripId:string;revision:number}){
 const [s,setState]=useState<BookingState|null>(null),[error,setError]=useState('');
 useEffect(()=>{let active=true;const load=()=>bookingApi('get',{trip_id:tripId}).then(x=>{if(active){setState(x);setError('');}}).catch(e=>{if(active)setError(readableError(e));});void load();const refresh=()=>{if(document.visibilityState==='visible')void load();};window.addEventListener('focus',refresh);const timer=window.setInterval(refresh,15000);return()=>{active=false;clearInterval(timer);window.removeEventListener('focus',refresh);};},[tripId,revision]);
 return <Card title="Pact Passport" sub="Five group milestones from saved progress. An agreed itinerary and reported bookings remain separate.">{s?<MilestoneList items={s.milestones}/>:<p role={error?'alert':undefined}>{error||'Loading saved milestones…'}</p>}</Card>;
}
export function LiveBookings({workspace:w,userId,onRefresh,go}:{workspace:Workspace;userId:string;onRefresh:()=>Promise<unknown>;go:(tab:string)=>void}){
 const [s,setState]=useState<BookingState|null>(null),[planning,setPlanning]=useState<PlanningState|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
 const mounted=useRef(true),serial=useRef(0),saving=useRef(false),request=useRef<{signature:string;id:string}|null>(null);
 const organiser=w.members.find(m=>m.id===userId)?.role==='organiser';
 async function load(){const n=++serial.current;try{const [data,p]=await Promise.all([bookingApi('get',{trip_id:w.trip.id}),planningApi('get',{trip_id:w.trip.id})]);if(mounted.current&&n===serial.current){setState(data);setPlanning(p);setError('');}}catch(e){if(mounted.current&&n===serial.current)setError(readableError(e));throw e;}}
 useEffect(()=>{mounted.current=true;void load().catch(()=>{});const refresh=()=>{if(document.visibilityState==='visible'&&!saving.current)void load().catch(()=>{});};window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',refresh);const timer=window.setInterval(refresh,15000);return()=>{mounted.current=false;serial.current++;clearInterval(timer);window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh);};},[w.trip.id,w.trip.revision]);
 async function act(action:string,payload:Record<string,unknown>={},message='Booking handoff saved.'){
  if(!s||saving.current)return;saving.current=true;setBusy(true);setError('');setNotice('');
  const body={trip_id:w.trip.id,plan_id:s.plan?.id,expected_revision:s.revision,expected_handoff_revision:s.handoff_revision,...payload},signature=JSON.stringify([action,body]);
  if(request.current?.signature!==signature)request.current={signature,id:crypto.randomUUID()};
  try{await bookingApi(action,{...body,request_id:request.current.id});request.current=null;await onRefresh();await load();if(mounted.current)setNotice(message);return true;}
  catch(e){if(mounted.current)setError(readableError(e));return false;}
  finally{saving.current=false;if(mounted.current)setBusy(false);}
 }
 if(!s)return <Card title="Opening booking handoff…"><p role={error?'alert':undefined}>{error||'Loading saved tasks and milestones.'}</p>{error&&<Button onClick={()=>void load().catch(()=>{})}>Retry booking handoff</Button>}</Card>;
 const live=Boolean(s.plan?.agreed&&s.plan.current),ownerName=(id:string|null)=>w.members.find(m=>m.id===id)?.name||'Unassigned';
 return <div className="stack booking-flow">
  {error&&<p className="form-error" role="alert">{error} Your entered details are kept. Refresh the handoff before retrying an outdated save.</p>}{notice&&<p className="notice" role="status">{notice}</p>}
  <Actions><Badge tone={live?'positive':'alert'}>{live?'Agreed Plan v'+s.plan!.version+' · booking handoff':s.plan?'Plan v'+s.plan.version+' · handoff needs review':'Agreement needed first'}</Badge><Button variant="ghost" disabled={busy} onClick={()=>void load().catch(()=>{})}>Refresh booking handoff</Button></Actions>
  <div className="columns"><div>
   <Card title="From agreement to action" sub="Keep responsibility clear while you check providers outside Planzo."><p>A provider link opens a generic search, not a specific listing or a verified quote. Opening it leaves the task pending. Only an assigned owner can report a booking, and reports are self-reported.</p>
    {!live&&<Note title={s.stage==='postponed'?'Decision recorded · postponed':'Review the plan first'} tone="cream">{s.stage==='postponed'?'The saved decision and earlier reports remain in history. Booking handoff does not apply to this postponed trip.':'Booking updates require the current agreed version. Earlier tasks and reports remain a reference; they cannot approve changed dates, prices, roster or terms.'}</Note>}
    {live&&!s.handoff_revision&&(organiser?<Button disabled={busy} onClick={()=>void act('prepare',{},'Pending booking responsibilities created for this agreed version.')}>Prepare booking responsibilities</Button>:<p>The organiser prepares the handoff, then you can set up your personal tasks.</p>)}
    <Actions><Button variant="secondary" onClick={()=>go('review')}>Review itinerary and my estimate</Button><Button variant="secondary" onClick={()=>go('plan')}>Open itinerary</Button></Actions>
   </Card>
   {!!s.tasks.length&&<><Card title="Shared responsibilities" sub="The organiser assigns an included owner. The assigned owner checks and reports the task.">{s.tasks.filter(t=>!t.personal).map(t=><TaskEditor key={t.key} task={t} state={s} userId={userId} organiser={organiser} workspace={w} busy={busy} live={live} act={act}/>)}</Card>
   <Card title="My personal handoff" sub="These travel and activity tasks are visible only to you. No one else’s personal provider details or reports appear here.">{s.tasks.filter(t=>t.personal).length?s.tasks.filter(t=>t.personal).map(t=><TaskEditor key={t.key} task={t} state={s} userId={userId} organiser={organiser} workspace={w} busy={busy} live={live} act={act}/>):<p>You are outside this plan’s included travelling roster.</p>}</Card></>}
  </div><aside>
   <Card title="Pact Passport" tone="mint"><Coast/><MilestoneList items={s.milestones}/><p className="caption">Handoff prepared means responsibilities, methods and due times are set. It does not mean bookings are complete. Each traveller completes their own private handoff details.</p></Card>
   {planning?.plan?.own_cost&&<Card title="My saved planning estimate"><strong className="amount">{costRange(planning.plan.own_cost.total)}</strong><p className="caption">Plan v{planning.plan.version} · illustrative INR · fees and 10% contingency included · snapshot saved {stamp(planning.plan.created_at)}</p><p>Check your complete breakdown in Review & confirm before comparing a live quote. Planzo does not collect provider confirmations, ticket numbers or payment details.</p></Card>}
   <Note title="A quote or plan term changed?">The task owner can flag the change below. This reopens plan review for everyone and keeps earlier agreement and reports in history. A broken link can be recorded separately while its task stays pending.</Note>
  </aside></div>
 </div>;
}
type Act=(action:string,payload?:Record<string,unknown>,message?:string)=>Promise<boolean|undefined>;
function TaskEditor({task:t,state:s,userId,organiser,workspace:w,busy,live,act}:{task:BookingTask;state:BookingState;userId:string;organiser:boolean;workspace:Workspace;busy:boolean;live:boolean;act:Act}){
 const [owner,setOwner]=useState(t.owner_id||''),[due,setDue]=useState(localTime(t.due_at)),[provider,setProvider]=useState(t.provider_id),[status,setStatus]=useState('pending'),[ack,setAck]=useState(false),[changeAck,setChangeAck]=useState(false),[dirty,setDirty]=useState(false),[editing,setEditing]=useState([t.revision,t.report?.revision||0]);
 const changed=editing[0]!==t.revision||editing[1]!== (t.report?.revision||0),isOwner=t.owner_id===userId;
 const canEdit=live&&!busy&&(t.personal?isOwner:organiser||isOwner),canReport=live&&!busy&&isOwner&&!changed;
 function reset(){setOwner(t.owner_id||'');setDue(localTime(t.due_at));setProvider(t.provider_id);setStatus(t.report?.current_task&&['pending','reported','not_needed','link_problem'].includes(t.report.status)?t.report.status:'pending');setAck(false);setChangeAck(false);setEditing([t.revision,t.report?.revision||0]);setDirty(false);}
 useEffect(()=>{if(!dirty)reset();},[t.revision,t.report?.revision,dirty]);
 const method=s.providers.find(p=>p.id===t.provider_id),currentReport=t.report?.current_task;
 const choices=s.providers.filter(p=>['manual','unselected'].includes(p.id)||p.id===({travel:'irctc',stay:'booking',local:'goamiles'}[t.category]));
 async function save(action:string,payload:Record<string,unknown>,message:string){const ok=await act(action,{task_key:t.key,expected_task_revision:t.revision,expected_report_revision:t.report?.revision||0,...payload},message);if(ok){setDirty(false);setAck(false);setChangeAck(false);}}
 return <section className="booking-task">
  <h3>{taskTitle(t.category)}</h3><Badge tone={live&&currentReport&&['reported','not_needed'].includes(t.report!.status)?'positive':'pending'}>{!live?'Historical · ':t.report&&!currentReport?'Earlier task report · ':''}{currentReport?reportLabel(t.report!.status):'Pending'}</Badge>
  <p className="small">Owner: {w.members.find(m=>m.id===t.owner_id)?.name||'Unassigned'} · {t.due_at?'Due '+stamp(t.due_at):'No due time set'}</p>
  <p className="caption">{method?.label} · {method?.type==='generic_search'?'Generic search · no specific listing':method?.type==='manual'?'Manual verification · no listing link':'Handoff method pending'}. Details saved {stamp(t.saved_at)}.</p>
  {method?.url&&<a className="button secondary" href={method.url} target="_blank" rel="noopener noreferrer">Open {method.label} search ↗</a>}
  {t.report&&<p className="caption">Last report: {stamp(t.report.at)} · {reportLabel(t.report.status)}{!currentReport?' · from an earlier assignment or task revision':''}. No provider confirmation is verified.</p>}
  {changed&&dirty&&<Note title="This saved task changed" tone="cream">Your entered details are kept. Review the latest owner and saved status before replacing them. <Button variant="secondary" onClick={reset}>Use latest task details</Button></Note>}
  {(canEdit||isOwner)&&<details><summary>Manage {taskTitle(t.category).toLowerCase()}</summary><fieldset className="auth-fields" disabled={!canEdit||changed}>
   <Field label={'Owner for '+taskTitle(t.category)}><select value={owner} disabled={t.personal||!organiser} onChange={e=>{setOwner(e.target.value);setDirty(true);}}><option value="">Unassigned</option>{w.members.filter(m=>s.plan?.roster.includes(m.id)).map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></Field>
   <DateTimeField label={'Due time for '+taskTitle(t.category)} value={due} onChange={value=>{setDue(value);setDirty(true);}}/>
   <Field label={'Handoff method for '+taskTitle(t.category)}><select value={provider} onChange={e=>{setProvider(e.target.value);setDirty(true);}}>{choices.map(p=><option key={p.id} value={p.id}>{p.label}</option>)}</select></Field>
   <p className="caption">Saving changed details makes any earlier report require a fresh owner check. Use both nights for the stay task and include all required journeys in transport checks.</p>
   <Button disabled={!dirty||(owner===(t.owner_id||'')&&due===localTime(t.due_at)&&provider===t.provider_id)} onClick={()=>void save('save_task',{owner_id:owner||null,due_at:due?due+':00+05:30':null,provider_id:provider},'Task details saved. Earlier reports remain in history.')}>Save task details</Button>
  </fieldset>
  {isOwner&&<fieldset className="auth-fields" disabled={!canReport}>
   <Field label={'Status for '+taskTitle(t.category)}><select value={status} onChange={e=>{setStatus(e.target.value);setAck(false);setDirty(true);}}><option value="pending">Pending</option><option value="reported">Booking reported · self-reported</option><option value="not_needed">No reservation needed · self-reported</option><option value="link_problem">Link problem · keep pending</option></select></Field>
   {['reported','not_needed'].includes(status)&&<label className="check"><input type="checkbox" checked={ack} onChange={e=>{setAck(e.target.checked);setDirty(true);}}/>I checked the live total, required dates and journeys, capacity, requirements and cancellation terms against Plan v{s.plan?.version}. No material term changed. This is my own report and has not been verified by Planzo.</label>}
   <Button disabled={['reported','not_needed'].includes(status)&&!ack} onClick={()=>void save('report',{status,acknowledged:ack},'Your task status was saved with its version and timestamp. It remains self-reported.')}>Save my task status</Button>
   <label className="check"><input type="checkbox" checked={changeAck} onChange={e=>{setChangeAck(e.target.checked);setDirty(true);}}/>The live price, timing, roster, requirements or other plan terms changed. I understand this makes earlier agreement historical and requires a new plan and fresh responses.</label>
   <Button variant="secondary" disabled={!changeAck} onClick={()=>void save('flag_change',{acknowledged:changeAck},'Changed terms recorded. The group must review a new plan before booking updates resume.')}>Report changed terms and reopen review</Button>
  </fieldset>}
  </details>}
 </section>;
}
