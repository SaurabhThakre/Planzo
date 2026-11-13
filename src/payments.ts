export type Share={user_id:string;amount_paise:number};
export type ExpenseCategory='travel'|'food'|'stay'|'activities'|'shopping'|'other';
export type PaymentEntry={id:string;category?:ExpenseCategory|null;booking_category?:string|null;source:'booking'|'manual';title:string;amount_paise:number;payer_id:string;kind:'expense'|'refund';split_mode:'equal'|'exact';shares:Share[];paid_on:string;notes:string;voided:boolean;needs_review:boolean;plan_id?:string;plan_version?:number;step_id?:string;booking_revision?:number;booking_status?:string;provider_name?:string;reference?:string;revision:number;actor?:string;updated_at:string};
export type Settlement={id:string;from_id:string;to_id:string;amount_paise:number;method:string;paid_on:string;notes:string;status:'pending'|'confirmed'|'rejected'|'cancelled';created_at:string};
export type PaymentMember={id:string;name:string;included:boolean};
export type Balance={user_id:string;paid_paise:number;share_paise:number;settled_paise:number;balance_paise:number};
export type PaymentHistory={id:string;entity_id:string;action:string;actor:string;created_at:string;body:Record<string,unknown>};
export type PaymentsState={entries:PaymentEntry[];settlements:Settlement[];members:PaymentMember[];balances:Balance[];history:PaymentHistory[];editable:boolean;stamp:string;needs_review:number};
export const paymentMoney=(paise:number)=>new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',minimumFractionDigits:2,maximumFractionDigits:2}).format(paise/100);
export function paymentAmount(raw:string,allowZero=false){
 const value=raw.trim();if(!/^\d+(?:\.\d{1,2})?$/.test(value))throw Error('Use an INR amount with at most two decimals.');
 const [whole,decimal='']=value.split('.'),paise=Number(whole)*100+Number(decimal.padEnd(2,'0'));
 if(!Number.isSafeInteger(paise)||paise>(10000000000)||paise<(allowZero?0:1))throw Error('Enter a positive amount up to INR 10 crore.');return paise;
}
export function equalPaymentShares(amount:number,ids:string[]):Share[]{
 if(!Number.isSafeInteger(amount)||amount<1||!ids.length||new Set(ids).size!==ids.length)throw Error('Choose distinct travellers and a positive total.');
 const members=[...ids].sort(),base=Math.floor(amount/members.length),remainder=amount%members.length;
 return members.map((user_id,index)=>({user_id,amount_paise:base+(index<remainder?1:0)}));
}
export function exactPaymentShares(amount:number,shares:Share[]){
 if(!shares.length||new Set(shares.map(s=>s.user_id)).size!==shares.length||shares.some(s=>!Number.isSafeInteger(s.amount_paise)||s.amount_paise<0)||shares.reduce((n,s)=>n+s.amount_paise,0)!==amount)throw Error('Shares must add up exactly to the total.');
 return [...shares].sort((a,b)=>a.user_id.localeCompare(b.user_id));
}
export function paymentBalances(members:PaymentMember[],entries:PaymentEntry[],settlements:Settlement[]):Balance[]{
 const result=new Map(members.map(m=>[m.id,{user_id:m.id,paid_paise:0,share_paise:0,settled_paise:0,balance_paise:0}]));
 for(const e of entries){if(e.voided||e.needs_review)continue;const sign=e.kind==='refund'?-1:1;const payer=result.get(e.payer_id);if(!payer)throw Error('Unknown payer.');payer.paid_paise+=sign*e.amount_paise;
  for(const s of exactPaymentShares(e.amount_paise,e.shares)){const member=result.get(s.user_id);if(!member)throw Error('Unknown participant.');member.share_paise+=sign*s.amount_paise;}}
 for(const s of settlements){if(s.status!=='confirmed')continue;const from=result.get(s.from_id),to=result.get(s.to_id);if(!from||!to)throw Error('Unknown settlement traveller.');from.settled_paise+=s.amount_paise;to.settled_paise-=s.amount_paise;}
 for(const b of result.values()){b.balance_paise=b.paid_paise-b.share_paise+b.settled_paise;if(!Object.values(b).filter(v=>typeof v==='number').every(Number.isSafeInteger))throw Error('Ledger amount is too large.');}
 return [...result.values()];
}
export function suggestedSettlements(balances:Balance[]){
 if(balances.reduce((n,b)=>n+b.balance_paise,0)!==0)throw Error('Balances do not reconcile.');
 const debtors=balances.filter(b=>b.balance_paise<0).map(b=>({id:b.user_id,amount:-b.balance_paise})).sort((a,b)=>b.amount-a.amount||a.id.localeCompare(b.id));
 const creditors=balances.filter(b=>b.balance_paise>0).map(b=>({id:b.user_id,amount:b.balance_paise})).sort((a,b)=>b.amount-a.amount||a.id.localeCompare(b.id));
 const result:{from_id:string;to_id:string;amount_paise:number}[]=[];let i=0,j=0;
 while(i<debtors.length&&j<creditors.length){const amount=Math.min(debtors[i].amount,creditors[j].amount);result.push({from_id:debtors[i].id,to_id:creditors[j].id,amount_paise:amount});debtors[i].amount-=amount;creditors[j].amount-=amount;if(!debtors[i].amount)i++;if(!creditors[j].amount)j++;}
 return result;
}
export const paymentToday=()=>{const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());return ['year','month','day'].map(kind=>parts.find(p=>p.type===kind)?.value).join('-');};
export function paymentMemberName(members:PaymentMember[],id:string){const member=members.find(m=>m.id===id);if(!member)return 'Former traveller';return member.name+(members.filter(m=>m.name===member.name).length>1?' · '+(members.indexOf(member)+1):'')+(member.included?'':' (former)');}
