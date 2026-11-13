import {useEffect,useId,useRef,useState} from 'react';
import type {FlowDocument,FlowStep} from './privatePlanning';
import type {Workspace} from './backend';
import {readableError} from './errors';
import {bookingOptionsForStep} from './bookingOptions';
import {BOOKING_STATUSES,bookingCounts,bookingDraft,bookingFields,bookingMoney} from './bookingTracking';
import type {BookingRecord,BookingTracker,BookingDraft} from './bookingTracking';
import {bookingTrackerApi} from './bookingTrackingBackend';
import {contextualStepLabel} from './contextualPlanning';
import {itineraryDays,itineraryDayTitle} from './ItineraryDays';
import {ItineraryDayTabs} from './ItineraryDayTabs';
import {destinationDay,routeStamp,routeTimeLabel} from './routePlanning';
import {Button,Card,ItineraryTypeBadge} from './ui';
import './bookingOptions.css';

export function BookingOptionsPanel({document,destination,workspace,planId,onPayments}:{document:FlowDocument;destination:string;workspace:Workspace;planId:string;onPayments:()=>void}){
 const timeZone = document.route?.time_zone || 'Asia/Kolkata';
 const clock = new Intl.DateTimeFormat('en-IN', { timeZone, timeStyle: 'short' });
 const stepsById = new Map<string, FlowStep>();
 for (const step of document.steps) {
  if (!stepsById.has(step.id)) stepsById.set(step.id, step);
 }
 const uniqueSteps = [...stepsById.values()];
 const days = [...itineraryDays(uniqueSteps, timeZone)];
 const [selectedDay,setSelectedDay]=useState(''),[tracker,setTracker]=useState<BookingTracker|null>(null),[error,setError]=useState(''),[refresh,setRefresh]=useState(0);
 const saving=useRef(false),readSequence=useRef(0);
 const currentIndex=Math.max(0,days.findIndex(([day])=>day===selectedDay));
 const [date,steps]=days[currentIndex]||['',[]];
 const panelId=useId();
 const dayControls = useRef<HTMLDivElement>(null);
 useEffect(()=>{let alive=true;
  async function load(){if(saving.current)return;const current=++readSequence.current;try{const data=await bookingTrackerApi('get',{trip_id:workspace.trip.id,plan_id:planId});if(alive&&current===readSequence.current&&!saving.current){setTracker(data);setError('');}}catch(e){if(alive&&current===readSequence.current)setError(readableError(e));}}
  void load();const onFocus=()=>{if(window.document.visibilityState==='visible'&&!saving.current)void load();};
  const timer=window.setInterval(onFocus,15000);window.addEventListener('focus',onFocus);
  return()=>{alive=false;clearInterval(timer);window.removeEventListener('focus',onFocus);};
 },[workspace.trip.id,planId,refresh]);
 const members=workspace.members.filter(m=>m.included);
 const memberName=(id:string|null,fallback='Traveller')=>{const m=workspace.members.find(x=>x.id===id);if(!m)return fallback;return m.name+(workspace.members.filter(x=>x.name===m.name).length>1?' · traveller '+(workspace.members.indexOf(m)+1):'');};
 const eligible=(step:FlowStep)=>bookingOptionsForStep(step,document,destination,Date.parse(step.start)-86400000);
 const records=tracker?.plan_id===planId?tracker.records:[];
 const bookable=uniqueSteps.filter(step=>eligible(step)||records.some(r=>r.step_id===step.id));
 const counts=bookingCounts(bookable.map(s=>s.id),records);
 const options=steps.filter(step=>bookable.some(s=>s.id===step.id));
 async function save(stepId:string,draft:BookingDraft,requestId:string,expectedRevision:number){
  if(saving.current)throw Error('A booking update is already being saved.');saving.current=true;++readSequence.current;
  try{const fields=bookingFields(draft,members.map(m=>m.id));const data=await bookingTrackerApi('save',{trip_id:workspace.trip.id,plan_id:planId,step_id:stepId,expected_revision:expectedRevision,request_id:requestId,...fields});setTracker(data);setError('');}finally{saving.current=false;}
 }
 return (
  <div className="booking-options-page">
   <header className="booking-intro">
    <h2>Bookings</h2>
    <p className="small muted">Check availability and final prices with the provider.</p>
   </header>
   <aside className="card booking-summary" aria-label="Booking progress">
    <div className="booking-progress">
     <span><strong>{tracker ? counts.booked : '—'}</strong> booked</span>
     <span><strong>{tracker ? counts.in_progress : '—'}</strong> in progress</span>
     <span><strong>{tracker ? counts.not_booked + counts.cancelled : '—'}</strong> to arrange</span>
     {counts.not_needed > 0 && <span><strong>{counts.not_needed}</strong> not needed</span>}
    </div>
    <div className="booking-top-actions">
     <Button variant="ghost" onClick={() => setRefresh(n => n + 1)}>Refresh bookings</Button>
     <Button variant="secondary" onClick={onPayments}>Open Payments</Button>
    </div>
   </aside>
   <div className="booking-checklist">
    {error && <p role="alert">{error} Use Refresh bookings to try again.</p>}
    {!tracker && !error && <p role="status">Loading booking records…</p>}
    {tracker && !tracker.editable && <p role="status">Booking records are read-only for this trip.</p>}
    {date ? <>
     <div className="booking-day-controls" ref={dayControls}>
      <ItineraryDayTabs
       days={days.map(([day]) => day)}
       currentIndex={currentIndex}
       onSelect={index => {
        if (index === currentIndex) return;
        setSelectedDay(days[index][0]);
        const controls = dayControls.current;
        const checklist = controls?.parentElement;
        if (controls && checklist && checklist.getBoundingClientRect().top < parseFloat(getComputedStyle(controls).top) - 1) {
         checklist.scrollIntoView({ block: 'start', behavior: 'instant' });
        }
       }}
       panelId={panelId}
       label="Booking days"
      />
     </div>
     <section id={panelId} role="tabpanel" aria-labelledby={panelId + '-tab-' + currentIndex} tabIndex={0} className="booking-day-panel">
      <div className="booking-day-heading">
       <h3>{itineraryDayTitle(date, currentIndex)}</h3>
       {options.length > 0 && <span className="caption muted">Times in {routeTimeLabel(document)}</span>}
      </div>
      {options.length ? options.map(step => {
       const links = bookingOptionsForStep(step, document, destination);
       const [primary, ...secondary] = [...(links?.links || [])].sort((a, b) =>
        Number(/information/i.test(a.label)) - Number(/information/i.test(b.label))
       );
       const category = eligible(step)?.category || 'Activity';
       const record = records.find(r => r.step_id === step.id);
       const title = contextualStepLabel(step, document.refs);
       const overnight = destinationDay(step.end, timeZone) !== date;
       return (
        <Card key={step.id} className={'booking-step-card booking-state-'+(record?.status||'not_booked')}>
         <div className="booking-step-grid">
          <div className="booking-step-info">
           <div className="booking-badges">
            <ItineraryTypeBadge kind={category === 'Transfer' ? 'transport' : category === 'Stay' ? 'stay' : 'activity'}/>
            <span className={'booking-status ' + (record?.status || 'not_booked')}><span aria-hidden="true">{record?.status==='booked'?'✓':record?.status==='in_progress'?'◷':'○'}</span>{BOOKING_STATUSES[record?.status || 'not_booked']}</span>
           </div>
           <h4>{title}</h4>
           <p className="booking-time">
            <time dateTime={step.start}>{clock.format(new Date(step.start))}</time>
            {' → '}
            <time dateTime={step.end}>{overnight ? routeStamp(step.end, document) : clock.format(new Date(step.end))}</time>
           </p>
           {record && <>
            <dl className="booking-facts">
             {record.provider_name && <div><dt>Booked through</dt><dd>{record.provider_name}</dd></div>}
             {record.amount_paise !== null && <div><dt>Total paid</dt><dd>{bookingMoney(record.amount_paise)}</dd></div>}
             {record.booked_by && <div><dt>Booked by</dt><dd>{memberName(record.booked_by, record.booked_by_name || 'Former traveller')}</dd></div>}
             {record.reference && <div><dt>Reference</dt><dd>{record.reference}</dd></div>}
            </dl>
            {record.notes && <p className="booking-notes">{record.notes}</p>}
            <p className="caption muted">Updated by {memberName(record.actor, record.actor_name)} · {new Date(record.created_at).toLocaleString('en-IN')}</p>
           </>}
           {tracker && <BookingEditor
            record={record}
            members={members.map(m => ({ id: m.id, name: memberName(m.id) }))}
            editable={tracker.editable}
            onSave={(draft, request, revision) => save(step.id, draft, request, revision)}
           />}
          </div>
          {primary && <div className="booking-provider-actions" role="group" aria-label={'Provider links for ' + title}>
           <BookingProviderLink link={primary} primary/>
           {secondary.length > 0 && <details className="booking-more-providers">
            <summary>Compare {secondary.length} other {secondary.length===1?'option':'options'} <span className="booking-chevron" aria-hidden="true"/></summary>
            <div>{secondary.map(link => <BookingProviderLink key={link.href} link={link}/>)}</div>
           </details>}
           <p className="caption">Availability unverified</p>
          </div>}
         </div>
        </Card>
       );
      }) : <p className="small muted">No bookings to arrange this day.</p>}
     </section>
    </> : <p className="small muted">No bookings to arrange.</p>}
    {tracker && tracker.history.length > 0 && (
     <Card className="booking-history-card">
      <details>
       <summary>Booking history</summary>
       <ol className="booking-history">
        {tracker.history.map(event => (
         <li key={event.id}>
          <strong>{event.step_title}</strong>
          <span>Itinerary v{event.plan_version} · {BOOKING_STATUSES[event.status]} · {event.provider_name || 'No provider'}{event.amount_paise !== null ? ' · ' + bookingMoney(event.amount_paise) : ''}</span>
          {event.booked_by && <span>Booked by {memberName(event.booked_by, event.booked_by_name || 'Former traveller')}</span>}
          {event.reference && <span>Reference: {event.reference}</span>}
          {event.notes && <span>{event.notes}</span>}
          <span className="caption">Saved by {memberName(event.actor, event.actor_name)} · {new Date(event.created_at).toLocaleString('en-IN')}</span>
         </li>
        ))}
       </ol>
      </details>
     </Card>
    )}
   </div>
  </div>
 );
}

function BookingProviderLink({ link, primary = false }: { link: { label: string; href: string }; primary?: boolean }) {
 return (
  <a className={'booking-provider-link ' + (primary ? 'primary' : 'secondary')} href={link.href} target="_blank" rel="noreferrer">
   {link.label}<span aria-hidden="true">↗</span>
  </a>
 );
}

function BookingEditor({record,members,editable,onSave}:{record?:BookingRecord;members:{id:string;name:string}[];editable:boolean;onSave:(draft:BookingDraft,requestId:string,revision:number)=>Promise<void>}){
 const [open,setOpen]=useState(false),[draft,setDraft]=useState(()=>bookingDraft(record)),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[baseRevision,setBaseRevision]=useState(record?.revision||0);
 const request=useRef<{signature:string;id:string}|null>(null);const formId=useId();
 useEffect(()=>{if(!open)setDraft(bookingDraft(record));},[record?.revision,open]);
 const set=(key:keyof BookingDraft,value:string)=>setDraft(d=>({...d,[key]:value}));
 const stale=(record?.revision||0)!==baseRevision;
 async function submit(){if(busy||!editable||stale)return;setBusy(true);setError('');setNotice('');try{bookingFields(draft,members.map(m=>m.id));const signature=JSON.stringify([baseRevision,draft]);if(request.current?.signature!==signature)request.current={signature,id:crypto.randomUUID()};await onSave(draft,request.current.id,baseRevision);request.current=null;setOpen(false);setNotice('Booking details saved.');}catch(e){setError(readableError(e));}finally{setBusy(false);}}
 return <div className="booking-editor">{editable&&<Button variant="secondary" aria-expanded={open} aria-controls={formId} disabled={busy} onClick={()=>{if(!open){setDraft(bookingDraft(record));setBaseRevision(record?.revision||0);}setOpen(!open);setError('');setNotice('');}}>{open?'Close details':record?'Edit booking details':'Add booking details'}</Button>}
  {notice&&<p role="status">{notice}</p>}
  {open&&editable&&<form id={formId} className="booking-form" onSubmit={e=>{e.preventDefault();void submit();}}>
   <div className="booking-form-grid">
    <label>Status<select value={draft.status} disabled={busy} onChange={e=>set('status',e.target.value)}>{Object.entries(BOOKING_STATUSES).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
    <label>Booked through / provider<input value={draft.provider_name} maxLength={120} required={draft.status==='booked'} disabled={busy} placeholder="e.g. Booking.com or direct with hotel" onChange={e=>set('provider_name',e.target.value)}/></label>
    <label>Total paid for this step (INR)<input type="text" inputMode="decimal" value={draft.amount} required={draft.status==='booked'} disabled={busy} placeholder="e.g. 4200.00" onChange={e=>set('amount',e.target.value)}/></label>
    <label>Booked by<select value={draft.booked_by} required={draft.status==='booked'} disabled={busy} onChange={e=>set('booked_by',e.target.value)}><option value="">Choose a traveller</option>{members.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}{draft.booked_by&&!members.some(m=>m.id===draft.booked_by)&&<option value={draft.booked_by} disabled>Former traveller — choose again</option>}</select></label>
    <label>Booking reference (optional)<input value={draft.reference} maxLength={120} disabled={busy} onChange={e=>set('reference',e.target.value)}/></label>
   </div>
   <label>Notes (optional)<textarea value={draft.notes} maxLength={500} disabled={busy} placeholder="What is covered, travellers included, payment or cancellation notes" onChange={e=>set('notes',e.target.value)}/></label>
   <p className="caption">Booking details do not add an expense. Add any shared cost separately in Payments.</p>
   {error&&<p role="alert">{error}</p>}
   {stale&&<div role="status"><p>Another traveller updated this booking. Load their latest details before editing again.</p><Button variant="secondary" onClick={()=>{setDraft(bookingDraft(record));setBaseRevision(record?.revision||0);setError('');}}>Load latest details</Button></div>}
   <Button type="submit" disabled={busy||stale}>{busy?'Saving…':'Save booking details'}</Button>
  </form>}
 </div>;
}
