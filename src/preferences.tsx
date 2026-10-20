import { useEffect, useState } from "react";
import type { Brief, Trip } from "./domain";
import { blankBrief, briefErrors, saveBrief } from "./domain";
import { Actions, Badge, Button, Card, Coast, Feature, Field, Note, money, windowText, } from "./ui";
import {AiPreferencePreview} from './AiPreferencePreview';
import type {InterpretPreferences} from './AiPreferencePreview';
export function Preferences({ trip, personId, act, onDone, live = false, readOnly = false, onSave, savedRevision = 0, onInterpret, }: {
    trip: Trip;
    personId: string;
    act?: (fn: (t: Trip) => void, message?: string) => boolean;
    onDone: () => void;
    live?: boolean;
    readOnly?: boolean;
    onSave?: (brief: Brief, confirm: boolean, expectedRevision: number) => Promise<number>;
    savedRevision?: number;
    onInterpret?: InterpretPreferences;
}) {
    const draftKey = "planzo.form." + trip.id + "." + personId;
    const [form, setForm] = useState<Brief>(() => {
        try {
            const saved = !live && sessionStorage.getItem(draftKey);
            if (saved)
                return JSON.parse(saved);
        }
        catch { }
        return structuredClone(trip.briefs[personId] || (live ? {
            ...blankBrief(trip), origin: "", ceiling: 0, windows: [], vegetarian: false,
            stars: { Relaxation: 0, Food: 0, Beach: 0, Culture: 0, Adventure: 0 },
        } : blankBrief(trip)));
    });
    const [loadedRevision, setLoadedRevision] = useState(savedRevision);
    const [saving, setSaving] = useState(false);
    const [consent, setConsent] = useState(false), [checked, setChecked] = useState(false), [voice, setVoice] = useState(false), [errors, setErrors] = useState<string[]>([]), [parsed, setParsed] = useState<{
        amount: number | null;
        message: string;
    } | null>(null);
    useEffect(() => {
        try {
            if (!live) sessionStorage.setItem(draftKey, JSON.stringify(form));
        }
        catch { }
    }, [draftKey, form, live]);
    const set = (data: Partial<Brief>) => {
        if (saving || readOnly) return;
        setForm((f) => ({ ...f, ...data }));
        setChecked(false);
    };
    function parse() {
        if (!consent) {
            setErrors([
                "Allow the local interpretation preview, or confirm manually.",
            ]);
            return;
        }
        const text = form.text.toLowerCase();
        const found = [
            ...text.matchAll(/(?:₹|rs\.?\s*|inr\s*|under\s+|budget\s+(?:of\s+)?)([\d,]+(?:\.\d+)?)\s*(k|thousand)?/g),
        ].map((m) => Number(m[1].replaceAll(",", "")) * (m[2] ? 1000 : 1));
        if (text.includes("eleven thousand"))
            found.push(11000);
        const amounts = [...new Set(found)];
        setParsed({
            amount: amounts.length === 1 && amounts[0] > 0 ? amounts[0] : null,
            message: amounts.length > 1
                ? "Different amounts were found. Enter your intended ceiling manually."
                : amounts.length === 1
                    ? "A possible ceiling was found. Apply it only after checking its scope."
                    : "No unambiguous amount was found. Your current structured values are unchanged.",
        });
    }
    async function save(confirm: boolean) {
        if (saving || readOnly) return;
        const errs = confirm ? briefErrors(trip, form) : [];
        if (confirm && !checked)
            errs.push("Confirm that you checked the dates, amount and requirements.");
        setErrors(errs);
        if (errs.length)
            return;
        if (onSave) {
            setSaving(true);
            try { const revision = await onSave(form, confirm, loadedRevision); setLoadedRevision(revision); if (confirm) onDone(); }
            catch (e) { setErrors([e instanceof Error ? e.message : "Your input could not be saved. Please retry."]); }
            finally { setSaving(false); }
            return;
        }
        if (act?.((t) => saveBrief(t, personId, form, confirm), confirm
            ? "Private input confirmed."
            : "Draft saved. It is not yet a confirmed planning input.")) {
            if (confirm)
                onDone();
        }
    }
    return (<div className="columns">
      <div>
        <Card title="My private brief" sub={live ? "Saved privately to your verified identity. Friends see completion status, not your raw limits." : "These fields belong to your current demo persona. Friends see completion status, not your raw limits."}>
          <fieldset className="stack" aria-label="Private input fields" disabled={readOnly || saving}>
          {readOnly&&<p className="notice">This trip is archived. Your saved private input is available to read.</p>}
          <Badge tone={trip.briefs[personId]?.confirmed ? "positive" : "pending"}>
            {trip.briefs[personId]?.confirmed
            ? "Confirmed input"
            : "Draft input"}
          </Badge>
          <Note title="Private to you">
            Friends and the organiser see completion status, not your raw budget
            or private reasons.
          </Note>
          {errors.length > 0 && (<div className="form-error" role="alert">
              <strong>Please check your brief</strong>
              <ul>
                {errors.map((e) => (<li key={e}>{e}</li>))}
              </ul>
            </div>)}
          <fieldset>
            <legend>Available travel windows · Asia/Kolkata</legend>
            {trip.windows.map((w) => (<label className="check-line" key={w.id}>
                <input type="checkbox" checked={form.windows.includes(w.id)} onChange={(e) => set({
                windows: e.target.checked
                    ? [...form.windows, w.id]
                    : form.windows.filter((x) => x !== w.id),
            })}/>
                <span>
                  {windowText(trip, w.id)}
                  <small>
                    {w.start.slice(11)} departure → {w.end.slice(11)} return
                  </small>
                </span>
              </label>))}
          </fieldset>
          <div className="field-grid">
            <Field label="Starting from" hint="The sample price catalogue supports Bengaluru. Other origins need a verified quote.">
              <input value={form.origin} onChange={(e) => set({ origin: e.target.value })} maxLength={80}/>
            </Field>
            <Field label="Whole-trip ceiling · INR" hint="Include travel from home, all selected costs, fees and contingency.">
              <input type="number" min="1" max="1000000" value={form.ceiling || ""} onChange={(e) => set({ ceiling: Number(e.target.value) })}/>
            </Field>
          </div>
          <fieldset>
            <legend>Hard requirements</legend>
            <label className="check-line">
              <input type="checkbox" checked={form.vegetarian} onChange={(e) => set({ vegetarian: e.target.checked })}/>
              Vegetarian meals must be available
            </label>
            <label className="check-line">
              <input type="checkbox" checked={form.stepFree} onChange={(e) => set({ stepFree: e.target.checked })}/>
              Step-free access must be verified
            </label>
          </fieldset>
          <Field label="Tell us in your own words" hint="Optional. Do not include sensitive personal details.">
            <textarea value={form.text} onChange={(e) => set({ text: e.target.value })} placeholder="A relaxed pace, good food, and enough time to rest." maxLength={2000} rows={3}/>
          </Field>
          {!live&&<Actions>
            <Button variant="secondary" onClick={() => setVoice((v) => !v)}>
              Speak instead · voice preview
            </Button>
          </Actions>}
          {voice && (<Note title="Voice-input preview" icon="people" tone="peach">
              This demo does not record audio.{" "}
              <button className="text-button" onClick={() => {
                set({
                    text: "I can travel from Friday morning to Sunday night. Keep the whole trip under eleven thousand. I would love a relaxed beach day and vegetarian food.",
                });
                setVoice(false);
            }}>
                Use the sample transcript
              </button>{" "}
              You can edit or remove it before interpretation.
            </Note>)}
          {live&&onInterpret?<AiPreferencePreview key={trip.id+':'+trip.revision+':'+loadedRevision+':'+form.text} trip={trip} text={form.text} briefRevision={loadedRevision} disabled={saving || readOnly} onInterpret={onInterpret} onApply={set}/>:<><label className="check-line">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)}/>
            <span>
              Allow the optional interpretation preview
              <small>
                Runs locally with simple rules. No text or audio is sent to an
                AI service.
              </small>
            </span>
          </label>
          <Button variant="secondary" disabled={!consent || !form.text.trim()} onClick={parse}>
            Preview interpreted preferences
          </Button>
          {parsed && (<Note title="Is this what you meant?" icon="edit">
              {parsed.message}
              {parsed.amount !== null && (<>
                  <br />
                  <strong>
                    Suggested whole-trip ceiling: {money(parsed.amount)}
                  </strong>
                  <br />
                  <button className="text-button" onClick={() => {
                    set({ ceiling: parsed.amount! });
                    setParsed(null);
                }}>
                    Apply this amount for my review
                  </button>
                </>)}{" "}
              Travel dates and requirements still need your explicit check.
            </Note>)}</>}
          <label className="check-line">
            <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)}/>
            I checked the structured dates, whole-trip ceiling and requirements.
          </label>
          <Actions>
            <Button disabled={saving} onClick={() => save(true)}>{saving ? "Saving…" : "Confirm my private input"}</Button>
            <Button disabled={saving} variant="secondary" onClick={() => save(false)}>
              {saving ? "Saving…" : "Save draft"}
            </Button>
          </Actions>
          </fieldset>
        </Card>
      </div>
      <aside>
        <Card title="You set the boundaries" tone="mint">
          <Feature icon="lock" title="No public budget ranking">
            No financial explanations required.
          </Feature>
          <Feature title="Limits stay limits">
            A vote cannot raise your ceiling.
          </Feature>
          <Feature icon="edit" title="Changes are allowed">
            Updating confirmed input triggers plan revalidation.
          </Feature>
          <Coast />
        </Card>
        <Card title="Manual entry always works">
          <p className="small muted">
            You can confirm your structured fields without using the
            interpretation or voice previews.
          </p>
        </Card>
      </aside>
    </div>);
}
