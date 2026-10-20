import {useEffect,useRef,useState} from 'react';
import {supabase,readableError} from './backend';
import type {TripSummary} from './backend';
import {Actions,Button} from './ui';
type Action='delete_unused'|'archive'|'restore';
export function TripControls({trip,onDone}:{trip:TripSummary;onDone:()=>Promise<void>}){
 const [action,setAction]=useState<Action|null>(null),[ack,setAck]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const dialog=useRef<HTMLDialogElement>(null),requestId=useRef('');
 useEffect(()=>{if(action){setAck(false);setError('');requestId.current=crypto.randomUUID();dialog.current?.showModal();}else dialog.current?.close();},[action]);
 if(trip.role!=='organiser')return null;
 async function submit(){if(!action||!ack||busy)return;setBusy(true);setError('');try{const {error}=await supabase.rpc('planzo_manage_trip',{p_action:action,p_payload:{trip_id:trip.id,request_id:requestId.current,expected_revision:trip.revision,acknowledged:true}});if(error)throw Error(error.message);await onDone();setAction(null);}catch(e){setError(readableError(e)+' Close this dialog and refresh if the trip changed.');}finally{setBusy(false);}}
 const removed=trip.stage==='archived';
 return <><Actions>{removed?<Button variant="secondary" onClick={()=>setAction('restore')}>Restore trip</Button>:<>{trip.can_delete&&<Button variant="ghost" onClick={()=>setAction('delete_unused')}>Delete draft</Button>}<Button variant="ghost" onClick={()=>setAction('archive')}>Archive trip</Button></>}</Actions>
 <dialog className="trip-dialog" ref={dialog} aria-labelledby={'manage-'+trip.id} onCancel={e=>{e.preventDefault();if(!busy)setAction(null);}}><h2 id={'manage-'+trip.id}>{action==='delete_unused'?'Delete unused draft?':action==='archive'?'Archive this trip?':'Restore this trip?'}</h2><p><strong>{trip.name}</strong></p><p>{action==='delete_unused'?'The draft will leave your active trips. Its saved records are retained, and you can restore it from Deleted drafts.':action==='archive'?'This stops changes for everyone and moves the trip to Archived. Members can still read the saved trip and history.':'This returns the trip to active trips. Any earlier plan will need fresh review before agreement.'}</p><label className="check-line"><input type="checkbox" checked={ack} disabled={busy} onChange={e=>setAck(e.target.checked)}/>I understand and want to continue.</label>{error&&<p role="alert" className="form-error">{error}</p>}<Actions><Button disabled={!ack||busy} onClick={()=>void submit()}>{busy?'Saving…':action==='delete_unused'?'Delete draft':action==='archive'?'Archive trip':'Restore trip'}</Button><Button variant="secondary" disabled={busy} onClick={()=>setAction(null)}>Cancel</Button></Actions></dialog></>;
}
