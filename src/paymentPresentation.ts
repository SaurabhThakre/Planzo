import type {ExpenseCategory,PaymentEntry,PaymentsState,Settlement} from './payments';

export const expenseCategories:Record<ExpenseCategory,{label:string;icon:string}>={
 travel:{label:'Travel',icon:'car'},
 food:{label:'Food & drink',icon:'utensils'},
 stay:{label:'Stay',icon:'bed'},
 activities:{label:'Activities',icon:'ticket'},
 shopping:{label:'Shopping',icon:'shopping-bag'},
 other:{label:'Other',icon:'receipt'},
};

const titleCategories=[
 ['travel',/\b(taxi|cabs?|uber|ola|rapido|rickshaw|tuk[- ]tuk|flights?|airfare|trains?|railway|bus(?:es)?|shuttle|ferry|metro|parking|tolls?|fuel|airport transfer|car rental)\b/i],
 ['food',/\b(dinner|lunch|breakfast|brunch|coffee|cafe|restaurant|food|meals?|grocer(?:y|ies)|snacks?|drinks?|water bottles?)\b/i],
 ['stay',/\b(hotels?|hostels?|airbnb|resorts?|guest ?houses?|accommodation|homestay|room booking|room deposit)\b/i],
 ['activities',/\b(museum|tours?|concert|festival|sightseeing|admission|entry pass|entry ticket|kayak(?:ing)?|scuba|safari)\b/i],
 ['shopping',/\b(souvenirs?|shopping|gifts?|clothes|clothing|handicrafts?)\b/i],
] as const;

export function bookingExpenseCategory(category?:string|null):ExpenseCategory|null{
 switch(category){
  case 'transport':case 'travel':return 'travel';
  case 'meal':case 'food':return 'food';
  case 'stay':return 'stay';
  case 'activity':case 'activities':return 'activities';
  case 'shopping':return 'shopping';
  default:return null;
 }
}

export function suggestExpenseCategory(title:string):ExpenseCategory{
 const normalized=title.normalize('NFD').replace(/\p{M}/gu,'');
 if(/\b(taxi|cab|shuttle|rickshaw|uber|rapido|train|bus)\s+(?:ride\s+)?(?:to|from)\b/i.test(normalized))return 'travel';
 const matches=titleCategories.filter(([,pattern])=>pattern.test(normalized));
 return matches.length===1?matches[0][0]:'other';
}

export function paymentExpenseCategory(entry:PaymentEntry):ExpenseCategory{
 return entry.category&&Object.hasOwn(expenseCategories,entry.category)?entry.category:
  bookingExpenseCategory(entry.booking_category)??suggestExpenseCategory(entry.title);
}

export function paymentOverview(state:PaymentsState,userId:string){
 const entries=state.entries.filter(e=>!e.voided),counted=entries.filter(e=>!e.needs_review);
 const total=counted.reduce((sum,e)=>sum+(e.kind==='refund'?-1:1)*e.amount_paise,0);
 const own=state.balances.find(b=>b.user_id===userId);
 return {entries,total,own:own?.balance_paise??0,paid:own?.paid_paise??0,share:own?.share_paise??0,
  pending:state.settlements.filter(s=>s.status==='pending'),incoming:state.settlements.filter(s=>s.status==='pending'&&s.to_id===userId)};
}
export function expenseShare(entry:PaymentEntry,userId:string){return entry.needs_review?null:(entry.kind==='refund'?-1:1)*(entry.shares.find(s=>s.user_id===userId)?.amount_paise??0);}
export const settlementStatus=(status:Settlement['status'])=>({pending:'Earlier unrecorded payment',confirmed:'Recorded',rejected:'Not recorded',cancelled:'Removed'}[status]);
export const paymentDate=(day:string)=>new Date(day+'T12:00:00Z').toLocaleDateString('en-IN',{day:'numeric',month:'short',timeZone:'UTC'});
