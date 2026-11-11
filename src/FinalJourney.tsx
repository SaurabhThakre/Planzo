import { routeStamp, routeTimeLabel, routeBadge } from './routePlanning';
import { ContextualStepDetails, StepPrice } from './ContextualStepDetails';
import { contextualStepLabel } from './contextualPlanning';
import { itineraryDays, itineraryDayTitle } from './ItineraryDays';
import type { FlowDocument, PersonalInput } from './privatePlanning';
import { flowMoney } from './privatePlanning';
import { Card, ItineraryTypeBadge } from './ui';
import { useId, useState } from 'react';
import { ItineraryDayTabs } from './ItineraryDayTabs';

export function FinalJourney({ document, own, total }: {
  document: FlowDocument; own?: PersonalInput; total: number;
}) {
  const days = [...itineraryDays(document.steps, document.route?.time_zone)];
  const [selectedDay, setSelectedDay] = useState('');
  const currentIndex = Math.max(0, days.findIndex(([day]) => day === selectedDay));
  const [date, steps] = days[currentIndex] || ['', []];
  const panelId = useId();
  return <div className="stack final-itinerary-journey">
    <ItineraryDayTabs days={days.map(([day])=>day)} currentIndex={currentIndex} onSelect={index=>setSelectedDay(days[index][0])} panelId={panelId} label="Locked itinerary days"/>
    {date && <section id={panelId} role="tabpanel" aria-labelledby={panelId+'-tab-'+currentIndex}>
    <Card title={itineraryDayTitle(date, currentIndex)}>
      <ol className="final-journey">{steps.map(step => {
        return <li key={step.id}>
        <span className="journey-dot" aria-hidden="true"/>
        <div>
          <ItineraryTypeBadge kind={routeBadge(step, document.refs)}/>
          <h3>{contextualStepLabel(step, document.refs)}{step.ref.endsWith('_alternative') ? ' · alternative arrangement' : ''}</h3>
          <p>{routeStamp(step.start, document)} → {routeStamp(step.end, document)} {routeTimeLabel(document)}</p>
          <ContextualStepDetails step={step} refs={document.refs}/>
          <StepPrice step={step} document={document}/>
        </div>
      </li>;
      })}</ol>
    </Card></section>}
    <Card title="Planning estimate" sub="Estimated total per person">
      <p className="remaining-budget">{flowMoney(own ? total : document.cost_paise)}</p>
      {own && <p className="small">Remaining within your trip budget · {flowMoney(Math.max(0, own.ceiling_paise - total))}</p>}
    </Card>
  </div>;
}
