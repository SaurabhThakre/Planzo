import {supabase} from './backend';
import type {Catalogue,CostSnapshot} from './planningBackend';
export type ItinerarySlot={id:string;label:string;day:number;kind:string;timing:string;default:string;choices:string[]};
export type ItemCatalogue=Catalogue&{slots:ItinerarySlot[];choices:Record<string,{title:string;basis:string;price:[number,number]}>};
export type ItemPoll={id:string;slot_id:string;source_revision:number;roster:string[];deadline:string;status:string;responded:number;
 options:{id:string;title:string;own_cost:CostSnapshot|null}[];own_ballot:{choice:string;revision:number}|null;
 result:{counts:Record<string,number>;abstain:number;different:number;missing:number;winner:string|null}|null};
export type ItineraryState={revision:number;stage:string;deadline:string;catalogue:ItemCatalogue;windows:{id:string;compatible:boolean}[];
 draft:{source_revision:number;current:boolean;window_id:string;items:Record<string,string|null>;gaps:{slot_id:string;message:string}[];blockers:string[];own_cost:CostSnapshot|null;rooms:number}|null;poll:ItemPoll|null};
export async function itineraryApi<T=ItineraryState>(action:string,payload:Record<string,unknown>):Promise<T>{
 const {data,error}=await supabase.rpc('planzo_itinerary',{p_action:action,p_payload:payload});
 if(error)throw new Error(error.message);return data as T;
}
