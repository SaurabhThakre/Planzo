import {useState} from 'react';
import type {Workspace} from './backend';
import {Button,Icon} from './ui';
import {flowStamp} from './privatePlanning';
import {planStage} from './planningBackend';

export function TripWorkspaceNav({workspace:w,tab,busy,go,onRefresh}:{workspace:Workspace;tab:string;busy:boolean;go:(tab?:string)=>void;onRefresh:()=>void}){
 const [collapsed,setCollapsed]=useState(false),[mobileOpen,setMobileOpen]=useState(false);
 const tabs=w.trip.workflow_version===2?['plan',...(w.trip.stage==='agreed'?['journey','bookings','payments']:[])]:['plan','voting','review','bookings'];
 const label=(id:string)=>id==='payments'?'Payments':id==='plan'?'Itinerary':id==='voting'?'Step decisions':id==='journey'?'Final journey':id==='bookings'?(w.trip.workflow_version===2?'Bookings':'Booking handoff'):'Review & confirm';
 const open=(next?:string)=>{setMobileOpen(false);go(next);};
 return <aside className={'trip-workspace-nav '+(collapsed?'collapsed ':'')+(mobileOpen?'mobile-open':'')}>
  <div className="workspace-nav-head"><button className="workspace-menu-button" aria-expanded={mobileOpen} onClick={()=>setMobileOpen(x=>!x)}>Trip menu</button><button className="workspace-collapse" aria-label={collapsed?'Expand trip navigation':'Collapse trip navigation'} onClick={()=>setCollapsed(x=>!x)}>{collapsed?'→':'←'}</button></div>
  <nav aria-label="Trip navigation">
   <button aria-label="Overview" title={collapsed?"Overview":undefined} className={!tab?'active':''} aria-current={!tab?'page':undefined} onClick={()=>open()}><Icon name="home"/><span>Overview</span></button>
   <button aria-label="My private input" title={collapsed?"My private input":undefined} className={tab==='preferences'?'active':''} aria-current={tab==='preferences'?'page':undefined} onClick={()=>open('preferences')}><Icon name="lock"/><span>My private input</span></button>
   {tabs.map(id=><button key={id} aria-label={label(id)} title={collapsed?label(id):undefined} className={tab===id||(id==='plan'&&(tab==='voting'||w.trip.workflow_version===2&&tab==='review'))||(w.trip.workflow_version!==2&&id==='bookings'&&tab==='journey')?'active':''} aria-current={tab===id||(id==='plan'&&(tab==='voting'||w.trip.workflow_version===2&&tab==='review'))?'page':undefined} onClick={()=>open(id)}><Icon name={id==='plan'?'map':id==='voting'?'people':id==='journey'?'plane':(id==='bookings'||id==='payments')?'wallet':'check'}/><span>{label(id)}</span></button>)}

  </nav>
  <div className="workspace-nav-utilities">
   <button aria-label="History" title={collapsed?"History":undefined} aria-current={tab==='history'?'page':undefined} onClick={()=>open('history')} className={tab==='history'?'active':''}><Icon name="clock"/><span>History</span></button>
   <button aria-label="All trips" title={collapsed?"All trips":undefined} onClick={()=>{setMobileOpen(false);go('all-trips')}}><Icon name="home"/><span>All trips</span></button>
   <Button variant="ghost" disabled={busy} aria-label="Refresh" title={collapsed?"Refresh":undefined} onClick={onRefresh}><Icon name="clock"/><span>Refresh</span></Button>
  </div>
 </aside>;
}

export function TripWorkspaceHeader({workspace:w,instruction}:{workspace:Workspace;instruction:string}){
 const stage=w.trip.removal_kind?.startsWith('deleted_')?'Deleted':w.trip.workflow_version===2&&w.trip.stage==='agreed'?'Trip agreed · itinerary locked':planStage(w.trip.stage);
 return <header className="trip-workspace-header">
  <div>{w.trip.destination.trim().toLowerCase()!==w.trip.name.trim().toLowerCase()&&<span className="eyebrow">{w.trip.destination}</span>}<h1>{w.trip.name}</h1>{instruction&&<p>{instruction}</p>}</div>
  <dl><div><dt>{w.windows.length===1?'Trip dates':'Date options'}</dt><dd>{w.windows.length?w.windows.map(window=><p key={window.id}>{flowStamp(window.start)} → {flowStamp(window.end)} IST</p>):'Dates pending'}</dd></div><div><dt>Stage</dt><dd>{stage}</dd></div></dl>
 </header>;
}
