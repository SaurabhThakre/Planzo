export const BOOKING_STATUSES={not_booked:'Not booked',in_progress:'In progress',booked:'Booked',cancelled:'Cancelled',not_needed:'Not needed'} as const;
export type BookingStatus=keyof typeof BOOKING_STATUSES;
export type BookingRecord={id:string;plan_id:string;step_id:string;revision:number;status:BookingStatus;provider_name:string;amount_paise:number|null;booked_by:string|null;booked_by_name:string|null;reference:string;notes:string;actor:string;actor_name:string;created_at:string;step_title:string;step_start:string;step_end:string;plan_version?:number};
export type BookingTracker={plan_id:string;version:number;editable:boolean;records:BookingRecord[];history:BookingRecord[]};
export type BookingDraft={status:BookingStatus;provider_name:string;amount:string;booked_by:string;reference:string;notes:string};
export const bookingDraft=(record?:BookingRecord):BookingDraft=>({status:record?.status||'not_booked',provider_name:record?.provider_name||'',amount:record?.amount_paise==null?'':(record.amount_paise/100).toFixed(2),booked_by:record?.booked_by||'',reference:record?.reference||'',notes:record?.notes||''});
export function bookingFields(draft:BookingDraft,includedIds:string[]){
 if(!Object.hasOwn(BOOKING_STATUSES,draft.status))throw Error('Choose a booking status.');
 const provider_name=draft.provider_name.trim(),reference=draft.reference.trim(),notes=draft.notes.trim(),raw=draft.amount.trim();
 if(provider_name.length>120||reference.length>120||notes.length>500)throw Error('Booking details are too long.');
 if(raw&&!/^\d+(?:\.\d{1,2})?$/.test(raw))throw Error('Enter a non-negative INR amount with at most two decimals.');
 const amount_paise=raw?Math.round(Number(raw)*100):null;
 if(amount_paise!==null&&(!Number.isSafeInteger(amount_paise)||amount_paise>10000000000))throw Error('Amount is too large.');
 const booked_by=draft.booked_by||null;
 if(booked_by&&!includedIds.includes(booked_by))throw Error('Choose an included traveller.');
 if(draft.status==='booked'&&(!provider_name||amount_paise===null||!booked_by))throw Error('Booked needs a provider, total paid and the traveller who booked.');
 return {status:draft.status,provider_name,amount_paise,booked_by,reference,notes};
}
export function bookingCounts(stepIds:string[],records:BookingRecord[]){
 const map=new Map(records.map(record=>[record.step_id,record.status]));
 return stepIds.reduce((counts,id)=>{const status=map.get(id)||'not_booked';counts[status]++;return counts;},{not_booked:0,in_progress:0,booked:0,cancelled:0,not_needed:0});
}
export const bookingMoney=(paise:number)=>new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',minimumFractionDigits:2,maximumFractionDigits:2}).format(paise/100);
