import {useId,useRef,useState} from 'react';
import {Actions,Button,Field} from './ui';
import {displayTime,localTimeValue} from './setupRules';
export function DateTimeField({label,value,onChange,disabled=false,dateOnly=false,max,onEditingChange}:{label:string;value:string;onChange:(value:string)=>void;disabled?:boolean;dateOnly?:boolean;max?:string;onEditingChange?:(open:boolean)=>void}){
 const [open,setOpen]=useState(false),[date,setDate]=useState(''),[hour,setHour]=useState('06'),[minute,setMinute]=useState('00'),[error,setError]=useState('');
 const panelId=useId(),root=useRef<HTMLDivElement>(null);
 const close=()=>{setOpen(false);setError('');onEditingChange?.(false);root.current?.querySelector('button')?.focus();};
 function edit(){setDate(value.slice(0,10));setHour(value.slice(11,13)||'06');setMinute(value.slice(14,16)||'00');setOpen(true);setError('');onEditingChange?.(true);}
 function apply(){const next=dateOnly?date:date+'T'+hour+':'+minute,t=localTimeValue(dateOnly?next+'T12:00':next);if(!Number.isFinite(t)||(max&&localTimeValue(next)>localTimeValue(max))){setError('Choose a valid '+(dateOnly?'date.':'date and time within the allowed range.'));return;}onChange(next);close();}
 return <div className="date-time-field" ref={root}><span className="field-label">{label}</span><Button variant="secondary" disabled={disabled} aria-label={'Choose '+label} aria-expanded={open} aria-controls={open?panelId:undefined} onClick={open?close:edit}><span>{displayTime(value,dateOnly)}{!dateOnly?' IST':''}</span><span className="date-time-chevron" aria-hidden="true">⌄</span></Button>
 {open&&<div id={panelId} className="date-time-editor" role="group" aria-label={'Edit '+label}><Field label={label+' date'}><input type="date" autoFocus value={date} max={max?.slice(0,10)} disabled={disabled} onChange={e=>setDate(e.target.value)}/></Field>
 {!dateOnly&&<div className="time-selectors"><Field label={label+' hour (24-hour)'}><select value={hour} disabled={disabled} onChange={e=>setHour(e.target.value)}>{Array.from({length:24},(_,i)=>String(i).padStart(2,'0')).map(x=><option key={x}>{x}</option>)}</select></Field><Field label={label+' minute'}><select value={minute} disabled={disabled} onChange={e=>setMinute(e.target.value)}>{Array.from({length:60},(_,i)=>String(i).padStart(2,'0')).map(x=><option key={x}>{x}</option>)}</select></Field></div>}
 {error&&<p role="alert" className="form-error">{error}</p>}<Actions><Button disabled={disabled} aria-label={'Apply '+label} onClick={apply}>Apply</Button><Button variant="ghost" onClick={close}>Cancel</Button></Actions></div>}
 </div>;
}
