import {useState} from 'react';
import type {Workspace} from './backend';
import {Button,Icon} from './ui';

export function TripWorkspaceNav({workspace:w,tab,busy,go,onRefresh}:{workspace:Workspace;tab:string;busy:boolean;go:(tab?:string)=>void;onRefresh:()=>void}){
 const [collapsed,setCollapsed]=useState(false),[mobileOpen,setMobileOpen]=useState(false);
 const tabs=w.trip.workflow_version===2?['plan','voting',...(w.trip.stage==='agreed'?['journey']:[])]:['plan','voting','review','bookings'];
 const label=(id:string)=>id==='plan'?'Itinerary':id==='voting'?'Step decisions':id==='journey'?'Final journey':id==='bookings'?'Booking handoff':'Review & confirm';
 const open=(next?:string)=>{setMobileOpen(false);go(next);};
 return <aside className={'trip-workspace-nav '+(collapsed?'collapsed ':'')+(mobileOpen?'mobile-open':'')}>
  <div className="workspace-nav-head"><button className="workspace-menu-button" aria-expanded={mobileOpen} onClick={()=>setMobileOpen(x=>!x)}>Trip menu</button><button className="workspace-collapse" aria-label={collapsed?'Expand trip navigation':'Collapse trip navigation'} onClick={()=>setCollapsed(x=>!x)}>{collapsed?'→':'←'}</button></div>
  <nav aria-label="Trip navigation">
   <button aria-label="Overview" title={collapsed?"Overview":undefined} className={!tab?'active':''} aria-current={!tab?'page':undefined} onClick={()=>open()}><Icon name="home"/><span>Overview</span></button>
   {tabs.map(id=><button key={id} aria-label={label(id)} title={collapsed?label(id):undefined} className={tab===id||(id==='bookings'&&tab==='journey')?'active':''} aria-current={tab===id?'page':undefined} onClick={()=>open(id)}><Icon name={id==='plan'?'map':id==='voting'?'people':id==='journey'?'plane':id==='bookings'?'wallet':'check'}/><span>{label(id)}</span></button>)}
   <button aria-label="My private input" title={collapsed?"My private input":undefined} className={tab==='preferences'?'active':''} aria-current={tab==='preferences'?'page':undefined} onClick={()=>open('preferences')}><Icon name="lock"/><span>My private input</span></button>
  </nav>
  <div className="workspace-nav-utilities">
   <button aria-label="History" title={collapsed?"History":undefined} aria-current={tab==='history'?'page':undefined} onClick={()=>open('history')} className={tab==='history'?'active':''}><Icon name="clock"/><span>History</span></button>
   <button aria-label="All trips" title={collapsed?"All trips":undefined} onClick={()=>{setMobileOpen(false);go('all-trips')}}><Icon name="home"/><span>All trips</span></button>
   <Button variant="ghost" disabled={busy} aria-label="Refresh" title={collapsed?"Refresh":undefined} onClick={onRefresh}><Icon name="clock"/><span>Refresh</span></Button>
  </div>
 </aside>;
}

export function TripWorkspaceHeader({workspace:w,instruction}:{workspace:Workspace;instruction:string}){
 const first=w.windows[0];
 const date=(value:string)=>new Date(value).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric',timeZone:'Asia/Kolkata'});
 return <header className="trip-workspace-header"><div><span className="eyebrow">{w.trip.destination}</span><h1>{w.trip.name}</h1><p>{instruction}</p></div><dl><div><dt>Tentative date option</dt><dd>{first?date(first.start)+' – '+date(first.end):'Dates pending'}</dd></div><div><dt>Stage</dt><dd>{w.trip.stage}</dd></div></dl></header>;
}
