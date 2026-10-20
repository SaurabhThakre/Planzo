export const MAX_TRAVELLERS=100;
export function durationEnd(start:string,days:number,end=''){
  if(!Number.isFinite(localTimeValue(start))||!Number.isInteger(days)||days<1||days>365)return end;
  const d=new Date(start.slice(0,10)+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+days-1);
  return d.toISOString().slice(0,10)+'T'+(end.slice(11,16)||'22:00');
}
export function localTimeValue(value:string){
  const m=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if(!m)return NaN;
  const [,y,mo,d,h,mi]=m.map(Number),date=new Date(Date.UTC(y,mo-1,d,h,mi));
  return date.getUTCFullYear()===y&&date.getUTCMonth()===mo-1&&date.getUTCDate()===d&&h<24&&mi<60?date.getTime()-330*60000:NaN;
}
export function setupErrors(v:{name:string;destination:string;tentativeDays:number;minimum:number;deadline:string;windows:{start:string;end:string}[]},now=Date.now()){
  const errors:string[]=[];
  if(!v.name.trim()||!v.destination.trim())errors.push('Enter a trip name and destination.');
  if(!Number.isInteger(v.tentativeDays)||v.tentativeDays<1||v.tentativeDays>365)errors.push('Enter a tentative duration from 1 to 365 days.');
  if(!Number.isInteger(v.minimum)||v.minimum<1||v.minimum>MAX_TRAVELLERS)errors.push('Enter a minimum from 1 to '+MAX_TRAVELLERS+' travellers, including you.');
  const deadline=localTimeValue(v.deadline+'T23:59');
  if(!Number.isFinite(deadline)||deadline<=now)errors.push('Choose a future response deadline.');
  if(v.windows.length<1||v.windows.length>3)errors.push('Add one to three tentative date windows.');
  if(v.windows.some(w=>!Number.isFinite(localTimeValue(w.start))||!Number.isFinite(localTimeValue(w.end))||localTimeValue(w.start)<=Math.max(now,deadline)||localTimeValue(w.end)<=localTimeValue(w.start)))errors.push('Apply future departure and return times, after the response deadline, with return after departure.');
  if(new Set(v.windows.map(w=>w.start+'|'+w.end)).size!==v.windows.length)errors.push('Each date window must be different.');
  return errors;
}
export const displayTime=(value:string,dateOnly=false)=>{
  const t=localTimeValue(dateOnly?value+'T12:00':value);
  return Number.isFinite(t)?new Intl.DateTimeFormat('en-IN',{timeZone:'Asia/Kolkata',dateStyle:'medium',...(!dateOnly?{timeStyle:'short' as const}:{})}).format(t):'Choose '+(dateOnly?'date':'date and time');
};
