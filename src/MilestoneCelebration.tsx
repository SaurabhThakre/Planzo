import {createContext,useCallback,useContext,useEffect,useRef,useState} from 'react';
import type {CSSProperties,ReactNode} from 'react';
import {claimMilestone,milestoneCopy} from './milestones';
import type {Milestone} from './milestones';
import './milestones.css';
const CelebrationContext=createContext<(event:Milestone)=>void>(()=>{});
export const useMilestone=()=>useContext(CelebrationContext);
export function MilestoneProvider({children}:{children:ReactNode}){
 const [event,setEvent]=useState<Milestone|null>(null),seen=useRef(new Set<string>());
 const celebrate=useCallback((next:Milestone)=>{let storage;try{storage=window.sessionStorage;}catch{}if(claimMilestone(next,seen.current,storage))setEvent(next);},[]);
 useEffect(()=>{if(!event)return;const timer=window.setTimeout(()=>setEvent(null),6500);return()=>window.clearTimeout(timer);},[event]);
 return <CelebrationContext.Provider value={celebrate}>{children}{event&&<aside className="milestone-celebration" role="status" aria-live="polite" aria-atomic="true" key={event.kind+event.tripId+event.version}>
  <div className="milestone-sparkles" aria-hidden="true">{Array.from({length:12},(_,i)=><i key={i} style={{'--spark':i} as CSSProperties}/>)}</div>
  <span className="milestone-medal" aria-hidden="true">✓</span><div><strong>{milestoneCopy[event.kind].title}</strong><p>{milestoneCopy[event.kind].detail}</p></div>
  <button type="button" aria-label="Dismiss celebration" onClick={()=>setEvent(null)}>×</button>
 </aside>}</CelebrationContext.Provider>;
}
