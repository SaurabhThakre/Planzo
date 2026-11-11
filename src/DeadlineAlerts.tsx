import { useEffect, useState } from 'react';
import { supabase } from './backend';
import { flowStamp } from './privatePlanning';
import { Icon } from './ui';

type Reminder = { id: string; name: string; response_deadline: string };
const leadTime = 24 * 60 * 60 * 1000;
const deadlineLabel = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

export function DeadlineAlerts({ userId, tripId, revision }: { userId: string; tripId?: string; revision?: number }) {
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [selectedReminder, setSelectedReminder] = useState<string>();
  const [dismissed, setDismissed] = useState(new Set<string>());
  const key = (reminder: Reminder) => 'planzo.deadline.' + userId + '.' + reminder.id + '.' + reminder.response_deadline;

  useEffect(() => {
    let stopped = false;
    let loading = false;
    async function refresh() {
      if (loading || document.visibilityState !== 'visible') return;
      loading = true;
      try {
        const now = Date.now();
        const { data, error } = await supabase.from('planzo_trips')
          .select('id,name,response_deadline')
          .in('stage', ['collecting', 'planning', 'reviewing', 'revise'])
          .gt('response_deadline', new Date(now).toISOString())
          .lte('response_deadline', new Date(now + leadTime).toISOString())
          .order('response_deadline');
        if (!stopped && !error) setReminders(data ?? []);
      } catch {
        // A failed background poll must not interrupt planning.
      } finally {
        loading = false;
      }
    }
    void refresh();
    const timer = window.setInterval(refresh, 30000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [userId, tripId, revision]);

  const visible = reminders.filter(reminder => {
    const id = key(reminder);
    if (Date.parse(reminder.response_deadline) <= Date.now() || dismissed.has(id)) return false;
    try { return !localStorage.getItem(id); } catch { return true; }
  });
  const index = Math.max(0, visible.findIndex(reminder => key(reminder) === selectedReminder));
  const reminder = visible[index];
  if (!reminder) return null;
  const reminderKey = key(reminder);
  return (
    <section className="deadline-alerts" aria-label="Response deadline reminders" aria-live="polite">
      <Icon name="clock"/>
      <strong className="deadline-trip" title={reminder.name}>{reminder.name}</strong>
      <time dateTime={reminder.response_deadline} title={flowStamp(reminder.response_deadline) + ' IST'}>
        Due {deadlineLabel.format(new Date(reminder.response_deadline))} IST
      </time>
      <a href={'#/trip/' + reminder.id} aria-label={'Open trip: ' + reminder.name}>Open trip</a>
      {visible.length > 1 && (
        <button type="button" title="Show next reminder"
          aria-label={'Show next reminder (' + (index + 1) + ' of ' + visible.length + ')'}
          onClick={() => setSelectedReminder(key(visible[(index + 1) % visible.length]))}>
          {index + 1}/{visible.length}
        </button>
      )}
      <button type="button" className="deadline-dismiss" aria-label="Dismiss reminder" title="Dismiss reminder" onClick={() => {
        setDismissed(previous => new Set([...previous, reminderKey]));
        try { localStorage.setItem(reminderKey, '1'); } catch { /* Dismissed for this session. */ }
      }}>×</button>
    </section>
  );
}
