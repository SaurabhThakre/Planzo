import { useEffect, useState } from 'react';
import type { Workspace } from './backend';
import { flowApi } from './flowBackend';
import type { FlowState } from './flowBackend';
import { Button, Card } from './ui';

export function planningProgress(state: FlowState) {
  const plan = state.plan;
  const inputs = state.included > 0 && state.confirmed === state.included && !state.blocker;
  const pending = state.polls.filter(poll => ['open', 'unresolved'].includes(poll.status)).length;
  const decisions = Boolean(plan && !pending && !state.personal_checks_pending && !plan.document.unplaced.length);
  const review = decisions && !plan?.requirements_legacy;
  const allReady = Boolean(plan && plan.review_count === state.included && review);
  return { plan, inputs, pending, decisions, review, allReady };
}

export function PlanningNavigation({ state, tab, go }: {
  state: FlowState; tab: string; go: (tab: string) => void;
}) {
  const { plan, inputs, decisions, review, allReady } = planningProgress(state);
  const privateAvailable = !inputs || !plan;
  const stages = [
    { key: 'preferences', title: 'Private inputs', done: inputs, available: privateAvailable, pending: 'Inputs confirmed' },
    { key: 'plan', title: 'Shared itinerary', done: Boolean(plan), available: true, pending: '' },
    { key: 'voting', title: 'Step decisions', done: decisions, available: Boolean(plan), pending: 'Available after an itinerary is ready' },
    { key: 'review', title: 'Personal review', done: allReady, available: review, pending: plan?.requirements_legacy ? 'Available after inputs are refreshed' : 'Available after step decisions and requirements are resolved' },
    { key: 'journey', title: 'Locked', done: Boolean(plan?.locked), available: Boolean(plan?.locked), pending: 'Available after the organiser locks the plan' },
  ];
  return <nav aria-label="Itinerary stages" className="planning-stages">
    <p className="caption">Tell us what works → Pick together → Say yes or no</p>
    <ol>{stages.map(stage => <li key={stage.key}>
      {stage.available
        ? <Button variant={tab === stage.key ? 'primary' : 'secondary'} aria-current={tab === stage.key ? 'step' : undefined} onClick={() => go(stage.key)}>
          {stage.done && <span aria-label="Complete">✓</span>}{stage.title}
        </Button>
        : <span className="planning-stage-unavailable" title={stage.pending}>
          {stage.done ? '✓ ' : ''}{stage.title}<small>{stage.pending}</small>
        </span>}
    </li>)}</ol>
  </nav>;
}

export function TripPassport({ workspace, userId, go }: { workspace: Workspace; userId: string; go: (tab: string) => void }) {
  const [state, setState] = useState<FlowState | null>(null);
  const { id, revision } = workspace.trip;
  useEffect(() => {
    let active = true;
    const read = async () => {
      try {
        const result = await flowApi('get', { trip_id: id });
        if (active) setState(result);
      } catch { /* The roster summary remains available. */ }
    };
    void read();
    const refresh = () => { if (document.visibilityState === 'visible') void read(); };
    const timer = window.setInterval(refresh, 15000);
    window.addEventListener('focus', refresh);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [id, revision, userId]);
  const own = workspace.members.find(member => member.id === userId);
  const organiser = own?.role === 'organiser';
  const progress = state && planningProgress(state);
  const archived = ['archived', 'postponed'].includes(workspace.trip.stage);
  const steps = [
    ['Private inputs', Boolean(progress?.inputs)],
    ['Shared itinerary', Boolean(progress?.plan)],
    ['Step decisions', Boolean(progress?.decisions)],
    ['Personal review', Boolean(progress?.allReady)],
    ['Locked', Boolean(progress?.plan?.locked)],
  ] as const;
  const next = steps.findIndex(([, done]) => !done);
  const label = progress?.plan?.locked ? 'Open final journey'
    : !own?.confirmed && own?.included ? 'Add my private input'
    : progress?.pending ? 'Open step decisions'
    : progress?.review && !progress.plan?.reviewed && own?.included ? 'Review the itinerary'
    : progress?.allReady && organiser ? 'Lock the itinerary'
    : progress?.inputs && !progress.plan && organiser ? 'Generate the itinerary'
    : 'See itinerary progress';
  const tab = progress?.plan?.locked ? 'journey' : !own?.confirmed && own?.included ? 'preferences'
    : progress?.pending ? 'voting' : progress?.review ? 'review' : 'plan';
  return <Card title="Trip passport" titleIcon="map">
    <ol className="passport-steps">{steps.map(([title, done], i) =>
      <li key={title} aria-current={next === i && !archived ? 'step' : undefined}>
        <span aria-hidden="true">{done ? '✓' : i + 1}</span>{title}
        <small>{done ? 'Complete' : next === i && !archived ? 'Next' : 'Upcoming'}</small>
      </li>)}</ol>
    <Button variant="secondary" onClick={() => go(archived ? 'history' : tab)}>{archived ? 'Open History' : label}</Button>
  </Card>;
}
