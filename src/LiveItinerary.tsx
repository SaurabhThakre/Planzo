import {useEffect,useRef,useState} from 'react';
import {DateTimeField} from './DateTimeField';
import type {Workspace} from './backend';
import {readableError} from './backend';
import {Actions,Badge,ItineraryTypeBadge,Button,Card,Field,Note} from './ui';
import {costRange} from './planningBackend';
import type {CostSnapshot} from './planningBackend';
import {itineraryApi} from './itineraryBackend';
import type {ItinerarySlot,ItineraryState} from './itineraryBackend';
const stamp=(s:string)=>new Date(s).toLocaleString('en-IN',{timeZone:'Asia/Kolkata',dateStyle:'medium',timeStyle:'short'})+' IST';
const localTime=(s:string)=>new Date(new Date(s).getTime()+330*60000).toISOString().slice(0,16);
export function LiveItinerary({workspace:w,userId,tab,onChanged,go}:{workspace:Workspace;userId:string;tab:string;onChanged:()=>Promise<unknown>;go:(tab:string)=>void}){
 const [state,setState]=useState<ItineraryState|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
 const [windowId,setWindow]=useState(w.windows[0]?.id||''),[slotId,setSlot]=useState('stay_2'),[a,setA]=useState('twin_hotel'),[b,setB]=useState('shared_villa');
 const [deadline,setDeadline]=useState(localTime(new Date(Math.min(Date.now()+86400000,new Date(w.trip.response_deadline).getTime())).toISOString()));
 const [ballot,setBallot]=useState(''),[revisionAck,setRevisionAck]=useState(false);
 const mounted=useRef(true),sequence=useRef(0),request=useRef<{signature:string;id:string}|null>(null),saving=useRef(false);
 const organiser=w.members.find(m=>m.id===userId)?.role==='organiser';
 async function load(){const serial=++sequence.current;try{const s=await itineraryApi('get',{trip_id:w.trip.id});if(mounted.current&&serial===sequence.current){setState(s);setError('');}return s;}catch(e){if(mounted.current&&serial===sequence.current)setError(readableError(e));throw e;}}
 useEffect(()=>{mounted.current=true;void load().catch(()=>{});const refresh=()=>{if(document.visibilityState==='visible'&&!saving.current)void load().catch(()=>{});};window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',refresh);const timer=window.setInterval(refresh,15000);return()=>{mounted.current=false;sequence.current++;clearInterval(timer);window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh);};},[w.trip.id,w.trip.revision]);
 useEffect(()=>{if(state?.draft)setWindow(state.draft.window_id);},[state?.draft?.window_id]);
 useEffect(()=>{setBallot(state?.poll?.own_ballot?.choice||'');},[state?.poll?.id,state?.poll?.own_ballot?.revision]);
 async function act(action:string,payload:Record<string,unknown>={},message='Saved to the shared itinerary.'){
  if(!state||saving.current)return;saving.current=true;setBusy(true);setError('');setNotice('');
  const body={trip_id:w.trip.id,expected_revision:state.revision,...payload},signature=JSON.stringify([action,body]);
  if(request.current?.signature!==signature)request.current={signature,id:crypto.randomUUID()};
  try{await itineraryApi(action,{...body,request_id:request.current.id});request.current=null;await onChanged();await load();if(mounted.current){setNotice(message);setRevisionAck(false);}if(action==='publish_plan')go('review');}
  catch(e){if(mounted.current)setError(readableError(e));}
  finally{saving.current=false;if(mounted.current)setBusy(false);}
 }
 if(!state)return <Card title="Opening your shared itinerary…">{error?<><p role="alert">{error}</p><Button onClick={()=>void load().catch(()=>{})}>Retry itinerary</Button></>:<p>Loading the saved trip and item choices.</p>}</Card>;
 const s=state,d=s.draft,p=s.poll,cat=s.catalogue;
 const frozen=['postponed','archived'].includes(s.stage),overdue=new Date(s.deadline).getTime()<=Date.now();
 const historical=Boolean(p&&(!d?.current||(p.source_revision!==s.revision&&!(p.status==='closed'&&p.source_revision+1===s.revision))));
 const blocked=Boolean(p&&['open','unresolved'].includes(p.status)),canEdit=organiser&&!busy&&!frozen&&!overdue&&Boolean(d?.current)&&!blocked;
 const slot=cat.slots.find(x=>x.id===slotId),eligible=w.members.some(m=>m.id===userId&&m.included);
 const windowText=(id:string)=>{const win=w.windows.find(x=>x.id===id);return win?stamp(win.start+':00+05:30')+' → '+stamp(win.end+':00+05:30'):'Choose a window';};
 function target(item:ItinerarySlot){setSlot(item.id);setA(item.choices[0]);setB(item.choices[1]||'');go('voting');}
 return <div className="stack itinerary-flow">
  {error&&<p className="form-error" role="alert">{error} Your entered choices are kept. Refresh the latest itinerary before retrying a stale action.</p>}{notice&&<p className="notice" role="status">{notice}</p>}
  {tab==='plan'?<div className="columns"><div>
   <Card title="One itinerary, together" sub="Dates first, then travel, both nights and activities. Keep agreed choices; use an item vote where the group needs a decision.">
    <p>These are manual proposals from a fictional Goa catalogue. Natural-language extraction and AI suggestions are a later step. Saving an item proposes a draft; everyone still reviews the final plan.</p>
    <Field label="Complete travel window"><select value={windowId} disabled={busy||frozen||!organiser} onChange={e=>setWindow(e.target.value)}>{w.windows.map(win=><option key={win.id} value={win.id}>{windowText(win.id)}{s.windows.find(x=>x.id===win.id)?.compatible?' · shared availability':' · availability needs checking'}</option>)}</select></Field>
    {organiser?<><label className="check"><input type="checkbox" checked={revisionAck} disabled={busy||frozen} onChange={e=>setRevisionAck(e.target.checked)}/>I understand that starting or rechecking a draft makes earlier agreement historical and requires fresh review.</label><Button disabled={busy||frozen||overdue||!revisionAck} onClick={()=>void act('prepare',{window_id:windowId},'One itinerary checked and saved. Prior versions remain in history.')}>{busy?'Saving…':d?'Recheck itinerary and dates':'Start one itinerary'}</Button></>:<p>The organiser starts or rechecks the itinerary after everyone confirms their private input.</p>}
   </Card>
   {d&&<><Card title="Missing-step checks" tone={d.gaps.length?'cream':'mint'}><Badge tone={d.gaps.length?'alert':'positive'}>{d.gaps.length?d.gaps.length+' missing steps':'All required slots filled'}</Badge><p>A three-day trip needs the nights after Days 1 and 2. Every travel, food and activity/free-time slot must also have an explicit arrangement.</p>{d.gaps.length>0&&<ul>{d.gaps.map(g=><li key={g.slot_id}>{g.message}</li>)}</ul>}{d.blockers.length>0&&<><strong>Before review or a vote</strong><ul>{d.blockers.map(x=><li key={x}>{x}</li>)}</ul></>}{!d.current&&<Note title="Saved draft needs rechecking" tone="cream">Inputs, roster or catalogue facts changed. The organiser must recheck before editing, voting or sharing.</Note>}</Card>
    <Card title="Your shared timeline" sub={windowText(d.window_id)}><ol className="itinerary-timeline">{cat.slots.map(item=><li key={item.id}>
     <div className="actions"><Badge>Day {item.day}</Badge><ItineraryTypeBadge kind={item.id==='food'?'food':item.id==='local'?'transport':item.kind}/><strong>{item.label}</strong>{!d.items[item.id]&&<Badge tone="alert">Missing</Badge>}</div>
     <p>{d.items[item.id]?cat.choices[d.items[item.id]!]?.title:'No arrangement chosen'}</p><p className="caption">{item.timing}</p>
     {organiser&&<ItemEditor slot={item} selected={d.items[item.id]||''} catalogue={cat.choices} disabled={!canEdit} save={choice=>void act('set_item',{slot_id:item.id,choice},'Item saved. Costs are rechecked and any prior review needs fresh responses.')} vote={()=>target(item)}/>}
    </li>)}</ol></Card></>}
  </div><aside><Card title="From itinerary to budget review" tone="mint"><p>Resolve only choices that need a group decision. All other items stay in the same itinerary. Detailed personal costs and final readiness come in Review & confirm.</p><p className="small">Votes cannot override availability, private ceilings or requirements. Unknown prices and missing steps block review.</p><Actions><Button variant="secondary" onClick={()=>go('voting')}>Open item voting</Button><Button variant="secondary" onClick={()=>go('review')}>Review saved plan</Button></Actions>
   {d?.own_cost&&<details><summary>Check my running whole-trip estimate</summary><ItemCost cost={d.own_cost}/></details>}
   {organiser&&<><p className="caption">Sharing a review version is private to this trip. It does not publish the website or reserve anything.</p><Button disabled={!canEdit||Boolean(d?.blockers.length)} onClick={()=>void act('publish_plan',{},'Itinerary shared as a new review version.')}>Share itinerary for budget review</Button></>}
  </Card><Note title={cat.label}>{cat.source} · {cat.source_date}. {cat.assumptions.join(' ')}</Note></aside></div>:
  <div className="columns"><div>
   <Card title="One item, one decision" sub="The rest of the itinerary stays in place. Both alternatives must pass complete group checks.">
    {p?<><Badge tone={p.status==='open'?'pending':p.status==='closed'?'positive':'neutral'}>{p.status}{historical?' · historical':''}</Badge><h3>{cat.slots.find(x=>x.id===p.slot_id)?.label||p.slot_id}</h3><p>{p.responded} of {p.roster.length} ballots saved · closes {stamp(p.deadline)}</p>
     <p className="small">A tie uses the lower upper whole-trip core cost, excluding optional add-ons. Equal costs, no preference votes or any request for another option remain unresolved. Missing ballots are never votes.</p>
     <div className="item-comparison">{p.options.map(o=><section key={o.id}><h4>{o.title}</h4><p className="caption">Your complete estimate in this poll snapshot</p>{o.own_cost&&<ItemCost cost={o.own_cost}/>}</section>)}</div>
     {p.status==='open'&&eligible&&<form onSubmit={e=>{e.preventDefault();void act('vote',{poll_id:p.id,choice:ballot,expected_ballot_revision:p.own_ballot?.revision||0},'Your private item ballot is saved.');}}><fieldset className="auth-fields" disabled={busy||frozen||new Date(p.deadline).getTime()<=Date.now()}><Field label="Your item ballot"><select value={ballot} required onChange={e=>setBallot(e.target.value)}><option value="">Choose a response</option>{p.options.map(o=><option key={o.id} value={o.id}>{o.title}</option>)}<option value="abstain">Abstain</option><option value="different">Request a different option</option></select></Field><Button type="submit" disabled={!ballot}>Save my item ballot</Button></fieldset></form>}
     {!eligible&&<p>You have observer access. Only the included travelling roster votes.</p>}
     {p.own_ballot&&<p>Your saved ballot: {cat.choices[p.own_ballot.choice]?.title||p.own_ballot.choice}</p>}
     {p.result&&<Note title={historical?'Earlier item decision':p.result.winner?'Item choice saved to the itinerary':'This item remains unresolved'}>{Object.entries(p.result.counts).map(([id,count])=>(cat.choices[id]?.title||id)+': '+count).join(' · ')}. Abstain: {p.result.abstain} · Different: {p.result.different} · Missing: {p.result.missing}. {historical?'This result belongs to an earlier draft and cannot approve the current itinerary.':'Final readiness is still required.'}</Note>}
     {organiser&&<Actions>{p.status==='open'&&<Button disabled={busy||frozen} onClick={()=>void act('close_poll',{poll_id:p.id},'Item poll closed. Check its result before sharing a review version.')}>Close item poll</Button>}{blocked&&<Button variant="secondary" disabled={busy||frozen} onClick={()=>void act('cancel_poll',{poll_id:p.id},'Item poll ended. The previous itinerary choice is retained until explicitly changed.')}>End poll and rethink</Button>}</Actions>}
    </>:<p>No item poll yet. Items the group has already agreed can stay in the itinerary without a poll.</p>}
   </Card>
   {organiser&&<Card title="Open a targeted item vote"><fieldset className="auth-fields" disabled={busy||frozen||overdue||!d?.current||blocked}>
    <Field label="Item to resolve"><select value={slotId} onChange={e=>{const x=cat.slots.find(x=>x.id===e.target.value)!;setSlot(x.id);setA(x.choices[0]);setB(x.choices[1]||'');}}>{cat.slots.filter(x=>x.choices.length>1).map(x=><option key={x.id} value={x.id}>{x.label}</option>)}</select></Field>
    <Field label="First item alternative"><select value={a} onChange={e=>setA(e.target.value)}>{slot?.choices.map(id=><option key={id} value={id}>{cat.choices[id].title}</option>)}</select></Field>
    <Field label="Second item alternative"><select value={b} onChange={e=>setB(e.target.value)}>{slot?.choices.map(id=><option key={id} value={id}>{cat.choices[id].title}</option>)}</select></Field>
    <DateTimeField label="Item poll closes" value={deadline} max={localTime(s.deadline)} onChange={setDeadline}/>
    <p className="caption">For a missing item, fill all other required steps first. The server checks both completed alternatives before opening the vote.</p>
    <Button disabled={!a||!b||a===b||!deadline} onClick={()=>void act('open_poll',{slot_id:slotId,choice_a:a,choice_b:b,deadline:deadline+':00+05:30'},'An item poll is open. Live vote totals remain hidden.')}>Check alternatives and open item poll</Button>
   </fieldset></Card>}
  </div><aside><Card title="Keep the whole trip in view" tone="mint"><p>A hotel or activity vote changes one item. It does not approve a plan, book a stay or override someone’s hard limit.</p><Button variant="secondary" onClick={()=>go('plan')}>Back to one itinerary</Button><Button onClick={()=>go('review')}>Review current saved plan</Button></Card></aside></div>}
 </div>;
}
function ItemEditor({slot,selected,catalogue,disabled,save,vote}:{slot:ItinerarySlot;selected:string;catalogue:ItineraryState['catalogue']['choices'];disabled:boolean;save:(choice:string|null)=>void;vote:()=>void}){
 const [choice,setChoice]=useState(selected);useEffect(()=>setChoice(selected),[selected]);
 return <details><summary>Edit {slot.label.toLowerCase()}</summary><Field label={'Arrangement for '+slot.label}><select value={choice} disabled={disabled} onChange={e=>setChoice(e.target.value)}><option value="">No arrangement yet</option>{slot.choices.map(id=><option key={id} value={id}>{catalogue[id].title}</option>)}</select></Field><Actions><Button disabled={disabled||choice===selected} onClick={()=>save(choice||null)}>Save item</Button>{slot.choices.length>1&&<Button variant="secondary" disabled={disabled} onClick={vote}>Resolve this item with a vote</Button>}</Actions></details>;
}
function ItemCost({cost}:{cost:CostSnapshot}){return <div><strong>{costRange(cost.total)}</strong><p className="caption">INR · whole trip · illustrative · fees and 10% contingency included</p><details><summary>See my complete cost breakdown</summary>{cost.rows.map(row=><div className="member-row" key={row.label}><span>{row.label}</span><strong>{costRange(row.range)}</strong></div>)}</details></div>;}
