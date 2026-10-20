import { createClient } from '@supabase/supabase-js';
import type { Brief, Person, Trip } from './domain';
import { makeTrip } from './domain';

// Public browser configuration. Authorization is enforced by the database.
export const supabase = createClient(
  'https://ewysgpuwvufbklesdhuj.supabase.co',
  'sb_publishable_itUO45I1N1T3rp06T6p_DA_q-RN6DPI',
  { auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } },
);
export type TripSummary = { id: string; name: string; destination: string; role: 'organiser'|'member'; stage: string; revision: number; tentative_days?:number; removal_kind?:'deleted_draft'|'archived'|null; can_delete?:boolean };
export type LiveMember = {id:string;name:string;role:'organiser'|'member';included:boolean;confirmed:boolean;revision:number};
export type StoredBrief = {origin:string;ceiling_paise:number|null;windows:string[];vegetarian:boolean;step_free:boolean;stars:Record<string,number>;text:string;boat:boolean};
export type Workspace = {
  trip:{id:string;name:string;destination:string;minimum_group_size:number;response_deadline:string;revision:number;stage:string;tentative_days?:number;workflow_version?:number;removal_kind?:'deleted_draft'|'archived'|null};
  windows:{id:string;start:string;end:string}[];
  members:LiveMember[];
  own_brief:{content:StoredBrief;revision:number;confirmed:boolean}|null;
};
export type Invite = {id:string;expires_at:string;revoked_at:string|null;created_at?:string;token?:string};
export async function api<T>(action:string,payload:Record<string,unknown>={}):Promise<T> {
  const { data,error }=await supabase.rpc('planzo_api',{p_action:action,p_payload:payload});
  if(error) throw new Error(error.message);
  return data as T;
}
export {readableError} from './errors';
export function asTrip(w:Workspace,person:Person):Trip {
  const b=w.own_brief;
  const own:Brief|undefined=b ? {origin:b.content.origin,ceiling:(b.content.ceiling_paise||0)/100,windows:b.content.windows,
    vegetarian:b.content.vegetarian,stepFree:b.content.step_free,stars:b.content.stars,text:b.content.text,boat:b.content.boat,confirmed:b.confirmed}:undefined;
  return {...makeTrip(person),id:w.trip.id,name:w.trip.name,destination:w.trip.destination,minimum:w.trip.minimum_group_size,
    deadline:w.trip.response_deadline.slice(0,10),tentativeDays:w.trip.tentative_days??3,revision:w.trip.revision,windows:w.windows,windowId:w.windows[0]?.id||'',
    members:w.members.map(m=>({id:m.id,name:m.name,role:m.role,included:m.included})),briefs:own?{[person.id]:own}:{},sample:false};
}
export const serializeBrief=(b:Brief):StoredBrief=>({origin:b.origin.trim(),ceiling_paise:b.ceiling?Math.round(b.ceiling*100):null,
  windows:b.windows,vegetarian:b.vegetarian,step_free:b.stepFree,stars:b.stars,text:b.text,boat:b.boat});
export const callbackUrl=(kind:string)=>location.origin+location.pathname+'?auth='+encodeURIComponent(kind);
export {invitationToken} from './invitations';
export const invitationUrl=(token:string)=>location.origin+location.pathname+'#/join/'+token;
