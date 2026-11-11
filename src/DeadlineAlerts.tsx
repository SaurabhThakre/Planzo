import { useEffect, useState } from 'react';
import { supabase } from './backend';
import { flowStamp } from './privatePlanning';
import { Button, Note } from './ui';

type Reminder = { id: string; name: string; response_deadline: string };
const leadTime = 24 * 60 * 60 * 1000;

export function DeadlineAlerts({ userId, tripId, revision }: { userId: string; tripId?: string; revision?: number }) {
  const [reminders, setReminders] = useState<Reminder[]>([]);
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
  return visible.length > 0 && <section className="deadline-alerts" aria-label="Response deadline reminders" aria-live="polite">
    {visible.map(reminder => <Note key={key(reminder)} title={'Response deadline soon · ' + reminder.name} tone="cream">
      <p>Due {flowStamp(reminder.response_deadline)} IST. <a href={'#/trip/' + reminder.id}>Open trip</a></p>
      <Button variant="ghost" onClick={() => {
        const id = key(reminder);
        setDismissed(previous => new Set([...previous, id]));
        try { localStorage.setItem(id, '1'); } catch { /* Dismissed for this session. */ }
      }}>Dismiss reminder</Button>
    </Note>)}
  </section>;
}
