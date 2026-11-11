import{destinationDay}from'./routePlanning';
import {useEffect,useId,useState} from 'react';
import type {FlowPoll} from './flowBackend';
import type {FlowStep} from './privatePlanning';
import {Badge,Button,ItineraryTypeBadge} from './ui';
import {flowStamp} from './privatePlanning';

type Decision=Pick<FlowPoll,'step_id'|'mode'|'options'|'status'>;
type Names=(ref:string)=>string;
const date=(s:string,timeZone='Asia/Kolkata')=>new Date(s).toLocaleDateString('en-IN',{timeZone,weekday:'short',day:'numeric',month:'short',year:'numeric'});
const time=(s:string,timeZone='Asia/Kolkata')=>new Date(s).toLocaleTimeString('en-IN',{timeZone,hour:'numeric',minute:'2-digit'});
const day=(s:string,timeZone='Asia/Kolkata')=>destinationDay(s,timeZone);
const kind=(ref:string,fallback:string)=>ref==='rest'||ref==='rest_alternative'?'rest':ref==='food'||ref==='food_alternative'?'food':ref==='stay'||ref==='stay_alternative'?'stay':fallback;

export function StepDecisionDetails({poll,step,version,planStart,name}:{poll:Decision;step?:FlowStep;version:number;planStart:string;name:Names}){
 const zone=step?.time_zone||'Asia/Kolkata';
 const active=poll.status==='open'||poll.status==='unresolved';
 const dayNumber=step?Math.round((Date.parse(day(step.start,zone))-Date.parse(day(planStart,zone)))/86400000)+1:null;
 return <div className="step-decision-details">
  {step?<div className="decision-schedule"><div className="actions"><ItineraryTypeBadge kind={kind(step.ref,step.kind)}/><span className="caption">{poll.step_id.replace('step_','Step ')} · Day {dayNumber}{version>0?' · Version '+version:''}</span></div><p className="decision-date"><time dateTime={step.start}>{date(step.start,zone)}</time>{day(step.start,zone)!==day(step.end,zone)&&<> → <time dateTime={step.end}>{date(step.end,zone)}</time></>}</p><p className="decision-time">{time(step.start,zone)} → {time(step.end,zone)} <span>{step.time_zone||'IST'}</span></p>{!active&&<p className="caption">These timings describe the current itinerary. Earlier versions are in History.</p>}{!active&&<p className="small">In the current itinerary: <strong>{name(step.ref)}</strong></p>}</div>:<p className="decision-missing">This step is absent from the current itinerary. Read its saved version in History for its date and time. Refresh planning before voting on this step.</p>}
  {poll.status==='stale'&&<p className="decision-missing">This is an earlier vote. Its choices are shown for reference; it cannot change the current itinerary.</p>}
  <div className="decision-comparison" aria-label={poll.mode==='concern'?'Current and proposed arrangements':'Arrangements to compare'}>{poll.options.map((ref,i)=><section key={ref} className={'decision-option '+(poll.mode==='concern'&&i===1?'proposed':'')}><p className="eyebrow">{poll.mode==='concern'?(i===0?(active?'Current arrangement':'Original arrangement'):'Proposed change'):'Option '+(i+1)+(i===0?' · Original arrangement':'')}</p><h4>{name(ref)}</h4>{ref.endsWith('_alternative')&&['food_alternative','stay_alternative','rest_alternative'].includes(ref)&&<p className="caption">{ref==='food_alternative'?'A different meal arrangement is requested. Menu and provider details have not been recorded.':ref==='stay_alternative'?'A different stay arrangement is requested. Property and room details have not been recorded.':'A different rest arrangement is requested. Specific details have not been recorded.'}</p>}</section>)}</div>
 </div>;
}

export function StepBallotChoices({poll,name,value,onChange}:{poll:Decision;name:Names;value:string;onChange:(value:string)=>void}){
 const id=useId();
 return <fieldset className="decision-ballot"><legend>Your vote on {poll.step_id.replace('step_','Step ')}</legend><div className="decision-ballot-options">{poll.options.map((ref,i)=><label className={'decision-radio '+(value===ref?'selected':'')} key={ref}><input type="radio" name={id} value={ref} checked={value===ref} onChange={()=>onChange(ref)}/><span><span className="caption">{poll.mode==='concern'?(i===0?'Keep current · reject change':'Accept proposed change'):'Choose option '+(i+1)}</span><strong>{name(ref)}</strong></span></label>)}<label className={'decision-radio '+(value==='abstain'?'selected':'')}><input type="radio" name={id} value="abstain" checked={value==='abstain'} onChange={()=>onChange('abstain')}/><span><strong>Abstain</strong><span className="caption">No preference between these options</span></span></label></div></fieldset>;
}

export function StepDecisionView({ poll, step, planStart, version, planId, total, name, busy, organiser, eligible, act }: {
 poll:FlowPoll; step?:FlowStep; planStart:string; version:number; planId:string; total:number; name:Names;
 busy:boolean; organiser:boolean; eligible:boolean; act:(action:string,payload:Record<string,unknown>)=>Promise<void>;
}) {
 const [choice,setChoice]=useState(poll.own_ballot?.choice||'');
 const [ack,setAck]=useState(false);
 useEffect(()=>setChoice(poll.own_ballot?.choice||''),[poll.own_ballot?.revision]);
 useEffect(()=>setAck(false),[planId]);
 const open=poll.status==='open', active=open||poll.status==='unresolved';
 const expired=Date.parse(poll.deadline)<=Date.now();
 const enough=poll.responded*2>=total;
 const submit=(action:string,payload:Record<string,unknown>)=>void act(action,payload).catch(()=>{});
 return <section className="flow-poll step-decision compact-vote">
  <div className="actions">
   <Badge tone={poll.status==='closed'?'positive':'pending'}>{{open:'Open vote',closed:'Resolved',unresolved:'Needs another decision',stale:'Earlier vote'}[poll.status]}</Badge>
   <h3>{step?name(step.ref):poll.step_id.replace('step_','Step ')}</h3>
   {poll.own_ballot&&<Badge tone="positive">✓ Vote saved</Badge>}
  </div>
  <StepDecisionDetails poll={poll} step={step} version={organiser?version:0} planStart={planStart} name={name}/>
  <p className="small"><time dateTime={poll.deadline}>{flowStamp(poll.deadline)} IST</time> · {poll.responded} of {total} voted</p>
  {poll.concern_note&&<p className="small preserve-lines"><strong>{poll.concern_shared?'Shared with organiser':'Your private note'}</strong><br/>{poll.concern_note}</p>}
  {open&&eligible&&<fieldset className="auth-fields" disabled={busy||!step||expired}>
   <StepBallotChoices poll={poll} name={name} value={choice} onChange={setChoice}/>
   <Button disabled={!choice||choice===poll.own_ballot?.choice} onClick={()=>submit('vote',{poll_id:poll.id,choice,expected_ballot_revision:poll.own_ballot?.revision||0})}>Save vote</Button>
  </fieldset>}
  {organiser&&active&&<>
   <Button variant="secondary" disabled={busy||!step||(!enough&&!expired)} onClick={()=>submit('close_poll',{poll_id:poll.id})}>Close vote</Button>
   {!enough&&!expired&&<p className="caption">Close after {Math.ceil(total/2)} travellers vote, or when voting ends.</p>}
  </>}
  {!open&&poll.result&&<p>{poll.result.winner?'Result · '+name(poll.result.winner):'No winner. The organiser can revise the itinerary.'}</p>}
  {poll.own_requirement&&!poll.personal_resolved&&['closed','stale'].includes(poll.status)&&<>
   <label className="check"><input type="checkbox" checked={ack} disabled={busy} onChange={e=>setAck(e.target.checked)}/>I accept the current outcome of my requirement.</label>
   <Button disabled={busy||!ack} onClick={()=>submit('resolve_personal',{poll_id:poll.id,plan_id:planId,acknowledged:true})}>Resolve my requirement</Button>
  </>}
 </section>;
}
