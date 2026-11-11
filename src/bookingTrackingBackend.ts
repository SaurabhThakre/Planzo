import {supabase} from './backend';
import type {BookingTracker} from './bookingTracking';
export async function bookingTrackerApi(action:'get'|'save',payload:Record<string,unknown>):Promise<BookingTracker>{
 const {data,error}=await supabase.rpc('planzo_booking_tracker',{p_action:action,p_payload:payload});
 if(error)throw Error(error.message);
 return data as BookingTracker;
}
