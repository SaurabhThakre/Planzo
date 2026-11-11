import { destinationDay, routeStamp, routeTimeLabel, routeBadge } from './routePlanning';
import { ContextualStepDetails, StepPrice } from './ContextualStepDetails';
import { contextualStepLabel } from './contextualPlanning';
import { itineraryDays, itineraryDayTitle } from './ItineraryDays';
import type { FlowDocument, PersonalInput } from './privatePlanning';
import { flowMoney } from './privatePlanning';
import { Button, Card, ItineraryTypeBadge } from './ui';
import { useId, useState } from 'react';
import { ItineraryDayTabs } from './ItineraryDayTabs';

export function FinalJourney({ document, own, total, onBookings }: {
  document: FlowDocument; own?: PersonalInput; total: number; onBookings: () => void;
}) {
  const timeZone = document.route?.time_zone || 'Asia/Kolkata';
  const days = [...itineraryDays(document.steps, timeZone)];
  const clock = new Intl.DateTimeFormat('en-IN', { timeZone, timeStyle: 'short' });
  const [selectedDay, setSelectedDay] = useState('');
  const currentIndex = Math.max(0, days.findIndex(([day]) => day === selectedDay));
  const [date, steps] = days[currentIndex] || ['', []];
  const panelId = useId();
  return <div className="stack final-itinerary-journey">
    <div className="final-journey-toolbar">
      <ItineraryDayTabs days={days.map(([day])=>day)} currentIndex={currentIndex} onSelect={index=>setSelectedDay(days[index][0])} panelId={panelId} label="Locked itinerary days"/>
      <Button variant="secondary" onClick={onBookings}>Open Bookings</Button>
    </div>
    {date && (
      <section id={panelId} role="tabpanel" aria-labelledby={panelId+'-tab-'+currentIndex}>
        <Card className="final-journey-day">
          <div className="final-journey-heading">
            <h2>{itineraryDayTitle(date, currentIndex)}</h2>
            <span className="caption muted">Times in {routeTimeLabel(document)}</span>
          </div>
          <ol className="final-journey">
            {steps.map(step => {
              const overnight = destinationDay(step.end, timeZone) !== date;
              return (
                <li key={step.id}>
                  <span className="journey-dot" aria-hidden="true"/>
                  <div className="journey-stop">
                    <div className="journey-stop-heading">
                      <ItineraryTypeBadge kind={routeBadge(step, document.refs)}/>
                      <h3>{contextualStepLabel(step, document.refs)}{step.ref.endsWith('_alternative') ? ' · alternative arrangement' : ''}</h3>
                    </div>
                    <p className="small muted">
                      <time dateTime={step.start}>{clock.format(new Date(step.start))}</time>
                      {' → '}
                      <time dateTime={step.end}>{overnight ? routeStamp(step.end, document) : clock.format(new Date(step.end))}</time>
                    </p>
                    <StepPrice step={step} document={document}/>
                    <ContextualStepDetails step={step} refs={document.refs} collapsed/>
                  </div>
                </li>
              );
            })}
          </ol>
        </Card>
      </section>
    )}
    <Card className="final-journey-estimate">
      <div className="final-journey-heading">
        <h2>Planning estimate</h2>
        <p><strong className="remaining-budget">{flowMoney(own ? total : document.cost_paise)}</strong> <span className="small muted">per person</span></p>
      </div>
      {own && <p className="small">Remaining within your trip budget · {flowMoney(Math.max(0, own.ceiling_paise - total))}</p>}
    </Card>
  </div>;
}
