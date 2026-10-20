export function routeFixture(start='2026-11-20T00:00:00Z',days=7){
 const ctx={stamp:'a'.repeat(32),destination:'Japan',start,end:new Date(Date.parse(start)+(days-1)*86400000+13*3600000).toISOString().replace('.000Z','Z'),traveller_count:2,refs:[{id:'ref_1',title:'TEST iconic highlights and transfer timings',kind:'activity',priority:'hard'},{id:'ref_2',title:'TEST Tokyo nightlife',kind:'activity',priority:'soft'}]};
 const zones=[{id:'zone_1',city:'Tokyo',name:'Asakusa',latitude:35.7148,longitude:139.7967},{id:'zone_2',city:'Kyoto',name:'Higashiyama',latitude:35,longitude:135.7788},{id:'zone_3',city:'Osaka',name:'Namba',latitude:34.6687,longitude:135.5013}];
 const price=(l=100,h=200)=>({low_inr:l,high_inr:h,assumptions:'TEST estimate per person per scheduled unit.'}),items=[],timeline=[];let cursor=Date.parse(start),zone='zone_1';
 function add(category,title,hours,{to=zone,sources=[],best_time='any',mode='none'}={}){let id='idea_'+(items.length+1);items.push({id,sources,title,kind:category==='meal'?'food':category==='stay'?'stay':'activity',location:zones.find(z=>z.id===zone).name,description:'TEST '+title+' in the current route area.',needs_confirmation:false,price:category==='rest'?price(0,0):price(),category,zone,end_zone:to,mode,minimum_minutes:category==='transfer'?Math.round(hours*60):category==='stay'?360:20,best_time});let end=cursor+hours*3600000;timeline.push({ref:id,start:new Date(cursor).toISOString().replace('.000Z','Z'),end:new Date(end).toISOString().replace('.000Z','Z')});cursor=end;zone=to;}
 for(let day=0;day<days;day++){
  add('meal','Breakfast '+(day+1),1);let transfer=day===2?'zone_2':day===4?'zone_3':day===days-1?'zone_1':null;
  if(transfer)add('transfer','Train to '+zones.find(z=>z.id===transfer).city,transfer==='zone_3'?1:4,{to:transfer,mode:'rail'});else add('visit','Morning highlight '+(day+1),3,{sources:day===0?['ref_1']:[],best_time:'daytime'});
  add('meal','Lunch '+(day+1),1);add('visit','Afternoon highlight '+(day+1),transfer&&transfer!=='zone_3'?2:3,{best_time:'daytime'});
  let localHour=new Date(cursor+9*3600000).getUTCHours();if(localHour<18)add('rest','Relaxed local break '+(day+1),18-localHour);
  add('meal','Dinner '+(day+1),1);add('visit',day===0?'Tokyo evening nightlife':'Evening neighbourhood '+(day+1),2,{sources:day===0?['ref_2']:[],best_time:'evening'});
  if(day<days-1)add('stay','Overnight base '+(day+1),12);else add('rest','Departure buffer',1);
 }
 const x={version:3,currency:'INR',route:{time_zone:'Asia/Tokyo',summary:'TEST Tokyo, Kyoto, Osaka and return to Tokyo with timed rail journeys.',assumptions:['TEST entry and exit Tokyo; user must check gateways.'],zones,entry_zone:'zone_1',exit_zone:'zone_1'},items,timeline,conflicts:[],essentials:{meal:price(),stay:price(),local_travel:price(0,0),fees:price(0,100)}};
 return {ctx,x,price};
}
