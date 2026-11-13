import { useEffect, useRef, useState } from 'react';
import type { Workspace } from './backend';
import type { FlowState } from './flowBackend';
import { readableError } from './errors';
import { Actions, Button, Card, Field, Note } from './ui';
import { DateTimeField } from './DateTimeField';
import { flowMoney, flowStamp, instant, localDate, suggestPlanningRequests, validatePersonal } from './privatePlanning';
import type { PersonalInput,PlanningRequest } from './privatePlanning';
import {PlanningRequestEditor} from './PlanningRequestEditor';

const labels = ['Destination times', 'Budget', 'Preferences', 'Review your summary'];
const summary = labels.length - 1;

function initialInput(saved: FlowState['own'], windows: Workspace['windows']): PersonalInput {
  const old = saved?.content;
  if (old && saved?.confirmed) return { ...old, ai_consent: true, start: localDate(old.start), end: localDate(old.end) };
  const window = windows.find(option => option.id === old?.window_id) ?? windows[0];
  const keepTimes = old && window?.id === old.window_id;
  return {
    version: 3, origin: old?.origin ?? '', window_id: window?.id ?? '',
    start: keepTimes ? localDate(new Date(Date.parse(instant(old.start)) + (old.version === 3 ? 0 : old.outbound_minutes) * 60000).toISOString()) : window ? localDate(window.start) : '',
    end: keepTimes ? localDate(new Date(Date.parse(instant(old.end)) - (old.version === 3 ? 0 : old.return_minutes) * 60000).toISOString()) : window ? localDate(window.end) : '',
    outbound_minutes: 0, return_minutes: 0, travel_reserve_paise: 0,
    ceiling_paise: old?.ceiling_paise ?? 0, interests: old?.interests ?? [], places: old?.places ?? [],
    hard: old?.hard ?? '', soft: old?.soft ?? '', fictional: false, ai_consent: true,
  };
}

export function PrivateConversation({ workspace, state, onAct, busy, onDone, votingReadOnly = false }: {
  workspace: Workspace;
  state: FlowState;
  onAct: (action: string, payload: Record<string, unknown>) => Promise<void>;
  busy: boolean;
  votingReadOnly?: boolean;
  onDone: () => void;
}) {
  const saved = state.own;
  const [input, setInput] = useState(() => initialInput(saved, workspace.windows));
  const [step, setStep] = useState(saved?.confirmed ? summary : 0);
  const [budget, setBudget] = useState(saved ? String(saved.content.ceiling_paise / 100) : '');
  const [error, setError] = useState('');
  const [editingDates, setEditingDates] = useState<string[]>([]);
  const [ack, setAck] = useState(false);
  const [requestEdits,setRequestEdits]=useState<PlanningRequest[]|null>(null);
  const [reopenAck, setReopenAck] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const inactive = ['archived', 'postponed'].includes(state.stage);
  const frozen = busy || saved?.confirmed || inactive;
  const window = workspace.windows.find(option => option.id === input.window_id);
  const samePreferences = saved?.content.hard === input.hard && saved?.content.soft === input.soft;
  const requests = requestEdits ?? (samePreferences && saved?.content.requests
    ? saved.content.requests
    : suggestPlanningRequests(input.hard, input.soft));

  useEffect(() => { heading.current?.focus(); }, [step]);

  function update(patch: Partial<PersonalInput>) {
    setInput(previous => ({ ...previous, ...patch }));
    if(patch.hard!==undefined||patch.soft!==undefined)setRequestEdits(null);
    setAck(false);
    setError('');
  }

  function editDate(id: string, open: boolean) {
    setEditingDates(previous => open ? [...new Set([...previous, id])] : previous.filter(value => value !== id));
  }

  function navigate(next: number) {
    setError('');
    setStep(next);
  }

  async function confirm() {
    if (frozen || !ack || editingDates.length) return;
    const start = Date.parse(instant(input.start));
    const end = Date.parse(instant(input.end));
    const paise = Math.round(Number(budget) * 100);
    if (!input.origin.trim() || !window || !Number.isFinite(start) || !Number.isFinite(end)
      || start < Date.parse(instant(window.start)) || end > Date.parse(instant(window.end)) || end <= start) {
      setStep(0);
      setError('Enter your starting city and choose arrival and departure times inside the trip dates.');
      return;
    }
    if (budget.trim() === '' || !Number.isSafeInteger(paise) || paise < 100 || paise > 10000000000) {
      setStep(1);
      setError('Enter a whole-trip budget of at least ₹1.');
      return;
    }
    if (!input.hard.trim() || !input.soft.trim()) {
      setStep(2);
      setError('Fill in both preferences, using “None” when you have no requirement or preference.');
      return;
    }
    let value: PersonalInput;
    try {
      value = validatePersonal({ ...input, ceiling_paise: paise, requests, requests_reviewed: true }, workspace.windows);
    } catch (failure) {
      setStep(2);
      setError(readableError(failure));
      return;
    }
    try {
      await onAct('confirm_input', {
        expected_input_revision: saved?.revision ?? 0,
        content: { ...value, version: 3 },
        acknowledged: true,
      });
      setAck(false);
    } catch (failure) {
      setError(readableError(failure));
    }
  }

  return <div className="conversation-layout private-input-layout">
    <Card title="My private input" sub={state.confirmed + ' of ' + state.included + ' travellers have confirmed.'}>
      <ol className="conversation-progress" aria-label="Private input sections">
        {labels.map((label, index) => <li key={label} aria-current={index === step ? 'step' : undefined}>
          <button type="button" disabled={busy || editingDates.length > 0} onClick={() => navigate(index)}>
            <span>{index + 1}</span>{label}
          </button>
        </li>)}
      </ol>
      <div className="guide-question">
        <span className="caption">Planzo guide</span>
        <h3 ref={heading} tabIndex={-1}>{labels[step]}</h3>
        <p className="small">{[
          'Choose your own times within the organiser’s trip dates.',
          'Include return travel, stays, food, activities, fees and contingency.',
          'Use one short request per line. Keep personal reasons and identifying details out of requests.',
          'Check your dates, budget and preferences before confirming.',
        ][step]}</p>
      </div>
      <fieldset className="auth-fields" disabled={Boolean(frozen)}>
        {step === 0 && <>
          <Field label="Starting city"><input value={input.origin} maxLength={80} autoComplete="off" onChange={event => update({ origin: event.target.value })}/></Field>
          {workspace.windows.length === 1
            ? <p><strong>Trip dates</strong><br/>{flowStamp(workspace.windows[0].start)} → {flowStamp(workspace.windows[0].end)} IST</p>
            : <Field label="Trip date option"><select value={input.window_id} disabled={editingDates.length > 0} onChange={event => {
              const option = workspace.windows.find(value => value.id === event.target.value);
              if (option) update({ window_id: option.id, start: localDate(option.start), end: localDate(option.end) });
            }}>{workspace.windows.map(option => <option key={option.id} value={option.id}>{flowStamp(option.start)} → {flowStamp(option.end)} IST</option>)}</select></Field>}
          <DateTimeField label={saved?.confirmed && input.version !== 3 ? 'My saved earliest home departure' : 'My arrival at the destination'} value={input.start}
            min={window ? localDate(window.start) : undefined} max={window ? localDate(window.end) : undefined}
            onChange={start => update({ start })} onEditingChange={open => editDate('start', open)}/>
          <DateTimeField label={saved?.confirmed && input.version !== 3 ? 'My saved latest home return' : 'My departure from the destination'} value={input.end}
            min={window ? localDate(window.start) : undefined} max={window ? localDate(window.end) : undefined}
            onChange={end => update({ end })} onEditingChange={open => editDate('end', open)}/>
        </>}
        {step === 1 && <Field label="Whole-trip budget (INR)">
          <input type="number" inputMode="decimal" min="1" step="0.01" value={budget} onChange={event => { setBudget(event.target.value); setAck(false); setError(''); }}/>
        </Field>}
        {step === 2 && <>
          <Field label="Must-haves"><textarea rows={4} maxLength={1500} value={input.hard} onChange={event => update({ hard: event.target.value })} placeholder="For example: Visit Fort Aguada. Enter None if you have no must-haves."/></Field>
          <Field label="Flexible preferences"><textarea rows={4} maxLength={1500} value={input.soft} onChange={event => update({ soft: event.target.value })} placeholder="For example: A relaxed beach afternoon. Enter None if you have no preferences."/></Field>
        </>}
      </fieldset>
      {step === summary && <>
        <dl className="personal-summary">
          <dt>Starting city</dt><dd>{input.origin || 'Add your city'}</dd>
          <dt>{input.version === 3 ? 'My destination availability' : 'My saved home travel availability'}</dt>
          <dd>{input.start && input.end ? flowStamp(input.start) + ' → ' + flowStamp(input.end) + ' IST' : 'Choose dates'}</dd>
          <dt>Whole-trip budget</dt><dd>{budget === '' ? 'Add your budget' : flowMoney(Math.round(Number(budget) * 100))}</dd>
          <dt>Must-haves</dt><dd className="preserve-lines">{input.hard || 'Add your must-haves'}</dd>
          <dt>Flexible preferences</dt><dd className="preserve-lines">{input.soft || 'Add your preferences'}</dd>
        </dl>
        {!saved?.confirmed && !inactive && <>
          <PlanningRequestEditor requests={requests} disabled={Boolean(frozen)} onChange={next=>{setRequestEdits(next);setAck(false);setError('');}}/>
          <label className="check"><input type="checkbox" checked={ack} disabled={busy} onChange={event => setAck(event.target.checked)}/>I reviewed my summary and agree to share the planning requests described above.</label>
          <Button disabled={!ack || busy} onClick={() => void confirm()}>{busy ? 'Saving…' : 'Confirm my private summary'}</Button>
        </>}
        {saved?.confirmed && <Note title="Your personal summary is confirmed" tone="mint">
          {(inactive || votingReadOnly) ? 'These saved answers are read-only.' : 'Reopen your input to change it. The group will need a fresh plan and review.'}
        </Note>}
        {saved?.confirmed && !inactive && !votingReadOnly && <details>
          <summary>Edit my confirmed answers</summary>
          <label className="check"><input type="checkbox" checked={reopenAck} disabled={busy} onChange={event => setReopenAck(event.target.checked)}/>I understand that editing requires fresh planning and group review.</label>
          <Button disabled={busy || !reopenAck} onClick={async () => {
            try {
              await onAct('reopen_input', { expected_input_revision: saved.revision, acknowledged: true });
              navigate(0);
            } catch (failure) {
              setError(readableError(failure));
            }
          }}>Reopen my private input</Button>
        </details>}
      </>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <Actions>
        {step > 0 && <Button variant="secondary" disabled={busy || editingDates.length > 0} onClick={() => navigate(step - 1)}>Back</Button>}
        {step < summary && <Button disabled={busy || editingDates.length > 0} onClick={() => navigate(step + 1)}>Continue</Button>}
        <Button variant="ghost" disabled={busy || editingDates.length > 0} onClick={onDone}>Trip overview</Button>
      </Actions>
    </Card>
  </div>;
}
