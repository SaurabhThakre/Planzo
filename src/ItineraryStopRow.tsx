import type {FlowDocument,FlowRef,FlowStep} from './privatePlanning';
import {contextualStepLabel} from './contextualPlanning';
import {routeBadge,routeStamp,routeTimeLabel} from './routePlanning';
import {Badge,ItineraryTypeBadge} from './ui';
export function ItineraryStopRow({step,index,document,refs,pending=false,onSelect}:{step:FlowStep;index:number;document:FlowDocument;refs:FlowRef[];pending?:boolean;onSelect?:()=>void}){
 const copy=<><span className="stop-number">{index+1}</span><span className="stop-copy"><ItineraryTypeBadge kind={routeBadge(step,refs)}/><strong>{contextualStepLabel(step,refs)}{step.ref.endsWith('_alternative')?' · revised arrangement':''}</strong><small>{routeStamp(step.start,document)} → {routeStamp(step.end,document)} {routeTimeLabel(document)}</small>{pending&&<Badge tone="pending">Decision pending</Badge>}</span></>;
 return onSelect?<button id={'itinerary-step-'+step.id} onClick={onSelect}>{copy}<span aria-hidden="true">→</span></button>:<div className="itinerary-static-row">{copy}</div>;
}
