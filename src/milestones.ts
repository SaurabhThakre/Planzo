export type MilestoneKind='joined'|'confirmed'|'locked';
export type Milestone={kind:MilestoneKind;userId:string;tripId:string;version?:string|number};
export const milestoneCopy={
 joined:{title:"You're in!",detail:'Your next adventure starts with this group.'},
 confirmed:{title:'Your yes is in!',detail:'You confirmed this itinerary. One step closer to getting away.'},
 locked:{title:'This trip has a plan!',detail:'The itinerary is locked. Time to arrange the bookings together.'},
} as const;
type Store={getItem:(key:string)=>string|null;setItem:(key:string,value:string)=>void};
export function claimMilestone(event:Milestone,seen:Set<string>,storage?:Store){
 if(!event.userId||!event.tripId||!Object.hasOwn(milestoneCopy,event.kind))return false;
 const key=['planzo.milestone.v1',event.userId,event.tripId,event.kind,event.version??'joined'].map(encodeURIComponent).join(':');
 if(seen.has(key))return false;
 try{if(storage?.getItem(key)==='seen'){seen.add(key);return false;}}catch{/* Memory still prevents repeats if storage is unavailable. */}
 seen.add(key);if(seen.size>200)seen.delete(seen.values().next().value!);
 try{storage?.setItem(key,'seen');}catch{/* No private input or payment data is persisted. */}
 return true;
}
