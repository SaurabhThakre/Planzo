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
  {step?<div className="decision-schedule"><div className="actions"><ItineraryTypeBadge kind={kind(step.ref,step.kind)}/><span className="caption">{poll.step_id.replace('step_','Step ')} · Day {dayNumber} · Current itinerary v{version}</span></div><p className="decision-date"><time dateTime={step.start}>{date(step.start,zone)}</time>{day(step.start,zone)!==day(step.end,zone)&&<> → <time dateTime={step.end}>{date(step.end,zone)}</time></>}</p><p className="decision-time">{time(step.start,zone)} → {time(step.end,zone)} <span>{step.time_zone||'IST'}</span></p>{!active&&<p className="caption">These timings describe the current itinerary. Earlier versions are in History.</p>}{!active&&<p className="small">In the current itinerary: <strong>{name(step.ref)}</strong></p>}</div>:<p className="decision-missing">This step is absent from the current itinerary. Read its saved version in History for its date and time. Refresh planning before voting on this step.</p>}
  {poll.status==='stale'&&<p className="decision-missing">This is an earlier vote. Its choices are shown for reference; it cannot change the current itinerary.</p>}
  <div className="decision-comparison" aria-label={poll.mode==='concern'?'Current and proposed arrangements':'Arrangements to compare'}>{poll.options.map((ref,i)=><section key={ref} className={'decision-option '+(poll.mode==='concern'&&i===1?'proposed':'')}><p className="eyebrow">{poll.mode==='concern'?(i===0?(active?'Current arrangement':'Original arrangement'):'Proposed change'):'Option '+(i+1)+(i===0?' · Original arrangement':'')}</p><h4>{name(ref)}</h4>{ref.endsWith('_alternative')&&['food_alternative','stay_alternative','rest_alternative'].includes(ref)&&<p className="caption">{ref==='food_alternative'?'A different meal arrangement is requested. Menu and provider details have not been recorded.':ref==='stay_alternative'?'A different stay arrangement is requested. Property and room details have not been recorded.':'A different rest arrangement is requested. Specific details have not been recorded.'}</p>}</section>)}</div>
  {active&&step&&<p className="caption">This vote changes the arrangement within the time slot above. The step’s dates and times stay the same.</p>}
 </div>;
}

export function StepBallotChoices({poll,name,value,onChange}:{poll:Decision;name:Names;value:string;onChange:(value:string)=>void}){
 const id=useId();
 return <fieldset className="decision-ballot"><legend>Your vote on {poll.step_id.replace('step_','Step ')}</legend><div className="decision-ballot-options">{poll.options.map((ref,i)=><label className={'decision-radio '+(value===ref?'selected':'')} key={ref}><input type="radio" name={id} value={ref} checked={value===ref} onChange={()=>onChange(ref)}/><span><span className="caption">{poll.mode==='concern'?(i===0?'Keep current · reject change':'Accept proposed change'):'Choose option '+(i+1)}</span><strong>{name(ref)}</strong></span></label>)}<label className={'decision-radio '+(value==='abstain'?'selected':'')}><input type="radio" name={id} value="abstain" checked={value==='abstain'} onChange={()=>onChange('abstain')}/><span><strong>Abstain</strong><span className="caption">No preference between these options</span></span></label></div></fieldset>;
}

export function StepDecisionView({poll:p,step,planStart,version,planId,total,name,busy,act}:{poll:FlowPoll;step?:FlowStep;planStart:string;version:number;planId:string;total:number;name:(id:string)=>string;busy:boolean;act:(action:string,payload:Record<string,unknown>)=>Promise<void>}){
 const [choice,setChoice]=useState(p.own_ballot?.choice||''),[ack,setAck]=useState(false);useEffect(()=>setChoice(p.own_ballot?.choice||''),[p.own_ballot?.revision]);useEffect(()=>setAck(false),[planId]);
 const submit=(action:string,body:Record<string,unknown>)=>{void act(action,body).catch(()=>{});};
 return <section className="flow-poll step-decision"><div className="actions"><Badge tone={p.status==='closed'?'positive':'pending'}>{{open:'Open vote',closed:'Resolved',unresolved:'Needs another decision',stale:'Earlier vote'}[p.status]}</Badge><h3>{p.step_id.replace('step_','Step ')} · {p.mode==='concern'?'Proposed change':'Compare alternatives'}</h3></div><StepDecisionDetails poll={p} step={step} version={version} planStart={planStart} name={name}/><div className="decision-vote-meta"><p><span className="caption">Vote deadline</span><strong><time dateTime={p.deadline}>{flowStamp(p.deadline)} IST</time></strong></p><p><span className="caption">Responses</span><strong>{p.responded} of {total} ballots saved</strong></p></div><p className="caption">{p.mode==='concern'?'Change needs more than half of all included travellers. Otherwise the current step stays.':'Most votes wins once everyone responds or the deadline passes. Ties and no preference votes remain unresolved.'}</p>
 {p.status==='open'&&<fieldset className="auth-fields" disabled={busy||!step||Date.parse(p.deadline)<=Date.now()}><StepBallotChoices poll={p} name={name} value={choice} onChange={setChoice}/><Button disabled={!choice} onClick={()=>submit('vote',{poll_id:p.id,choice,expected_ballot_revision:p.own_ballot?.revision||0})}>Save my step ballot</Button></fieldset>}
 {['open','unresolved'].includes(p.status)&&<Button variant="secondary" disabled={busy||!step||(p.responded<total&&Date.parse(p.deadline)>Date.now())} onClick={()=>submit('close_poll',{poll_id:p.id})}>Close and resolve step vote</Button>}
 {p.result&&<p>{Object.entries(p.result.counts).map(([k,n])=>name(k)+': '+n).join(' · ')} · Abstain: {p.result.abstain} · Missing: {p.result.missing}. {p.result.winner?'Saved: '+name(p.result.winner):'No winner. Review the private inputs and generate a revised plan.'}</p>}
 {p.own_requirement&&!p.personal_resolved&&['closed','stale'].includes(p.status)&&<><label className="check"><input type="checkbox" checked={ack} disabled={busy} onChange={e=>setAck(e.target.checked)}/>I checked the current resulting itinerary; I accept the current outcome of my requirement, including any disclosed exclusion.</label><Button disabled={busy||!ack} onClick={()=>submit('resolve_personal',{poll_id:p.id,plan_id:planId,acknowledged:true})}>Resolve my personal requirement</Button></>}
 </section>;
}
