import {useId,useState} from 'react';
import type {FlowDocument,PersonalInput} from './privatePlanning';
import {flowMoney} from './privatePlanning';
import {routeStamp,routeTimeLabel} from './routePlanning';
import {itineraryDays,itineraryDayTitle} from './ItineraryDays';
import {ItineraryDayTabs} from './ItineraryDayTabs';
import {ItineraryStopRow} from './ItineraryStopRow';
import {MyRequirements} from './MyRequirements';
import type {OwnRequirementCheck} from './requirementCoverage';
import {Button,Card} from './ui';
export function FinalJourney({document,own,total,checks,onBookings}:{document:FlowDocument;own?:PersonalInput;total:number;checks?:OwnRequirementCheck[];onBookings:()=>void}){
 const days=[...itineraryDays(document.steps,document.route?.time_zone)],panelId=useId(),[selectedDay,setSelectedDay]=useState('');
 const currentIndex=Math.max(0,days.findIndex(([day])=>day===selectedDay)),[date,steps]=days[currentIndex]||['',[]];
 return <div className="stack final-itinerary-journey">
  <Card title="Locked itinerary" sub={routeStamp(document.start,document)+' → '+routeStamp(document.end,document)+' '+routeTimeLabel(document)}>
   <div className="flow-days"><ItineraryDayTabs days={days.map(([day])=>day)} currentIndex={currentIndex} onSelect={index=>setSelectedDay(days[index][0])} panelId={panelId} label="Locked itinerary days"/>
    {date&&<section className="day-panel" id={panelId} role="tabpanel" aria-labelledby={panelId+'-tab-'+currentIndex}><h3>{itineraryDayTitle(date,currentIndex)}</h3><ol className="stop-summary">{steps.map((step,index)=><li key={step.id}><ItineraryStopRow step={step} index={index} document={document} refs={document.refs}/></li>)}</ol></section>}
   </div><Button variant="secondary" onClick={onBookings}>Open Bookings</Button>
  </Card>
  <Card title="Planning estimate" sub="Estimated total per person"><p className="remaining-budget">{flowMoney(own?total:document.cost_paise)}</p>{own&&<p className="small">Remaining within your trip budget · {flowMoney(Math.max(0,own.ceiling_paise-total))}</p>}</Card>
  <MyRequirements checks={checks} document={document} expected={own?.requests?.length}/>
 </div>;
}
