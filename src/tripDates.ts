const zone='Asia/Kolkata';
export function compactTripDates(start:string,end:string){
 const a=new Date(start),b=new Date(end);
 if(!Number.isFinite(a.getTime())||!Number.isFinite(b.getTime()))return{dates:'Dates pending',times:'',full:'Dates pending'};
 const parts=(d:Date)=>Object.fromEntries(new Intl.DateTimeFormat('en-IN',{timeZone:zone,day:'numeric',month:'short',year:'numeric'}).formatToParts(d).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
 const x=parts(a),y=parts(b),clock=(d:Date)=>new Intl.DateTimeFormat('en-IN',{timeZone:zone,hour:'numeric',minute:'2-digit',hour12:true}).format(d);
 const dates=x.year===y.year&&x.month===y.month?(x.day===y.day?x.day:x.day+'–'+y.day)+' '+x.month+' '+x.year:x.year===y.year?x.day+' '+x.month+'–'+y.day+' '+y.month+' '+y.year:x.day+' '+x.month+' '+x.year+'–'+y.day+' '+y.month+' '+y.year;
 return{dates,times:clock(a)+' → '+clock(b),full:x.day+' '+x.month+' '+x.year+', '+clock(a)+' → '+y.day+' '+y.month+' '+y.year+', '+clock(b)+' IST'};
}
