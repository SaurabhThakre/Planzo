import {useEffect,useRef,useState} from 'react';
import {LiveItinerary} from './LiveItinerary';
import {DateTimeField} from './DateTimeField';
import type {Person} from './domain';
import type {Workspace} from './backend';
import {readableError} from './backend';
import {Actions,Badge,Button,Card,Coast,Field,Note} from './ui';
import {costRange,paise,planningApi,planningSummary,planStage} from './planningBackend';
import type {CostSnapshot,PlanningState} from './planningBackend';
const stamp=(value:string)=>new Date(value).toLocaleString('en-IN',{timeZone:'Asia/Kolkata',dateStyle:'medium',timeStyle:'short'})+' IST';
const inputTime=(value:string)=>{const d=new Date(value);return Number.isFinite(d.getTime())?new Date(d.getTime()+330*60000).toISOString().slice(0,16):'';};
export function LivePlanning({workspace:w,person,tab,onRefresh,go}:{workspace:Workspace;person:Person;tab:string;onRefresh:()=>Promise<unknown>;go:(tab:string)=>void}){
 const [s,setState]=useState<PlanningState|null>(null),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [windowId,setWindowId]=useState(w.windows[0]?.id||''),[pollDeadline,setPollDeadline]=useState(inputTime(new Date(Math.min(Date.now()+86400000,new Date(w.trip.response_deadline).getTime())).toISOString()));
 const [ballot,setBallot]=useState(''),[response,setResponse]=useState('ready'),[reason,setReason]=useState(''),[ack,setAck]=useState(false);
 const [roster,setRoster]=useState(w.members.filter(m=>m.included).map(m=>m.id)),[rosterAck,setRosterAck]=useState(false),[deadline,setDeadline]=useState(inputTime(w.trip.response_deadline)),[postponeAck,setPostponeAck]=useState(false),[summaryOpen,setSummaryOpen]=useState(false);
 const request=useRef<{signature:string;id:string}|null>(null),sequence=useRef(0),mounted=useRef(true);
 const organiser=w.members.find(m=>m.id===person.id)?.role==='organiser',frozen=['postponed','archived'].includes(s?.stage||w.trip.stage);
 async function load(){const serial=++sequence.current;try{const data=await planningApi('get',{trip_id:w.trip.id});if(mounted.current&&serial===sequence.current){setState(data);setLoading(false);}return data;}catch(e){if(mounted.current&&serial===sequence.current){setError(readableError(e));setLoading(false);}throw e;}}
 useEffect(()=>{mounted.current=true;void load().catch(()=>{});const focus=()=>{if(document.visibilityState==='visible')void load().catch(()=>{});};window.addEventListener('focus',focus);document.addEventListener('visibilitychange',focus);const timer=window.setInterval(focus,15000);return()=>{mounted.current=false;sequence.current++;clearInterval(timer);window.removeEventListener('focus',focus);document.removeEventListener('visibilitychange',focus);};},[w.trip.id,w.trip.revision]);
 useEffect(()=>{setRoster(w.members.filter(m=>m.included).map(m=>m.id));setRosterAck(false);},[w.trip.revision]);
 useEffect(()=>{setBallot(s?.poll?.own_ballot?.choice||'');},[s?.poll?.id,s?.poll?.own_ballot?.revision]);
 useEffect(()=>{setAck(false);if(s?.plan?.own_response){setResponse(s.plan.own_response.status);setReason(s.plan.own_response.private_reason);}},[s?.plan?.id]);
 async function act(action:string,payload:Record<string,unknown>={},message='Saved to your shared trip.'){
  if(!s||busy)return;setBusy(true);setError('');setNotice('');const body={trip_id:w.trip.id,expected_revision:s.revision,...payload};const signature=JSON.stringify([action,body]);
  if(request.current?.signature!==signature)request.current={signature,id:crypto.randomUUID()};
  try{await planningApi(action,{...body,request_id:request.current.id});request.current=null;await onRefresh();await load();setNotice(message);if(action==='respond')setAck(false);}
  catch(e){setError(readableError(e));if(/changed|current|stale|another tab|revalidation/.test(readableError(e)))void load().catch(()=>{});}
  finally{if(mounted.current)setBusy(false);}
 }
 if(loading)return <Card title="Opening shared planning…"><p>Your private limits stay on the server.</p></Card>;
 if(!s)return <Card title="Planning could not load"><p role="alert">{error}</p><Button onClick={()=>{setError('');setLoading(true);void load().catch(()=>{});}}>Retry planning</Button></Card>;
 const draft=s.draft,plan=s.plan,poll=s.poll;
 const pollLive=poll?.status==='open',pollBlocked=pollLive||poll?.status==='unresolved';
 const isIncluded=w.members.some(m=>m.id===person.id&&m.included),inPlan=plan?.roster.includes(person.id);
 const ready=plan?.responses.filter(r=>r.status==='ready'&&plan.roster.includes(r.user_id)).length||0;
 const current=Boolean(plan?.current),draftCurrent=Boolean(draft?.current),overdue=new Date(s.deadline).getTime()<=Date.now();
 const selected=draft?.options.find(o=>o.id===draft.selected_option),selectedFeasible=selected?.blockers.length===0;
 const summary=planningSummary(w.trip.name,s,w.members,w.windows);
 const windowText=(id:string)=>{const v=w.windows.find(x=>x.id===id);return v?stamp(v.start+':00+05:30')+' → '+stamp(v.end+':00+05:30'):'Unavailable window';};
 return <div className="stack live-planning">
  {error&&<p className="form-error" role="alert">{error}</p>}{notice&&<p className="notice" role="status">{notice}</p>}
  <div className="actions"><Badge tone={s.stage==='agreed'?'positive':frozen?'neutral':'pending'}>{planStage(s.stage)}</Badge><span className="small muted">{w.members.filter(m=>m.included).length} included · minimum {w.trip.minimum_group_size}</span><Button variant="ghost" disabled={busy} onClick={()=>{setError('');void load().catch(()=>{});}}>Refresh planning</Button></div>
  <Note title="Saved together · estimated costs" icon="wallet">Plans, ballots and responses are saved in Supabase. Prices use the labelled Goa reference, not live provider quotes. No AI, reservation or payment is made. Raw limits, other people’s personal costs and private change notes stay private.</Note>
  {overdue&&!frozen&&<Note title="The response deadline has passed" tone="cream">The organiser can extend, revise or postpone. Missing responses never become agreement. You can still withdraw an earlier response; new readiness requires an open decision round.</Note>}
  {frozen?<Card title={s.stage==='archived'?'This trip is archived':'This trip is postponed'}><p>Saved decisions remain available in History. No traveller was automatically confirmed.</p></Card>:null}
  {['plan','voting'].includes(tab)&&<LiveItinerary workspace={w} userId={person.id} tab={tab} onChanged={async()=>{await onRefresh();await load();}} go={go}/>}
  {tab==='review'&&<div className="columns"><div><Card title={plan?'Plan v'+plan.version+' · '+plan.content.title:'No plan shared for review yet'}>
   {plan?<><Badge tone={current?'positive':'alert'}>{current?'Current review version':'Historical · fresh review needed'}</Badge><p>{windowText(plan.window_id)}</p><p>Included: {w.members.filter(m=>plan.roster.includes(m.id)).map(m=>m.name).join(', ')}</p><p className="caption">Saved {stamp(plan.created_at)} · {plan.option_id==='itinerary'?'Two required nights covered':plan.content.rooms+' twin rooms'} · estimates include 10% contingency</p><ol>{plan.content.itinerary.map(x=><li key={x}>{x}</li>)}</ol><p>{plan.content.optional}</p>{plan.own_cost&&<CostView cost={plan.own_cost}/>}
    <CatalogueNote catalogue={plan.catalogue}/>
    <Button variant="secondary" onClick={()=>setSummaryOpen(x=>!x)}>{summaryOpen?'Hide':'Show copyable'} safe plan summary</Button>{summaryOpen&&<Field label="Current plan summary"><textarea readOnly rows={10} value={summary}/></Field>}
   </>:<><p>The organiser completes one itinerary, resolves item choices and shares it with the group. You then see your own complete cost before responding.</p><Button onClick={()=>go('plan')}>Open planning</Button></>}
  </Card>
  {plan&&<Card title="Everyone’s response" sub={current?ready+' of '+plan.roster.length+' ready for this version. Silence stays pending.':'These responses belong to the earlier version and cannot approve fresh terms.'}>
   {w.members.filter(m=>plan.roster.includes(m.id)).map(m=>{const r=plan.responses.find(r=>r.user_id===m.id);return <div className="member-row" key={m.id}><strong>{m.name}{m.id===person.id?' · you':''}</strong><Badge tone={r?.status==='ready'&&current?'positive':'pending'}>{!current?'Earlier: ':''}{r?.status==='ready'?'Ready':r?.status==='change'?'Needs a change':r?.status==='decline'?'Not joining':'Pending'}</Badge></div>;})}
   {organiser&&<Button disabled={busy||frozen||overdue||!current||ready!==plan.roster.length} onClick={()=>void act('close_round',{plan_id:plan.id},'The included group explicitly agreed to this plan version. Bookings remain pending.')}>Confirm trip agreement</Button>}
  </Card>}</div><aside>
   {plan&&inPlan?<Card title="Your response" tone="mint"><p>Ready is a nonbinding intention to book this exact version. It does not reserve, pay for or book anything.</p><form onSubmit={e=>{e.preventDefault();void act('respond',{plan_id:plan.id,status:response,private_reason:reason,acknowledged:ack,expected_response_revision:plan.own_response?.revision||0},'Your response to Plan v'+plan.version+' is saved.');}}><fieldset className="auth-fields" disabled={busy||frozen||!current}>
    <Field label="Your decision"><select value={response} onChange={e=>{setResponse(e.target.value);setAck(false);}}><option value="ready">Ready to book this plan</option><option value="change">Needs a change</option><option value="decline">Not joining</option></select></Field>
    <Field label="Private note (optional)" hint="Only you can read this note. The group sees your response status."><textarea maxLength={2000} rows={4} value={reason} onChange={e=>setReason(e.target.value)}/></Field>
    {response==='ready'&&<label className="check"><input type="checkbox" checked={ack} onChange={e=>setAck(e.target.checked)}/>I reviewed my full estimate, dates, roster, assumptions and optional activity for Plan v{plan.version}. I understand prices are illustrative and no booking is made.</label>}
    <Button type="submit" disabled={response==='ready'&&(!ack||overdue)}>Save my response</Button>
   </fieldset></form>{plan.own_response&&<p className="small">Your saved response: {plan.own_response.status}. You can revise it while this version is current.</p>}</Card>:plan?<Note title="Observer access">You are outside this version’s travelling roster. You can follow shared progress, but cannot approve it.</Note>:null}
   {s.stage==='agreed'&&current&&<Note title="Trip agreed · booking handoff" icon="check">Everyone included explicitly confirmed this version. Assign responsibilities and check providers next. A reported booking is self-reported; Planzo does not verify reservations.<Button onClick={()=>go('bookings')}>Open booking handoff</Button></Note>}
   <Button variant="secondary" onClick={()=>go('plan')}>Return to planning</Button>
  </aside></div>}
  {organiser&&<details className="organiser-tools"><summary>Organiser tools</summary><Card title="Revise the proposal or record another outcome" sub="Nobody is silently removed. A changed roster or decision context needs fresh costs, a new plan version and fresh responses.">
   <details><summary>Propose a different travelling roster</summary><fieldset className="auth-fields" disabled={busy||frozen}>{w.members.map(m=><label className="check" key={m.id}><input type="checkbox" checked={roster.includes(m.id)} onChange={e=>{setRoster(e.target.checked?[...roster,m.id]:roster.filter(id=>id!==m.id));setRosterAck(false);}}/>{m.name} · {m.included?'currently included':'observer'}</label>)}<label className="check"><input type="checkbox" checked={rosterAck} onChange={e=>setRosterAck(e.target.checked)}/>I am openly proposing this roster. Excluded people retain workspace access; all costs and approvals need fresh review.</label><Button disabled={!rosterAck||roster.length<w.trip.minimum_group_size} onClick={()=>void act('roster',{roster,acknowledge_roster:rosterAck},'Travelling roster proposal saved. Check new options and share a new review version.')}>Save proposed travelling roster</Button></fieldset></details>
   <details><summary>Extend the deadline</summary><DateTimeField label="Later response deadline" value={deadline} disabled={busy||frozen} onChange={setDeadline}/><Button disabled={busy||frozen||!deadline} onClick={()=>void act('extend',{deadline:deadline+':00+05:30'},'Deadline extended. Earlier decisions remain historical; fresh review is required.')}>Save later deadline</Button></details>
   <Actions><Button variant="secondary" disabled={busy||frozen} onClick={()=>void act('revise',{},'Trip reopened for inputs and revision. Earlier plans and responses remain historical.')}>Reopen inputs and revise</Button></Actions>
   <details><summary>Postpone this trip</summary><label className="check"><input type="checkbox" disabled={busy||frozen} checked={postponeAck} onChange={e=>setPostponeAck(e.target.checked)}/>Record postponement for everyone and stop this decision round. Saved history remains available.</label><Button variant="secondary" disabled={busy||frozen||!postponeAck} onClick={()=>void act('postpone',{},'Trip postponed. The decision history is saved without inferring consent.')}>Record postponement</Button></details>
  </Card></details>}
 </div>;
}
function CostView({cost}:{cost:CostSnapshot}){return <div><div className="total"><span className="eyebrow">YOUR COMPLETE PLANNING ESTIMATE</span><p className="amount">{costRange(cost.total)}</p><p className="small muted">INR · illustrative · includes fees and 10% contingency</p></div>{cost.rows.map(r=><div className="member-row" key={r.label}><span>{r.label}</span><strong>{costRange(r.range)}</strong></div>)}<p className="caption">Exact paise are saved; only your own personal estimate is shown. {cost.boat?'Your optional boat is included.':'Boat is excluded for you; free time remains available.'}</p></div>;}
function CatalogueNote({catalogue}:{catalogue:PlanningState['catalogue']}){return <Note title={catalogue.label} icon="wallet"><span>{catalogue.source} · source date {catalogue.source_date}.</span><span className="small"> {catalogue.assumptions.join(' ')}</span></Note>;}
