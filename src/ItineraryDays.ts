import { destinationDay } from './routePlanning';
import type { FlowStep } from './privatePlanning';

export function itineraryDays<T extends Pick<FlowStep, 'start'>>(steps: readonly T[], zone?: string) {
  const days = new Map<string, T[]>();
  for (const step of steps) {
    const day = destinationDay(step.start, zone);
    const items = days.get(day);
    if (items) items.push(step);
    else days.set(day, [step]);
  }
  return days;
}

export function itineraryDayTitle(day: string, index: number) {
  return 'Day ' + (index + 1) + ' · ' + new Date(day + 'T12:00:00Z')
    .toLocaleDateString('en-IN', { timeZone: 'UTC', dateStyle: 'long' });
}
