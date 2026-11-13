import{destinationDay,routeStamp,routeTimeLabel,routeBadge}from'./routePlanning';
import {StepPrice,PricingSummary,RouteOverview} from './ContextualStepDetails';
import {useEffect,useId,useRef,useState} from 'react';
import {useMilestone} from './MilestoneCelebration';
import {ItineraryDayTabs} from './ItineraryDayTabs';
import {readableError} from './backend';
import type {Workspace} from './backend';
import {flowApi,generateFlow,refineApi,remindVoters} from './flowBackend';
import type {FlowState,FlowPoll} from './flowBackend';
import {PrivateConversation} from './PrivateConversation';
import {JourneyHistory} from './LiveJourney';
import {LiveHistory} from './LiveHistory';
import {MasterPlanEditor} from './MasterPlanEditor';
import {FinalJourney} from './FinalJourney';
import {ItineraryStopRow} from './ItineraryStopRow';
import {MyRequirements} from './MyRequirements';
import {afterInputDestination} from './tripProgress';
import {BookingOptionsPanel} from './BookingOptionsPanel';
import {PaymentsPanel} from './PaymentsPanel';
import {RepriceStayForm} from './RepriceStayForm';
import {repriceStay} from './repriceStay';
import {Button,Card,Actions,Badge,ItineraryTypeBadge,Field,Note} from './ui';
import {DateTimeField} from './DateTimeField';
import {StepDecisionView} from './StepDecisionDetails';
import {flowMoney,flowStamp,localDate} from './privatePlanning';
import{contextualStepLabel}from'./contextualPlanning';
import{ContextualStepDetails}from'./ContextualStepDetails';
import type {FlowDocument,FlowRef,FlowStep} from './privatePlanning';
import {InPlacePanel} from './InPlacePanel';
import {PlanningNavigation,planningProgress} from './TripPlanningProgress';
import {itineraryDays,itineraryDayTitle} from './ItineraryDays';
type PlanningLink=(tab:string,target?:string)=>void;
const pendingDecision=(poll:FlowPoll)=>poll.status==='open'||poll.status==='unresolved';

function focusPlanningTarget(id:string,onFocused?:()=>void){
 const frame=requestAnimationFrame(()=>{
  const element=document.getElementById(id);
  if(!element)return;
  element.focus({preventScroll:true});
  element.scrollIntoView({block:'nearest'});
  onFocused?.();
 });
 return ()=>cancelAnimationFrame(frame);
}

export function LivePrivatePlanning({workspace:w,userId,tab,target,onRefresh,go}:{workspace:Workspace;userId:string;tab:string;target?:string;onRefresh:()=>Promise<unknown>;go:PlanningLink}){
 const celebrate=useMilestone();
 const [state,setState]=useState<FlowState|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[reviewAck,setReviewAck]=useState(false);
 const [deadline,setDeadline]=useState(localDate(w.trip.response_deadline)),[dateEditing,setDateEditing]=useState(false),[deadlineAck,setDeadlineAck]=useState(false);
 const [editingPlan,setEditingPlan]=useState(false);useEffect(()=>setEditingPlan(tab==='plan'&&target==='edit'),[state?.plan?.id,target,tab]);
 const itineraryDay=useState('');
 const watchedVote=useRef(false);
 useEffect(()=>{
  if(tab!=='voting'||target){watchedVote.current=false;return;}
  if(!state)return;
  const progress=planningProgress(state);
  if(watchedVote.current&&progress.review&&!progress.plan?.locked)go('review');
  watchedVote.current=Boolean(progress.plan&&!progress.review);
 },[state,tab,target]);
 const mounted=useRef(true),inflight=useRef(false),readSequence=useRef(0),request=useRef<{signature:string;id:string}|null>(null);
 const organiser=w.members.some(m=>m.id===userId&&m.role==='organiser'),included=w.members.some(m=>m.id===userId&&m.included);
 async function load(){const sequence=++readSequence.current;const s=await flowApi('get',{trip_id:w.trip.id});if(mounted.current&&sequence===readSequence.current)setState(s);}
 useEffect(()=>{setReviewAck(false);},[state?.plan?.id,state?.stamp]);
 useEffect(()=>{mounted.current=true;void load().catch(e=>mounted.current&&setError(readableError(e)));const focus=()=>{if(document.visibilityState==='visible'&&!inflight.current)void load().catch(e=>mounted.current&&setError(readableError(e)));};const timer=window.setInterval(focus,15000);window.addEventListener('focus',focus);return()=>{mounted.current=false;clearInterval(timer);window.removeEventListener('focus',focus);};},[w.trip.id,userId]);
 useEffect(()=>{if(state&&w.trip.revision!==state.revision&&!inflight.current)void load().catch(e=>mounted.current&&setError(readableError(e)));},[w.trip.revision]);
 async function act(action:string,payload:Record<string,unknown>={}){
  if(!state||inflight.current)throw Error('Wait for the current action to finish.');
  inflight.current=true;readSequence.current++;setBusy(true);setError('');setNotice('');
  const body={trip_id:w.trip.id,expected_revision:state.revision,expected_stamp:state.stamp,...payload},signature=JSON.stringify([action,body]);
  if(request.current?.signature!==signature)request.current={signature,id:crypto.randomUUID()};
  try{const result=(action==='edit_plan'||action==='reprice_step')?await refineApi(action,{...body,request_id:request.current.id}):await flowApi(action,{...body,request_id:request.current.id});request.current=null;if(mounted.current){setState(result);setReviewAck(false);setNotice(action==='lock'?'Itinerary locked.':action==='confirm_input'?'Your private summary is confirmed and saved.':'Saved. Showing the current planning state.');}await onRefresh();
   if(mounted.current&&action==='confirm_input')go(afterInputDestination(result.included,organiser));
   if(mounted.current&&action==='review'&&payload.response==='ready')celebrate({kind:'confirmed',userId,tripId:w.trip.id,version:result.plan?.id});
   if(mounted.current&&action==='lock'){celebrate({kind:'locked',userId,tripId:w.trip.id,version:result.revision});go('journey');}
   if(mounted.current&&['close_poll','resolve_personal'].includes(action)&&planningProgress(result).review)go('review');}
  catch(e){if(mounted.current)setError(readableError(e));throw e;}finally{inflight.current=false;if(mounted.current)setBusy(false);}
 }
 const doAct=(action:string,payload:Record<string,unknown>={})=>{void act(action,payload).catch(()=>{});};
 async function generate(){if(!state||inflight.current)return;inflight.current=true;readSequence.current++;setBusy(true);setError('');setNotice('');
  try{const result=await generateFlow({trip_id:w.trip.id,expected_revision:state.revision,expected_stamp:state.stamp,request_id:crypto.randomUUID()});if(mounted.current){setState(result);setReviewAck(false);setNotice('An itinerary draft is ready for step decisions and your personal review.');}await onRefresh();}
  catch(e){if(mounted.current)setError(readableError(e));}finally{inflight.current=false;if(mounted.current)setBusy(false);}
 }
 if(!state)return <Card title="Opening the planning flow…">{error?<><p role="alert">{error}</p><Button onClick={()=>void load().catch(e=>setError(readableError(e)))}>Retry</Button></>:<p>Checking your trip and private summary.</p>}</Card>;
 const s=state,p=s.plan,frozen=['archived','postponed'].includes(s.stage),refs=s.context?.refs||[];
 const { pending, review }=planningProgress(s);
 const readyToReview=Boolean(review&&!p?.locked&&!frozen);
 const name=(id:string)=>({rest:'Free time / rest',food:'Meal arrangement',food_alternative:'Alternative meal arrangement',stay:'Stay arrangement',stay_alternative:'Alternative stay arrangement',rest_alternative:'Alternative rest arrangement'}[id]||p?.document.refs.find(r=>r.id===id)?.title||refs.find(r=>r.id===id)?.title||id);
 const feedback=<>{error&&<p className="form-error" role="alert">{error} <Button variant="ghost" disabled={busy} onClick={()=>void load().catch(e=>setError(readableError(e)))}>Refresh planning</Button></p>}{notice&&<p className="notice" role="status">{notice}</p>}</>;
 const navigation=<PlanningNavigation state={s} tab={tab} go={go}/>;
 const stayRepricing=p&&organiser&&included&&!frozen&&pending===0&&<RepriceStayForm
  key={'price-editor:'+p.id} document={p.document} busy={busy} save={async (stepId,amount,paise)=>{
   if(p.document.route_version===1){
    await act('reprice_step',{plan_id:p.id,price_change:{step_id:stepId,cost_paise:paise},acknowledged:true});
   }else{
    await act('edit_plan',{plan_id:p.id,steps:repriceStay(p.document,stepId,amount),acknowledged:true});
   }
   go('plan');
  }}/>;
 const extend=<details><summary>Extend the response deadline</summary>
   <DateTimeField label="New response deadline" value={deadline} onChange={setDeadline} onEditingChange={setDateEditing}/>
   <label className="check"><input type="checkbox" checked={deadlineAck} onChange={e=>setDeadlineAck(e.target.checked)}/>Extend the deadline and start fresh planning.</label>
   <Button disabled={busy||dateEditing||!deadlineAck} onClick={()=>doAct('extend_deadline',{deadline:deadline+':00+05:30',acknowledged:true})}>Apply new deadline</Button>
 </details>;
 if(tab==='preferences')return <div className="stack planning-v2">{feedback}<PrivateConversation key={w.trip.id+userId+':'+(s.own?.revision||0)+':'+Boolean(s.own?.confirmed)} workspace={w} state={s} busy={busy} votingReadOnly={pending>0} onAct={act} onDone={()=>go('')}/></div>;
 if(tab==='history')return <PlanningHistoryTabs state={s} tripId={w.trip.id} workspace={w}/>;
 if(tab==='payments')return !included?<Card title="Payments unavailable"><p>Only included travellers can access shared payments.</p></Card>:!p?.locked&&!s.history.some(version=>version.locked)?<Card title="Lock the itinerary to open Payments"><p>Finish the itinerary and personal reviews first. Add shared expenses and record payments between travellers here.</p><Button onClick={()=>go('plan')}>Open itinerary</Button></Card>:<PaymentsPanel tripId={w.trip.id} userId={userId} onBookings={()=>go('bookings')}/>;
 if(tab==='journey'||tab==='bookings')return <div className="stack planning-v2">{feedback}
  {p?.locked?tab==='bookings'?(included?<BookingOptionsPanel key={'bookings:'+p.id} document={p.document} destination={w.trip.destination} workspace={w} planId={p.id} onPayments={()=>go('payments')}/>:<Card title="Booking options are unavailable"><p>Provider options are available to included travellers on locked trips.</p></Card>):<FinalJourney document={p.document} own={s.own?.content} total={p.own_total_paise} checks={p.own_requirement_checks} onBookings={()=>go('bookings')}/>:<Card title="Finalize your itinerary first"><p>Finish step decisions and personal reviews. Booking options open after the organiser locks the itinerary.</p><Button onClick={()=>go('plan')}>Open itinerary</Button></Card>}
  {p?.locked&&tab==='bookings'&&stayRepricing}
 </div>;
 if(!p)return <div className="stack planning-v2">{feedback}{navigation}<Card title="Private inputs">
  <p>{s.confirmed} of {s.included} travellers confirmed.</p>
  <p>{frozen?'Saved plans are in History.':s.blocker||'Your group is ready to generate an itinerary.'}</p>
  <Actions><Button variant="secondary" onClick={()=>go(frozen?'history':'preferences')}>{frozen?'Open History':s.own?.confirmed?'View my input':'Add my input'}</Button>
   {organiser&&!frozen&&<Button disabled={busy||Boolean(s.blocker)||!s.ai_available} onClick={()=>void generate()}>{busy?'Planning…':'Generate itinerary with Gemini'}</Button>}
  </Actions>
  {!frozen&&!s.blocker&&!s.ai_available&&<p className="caption">Each traveller must confirm the planning requests they want to share.</p>}
  {organiser&&!frozen&&extend}
  {organiser&&!frozen&&<PlanReviewActions key={s.stamp} workspace={w} userId={userId} busy={busy} act={act}/>}
 </Card></div>;
 if(tab==='voting')return <div className="stack planning-v2">{feedback}{navigation}
  <FlowStepDecisions state={s} plan={p} target={target} go={go} name={name} busy={busy||frozen||p.locked} organiser={organiser} eligible={included} act={act}/>
  {organiser&&!frozen&&!p.locked&&s.polls.some(poll=>poll.status==='unresolved')&&<Button variant="secondary" onClick={()=>go('plan','edit')}>Revise plan</Button>}
  {review&&<Button onClick={()=>go(p.locked?'journey':'review')}>{p.locked?'Open final journey':'Continue to personal review'}</Button>}
 </div>;
 const exceptions=p.own_requirement_checks?.filter(check=>check.status!=='included')||[];
 const response=p.own_response??(p.reviewed?'ready':null);
 const change=p.change_count??0,decline=p.decline_count??0;
 const estimate=s.own?p.own_total_paise:p.document.cost_paise;
 const revise=()=>{setEditingPlan(true);if(tab!=='plan')go('plan','edit');};
 const decide=(response:'ready'|'change'|'decline')=>doAct('review',{plan_id:p.id,acknowledged:true,response,accept_exclusions:response==='ready'&&reviewAck});
 const requirementSummary=Boolean(p.own_requirement_checks?.length)&&
  <p className="small">{exceptions.length?<><strong>For your review</strong> · {exceptions.map(check=>check.title+' ('+(check.reason==='unverified'?'unverified':'not included')+')').join(', ')}</>:'Your requests are included.'}</p>;
 const timeline=<FlowTimeline document={p.document} refs={p.document.refs||refs} polls={s.polls}
  editable={tab!=='review'&&!busy&&!frozen&&!p.locked&&included}
  concern={async (id,replacement,hard,note,share)=>{await act('raise_concern',{step_id:id,replacement,hard,concern_note:note,share_concern:share});go('voting');}}
  openVote={id=>go('voting',id)} targetStep={target} dayState={itineraryDay} dayLabel={tab==='review'?'Review itinerary days':'Itinerary days'}/>;
 const reviewCard=<Card title="Personal review">
  {p.locked?<p>This itinerary is locked.</p>:!readyToReview?<p>Finish step decisions and any personal requirements first.</p>:<>
   {requirementSummary}
   {s.own&&<p className="small">Your availability · {flowStamp(new Date(Date.parse(s.own.content.start)+s.own.content.outbound_minutes*60000).toISOString())} → {flowStamp(new Date(Date.parse(s.own.content.end)-s.own.content.return_minutes*60000).toISOString())} IST</p>}
   <p className="small">Planning estimate · {flowMoney(estimate)}{s.own?' · Remaining within your trip budget '+flowMoney(Math.max(0,s.own.content.ceiling_paise-estimate)):''}</p>
   {response&&<Badge tone={response==='ready'?'positive':'pending'}>{response==='ready'?'✓ Confirmed':response==='change'?'Needs a change':'Not joining'}</Badge>}
   {p.own_over_budget&&<p className="form-error">The estimate exceeds your private budget. Review your input.</p>}
   {included&&<><label className="check"><input type="checkbox" disabled={busy||p.own_over_budget} checked={reviewAck} onChange={e=>setReviewAck(e.target.checked)}/>I checked the times and cost and accept any exceptions listed above.</label>
    <Actions><Button disabled={busy||p.own_over_budget||!reviewAck} onClick={()=>decide('ready')}>Confirm this itinerary</Button>
     <Button variant="secondary" disabled={busy||response==='change'} onClick={()=>decide('change')}>Needs a change</Button>
     <Button variant="ghost" disabled={busy||response==='decline'} onClick={()=>decide('decline')}>Not joining</Button></Actions></>}
  </>}
  <p role="status">{p.review_count} of {s.included} confirmed this itinerary.</p>
  {(change>0||decline>0)&&<p className="small">{change} need a change · {decline} not joining. {organiser?'Revise the itinerary, change the roster explicitly or postpone.':'The organiser can revise the plan.'}</p>}
  {organiser&&!p.locked&&!frozen&&<>
   <Button disabled={busy||!readyToReview||p.review_count!==s.included} onClick={()=>doAct('lock',{plan_id:p.id,acknowledged:true})}>Lock itinerary</Button>
   {(change>0||decline>0)&&<Button variant="secondary" onClick={revise}>Revise plan</Button>}
   {(change>0||decline>0)&&extend}
   <PlanReviewActions key={s.stamp} workspace={w} userId={userId} busy={busy} act={act}/>
  </>}
 </Card>;
 return <div className="stack planning-v2">{feedback}{navigation}
  {pending>0&&<Note title={pending+' open step '+(pending===1?'decision':'decisions')} tone="cream"><Button onClick={()=>go('voting')}>Open step decisions</Button></Note>}
  {p.requirements_legacy&&!p.locked&&<Note title="This earlier plan needs fresh inputs" tone="cream"><Button variant="secondary" onClick={()=>go('preferences')}>Review my private input</Button></Note>}
  <Card title={tab==='review'?'Review the itinerary day by day':p.locked?'Locked itinerary':'Shared itinerary'} sub={(organiser?'Version '+p.version+' · ':'')+routeStamp(p.document.start,p.document)+' → '+routeStamp(p.document.end,p.document)+' '+routeTimeLabel(p.document)}>
   {p.document.unplaced.length>0&&<p className="small">Still to resolve · {p.document.unplaced.map(name).join(', ')}</p>}
   {tab==='plan'&&editingPlan&&organiser&&!frozen?<MasterPlanEditor document={p.document} busy={busy} onSave={async steps=>{await act('edit_plan',{plan_id:p.id,steps,acknowledged:true});setEditingPlan(false);}} onCancel={()=>setEditingPlan(false)}/>:timeline}
   {tab!=='review'&&organiser&&!frozen&&!editingPlan&&<Button variant="secondary" onClick={revise}>Edit master plan</Button>}
  </Card>
  {tab==='review'&&reviewCard}
  {tab!=='review'&&<Card title="Planning estimate" sub="Estimated total per person">
   <p className="remaining-budget">{flowMoney(estimate)}</p>
   {s.own&&<p className="small">Remaining within your trip budget · {flowMoney(Math.max(0,s.own.content.ceiling_paise-estimate))}</p>}
   {organiser&&!frozen&&!p.locked&&s.polls.some(poll=>poll.status==='unresolved')&&<Button variant="secondary" onClick={()=>go('plan','edit')}>Revise plan</Button>}
  {review&&<Button onClick={()=>go(p.locked?'journey':'review')}>{p.locked?'Open final journey':'Go to personal review'}</Button>}
  </Card>}
  <MyRequirements checks={p.own_requirement_checks} document={p.document} expected={s.own?.content.requests?.length}/>
  {tab==='plan'&&!editingPlan&&stayRepricing}
  <details><summary>How Planzo keeps it fair</summary><p className="small">Private limits still apply. Each traveller answers for themselves. A vote records a preference, and live choices stay private until it closes.</p></details>
  {tab==='plan'&&organiser&&!frozen&&!p.locked&&<Card title="Manage travelling group"><PlanReviewActions key={s.stamp} workspace={w} userId={userId} busy={busy} act={act}/></Card>}
 </div>;
}
function PlanReviewActions({workspace,userId,busy,act}:{workspace:Workspace;userId:string;busy:boolean;act:(action:string,payload:Record<string,unknown>)=>Promise<void>}){
 const [roster,setRoster]=useState(()=>workspace.members.filter(member=>member.included).map(member=>member.id));
 const [postpone,setPostpone]=useState(false);
 const changed=workspace.members.some(member=>member.included!==roster.includes(member.id));
 return <div className="stack">
  <details><summary>Change the travelling roster</summary>
   <p className="small">Keep at least {workspace.trip.minimum_group_size} travellers, including the organiser. Everyone in the new roster will confirm their inputs again.</p>
   {workspace.members.map((member,index)=><label className="check" key={member.id}><input type="checkbox" disabled={busy||member.id===userId} checked={roster.includes(member.id)}
    onChange={e=>setRoster(previous=>e.target.checked?[...previous,member.id]:previous.filter(id=>id!==member.id))}/>{member.name}{workspace.members.filter(other=>other.name===member.name).length>1?' · traveller '+(index+1):''}{member.id===userId?' · organiser':''}</label>)}
   <Button variant="secondary" disabled={busy||!changed||roster.length<workspace.trip.minimum_group_size} onClick={()=>void act('set_roster',{roster,acknowledged:true}).catch(()=>{})}>Use this roster</Button>
  </details>
  <details><summary>Postpone trip</summary>
   <label className="check"><input type="checkbox" disabled={busy} checked={postpone} onChange={e=>setPostpone(e.target.checked)}/>Postpone this trip for everyone. Keep the itinerary in History.</label>
   <Button variant="secondary" disabled={busy||!postpone} onClick={()=>void act('postpone',{acknowledged:true}).catch(()=>{})}>Postpone trip</Button>
  </details>
 </div>;
}

function FlowStepDecisions({state,plan,target,go,name,busy,organiser,eligible,act}:{
 state:FlowState;plan:NonNullable<FlowState['plan']>;target?:string;go:PlanningLink;
 name:(id:string)=>string;busy:boolean;organiser:boolean;eligible:boolean;act:(action:string,payload:Record<string,unknown>)=>Promise<void>;
}){
 const [reminderBusy,setReminderBusy]=useState(false),[reminderStatus,setReminderStatus]=useState('');
 const needsAction=(poll:FlowPoll)=>pendingDecision(poll)||(poll.own_requirement&&!poll.personal_resolved);
 const active=state.polls.filter(needsAction);
 const resolved=state.polls.filter(poll=>poll.status==='closed'&&!needsAction(poll));
 const earlier=state.polls.filter(poll=>poll.status==='stale'&&!needsAction(poll));
 const targetAvailable=Boolean(target&&state.polls.some(poll=>poll.id===target));
 useEffect(()=>{
  if(targetAvailable)return focusPlanningTarget('step-decision-'+target);
 },[target,targetAvailable]);
 const renderDecision=(poll:FlowPoll)=>{
  const step=plan.document.steps.find(item=>item.id===poll.step_id);
  const currentStep=poll.status==='stale'?undefined:step;
  return <div key={poll.id} id={'step-decision-'+poll.id} tabIndex={-1} className="stack">
   <StepDecisionView poll={poll} step={step} planStart={plan.document.start} version={plan.version} planId={plan.id} total={state.included}
    name={id=>step&&id===step.ref?contextualStepLabel(step,plan.document.refs):name(id)} busy={busy} organiser={organiser} eligible={eligible} act={act}/>
   <Button variant="ghost" onClick={()=>currentStep?go('plan',currentStep.id):go('history')}>{currentStep?'View in itinerary':'View itinerary history'}</Button>
  </div>;
 };
 return <Card title="Step decisions" titleIcon="people" sub="Vote on the proposed changes.">
  {organiser&&active.some(poll=>poll.status==='open'&&Date.parse(poll.deadline)>Date.now())&&
   <Button variant="secondary" disabled={busy||reminderBusy} onClick={async()=>{
    setReminderBusy(true);setReminderStatus('');
    try{const outcome=await remindVoters(state.trip_id);setReminderStatus(outcome.failed
     ?'Sent '+outcome.sent+' · '+outcome.failed+' could not be sent. You can retry.'
     :outcome.sent?'Reminder sent to '+outcome.sent+' '+(outcome.sent===1?'traveller.':'travellers.')
     :'Nobody needs a reminder right now, or a reminder was sent recently.');}
    catch(error){setReminderStatus(readableError(error));}finally{setReminderBusy(false);}
   }}>{reminderBusy?'Sending reminders…':'Remind voters'}</Button>}
  {reminderStatus&&<p role="status">{reminderStatus}</p>}
  {active.length?active.map(renderDecision):<p>{plan.locked?'This itinerary is locked. Saved decisions are available below.':'No step decisions need action. Open a stop in Itinerary to raise a concern.'}</p>}
  {resolved.length>0&&<details open={resolved.some(poll=>poll.id===target)}><summary>Resolved decisions ({resolved.length})</summary>{resolved.map(renderDecision)}</details>}
  {earlier.length>0&&<details open={earlier.some(poll=>poll.id===target)}><summary>Earlier votes ({earlier.length})</summary><p>Use History to read the itinerary versions these votes belonged to.</p>{earlier.map(renderDecision)}</details>}
 </Card>;
}

function FlowTimeline({document:d,refs,polls,editable,concern,openVote,targetStep,dayState,inlineDetails=false,dayLabel='Itinerary days'}:{
 document:FlowDocument;refs:FlowRef[];polls:FlowPoll[];editable:boolean;
 concern:(step:string,replacement:string,hard:boolean,note:string,share:boolean)=>Promise<void>;openVote:(pollId:string)=>void;
 targetStep?:string;dayState?:[string,(day:string)=>void];inlineDetails?:boolean;dayLabel?:string;
}){
 const panelId=useId();
 const days=itineraryDays(d.steps,d.route?.time_zone);
 const entries=[...days],localDay=useState(''),[selectedStep,setSelectedStep]=useState<FlowStep|null>(null);
 const [selectedDay,setSelectedDay]=dayState||localDay;
 const currentDay=days.has(selectedDay)?selectedDay:entries[0]?.[0];
 const active=days.get(currentDay)||[],activeIndex=Math.max(0,entries.findIndex(([day])=>day===currentDay));
 const targetItem=targetStep&&d.steps.find(step=>step.id===targetStep);
 const targetDay=targetItem&&destinationDay(targetItem.start,d.route?.time_zone);
 const focused=useRef<string|undefined>(undefined);
 useEffect(()=>{
  if(!targetStep){focused.current=undefined;return;}
  if(!targetDay||focused.current===targetStep)return;
  if(currentDay!==targetDay){setSelectedDay(targetDay);return;}
  return focusPlanningTarget('itinerary-step-'+targetStep,()=>{focused.current=targetStep;});
 },[targetStep,targetDay,currentDay,setSelectedDay]);
 const detail=selectedStep&&d.steps.find(step=>step.id===selectedStep.id);
 const openDecision=(stepId:string)=>polls.find(poll=>poll.step_id===stepId&&pendingDecision(poll));
 const detailPoll=detail&&(openDecision(detail.id)||polls.find(poll=>poll.step_id===detail.id&&poll.status==='closed'));
 return <div className="flow-days"><ItineraryDayTabs days={entries.map(([day])=>day)} currentIndex={activeIndex} onSelect={index=>setSelectedDay(entries[index][0])} panelId={panelId} label={dayLabel}/><section className="day-panel" role="tabpanel" id={panelId} aria-labelledby={panelId+'-tab-'+activeIndex}><h3>{itineraryDayTitle(currentDay,activeIndex)}</h3><ol className="stop-summary">{active.map((step,index)=><li key={step.id}>{inlineDetails?<details><summary>{index+1}. {contextualStepLabel(step,refs)}</summary><p>{routeStamp(step.start,d)} → {routeStamp(step.end,d)} {routeTimeLabel(d)}</p><ContextualStepDetails step={step} refs={refs}/><StepPrice step={step} document={d}/></details>:<ItineraryStopRow step={step} index={index} document={d} refs={refs} pending={Boolean(openDecision(step.id))} onSelect={()=>setSelectedStep(step)}/>}</li>)}</ol></section>{detail&&<InPlacePanel title={contextualStepLabel(detail,refs)} onClose={()=>setSelectedStep(null)}>{({close})=><Card><div className="actions"><ItineraryTypeBadge kind={routeBadge(detail,refs)}/><Badge>Step {active.findIndex(step=>step.id===detail.id)+1}</Badge></div><p>{routeStamp(detail.start,d)} → {routeStamp(detail.end,d)} {routeTimeLabel(d)}</p><ContextualStepDetails step={detail} refs={refs}/>{d.requirements_version===1&&!d.contextual_version&&refs.filter(r=>r.kind===detail.kind&&detail.kind!=='activity').map(r=><p className="caption" key={r.id}>Requested: {r.title} · verify availability at booking</p>)}<StepPrice step={detail} document={d}/>{detailPoll&&<Button variant="secondary" onClick={()=>close(()=>openVote(detailPoll.id))}>{pendingDecision(detailPoll)?'View decision':'View decision outcome'}</Button>}{editable&&!detailPoll&&<StepConcern step={detail} refs={refs} save={(ref,hard,note,share)=>concern(detail.id,ref,hard,note,share)}/>}</Card>}</InPlacePanel>}</div>;
}
function StepConcern({step,refs,save}:{step:FlowStep;refs:FlowRef[];save:(ref:string,hard:boolean,note:string,share:boolean)=>Promise<void>}){
 const current=refs.find(r=>r.id===(step.kind==='activity'?step.ref:step.route_ref))?.route_item;
 const suitable=refs.filter(r=>(!r.kind||r.kind==='activity')&&(!current||r.route_item&&r.route_item.category===current.category&&r.route_item.zone===current.zone&&r.route_item.end_zone===current.end_zone&&r.route_item.minimum_minutes<=(Date.parse(step.end)-Date.parse(step.start))/60000));
 const options=step.kind==='activity'?[...(current?.category==='transfer'?[]:[{id:'rest',title:'Free time / rest'}]),...suitable]:[{id:step.kind,title:'Original arrangement'},{id:step.kind+'_alternative',title:'Alternative '+step.kind+' arrangement'}];
 const [replacement,setReplacement]=useState(options.find(x=>x.id!==step.ref)?.id||''),[hard,setHard]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false),[note,setNote]=useState(''),[share,setShare]=useState(false);
 return <details><summary>Raise a concern about this step</summary><p className="caption">Propose a change to this step.</p><Field label={'Replacement for '+step.id}><select value={replacement} onChange={e=>setReplacement(e.target.value)}>{options.filter(r=>r.id!==step.ref).map(r=><option key={r.id} value={r.id}>{r.title}</option>)}</select></Field><Field label={'Does '+step.id+' affect a must-have?'}><select value={hard?'hard':'soft'} onChange={e=>setHard(e.target.value==='hard')}><option value="soft">A flexible preference</option><option value="hard">My private must-have needs review</option></select></Field><Field label="Feedback (optional)" hint="Only you can see this note unless you share it with the organiser."><textarea rows={3} maxLength={1000} value={note} onChange={event=>setNote(event.target.value)}/></Field><label className="check"><input type="checkbox" checked={share} disabled={!note.trim()} onChange={event=>setShare(event.target.checked)}/>Share with organiser</label>{error&&<p role="alert">{error}</p>}{current?.category==='transfer'&&<p className="caption">Transfer alternatives must keep the same origin and destination. The organiser can adjust the route in Edit master plan; essential transfers cannot be removed.</p>}<Button disabled={busy||!replacement||replacement===step.ref} onClick={async()=>{setBusy(true);try{await save(replacement,hard,note,Boolean(note.trim()&&share));setError('');}catch(e){setError(readableError(e));}finally{setBusy(false);}}}>Raise step concern</Button></details>;
}
function FlowVersionHistory({state:s,tripId}:{state:FlowState;tripId:string}){
 const [selected,setSelected]=useState<{version:number;document:FlowDocument;locked:boolean}|null>(null),[error,setError]=useState('');
 return <Card title="Saved itinerary versions" sub="Earlier versions remain historical. Private summaries and individual ballots are not shared.">{s.history.length?s.history.map(h=><div className="member-row" key={h.id}><span>Version {h.version} · {flowStamp(h.created_at)} · {h.locked?'Locked':'Draft'}</span><Button variant="secondary" onClick={async()=>{try{const result=await flowApi('get_version',{trip_id:tripId,plan_id:h.id});setSelected(result as unknown as typeof selected);setError('');}catch(e){setError(readableError(e));}}}>Read version {h.version}</Button></div>):<p>No shared itinerary version yet.</p>}{error&&<p role="alert">{error}</p>}{selected&&<InPlacePanel title={'Historical version '+selected.version} onClose={()=>setSelected(null)}><RouteOverview document={selected.document}/><PricingSummary document={selected.document}/><FlowTimeline document={selected.document} refs={selected.document.refs||[]} polls={[]} editable={false} inlineDetails concern={async()=>{}} openVote={()=>{}}/></InPlacePanel>}</Card>;
}
function PlanningHistoryTabs({state,tripId,workspace}:{state:FlowState;tripId:string;workspace:Workspace}){
 const [tab,setTab]=useState<'versions'|'journey'|'trip'>('versions');
 return <div className="stack planning-history"><div className="local-tabs" role="tablist" aria-label="Planning history sections"><Button role="tab" aria-selected={tab==='versions'} variant={tab==='versions'?'primary':'secondary'} onClick={()=>setTab('versions')}>Itinerary versions</Button><Button role="tab" aria-selected={tab==='journey'} variant={tab==='journey'?'primary':'secondary'} onClick={()=>setTab('journey')}>Journey history</Button><Button role="tab" aria-selected={tab==='trip'} variant={tab==='trip'?'primary':'secondary'} onClick={()=>setTab('trip')}>Decision history</Button></div><div hidden={tab!=='versions'}><FlowVersionHistory state={state} tripId={tripId}/></div><div hidden={tab!=='journey'}><JourneyHistory tripId={tripId}/></div><div hidden={tab!=='trip'}><LiveHistory workspace={workspace}/></div></div>;
}
