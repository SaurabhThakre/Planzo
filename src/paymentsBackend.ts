import {supabase} from './backend';
import type {PaymentsState} from './payments';
export async function paymentsApi(action:string,payload:Record<string,unknown>):Promise<PaymentsState>{
 const {data,error}=await supabase.rpc('planzo_payments',{p_action:action,p_payload:payload});if(error)throw Error(error.message);return data as PaymentsState;
}
