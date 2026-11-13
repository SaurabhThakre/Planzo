import {useEffect,useState} from 'react';
import type {Workspace} from './backend';
import {flowApi} from './flowBackend';
import type {FlowState} from './flowBackend';
import {tripProgress} from './tripProgress';
import {Button} from './ui';
import './planningClarity.css';
export function TripProgressPanel({workspace,userId,go}:{workspace:Workspace;userId:string;go:(tab:string)=>void}){
 const[state,setState]=useState<FlowState|null>(null),[error,setError]=useState(false),[refresh,setRefresh]=useState(0);
 useEffect(()=>{let alive=true,sequence=0;setState(null);setError(false);const load=async()=>{const current=++sequence;try{const next=await flowApi('get',{trip_id:workspace.trip.id});if(alive&&current===sequence){setState(next);setError(false);}}catch{if(alive&&current===sequence)setError(true);}};void load();const focus=()=>{if(document.visibilityState==='visible')void load();};const timer=window.setInterval(focus,15000);window.addEventListener('focus',focus);return()=>{alive=false;clearInterval(timer);window.removeEventListener('focus',focus);};},[workspace.trip.id,workspace.trip.revision,userId,refresh]);
 const progress=tripProgress(workspace,userId,state);
 const name=(id:string)=>{const m=progress.members.find(m=>m.id===id)!;return m.name+(progress.members.filter(x=>x.name===m.name).length>1?' · '+(progress.members.indexOf(m)+1):'')+(id===userId?' (you)':'');};
 return <section className={'trip-progress-panel '+progress.tone} aria-labelledby="trip-next-heading">
  <div className="trip-progress-copy"><span className="eyebrow">What happens next</span><h2 id="trip-next-heading">{error?'Check your trip progress':progress.title}</h2><p>{error?'Progress could not refresh. Your saved input is kept.':progress.body}</p></div>
  <div className="trip-progress-actions"><Button onClick={()=>go(progress.tab)}>{progress.action}</Button><Button variant="ghost" onClick={()=>setRefresh(n=>n+1)}>Refresh status</Button></div>
  <div className="trip-input-progress"><strong>{progress.confirmed} of {progress.total} private inputs confirmed</strong><progress max={Math.max(1,progress.total)} value={progress.confirmed} aria-label="Private inputs confirmed"/>{progress.pending.length>0&&<p><span>Waiting on: </span>{progress.pending.map(m=>name(m.id)).join(', ')}</p>}</div>
 </section>;
}
