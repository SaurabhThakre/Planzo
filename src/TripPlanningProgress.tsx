import { useEffect, useRef, useState } from 'react';
import {bookingTrackerApi} from './bookingTrackingBackend';
import {bookingCounts} from './bookingTracking';
import {bookingOptionsForStep} from './bookingOptions';
import {paymentsApi} from './paymentsBackend';
import type { Workspace } from './backend';
import { flowApi } from './flowBackend';
import type { FlowState } from './flowBackend';
import { Button, Card, Icon } from './ui';
import './tripPassport.css';

export function planningProgress(state: FlowState) {
  const plan = state.plan;
  const inputs = state.included > 0 && state.confirmed === state.included && !state.blocker;
  const pending = state.polls.filter(poll => ['open', 'unresolved'].includes(poll.status)).length;
  const decisions = Boolean(plan && !pending && !state.personal_checks_pending && !plan.document.unplaced.length);
  const review = decisions && !plan?.requirements_legacy;
  const allReady = Boolean(plan && plan.review_count === state.included && review);
  return { plan, inputs, pending, decisions, review, allReady };
}

export function PlanningNavigation({ state, tab, go }: {
  state: FlowState; tab: string; go: (tab: string) => void;
}) {
  const { plan, inputs, decisions, review, allReady } = planningProgress(state);
  const privateAvailable = !inputs || !plan;
  const stages = [
    { key: 'preferences', title: 'Private inputs', done: inputs, available: privateAvailable, pending: 'Inputs confirmed' },
    { key: 'plan', title: 'Shared itinerary', done: Boolean(plan), available: true, pending: '' },
    { key: 'voting', title: 'Step decisions', done: decisions, available: Boolean(plan), pending: 'Available after an itinerary is ready' },
    { key: 'review', title: 'Personal review', done: allReady, available: review, pending: plan?.requirements_legacy ? 'Available after inputs are refreshed' : 'Available after step decisions and requirements are resolved' },
    { key: 'journey', title: 'Locked', done: Boolean(plan?.locked), available: Boolean(plan?.locked), pending: 'Available after the organiser locks the plan' },
  ];
  return <nav aria-label="Itinerary stages" className="planning-stages">
    <ol>{stages.map(stage => <li key={stage.key}>
      {stage.available
        ? <Button variant={tab === stage.key ? 'primary' : 'secondary'} aria-current={tab === stage.key ? 'step' : undefined} onClick={() => go(stage.key)}>
          {stage.done && <span aria-label="Complete">✓</span>}{stage.title}
        </Button>
        : <span className="planning-stage-unavailable" title={stage.pending}>
          {stage.done ? '✓ ' : ''}{stage.title}<small>{stage.pending}</small>
        </span>}
    </li>)}</ol>
  </nav>;
}

type Finance={trip:string;bookingsLoaded:boolean;booked:number;arranged:number;total:number;expenses:number;settled:boolean;pending:number}|null;
export function TripPassport({workspace,userId,go}:{workspace:Workspace;userId:string;go:(tab:string)=>void}){
 const [state,setState]=useState<FlowState|null>(null),[finance,setFinance]=useState<Finance>(null),sequence=useRef(0);
 const {id,revision}=workspace.trip,own=workspace.members.find(member=>member.id===userId);
 useEffect(()=>{
  let alive=true;setState(null);setFinance(null);
  const read=async()=>{const current=++sequence.current;try{
   const result=await flowApi('get',{trip_id:id});if(!alive||current!==sequence.current)return;setState(result);
   if(!own?.included||!result.history.some(plan=>plan.locked)&&!result.plan?.locked)return;
   const [bookings,payments]=await Promise.allSettled([result.plan?.locked?bookingTrackerApi('get',{trip_id:id,plan_id:result.plan.id}):Promise.resolve(null),paymentsApi('get',{trip_id:id})]);
   if(!alive||current!==sequence.current)return;
   const tracker=bookings.status==='fulfilled'?bookings.value:null,ledger=payments.status==='fulfilled'?payments.value:null,plan=result.plan;
   const ids=plan?.locked?[...new Set([...plan.document.steps.filter(step=>bookingOptionsForStep(step,plan.document,workspace.trip.destination,Date.parse(step.start)-86400000)).map(step=>step.id),...(tracker?.records.map(record=>record.step_id)||[])])]:[];
   const counts=bookingCounts(ids,tracker?.records||[]),expenses=ledger?.entries.filter(entry=>!entry.voided).length||0,pending=ledger?.settlements.filter(payment=>payment.status==='pending').length||0;
   setFinance({trip:id,bookingsLoaded:Boolean(tracker),booked:counts.booked,arranged:counts.booked+counts.not_needed,total:ids.length,expenses,settled:Boolean(ledger&&expenses&&!ledger.needs_review&&!pending&&ledger.balances.every(balance=>balance.balance_paise===0)),pending});
  }catch{/* Each step still opens its normal loading/error view. */}};
  void read();const refresh=()=>{if(document.visibilityState==='visible')void read();};const timer=window.setInterval(refresh,15000);window.addEventListener('focus',refresh);
  return()=>{alive=false;++sequence.current;window.clearInterval(timer);window.removeEventListener('focus',refresh);};
 },[id,revision,userId,own?.included]);
 const progress=state&&planningProgress(state),organiser=own?.role==='organiser',archived=['archived','postponed'].includes(workspace.trip.stage),locked=Boolean(progress?.plan?.locked),f=finance?.trip===id?finance:null;
 const steps=[
  {key:'preferences',title:'Private inputs',icon:'lock',done:Boolean(progress?.inputs),detail:state?state.confirmed+' of '+state.included+' confirmed':'Your dates, budget & preferences'},
  {key:'plan',title:'Shared itinerary',icon:'map',done:Boolean(progress?.plan),detail:progress?.plan?'Read the plan day by day':'Build the trip together'},
  {key:'voting',title:'Step decisions',icon:'people',done:Boolean(progress?.decisions),detail:progress?.pending?progress.pending+' decisions to resolve':progress?.decisions?'All decisions resolved':'Compare any proposed changes'},
  {key:'review',title:'Personal review',icon:'check',done:Boolean(progress?.allReady),detail:progress?.plan?progress.plan.review_count+' of '+state!.included+' reviewed':'Give your own yes or no'},
  {key:'journey',title:'Locked itinerary',icon:'plane',done:locked,detail:locked?'Your final day-by-day journey':'Ready after everyone confirms'},
  {key:'bookings',title:'Bookings',icon:'ticket',done:Boolean(f?.bookingsLoaded&&f.total&&f.arranged===f.total),detail:locked?(f?.bookingsLoaded?f.booked+' of '+f.total+' booked':'Arrange stays, activities & transfers'):'Opens after the itinerary is locked'},
  {key:'payments',title:'Payments',icon:'payments',done:Boolean(f?.settled),detail:f?.expenses?f.settled?'Everyone is settled up':f.expenses+' shared '+(f.expenses===1?'expense':'expenses')+(f.pending?' · '+f.pending+' pending':''):locked?'Add expenses & settle together':'Split costs after finalising the trip'},
 ];
 const next=steps.findIndex(step=>!step.done);
 const label=locked?'Open Bookings':!own?.confirmed&&own?.included?'Add my private input':progress?.pending?'Open step decisions':progress?.review&&!progress.plan?.reviewed&&own?.included?'Review the itinerary':progress?.allReady&&organiser?'Lock the itinerary':progress?.inputs&&!progress.plan&&organiser?'Generate the itinerary':'See itinerary progress';
 const tab=locked?'bookings':!own?.confirmed&&own?.included?'preferences':progress?.pending?'voting':progress?.review?'review':'plan';
 return <Card title="Trip passport" titleIcon="map" className="trip-passport">
  <ol className="passport-steps">{steps.map((step,index)=><li key={step.key} className={step.done?'complete':next===index&&!archived?'next':''}><button type="button" aria-label={step.title+' — '+step.detail} onClick={()=>go(step.key)}><span className="passport-step-icon" aria-hidden="true"><Icon name={step.icon}/></span><span className="passport-step-copy"><strong>{step.title}</strong><small>{step.detail}</small></span><span className="passport-step-status" aria-hidden="true">{step.done?'✓':'›'}</span></button></li>)}</ol>
  <Button variant="secondary" onClick={()=>go(archived?'history':tab)}>{archived?'Open History':label}</Button>
 </Card>;
}
