type Window = {id:string;start:string;end:string};
const months=['january','february','march','april','may','june','july','august','september','october','november','december'];
function localInstant(day:number,month:number,year:number,time:string){
  const [hour,minute]=time.split(':').map(Number);
  const value=new Date(Date.UTC(year,month,day,hour,minute));
  if(hour>23||minute>59||value.getUTCFullYear()!==year||value.getUTCMonth()!==month||value.getUTCDate()!==day)return NaN;
  return value.getTime()-330*60*1000;
}
function windowInstant(value:string){
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?$/.test(value))return NaN;
  if(!Number.isFinite(localInstant(Number(value.slice(8,10)),Number(value.slice(5,7))-1,Number(value.slice(0,4)),value.slice(11,16))))return NaN;
  return Date.parse(/(?:Z|[+-]\d{2}:\d{2})$/.test(value)?value:value+'+05:30');
}
// Check only a complete, explicit English availability sentence. Other wording,
// additional date constraints and invalid dates remain for manual review.
export function datedAvailability(text:string,windows:Window[]):{ids:string[];evidence:string}|null{
  const month=months.join('|');
  const pattern=new RegExp('(?:^|[.!?]\\s*)(I can (?:depart|leave) at (\\d{2}:\\d{2}) on (\\d{1,2}) ('+month+') (20\\d{2}) and return (?:by|at) (\\d{2}:\\d{2}) on (\\d{1,2}) ('+month+') (20\\d{2}))(?=[.!?]|$)','gi');
  const matches=[...text.matchAll(pattern)];
  if(matches.length!==1||!windows.length)return null;
  const m=matches[0],outside=text.slice(0,m.index)+text.slice(m.index+m[0].length);
  const otherDates=outside.replace(/return travel|(?:non[-\s]?)?vegetarian meals must be available/gi,'');
  if(/\b(?:20\d{2}|date|dates|depart|departure|leave|return|available|availability|unavailable|travel|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|\d{1,2}:\d{2}/i.test(otherDates))return null;
  if(new RegExp('\\b(?:'+month+'|except|excluding|cannot|can’t|can\'t|not|only|unless|if|home|busy|appointment|meeting|UTC|GMT|IST|time|times|timezone)\\b','i').test(outside))return null;
  const start=localInstant(Number(m[3]),months.indexOf(m[4].toLowerCase()),Number(m[5]),m[2]);
  const end=localInstant(Number(m[7]),months.indexOf(m[8].toLowerCase()),Number(m[9]),m[6]);
  const options=windows.map(w=>({id:w.id,start:windowInstant(w.start),end:windowInstant(w.end)}));
  if(!Number.isFinite(start)||!Number.isFinite(end)||start>=end||options.some(w=>!Number.isFinite(w.start)||!Number.isFinite(w.end)||w.start>=w.end))return null;
  return {ids:options.filter(w=>w.start>=start&&w.end<=end).map(w=>w.id),evidence:m[1]};
}
