import {useEffect,useId,useRef,useState} from 'react';
import type {Brief,Trip} from './domain';
import {AI_CONSENT_POLICY,uncertaintyText} from './aiProtocol';
import type {AiExtraction,AiInput,AiReply,AiWindow} from './aiProtocol';
import {Button,Icon,Note,money,windowText} from './ui';
export type InterpretPreferences=(input:AiInput,windows:AiWindow[])=>Promise<AiReply>;
export function AiPreferencePreview({trip,text,briefRevision,disabled,onInterpret,onApply}:{trip:Trip;text:string;briefRevision:number;disabled:boolean;onInterpret:InterpretPreferences;onApply:(fields:Partial<Brief>)=>void}){
  const [consent,setConsent]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [suggestion,setSuggestion]=useState<AiExtraction|null>(null),[selected,setSelected]=useState<string[]>([]);
  const epoch=useRef(0);
  const disclosureId=useId();
  useEffect(()=>()=>{epoch.current++;},[]);
  async function preview(){
    if(!consent||busy||disabled||!text.trim())return;
    const current=++epoch.current;setBusy(true);setError('');setSuggestion(null);setSelected([]);
    try{
      const result=await onInterpret({trip_id:trip.id,request_id:crypto.randomUUID(),expected_trip_revision:trip.revision,
        expected_brief_revision:briefRevision,text,consent:true,fictional_input:false,consent_policy:AI_CONSENT_POLICY},trip.windows);
      if(current===epoch.current)setSuggestion(result.suggestion);
    }catch(e){if(current===epoch.current)setError(e instanceof Error?e.message:'The AI preview is unavailable. Your text is kept; manual entry still works.');}
    finally{if(current===epoch.current)setBusy(false);}
  }
  function cancelConsent(){epoch.current++;setConsent(false);setSuggestion(null);setSelected([]);setBusy(false);setError('');}
  function apply(){
    if(!suggestion||!selected.length||disabled)return;
    const fields:Partial<Brief>={};
    if(selected.includes('origin')&&suggestion.origin!==null)fields.origin=suggestion.origin;
    if(selected.includes('ceiling')&&suggestion.ceiling_inr!==null)fields.ceiling=suggestion.ceiling_inr;
    if(selected.includes('windows')&&suggestion.window_ids.length)fields.windows=suggestion.window_ids;
    if(selected.includes('vegetarian')&&suggestion.vegetarian!==null)fields.vegetarian=suggestion.vegetarian;
    if(selected.includes('step_free')&&suggestion.step_free!==null)fields.stepFree=suggestion.step_free;
    onApply(fields);cancelConsent();
  }
  const field=(key:string,label:string,evidence:string|null)=><label className="check-line" key={key}>
    <input type="checkbox" checked={selected.includes(key)} onChange={e=>setSelected(s=>e.target.checked?[...s,key]:s.filter(x=>x!==key))}/>
    <span>{label}{evidence&&<small>You wrote: “{evidence}”</small>}</span>
  </label>;
  return <section aria-label="Optional AI preference interpretation">
    <label className="check-line"><input type="checkbox" aria-label="Allow Gemini" aria-describedby={disclosureId} checked={consent} disabled={disabled} onChange={e=>e.target.checked?setConsent(true):cancelConsent()}/>
      <span>Allow Gemini<small id={disclosureId}>Only the text you choose to submit here and this trip’s date options are sent to Google. This optional action works for every trip name. Google’s free service may use inputs and outputs to improve its products, including human review. Do not submit personal, sensitive or confidential information. Keep private reasons in the manual fields. Suggestions stay here until you choose to apply them. Manual entry always works.</small></span>
    </label>
    <Button variant="secondary" disabled={!consent||!text.trim()||busy||disabled} onClick={()=>void preview()}>{busy?'Interpreting your text…':'Preview with AI'}</Button>
    <p className="caption muted">Gemini’s free-tier usage limits apply. Wait a few seconds between previews; requests are never retried automatically.</p>
    {busy&&<p role="status">You can keep entering your preferences manually. Editing the text cancels this preview; the submitted text may already be processing.</p>}
    {error&&<p className="form-error" role="alert">{error}</p>}
    {suggestion&&<section className="note mint" aria-label="AI suggestion · check before applying"><Icon name="edit"/><div>
      <strong>AI suggestion · check before applying</strong>
      <p>Nothing has been saved or confirmed. Select only the suggestions that are correct for you.</p>
      {suggestion.uncertainties.map(x=><p key={x}>{uncertaintyText[x]}</p>)}
      <fieldset disabled={disabled||busy}><legend>Suggestions to apply for my review</legend>
        {suggestion.origin!==null&&field('origin','Starting from: '+suggestion.origin,suggestion.evidence.origin)}
        {suggestion.ceiling_inr!==null&&field('ceiling','Whole-trip ceiling: '+money(suggestion.ceiling_inr),suggestion.evidence.ceiling)}
        {suggestion.window_ids.length>0&&field('windows','Trip date options within your availability: '+suggestion.window_ids.map(id=>windowText(trip,id)).join('; '),suggestion.evidence.dates)}
        {suggestion.vegetarian!==null&&field('vegetarian',suggestion.vegetarian?'Vegetarian meals must be available':'Vegetarian meals are not a hard requirement',suggestion.evidence.vegetarian)}
        {suggestion.step_free!==null&&field('step_free',suggestion.step_free?'Step-free access must be verified':'Step-free access is not a hard requirement',suggestion.evidence.step_free)}
        {suggestion.soft_interests.length>0&&<p>Possible interests: {suggestion.soft_interests.join(', ')}. Review these in your own words above.</p>}
        <Button variant="secondary" disabled={!selected.length||disabled} onClick={apply}>Apply selected suggestions for my review</Button>
      </fieldset>
      <p>Check the structured fields above, then use Save draft or Confirm my private input when ready.</p>
    </div></section>}
  </section>;
}
