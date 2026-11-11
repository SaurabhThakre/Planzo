export function ItineraryDayTabs({ days, currentIndex, onSelect, panelId, label }: {
  days: string[]; currentIndex: number; onSelect: (index: number) => void; panelId: string; label: string;
}) {
  return <div className="day-tabs" role="tablist" aria-label={label}>
    {days.map((day, index) => <button key={day} type="button" role="tab" id={panelId+'-tab-'+index}
      aria-selected={currentIndex===index} aria-controls={panelId} tabIndex={currentIndex===index?0:-1}
      onClick={()=>{if(index!==currentIndex)onSelect(index);}} onKeyDown={event=>{
        const next=event.key==='ArrowRight'?(currentIndex+1)%days.length:event.key==='ArrowLeft'?(currentIndex+days.length-1)%days.length:event.key==='Home'?0:event.key==='End'?days.length-1:-1;
        if(next<0)return;event.preventDefault();if(next!==currentIndex)onSelect(next);
        event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
      }}>Day {index+1}<small>{new Date(day+'T12:00:00Z').toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'})}</small></button>)}
  </div>;
}
