import { useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import type { Brief, Person, Trip } from './domain';
import { assets } from './assets';
import { Actions, Badge, Button, Card, Coast, Feature, Field, Note, windowText } from './ui';
import { TripSetup } from './TripSetup';
import {TripControls} from './TripControls';
import {TripDetailsEditor} from './TripDetailsEditor';
import {SignupConfirmation} from './SignupConfirmation';
import {LiveHistory} from './LiveHistory';
import { Preferences } from './preferences';
import { api, asTrip, callbackUrl, invitationToken, invitationUrl, readableError, serializeBrief, supabase } from './backend';
import type { Invite, TripSummary, Workspace } from './backend';
import { readAuthReturn, resolveAuthReturn } from './authReturn';
import {LivePlanning} from './LivePlanning';
import {LiveBookings,LiveMilestones} from './LiveBookings';
import {planStage} from './planningBackend';
import {interpretPreferences} from './aiBackend';
import {LivePrivatePlanning} from './LivePrivatePlanning';
import {AppHeader} from './AppHeader';

const readRoute=()=>location.hash.replace(/^#\/?/,'').split('/');
function RememberInvite(token:string){try{sessionStorage.setItem('planzo.pending-invite',token);}catch{}}
function pendingInvite(){try{return sessionStorage.getItem('planzo.pending-invite')||'';}catch{return '';}}

export default function LiveApp(){
  const [route,setRoute]=useState(readRoute),[session,setSession]=useState<Session|null>(null),[loadingAuth,setLoadingAuth]=useState(true);
  const [profile,setProfile]=useState<Person|null>(null),[trips,setTrips]=useState<TripSummary[]>([]),[workspace,setWorkspace]=useState<Workspace|null>(null);
  const [busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[error,setError]=useState('');
  const [tripBucket,setTripBucket]=useState('active');
  const [authMode,setAuthMode]=useState(''),[invites,setInvites]=useState<Invite[]>([]),[freshInvite,setFreshInvite]=useState<Invite|null>(null);
  const activeUser=useRef<string|null>(null),createId=useRef(crypto.randomUUID());
  const authReturn=useRef(readAuthReturn(location.search,location.hash)),recoveryVerified=useRef(false);
  const uid=session?.user.id||null;
  const go=(...parts:string[])=>{setError('');setNotice('');location.hash='/'+parts.join('/');};
  useEffect(()=>{const change=()=>{setRoute(readRoute());window.scrollTo(0,0);};window.addEventListener('hashchange',change);return()=>window.removeEventListener('hashchange',change);},[]);
  useEffect(()=>{
    let cancelled=false;
    const {data:{subscription}}=supabase.auth.onAuthStateChange((event,s)=>{
      if(cancelled)return;
      activeUser.current=s?.user.id||null;setSession(s);
      if(event==='PASSWORD_RECOVERY'){recoveryVerified.current=true;setAuthMode('reset');}
      if(event==='SIGNED_OUT'){recoveryVerified.current=false;setAuthMode('');setWorkspace(null);setProfile(null);setTrips([]);setInvites([]);setFreshInvite(null);}
    });
    supabase.auth.getSession().then(({data,error})=>{
      if(cancelled)return;
      activeUser.current=data.session?.user.id||null;setSession(data.session);setLoadingAuth(false);
      if(authReturn.current.callback){
        const result=resolveAuthReturn(authReturn.current,recoveryVerified.current,Boolean(error));
        setAuthMode(result.reset?'reset':'');if(result.message)setError(result.message);
        const hash=result.route?'#/'+result.route:location.hash.startsWith('#/')?location.hash:'';
        history.replaceState(null,'',location.pathname+hash);setRoute(readRoute());
      }else if(error)setError(error.message);
    }).catch(e=>{if(!cancelled){setError(readableError(e));setLoadingAuth(false);}});
    return()=>{cancelled=true;subscription.unsubscribe();};
  },[]);
  useEffect(()=>{
    setProfile(null);setTrips([]);setWorkspace(null);setInvites([]);setFreshInvite(null);
    if(!uid)return;
    let cancelled=false;
    (async()=>{
      let data=await api<{profile:Person;trips:TripSummary[]}>('list');
      if(data.profile.name==='Traveller'&&session?.user.user_metadata?.display_name){
        await api('profile',{name:String(session.user.user_metadata.display_name).slice(0,50)});data=await api('list');
      }
      if(!cancelled){setProfile(data.profile);setTrips(data.trips);}
    })().catch(e=>{if(!cancelled)setError(readableError(e));});
    return()=>{cancelled=true;};
  },[uid]);
  const tripId=route[0]==='trip'?route[1]:'';
  async function refreshTrip(id=tripId){
    const requestedUser=uid;
    const data=await api<Workspace>('workspace',{trip_id:id});
    if(activeUser.current===requestedUser)setWorkspace(data);
    return data;
  }
  useEffect(()=>{
    setWorkspace(null);setInvites([]);setFreshInvite(null);
    if(!uid||!tripId)return;
    let cancelled=false;
    const refresh=()=>api<Workspace>('workspace',{trip_id:tripId}).then(data=>{if(!cancelled)setWorkspace(data);}).catch(e=>{if(!cancelled)setError(readableError(e));});
    void refresh();
    // Focus/visibility refresh and periodic reads keep other devices current without private-data broadcast.
    const onFocus=()=>{if(document.visibilityState==='visible')void refresh();};
    window.addEventListener('focus',onFocus);document.addEventListener('visibilitychange',onFocus);
    const timer=window.setInterval(onFocus,15000);
    return()=>{cancelled=true;clearInterval(timer);window.removeEventListener('focus',onFocus);document.removeEventListener('visibilitychange',onFocus);};
  },[uid,tripId]);
  async function perform(fn:()=>Promise<void>){setBusy(true);setError('');try{await fn();}catch(e){setError(readableError(e));}finally{setBusy(false);}}
  async function copyInvitationLink(token:string){
    let timeout:number|undefined;
    setNotice('If automatic copying is unavailable, select and copy the invitation link above.');
    try{
      if(!navigator.clipboard?.writeText)return;
      await Promise.race([navigator.clipboard.writeText(invitationUrl(token)),new Promise<never>((_,reject)=>{
        timeout=window.setTimeout(()=>reject(Error('Clipboard unavailable')),3000);
      })]);
      setNotice('Invitation link copied.');
    }catch{setNotice('Select and copy the invitation link above. Automatic copying is unavailable in this browser.');}
    finally{window.clearTimeout(timeout);}
  }
  async function loadInvites(){if(!tripId)return;const requestedTrip=tripId,requestedUser=uid;const data=await api<Invite[]>('list_invites',{trip_id:requestedTrip});const current=readRoute();if(activeUser.current===requestedUser&&current[0]==='trip'&&current[1]===requestedTrip)setInvites(data);}
  useEffect(()=>{if(tripId&&workspace?.trip.id===tripId&&workspace.members.find(m=>m.id===uid)?.role==='organiser')void loadInvites().catch(e=>setError(readableError(e)));},[tripId,workspace?.members.length,uid]);
  const sample=()=>{location.href=location.pathname+'?demo=1';};
  let view=route[0]||'home';
  const person=profile||(session?{id:session.user.id,name:'Traveller'}:null);
  const ownMember=workspace?.members.find(m=>m.id===uid);
  const heading=authMode==='reset'?'Choose a new password.':view==='trip'?({preferences:'My private preferences',plan:'Your itinerary',voting:'Group votes',review:'Review the plan',bookings:'Booking handoff',journey:'Your travel journey',history:'Trip history'}[route[2]]||'Your trip overview'):
    view==='setup'?'A good trip starts here.':view==='join'?'Your friends are planning a trip.':
    view==='signup'?'A shared trip starts with you.':['signin','emailcode'].includes(view)?'Welcome back.':view==='recovery'?'Let’s get you back in.':'Make room for everyone.';
  const lockedTrip=workspace?.trip.stage==='agreed';
  const instruction=authMode==='reset'?'Choose and confirm your new password.':view==='trip'&&workspace?.trip.stage==='archived'?'This trip is archived. Read its saved details or History; the organiser can restore it from Archived trips.':view==='trip'&&workspace?.trip.stage==='postponed'?'This trip is postponed. Read the saved plan and decisions in History.':view==='trip'?({preferences:ownMember?.confirmed?'Review your saved private answers. Reopen them only if they need to change.':'Choose your dates, enter your limits and confirm only after checking them.',plan:lockedTrip?'Review your finalized itinerary or open your final journey. Booking is Phase 2.':'Check the itinerary and its missing steps before sharing it for review.',voting:lockedTrip?'Read the saved step decisions. This itinerary is locked.':'Compare the feasible choices and submit your own vote.',review:'Review your complete estimate and respond to the current plan.',bookings:workspace?.trip.workflow_version===2?'Booking handoff comes in Phase 2. Open your final journey to follow the finalized itinerary.':'Assign responsibilities, check providers and update only your own tasks.',journey:'Follow your finalized destination itinerary. Booking and transport checks are Phase 2.',history:'Read saved decisions, earlier versions and progress in one place.'}[route[2]]||(lockedTrip?'Your itinerary is finalized. Follow your final journey; booking is Phase 2.':ownMember?.confirmed?'Check group progress and review the itinerary when everyone is ready.':'Check the dates and group progress, then add your private input.')):
    view==='setup'?'Enter the trip basics. Apply date and time changes before creating the trip.':view==='join'?'Use your invitation and verify your email to join the group.':view==='signup'?'Create your organiser account, then verify your email.':view==='recovery'?'Request and verify your recovery code to choose a new password.':['signin','emailcode'].includes(view)?'Sign in to continue with your saved trips.':'Create a trip, join with an invitation or open one of your saved trips.';
  async function reloadTripList(){const data=await api<{profile:Person;trips:TripSummary[]}>('list');setTrips(data.trips);}
  useEffect(()=>{if(uid&&view==='home')void reloadTripList().catch(e=>setError(readableError(e)));},[uid,view]);
  async function saveBrief(brief:Brief,confirm:boolean,expectedRevision:number){
    if(!workspace)throw Error('Reload your trip before saving.');
    const result=await api<{revision:number}>('save_brief',{trip_id:tripId,brief:serializeBrief(brief),confirm,acknowledged:confirm,
      expected_revision:expectedRevision,request_id:crypto.randomUUID()});
    await refreshTrip();setNotice(confirm?'Your private input is confirmed and saved.':'Your private draft is saved. Confirm it when you are ready.');
    return result.revision;
  }
  return <>
    <a className="skip-link" href="#main">Skip to content</a>
    <AppHeader name={session?profile?.name||'Signed in':undefined} busy={busy} onHome={()=>go('home')} onSignIn={()=>go('signin')} onSignOut={()=>void perform(async()=>{const {error}=await supabase.auth.signOut();if(error)throw error;go('home');})}/>
    <main id="main" className="public-shell"><div className="page-heading"><h1>{heading}</h1><p>{instruction}</p></div>
      {error&&<div className="form-error" role="alert">{error}</div>}{notice&&<p className="notice" role="status">{notice}</p>}
      {loadingAuth?<Card title="Restoring your session…"><p>Please wait while Planzo checks your sign-in.</p></Card>:
      authMode==='reset'?<Auth mode="reset" onDone={()=>{recoveryVerified.current=false;setAuthMode('');go('home');setNotice('Your password is updated. You can sign out and sign in with your new password.');}} go={go}/>:
      view==='join'?<GuestJoin session={session} initialToken={route[1]||pendingInvite()} onJoined={id=>{go('trip',id);void api<{profile:Person;trips:TripSummary[]}>('list').then(d=>{setProfile(d.profile);setTrips(d.trips);});}}/>:
      view==='recovery'?<Recovery onVerified={()=>{setError('');recoveryVerified.current=true;setAuthMode('reset');}} go={go}/>:
      view==='emailcode'?<EmailCodeSignIn onDone={()=>go('home')} go={go}/>:['signup','signin'].includes(view)?<Auth key={view} mode={view} go={go} onDone={()=>{const token=pendingInvite();token?go('join',token):go('home');}}/>:
      view==='setup'&&person?<TripSetup person={person} onCancel={()=>go('home')} onSave={details=>{void perform(async()=>{
        const name=details.name?.trim();if(!name)throw Error('Enter a trip name.');
        const result=await api<{trip_id:string}>('create_trip',{request_id:createId.current,name,destination:details.destination,
          minimum:details.minimum,tentative_days:details.tentativeDays,deadline:details.deadline+'T23:59:00+05:30',windows:details.windows?.map(w=>({...w,start:w.start+':00+05:30',end:w.end+':00+05:30'}))});
        createId.current=crypto.randomUUID();const data=await api<{profile:Person;trips:TripSummary[]}>('list');setTrips(data.trips);go('trip',result.trip_id);
      });}}/>:
      view==='trip'&&session?(workspace&&person?<>
        <div className="trip-navigation"><nav className="tabs" aria-label="Trip navigation"><Button variant={!route[2]?'primary':'secondary'} aria-current={!route[2]?'page':undefined} onClick={()=>go('trip',tripId)}>Overview</Button>
        {(workspace.trip.workflow_version===2?['plan','voting',...(workspace.trip.stage==='agreed'?['journey']:[])]:['plan','voting','review','bookings']).map(tab=>{const active=route[2]===tab||(tab==='bookings'&&route[2]==='journey');return <Button key={tab} variant={active?'primary':'secondary'} aria-current={active?'page':undefined} onClick={()=>go('trip',tripId,tab)}>{tab==='plan'?'Itinerary':tab==='voting'?'Step decisions':tab==='journey'?'Final journey':tab==='bookings'?'Booking handoff':'Review & confirm'}</Button>;})}
        <Button variant={route[2]==='preferences'?'primary':'secondary'} aria-current={route[2]==='preferences'?'page':undefined} onClick={()=>go('trip',tripId,'preferences')}>My private input</Button>
        </nav><div className="trip-utilities"><Button variant="ghost" onClick={()=>go('home')}>All trips</Button><a href={'#/trip/'+tripId+'/history'} aria-current={route[2]==='history'?'page':undefined}>History</a><Button variant="ghost" disabled={busy} onClick={()=>perform(async()=>{await refreshTrip();setNotice('Showing the latest saved trip.');})}>Refresh</Button></div></div>
        {workspace.trip.workflow_version===2&&['preferences','plan','voting','review','bookings','journey','history'].includes(route[2])?<><LivePrivatePlanning key={tripId+uid} workspace={workspace} userId={person.id} tab={route[2]} onRefresh={()=>refreshTrip()} go={tab=>go('trip',tripId,tab)}/>{route[2]==='history'&&<LiveHistory workspace={workspace}/>}</>:
        route[2]==='history'?<LiveHistory workspace={workspace}/>:
        route[2]==='preferences'?<Preferences key={tripId+uid} trip={asTrip(workspace,person)} personId={person.id} live readOnly={workspace.trip.stage==='archived'} savedRevision={workspace.own_brief?.revision||0} onSave={saveBrief} onInterpret={interpretPreferences} onDone={()=>go('trip',tripId)}/>:
        route[2]==='bookings'?<LiveBookings key={tripId+uid} workspace={workspace} userId={person.id} onRefresh={()=>refreshTrip()} go={tab=>go('trip',tripId,tab)}/>:
        ['plan','voting','review'].includes(route[2])?<LivePlanning key={tripId+uid} workspace={workspace} person={person} tab={route[2]} onRefresh={()=>refreshTrip()} go={tab=>go('trip',tripId,tab)}/>:
        <div className="columns"><div><Card title={workspace.trip.name} sub={workspace.trip.destination+' · '+workspace.members.length+' joined · minimum '+workspace.trip.minimum_group_size}>
          <Badge tone={workspace.trip.stage==='agreed'?'positive':'pending'}>{planStage(workspace.trip.stage)}</Badge>
          <p>{workspace.trip.stage==='agreed'?'Your itinerary is finalized. Open your final journey; booking handoff will be done in Phase 2.':'Add your personal travel times and preferences. Everyone sees progress; your raw limits remain private.'}</p>
          <Button onClick={()=>go('trip',tripId,'preferences')}>{workspace.trip.stage==='archived'?'View my saved input':ownMember?.confirmed?'Review my private input':'Add my private input'}</Button>
          <h3>Tentative destination windows</h3>{workspace.windows.map(w=><p key={w.id}>{windowText(asTrip(workspace,person),w.id)} · {w.start.slice(11)} → {w.end.slice(11)} IST</p>)}
          <p className="small muted">Response deadline: {new Date(workspace.trip.response_deadline).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'})} IST</p>
          <p className="small muted">Tentative duration: {workspace.trip.tentative_days??3} days</p>
          {ownMember?.role==='organiser'&&workspace.trip.workflow_version===2&&!['archived','postponed'].includes(workspace.trip.stage)&&<TripDetailsEditor key={tripId+':'+workspace.trip.revision} workspace={workspace} person={person} onSaved={async()=>{await reloadTripList();await refreshTrip();}}/>}
          <TripControls trip={{...workspace.trip,role:ownMember?.role||'member',can_delete:workspace.members.length===1&&!ownMember?.revision&&!invites.length&&trips.find(t=>t.id===tripId)?.can_delete}} onDone={async()=>{await reloadTripList();await refreshTrip();go('home');}}/>
        </Card><Card title="Your group" sub="Safe progress only. Private budgets and preference text are never included here.">
          {workspace.members.map(m=><div className="member-row" key={m.id}><strong>{m.name}{m.id===uid?' · you':''}</strong><span>{m.role} · {m.included?'included traveller':'observer'}</span><Badge tone={m.confirmed?'positive':'pending'}>{m.confirmed?'Input confirmed':m.revision?'Draft saved':'Input pending'}</Badge></div>)}
        </Card></div><aside>
          {ownMember?.role==='organiser'?<Card title="Invite your friends" tone="mint"><p>Friends verify their email with a code. They do not need a password or a separate signup form.</p>
            <Button disabled={busy||workspace.trip.stage!=='collecting'} onClick={()=>perform(async()=>{const result=await api<Invite>('create_invite',{trip_id:tripId});setFreshInvite(result);await loadInvites();})}>Create invitation link</Button>
            {freshInvite?.token&&<><Field label="Invitation link"><input readOnly value={invitationUrl(freshInvite.token)}/></Field><Button variant="secondary" onClick={()=>void copyInvitationLink(freshInvite.token!)}>Copy invitation</Button><p className="caption">Expires {new Date(freshInvite.expires_at).toLocaleString('en-IN')}. Copy it now; only its secure hash is stored.</p></>}
            {invites.map(i=><div className="invite-row" key={i.id}><span>{i.revoked_at?'Revoked':new Date(i.expires_at)<new Date()?'Expired':'Active'} · {new Date(i.expires_at).toLocaleDateString('en-IN')}</span>
              {!i.revoked_at&&new Date(i.expires_at)>new Date()&&<Button variant="ghost" disabled={busy} onClick={()=>perform(async()=>{await api('revoke_invite',{trip_id:tripId,invite_id:i.id});if(freshInvite?.id===i.id)setFreshInvite(null);await loadInvites();})}>Revoke</Button>}</div>)}
          </Card>:<Note title="You are a member">Only the organiser can create or revoke invitations. Your private input belongs to you.</Note>}
          {workspace.trip.workflow_version===2?<Card title="Your planning journey"><ol className="personal-journey"><li><strong>Private inputs</strong><span>{workspace.members.filter(m=>m.included&&m.confirmed).length} / {workspace.members.filter(m=>m.included).length} confirmed</span></li><li><strong>Itinerary and step decisions</strong><Button variant="ghost" onClick={()=>go('trip',tripId,'plan')}>Open itinerary</Button></li><li><strong>Finalized itinerary and journey</strong><span>{workspace.trip.stage==='agreed'?'Everyone reviewed · itinerary finalized':'Resolve decisions, review and finalize the itinerary'}</span>{workspace.trip.stage==='agreed'&&<Button variant="secondary" onClick={()=>go('trip',tripId,'journey')}>Open final journey</Button>}</li><li><strong>Booking handoff · Phase 2</strong><span>Transport, accommodation, responsibilities and live prices come in the second phase.</span></li></ol></Card>:<LiveMilestones tripId={tripId} revision={workspace.trip.revision}/>}
          <Note title="Next step">{workspace.trip.stage==='archived'?'Read saved decisions in History. The organiser can restore this trip from the Archived list.':workspace.trip.stage==='agreed'?'Follow your final journey. Booking handoff, provider checks and reservations are Phase 2.':ownMember?.confirmed?'Follow the group’s input progress. Open Itinerary when everyone included has confirmed.':'Add and confirm your private input. The group sees completion status, not your raw limits.'}</Note>
        </aside></div>}
      </>:<Card title="Opening your shared trip…"><p>If this takes longer than expected, use Home and reopen the trip.</p><Button onClick={()=>go('home')}>Home</Button></Card>):
      session?<div className="columns trip-dashboard"><Card className="trips-card" title="Your trips" sub="Saved securely and available when you sign in on another device.">
        <Button onClick={()=>go('setup')}>Create a trip</Button><div className="trip-buckets" role="group" aria-label="Trip lists">{[['active','Active'],['archived','Archived'],['deleted','Deleted drafts']].map(([id,label])=><Button key={id} variant={tripBucket===id?'primary':'ghost'} aria-pressed={tripBucket===id} onClick={()=>setTripBucket(id)}>{label}</Button>)}</div>
        {trips.filter(t=>tripBucket==='active'?t.stage!=='archived':tripBucket==='deleted'?t.removal_kind==='deleted_draft':t.stage==='archived'&&t.removal_kind!=='deleted_draft').map(t=><div className="trip-list-item" key={t.id}><div className="trip-card-summary"><h3>{t.name}</h3><p className="small muted">{t.destination} · {t.role}{t.stage==='archived'?' · '+(t.removal_kind==='deleted_draft'?'Deleted draft':'Archived'):''}</p></div><div className="trip-card-actions"><Button variant="secondary" onClick={()=>go('trip',t.id)}>Open trip</Button><TripControls trip={t} onDone={reloadTripList}/></div></div>)}
        {!trips.some(t=>tripBucket==='active'?t.stage!=='archived':tripBucket==='deleted'?t.removal_kind==='deleted_draft':t.stage==='archived'&&t.removal_kind!=='deleted_draft')&&<p>No trips in this list.</p>}
        <Button variant="ghost" onClick={()=>go('join')}>Join with an invitation</Button>
      </Card><Card title="Your group, your pace" tone="mint"><Coast/><Feature icon="lock" title="Your limits stay private"/><Feature icon="people" title="Everyone contributes as themselves"/><Button variant="secondary" onClick={sample}>Explore the separate Goa sample</Button></Card></div>:
      <div className="columns welcome"><Card title="Plan together. Travel together." sub="Private preferences. Shared trips. Clear decisions." tone="mint"><Coast variant="large"/><div className="benefits"><Feature icon="lock" title="Private limits"/><Feature icon="wallet" title="Full costs"/><Feature icon="people" title="Equal say"/></div></Card>
        <aside><Card title="Your next good trip"><p className="muted">Start a shared trip, invite your friends and save what works for each of you.</p><Button onClick={()=>go('signup')}>Create a trip</Button><Button variant="secondary" onClick={()=>go('join')}>Join with an invite</Button><Note title="Your group, your pace">A respectful no or a postponed trip is a useful outcome.</Note><Button variant="secondary" onClick={()=>go('signin')}>I already have an account</Button></Card><Button variant="ghost" onClick={sample}>Explore the separate Goa sample →</Button><p className="caption muted">The sample uses fictional data. Your shared trips save your real inputs.</p></aside></div>}
      {busy&&<p role="status">Saving your request…</p>}
    </main><footer className="app-footer">Planzo · private preferences, shared trips</footer>
  </>;
}

function Auth({mode,onDone,go}:{mode:string;onDone:()=>void;go:(...parts:string[])=>void}){
  const [signupCode,setSignupCode]=useState(''),[confirmationNote,setConfirmationNote]=useState('');
  const [name,setName]=useState(''),[email,setEmail]=useState(''),[password,setPassword]=useState(''),[repeat,setRepeat]=useState('');
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[sent,setSent]=useState(false);
  async function submit(e:React.SubmitEvent<HTMLFormElement>){e.preventDefault();setError('');setBusy(true);try{
    if(mode==='signup'){
      if(!name.trim())throw Error('Enter your name.');
      const {error}=await supabase.auth.signUp({email:email.trim(),password,options:{data:{display_name:name.trim()},emailRedirectTo:callbackUrl('confirmed')}});if(error)throw error;setSent(true);
    }else if(mode==='reset'){
      if(password!==repeat)throw Error('The passwords do not match.');
      const {error}=await supabase.auth.updateUser({password});if(error)throw error;onDone();
    }else{
      const {error}=await supabase.auth.signInWithPassword({email:email.trim(),password});if(error)throw error;onDone();
    }
  }catch(e){setError(readableError(e));}finally{setBusy(false);}}
  async function confirmSignup(e:React.SubmitEvent<HTMLFormElement>){e.preventDefault();setBusy(true);setError('');try{const {data,error}=await supabase.auth.verifyOtp({email:email.trim(),token:signupCode,type:'email'});if(error)throw error;if(!data.session||!data.user?.email_confirmed_at)throw Error('Email confirmation is not complete. Use the newest confirmation code.');setSignupCode('');onDone();}catch(e){setError(readableError(e));}finally{setBusy(false)}}
  async function resendSignup(){setBusy(true);setError('');try{const {error}=await supabase.auth.resend({type:'signup',email:email.trim(),options:{emailRedirectTo:callbackUrl('confirmed')}});if(error)throw error;setSignupCode('');setConfirmationNote('A new confirmation email was requested. Use its newest code.');}catch(e){setError(readableError(e));}finally{setBusy(false)}}
  return <div className="columns account-layout"><Card title="Less chasing. More planning." tone="mint" className="account-context"><img className="coast" src={mode==='signup'?assets.signup.imgEditableIllustrationGoaCoast:assets.signin.imgEditableIllustrationGoaCoast} alt="Illustrated Goa coastline with a palm tree, sailboat and warm sunset"/><Feature icon="people" title="Everyone gets a voice">Private preferences and a shared plan.</Feature><Feature icon="lock" title="Your own verified identity">Friends cannot respond as someone else.</Feature></Card>
    <Card className="account-form" title={mode==='signup'?(sent?'Confirm your email':'Create your Planzo account'):mode==='recovery'?'Reset your password':mode==='reset'?'Choose your new password':'Sign in to Planzo'}>
      {error&&<p className="form-error" role="alert">{error}</p>}
      {sent&&mode==='signup'?<SignupConfirmation email={email} code={signupCode} notice={confirmationNote} busy={busy} onCode={setSignupCode} onVerify={e=>void confirmSignup(e)} onResend={()=>void resendSignup()} onChangeEmail={()=>{setSent(false);setSignupCode('');setConfirmationNote('');}}/>:sent?<><Note title="Check your email">{mode==='signup'?'Check your inbox for the confirmation email, then return here to sign in.':'If an account exists for this address, the recovery instructions have been requested. Check your inbox.'}</Note><p className="small muted">Email delivery depends on the configured sender. If no message arrives, retry later or contact the trip organiser.</p><Button onClick={()=>go('signin')}>Return to sign in</Button></>:
      <form onSubmit={submit} className="stack"><fieldset disabled={busy} className="auth-fields">
        {mode==='signup'&&<Field label="Your name"><input required maxLength={50} autoComplete="given-name" value={name} onChange={e=>setName(e.target.value)}/></Field>}
        {mode!=='reset'&&<Field label="Email address"><input type="email" required autoComplete="email" maxLength={254} value={email} onChange={e=>setEmail(e.target.value)}/></Field>}
        {mode!=='recovery'&&<Field label={mode==='reset'?'New password':'Password'} hint={mode==='signup'||mode==='reset'?'Use at least 12 characters.':undefined}><input type="password" required minLength={mode==='signin'?1:12} maxLength={128} autoComplete={mode==='signin'?'current-password':'new-password'} value={password} onChange={e=>setPassword(e.target.value)}/></Field>}
        {mode==='reset'&&<Field label="Confirm new password"><input type="password" required minLength={12} maxLength={128} autoComplete="new-password" value={repeat} onChange={e=>setRepeat(e.target.value)}/></Field>}
        <Button type="submit" disabled={busy}>{busy?'Please wait…':mode==='signup'?'Create account':mode==='recovery'?'Send recovery email':mode==='reset'?'Save new password':'Sign in'}</Button>
      </fieldset></form>}
      <Actions><Button variant="ghost" onClick={()=>go(mode==='signup'?'signin':'signup')}>{mode==='signup'?'Already have an account? Sign in':'Create an account'}</Button>{mode==='signin'&&<><Button variant="ghost" onClick={()=>go('recovery')}>Forgot password?</Button><Button variant="secondary" onClick={()=>go('emailcode')}>Sign in with an email code</Button></>}</Actions>
      <Note title="Friends join by invitation">Friends verify an email code without choosing a password or filling in a signup form.</Note>
    </Card></div>;
}

function Recovery({onVerified,go}:{onVerified:()=>void;go:(...parts:string[])=>void}){
  const [email,setEmail]=useState(''),[code,setCode]=useState(''),[verify,setVerify]=useState(false);
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  async function submit(e:React.SubmitEvent<HTMLFormElement>){e.preventDefault();setError('');setBusy(true);try{
    if(verify){
      const {data,error}=await supabase.auth.verifyOtp({email:email.trim(),token:code,type:'recovery'});
      if(error)throw error;if(!data.session)throw Error('Recovery could not be verified. Request a new email and try its code.');
      onVerified();
    }else{
      const {error}=await supabase.auth.resetPasswordForEmail(email.trim(),{redirectTo:callbackUrl('recovery')});
      if(error)throw error;setVerify(true);setCode('');
    }
  }catch(e){setError(readableError(e));}finally{setBusy(false);}}
  return <div className="columns account-layout"><Card title="Get back to your plans" tone="mint" className="account-context"><Coast/><Feature icon="lock" title="Verify your email first">Enter the recovery code in Planzo, then choose a new password.</Feature><Feature icon="people" title="Use the browser you prefer">Your email can open elsewhere. Return here to enter its code.</Feature></Card>
    <Card className="account-form" title={verify?'Enter your recovery code':'Reset your password'}>
      {error&&<p className="form-error" role="alert">{error}</p>}
      {verify&&<Note title="Check your newest email">If an account exists for this address, a recovery email has been requested. Enter its code below. You do not need to click an email link.</Note>}
      <form onSubmit={submit} className="stack"><fieldset disabled={busy} className="auth-fields">
        <Field label="Email address"><input type="email" required autoComplete="email" maxLength={254} value={email} onChange={e=>{setEmail(e.target.value);setCode('');}}/></Field>
        {verify&&<Field label="Recovery code"><input required inputMode="numeric" pattern="[0-9]{6,8}" minLength={6} maxLength={8} autoComplete="one-time-code" value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,''))}/></Field>}
        <Button type="submit" disabled={busy}>{busy?'Please wait…':verify?'Verify recovery code':'Send recovery email'}</Button>
        <Button variant="ghost" onClick={()=>{setVerify(!verify);setCode('');setError('');}}>{verify?'Request a new recovery email':'I already have a recovery code'}</Button>
      </fieldset></form><Actions><Button variant="secondary" onClick={()=>go('signin')}>Return to sign in</Button></Actions>
    </Card></div>;
}

function EmailCodeSignIn({onDone,go}:{onDone:()=>void;go:(...parts:string[])=>void}){
  const [email,setEmail]=useState(''),[code,setCode]=useState(''),[sent,setSent]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  async function submit(e:React.SubmitEvent<HTMLFormElement>){e.preventDefault();setError('');setBusy(true);try{
    if(sent){
      const {error}=await supabase.auth.verifyOtp({email:email.trim(),token:code,type:'email'});if(error)throw error;onDone();
    }else{
      const {error}=await supabase.auth.signInWithOtp({email:email.trim(),options:{shouldCreateUser:false,emailRedirectTo:callbackUrl('guest')}});if(error)throw error;setSent(true);
    }
  }catch(e){setError(readableError(e));}finally{setBusy(false);}}
  return <div className="columns"><Card title="Return with an email code" sub="Use the same email you verified when joining. Your invitation can be expired or revoked; your existing membership stays available.">
    {error&&<p className="form-error" role="alert">{error}</p>}
    <form onSubmit={submit} className="stack"><fieldset disabled={busy} className="auth-fields">
      <Field label="Email address"><input type="email" required readOnly={sent} autoComplete="email" maxLength={254} value={email} onChange={e=>setEmail(e.target.value)}/></Field>
      {sent&&<><Note title="Check your email">Enter the Planzo sign-in code. No password is needed.</Note><Field label="Email verification code"><input required inputMode="numeric" pattern="[0-9]{6,8}" minLength={6} maxLength={8} autoComplete="one-time-code" value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,''))}/></Field></>}
      <Button type="submit" disabled={busy}>{busy?'Please wait…':sent?'Verify code and sign in':'Send sign-in code'}</Button>
      {sent&&<Button variant="ghost" onClick={()=>{setSent(false);setCode('');}}>Change email or request a new code</Button>}
    </fieldset></form><Actions><Button variant="ghost" onClick={()=>go('signin')}>Use a password instead</Button><Button variant="secondary" onClick={()=>go('join')}>Joining for the first time?</Button></Actions>
  </Card><aside><Card title="Pick up where you left off" tone="mint"><Coast/><Feature icon="lock" title="Your membership is saved">Sign in on another device to open your trips and your own private inputs.</Feature><Feature icon="people" title="First time here?">Open a valid invitation from your organiser to join a new trip.</Feature></Card></aside></div>;
}

function GuestJoin({session,initialToken,onJoined}:{session:Session|null;initialToken:string;onJoined:(id:string)=>void}){
  const [inviteInput,setInviteInput]=useState(initialToken),[name,setName]=useState(''),[email,setEmail]=useState(''),[code,setCode]=useState('');
  const [sent,setSent]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [preview,setPreview]=useState<{name:string;destination:string}|null>(null);
  const token=invitationToken(inviteInput);
  useEffect(()=>{setPreview(null);if(!token)return;let cancelled=false;
    supabase.rpc('planzo_invite_preview',{p_token:token}).then(({data,error})=>{if(cancelled)return;if(error)setError(error.message);else{setError('');setPreview(data);RememberInvite(token);}});
    return()=>{cancelled=true;};
  },[token]);
  async function join(){const result=await api<{trip_id:string}>('join',{token,name:name.trim()});try{sessionStorage.removeItem('planzo.pending-invite');}catch{}onJoined(result.trip_id);}
  async function submit(e:React.SubmitEvent<HTMLFormElement>){e.preventDefault();setError('');setBusy(true);try{
    if(!token||!preview)throw Error('Open a valid invitation link first.');
    if(!name.trim())throw Error('Enter your name.');
    RememberInvite(token);
    if(session){await join();}
    else if(sent){
      const {error}=await supabase.auth.verifyOtp({email:email.trim(),token:code,type:'email'});if(error)throw error;await join();
    }else{
      const {error}=await supabase.auth.signInWithOtp({email:email.trim(),options:{shouldCreateUser:true,data:{display_name:name.trim()},emailRedirectTo:callbackUrl('guest')}});if(error)throw error;setSent(true);
    }
  }catch(e){setError(readableError(e));}finally{setBusy(false);}}
  return <div className="columns"><Card title={preview?'Join '+preview.name:'Join your friends'} sub={preview?.destination||'Open the invitation your organiser shared.'}>
    {error&&<p className="form-error" role="alert">{error}</p>}
    <form onSubmit={submit} className="stack"><fieldset disabled={busy} className="auth-fields">
      <Field label="Invitation link or code"><input required value={inviteInput} onChange={e=>{setInviteInput(e.target.value);setSent(false);}} autoComplete="off" spellCheck={false}/></Field>
      <Field label="Your name"><input required maxLength={50} autoComplete="given-name" value={name} onChange={e=>setName(e.target.value)}/></Field>
      {session?<Note title="Email verified">Joining as {session.user.email}. To use another email, sign out first.</Note>:<>
      <Field label="Email address"><input type="email" required readOnly={sent} autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)}/></Field>
      {sent&&<><Note title="Check your email">Enter the sign-in code from Planzo. No password is needed.</Note><Field label="Email verification code"><input required inputMode="numeric" pattern="[0-9]{6,8}" minLength={6} maxLength={8} autoComplete="one-time-code" value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,''))}/></Field><Button variant="ghost" onClick={()=>{setSent(false);setCode('');}}>Change email or request a new code</Button></>}
      </>}
      <Button type="submit" disabled={busy||!preview}>{busy?'Please wait…':session?'Join this trip':sent?'Verify email and join':'Send email code'}</Button>
    </fieldset></form>
  </Card><aside><Card title="No separate signup" tone="mint"><Coast/><Feature icon="lock" title="Your email proves it is you">Use the same email to return on another device.</Feature><Feature icon="people" title="Your preferences stay yours">The group sees your completion status, not your raw limits.</Feature></Card></aside></div>;
}
