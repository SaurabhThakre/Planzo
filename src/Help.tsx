import {useEffect,useRef,useState} from 'react';
import type {ReactNode} from 'react';
import {Badge,Button,Card,Icon} from './ui';
import {InPlacePanel} from './InPlacePanel';

export type HelpTopic='organise-trip'|'join-trip'|'private-input'|'itinerary-decisions'|'final-journey-booking'|'troubleshooting';

const topics:{id:HelpTopic;label:string;summary:string;icon:string}[]=[
 {id:'organise-trip',label:'Organise a trip',summary:'Create the shared trip and invite travellers.',icon:'map'},
 {id:'join-trip',label:'Join a trip',summary:'Open an invitation and verify your email.',icon:'link'},
 {id:'private-input',label:'Private input',summary:'Confirm your own dates, budget and preferences.',icon:'lock'},
 {id:'itinerary-decisions',label:'Itinerary & decisions',summary:'Find the schedule, individual votes and personal review.',icon:'people'},
 {id:'final-journey-booking',label:'Final journey & booking',summary:'Confirm the plan and use the final journey.',icon:'plane'},
 {id:'troubleshooting',label:'Troubleshooting',summary:'Fix invitation, code and planning issues.',icon:'help'},
];

const journey:{label:string;topic:HelpTopic;icon:string}[]=[
 {label:'Confirm private input',topic:'private-input',icon:'lock'},
 {label:'Review the itinerary',topic:'itinerary-decisions',icon:'map'},
 {label:'Resolve step decisions if needed',topic:'itinerary-decisions',icon:'people'},
 {label:'Confirm the plan',topic:'itinerary-decisions',icon:'check'},
 {label:'View Final journey',topic:'final-journey-booking',icon:'plane'},
];

export const helpHref=(topic:HelpTopic)=>location.pathname+'#/help/'+topic;

export function ContextHelpLink({topic,children}:{topic:HelpTopic;children:ReactNode}){
 const [open,setOpen]=useState(false);
 return <><button type="button" className="context-help-link context-help-button" onClick={()=>setOpen(true)}>{children}</button>
  {open&&<InPlacePanel title="Help & documentation" className="help-panel" onClose={()=>setOpen(false)}>{({close})=><HelpPage shell="shared" initialTopic={topic} onReturn={()=>close()} allowWalkthrough={false}/>}</InPlacePanel>}</>;
}

function HelpHeroArt(){
 return <div className="help-hero-art" role="img" aria-label="Travel-guide illustration with a folded map, dotted route, compass and fictional ticket">
  <svg viewBox="0 0 390 178" fill="none" xmlns="http://www.w3.org/2000/svg">
   <path d="M34 34c39-20 85-22 126-4 35 15 76 17 112 5 33-11 67-4 84 20 18 25 11 61-14 82-30 25-75 16-112 16-42 0-79 19-123 10-53-10-84-47-73-89 4-16 12-29 23-40Z" fill="#EAF4EE"/>
   <path d="M40 125c37-19 62-12 95 8 31 19 63 27 102 18 42-9 80-14 119 3v18H40v-47Z" fill="#F1E9DA"/>
   <g stroke="#235A4D" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m76 49 58-14 49 18 58-14v76l-58 14-49-18-58 14V49Z" fill="#fff"/>
    <path d="M134 35v76m49-58v76"/>
    <path d="M92 91c21-28 40 6 59-14 18-19 30 20 56-5" strokeDasharray="4 7"/>
    <circle cx="91" cy="91" r="5" fill="#D76744" stroke="#fff" strokeWidth="3"/>
    <path d="M203 72c0 8-10 17-10 17s-10-9-10-17a10 10 0 1 1 20 0Z" fill="#EAF4EE"/>
    <circle cx="193" cy="72" r="3"/>
    <circle cx="280" cy="73" r="29" fill="#fff"/>
    <circle cx="280" cy="73" r="22"/>
    <path d="m288 63-5 14-14 5 5-14 14-5Z" fill="#F1E9DA"/>
    <path d="M280 46v5m0 44v5m-27-27h5m44 0h5"/>
    <path d="M253 112h89l-7 43h-75l-7-43Z" fill="#fff"/>
    <path d="M270 112v43m50-43v43M281 126h27m-27 10h18"/>
   </g>
   <text x="277" y="148" fill="#235A4D" fontFamily="Inter, sans-serif" fontSize="8" fontWeight="700">PLANZO PASS</text>
  </svg>
 </div>;
}

function GuideVisual({kind,demo=false}:{kind:'join'|'decisions'|'journey'|'fixes';demo?:boolean}){
 const data={
  join:{caption:'Invitation to verified membership',label:'Illustrated flow: open a fictional invitation link, receive an email code, then verify and join.',steps:[['link','Invitation link','Open the shared link'],['mail','Email code','Use the newest message'],['check','Verified','Join the trip']]},
  decisions:{caption:'Read the plan, resolve choices, then review',label:demo?'Illustrated flow: read the Goa schedule in Plan, vote in Decisions, then review and respond.':'Illustrated flow: read the schedule in Itinerary, resolve choices in Step decisions, then return to Itinerary to review.',steps:[['map',demo?'Plan':'Itinerary','Check the route and estimates'],['people',demo?'Decisions':'Step decisions','Compare and vote on one stop'],['check',demo?'Review and respond':'Back to Itinerary',demo?'Respond to the current plan':'Review and lock the current version']]},
  journey:{caption:'Journey and booking handoff',label:'Illustrated flow: follow the locked final journey, then independently check booking tasks with real providers.',steps:[['plane','Final journey','Use the locked day-by-day route'],['calendar','Bookings','Check current provider options'],['check','Self-report','Not a verified reservation']]},
  fixes:{caption:'Three cues to check first',label:'Troubleshooting cues: request a fresh invitation link, use the newest email code, and check estimate assumptions before proceeding.',steps:[['link','Link','Ask for a fresh active invite'],['clock','Code','Use the newest email code'],['wallet','Estimate','Read prices and assumptions']]},
 }[kind];
 return <figure className={'help-flow-figure '+(kind==='fixes'?'three-cues':'')}>
  <figcaption><strong>Illustrated guide</strong> · {data.caption}</figcaption>
  <div className="help-visual-flow" role="img" aria-label={data.label}>
   {data.steps.map(([icon,title,copy],index)=><div className="help-visual-stage" key={title}>
    <span className="help-visual-icon"><Icon name={icon}/></span>
    <span><strong>{title}</strong><small>{copy}</small></span>
    {index<data.steps.length-1&&<span className="help-route-arrow" aria-hidden="true">→</span>}
   </div>)}
  </div>
 </figure>;
}

function HelpNote({icon,title,children}:{icon:string;title:string;children:ReactNode}){
 return <div className="help-privacy"><span className="help-note-icon"><Icon name={icon}/></span><div><strong>{title}</strong><p>{children}</p></div></div>;
}

function Question({children}:{children:ReactNode}){
 return <span className="help-question"><Icon name="help"/>{children}</span>;
}

function ExampleFigure({kind}:{kind:'invite'|'private'}){
 const invite=kind==='invite';
 return <figure className="help-figure">
  <figcaption><strong>Illustrated example</strong> · Fictional shared trip · {invite?'Open the invitation panel from Share.':'Open and confirm your own private input.'}</figcaption>
  <div className="help-mock" role="img" aria-label={invite?'Illustration of the Invite your friends card':'Illustration of the shared trip navigation and private input guide'}>
   <div className="help-mock-bar"><Icon brand/><span>Planzo</span><span className="help-mock-pill">{invite?'Overview → Share':'Shared trips'}</span></div>
   {invite?<div className="help-mock-card">
    <span className="help-callout" aria-hidden="true">1</span><h3><Icon name="people"/>Invite your friends</h3>
    <p>Friends verify their email with a code.</p><span className="help-mock-button">Create invitation link</span>
    <div className="help-mock-field"><span><Icon name="link"/>Invitation link</span><span>Available after you create it</span></div>
    <span className="help-callout second" aria-hidden="true">2</span>
   </div>:<>
    <div className="help-mock-tabs"><span>Overview</span><span>Itinerary</span><span className="selected">My private input</span><span className="help-callout" aria-hidden="true">1</span></div>
    <div className="help-mock-card"><h3><Icon name="lock"/>Your private planning guide</h3>
     <div className="help-mock-steps"><span>1 · Destination times</span><span>2 · Whole-trip budget</span><span>3 · Places and interests</span></div>
     <span className="help-mock-button">Confirm my private summary</span><span className="help-callout second" aria-hidden="true">2</span>
    </div>
   </>}
  </div>
  <ol className="help-callout-copy">
   {invite?<><li><strong>Select Share on Overview.</strong> This opens the “Invite your friends” panel.</li><li><strong>Select “Create invitation link”.</strong> Copy the newly shown link and share it yourself.</li></>:<><li><strong>Select “My private input”.</strong> This opens only your own planning guide.</li><li><strong>Complete all six steps.</strong> Review, then select “Confirm my private summary”.</li></>}
  </ol>
 </figure>;
}

function Guide({topic,shell}:{topic:HelpTopic;shell:'shared'|'demo'}){
 switch(topic){
  case'organise-trip':return <>
   <p className="help-lede">Start with the shared dates and destination, then invite each traveller to contribute as themselves.</p>
   {shell==='demo'?<ol><li>Select <strong>Create another trip</strong> and complete the trip basics.</li><li>On <strong>Invite your friends</strong>, select <strong>Copy invite link</strong> or <strong>Preview friend invitation</strong>.</li><li>Use fictional information for the sample invitation and any traveller details.</li></ol>:<>
    <ol><li>Select <strong>Create a trip</strong> and complete the trip basics.</li><li>On <strong>Overview</strong>, select <strong>Share</strong> to open <strong>Invite your friends</strong>.</li><li>Select <strong>Create invitation link</strong>, then <strong>Copy invitation</strong>.</li><li>Share the link with the people you want to invite.</li></ol>
    <ExampleFigure kind="invite"/>
   </>}
   <details><summary><Question>Can I reuse an invitation?</Question></summary><p>{shell==='demo'?'Sample invitations work in the browser where the trip is saved while the invitation is active.':'Use it while it is active and before its expiry. The organiser can revoke it and create a new link through Share.'}</p></details>
  </>;
  case'join-trip':return shell==='demo'?<>
   <p className="help-lede">Use a fictional invitation and display name to try joining in the same browser.</p>
   <ol><li>From <strong>Invite your friends</strong>, select <strong>Preview friend invitation</strong>.</li><li>Enter a fictional name and choose <strong>Join as guest</strong>.</li></ol>
  </>:<>
   <p className="help-lede">A traveller joins from the organiser’s invitation and verifies the email they will use to return.</p>
   <ol><li>Open the invitation or select <strong>Join with an invite</strong>.</li><li>Paste the <strong>Invitation link or code</strong>.</li><li>Enter <strong>Your name</strong> and <strong>Email address</strong>.</li><li>Select <strong>Send email code</strong>.</li><li>Enter the newest <strong>Email verification code</strong>, then select <strong>Verify email and join</strong>.</li></ol>
   <GuideVisual kind="join"/>
   <details><summary><Question>I did not receive a code. What should I do?</Question></summary><p>Check the address, spam folder and newest message. Select <strong>Change email or request a new code</strong> before trying again. If the invitation expired, ask the organiser for a fresh link.</p></details>
   <details><summary><Question>Do travellers need a password?</Question></summary><p>No. The invitation flow verifies an email code and does not require a separate signup form.</p></details>
   <details><summary><Question>How do I return to a shared trip?</Question></summary><p>Open <strong>Sign in</strong>. Choose <strong>Password</strong> if you set one, or <strong>Email code</strong> and use the same email you verified when joining.</p></details>
  </>;
  case'private-input':return shell==='demo'?<>
   <p className="help-lede">Enter fictional dates, a budget and preferences for the current sample traveller.</p>
   <ol><li>Open <strong>My private input</strong>.</li><li>Complete the sample brief. Use <strong>Save draft</strong> if you want to return to it later in this browser.</li><li>Select <strong>Confirm my private input</strong> when you have checked your entries.</li></ol>
  </>:<>
   <p className="help-lede">Each traveller confirms their own availability, whole-trip ceiling and planning preferences.</p>
   <ol><li>Open the trip and select <strong>My private input</strong>.</li><li>Complete <strong>Your destination times</strong> and <strong>Your whole-trip budget</strong>.</li><li>Add shareable places, then describe private must-haves and flexible preferences.</li><li>Review the proposed planning requests and what may be shared.</li><li>Select <strong>Confirm my private summary</strong>.</li></ol>
   <HelpNote icon="lock" title="What the group sees">The group sees whether your input is pending or confirmed. Your raw budget limit, starting city and private notes stay private. Short planning requests you explicitly review are shared for itinerary planning.</HelpNote>
   <ExampleFigure kind="private"/>
   <details><summary><Question>Can the organiser see my budget?</Question></summary><p>No. The organiser and group see completion status, not your raw ceiling or private reasons.</p></details>
   <details><summary><Question>Can I change confirmed input?</Question></summary><p>Yes. Use <strong>Edit my confirmed answers</strong>, acknowledge the impact, then select <strong>Reopen my private input</strong>. The trip will need fresh planning and review.</p></details>
  </>;
  case'itinerary-decisions':return <>
   {shell==='demo'?<>
    <p className="help-lede">Use Plan for the Goa schedule and Decisions for individual choices.</p>
    <ol><li>Open <strong>Plan</strong> and select a day to read its stops, times and estimates.</li><li>Open <strong>Decisions</strong> to find open votes. You can also open a stop marked <strong>Decision pending</strong> and choose <strong>View decision</strong>.</li><li>Compare the options and submit your ballot when the vote is open. Select <strong>View in itinerary</strong> to return to the relevant day.</li><li>When you are ready to respond to the whole plan, choose <strong>Review and respond</strong> from the itinerary.</li></ol>
    <GuideVisual kind="decisions" demo/>
   </>:<>
    <p className="help-lede">Read the whole trip in Itinerary. Use Step decisions for votes about individual stops.</p>
    <ol><li>Open <strong>Itinerary</strong> and select a day. Check the route, local timing, assumptions and estimates.</li><li>Open a stop marked <strong>Decision pending</strong> and select <strong>View decision</strong>. To propose a change to an eligible stop, use <strong>Raise a concern about this step</strong>.</li><li>In <strong>Step decisions</strong>, compare the arrangements, check the deadline and submit your own ballot. Open <strong>Resolved decisions</strong> to see saved outcomes.</li><li>Choose <strong>View in itinerary</strong> to return to that stop. Under <strong>Review and lock this itinerary</strong>, check your estimate and requirement outcomes before selecting <strong>Confirm my personal review</strong>.</li><li>The organiser selects <strong>Lock resolved itinerary</strong> after everyone included reviews that version.</li></ol>
    <GuideVisual kind="decisions"/>
    <HelpNote icon="map" title="Find your trip tools">Use the sidebar on desktop or <strong>Trip menu</strong> on smaller screens. <strong>Overview → Trip passport</strong> shows planning progress. <strong>History</strong> shows earlier itinerary versions and decisions. Some older trips use a separate <strong>Review &amp; confirm</strong> section.</HelpNote>
   </>}
   <HelpNote icon="wallet" title="Prices are planning estimates">Estimated prices and availability need verification. Hard budgets and availability outrank votes, and silence never counts as approval.</HelpNote>
   <details><summary><Question>Why can’t I confirm?</Question></summary><p>Look for unresolved step decisions, an over-budget estimate, missing requirement checks or another traveller’s incomplete input.</p></details>
   <details><summary><Question>Does a popular vote override my limit?</Question></summary><p>No. A vote cannot override a hard budget, availability or required personal check.</p></details>
  </>;
  case'final-journey-booking':return shell==='demo'?<>
   <p className="help-lede">In the Goa sample, use Plan for the itinerary and Bookings for the fictional handoff.</p>
   <ol><li>Choose <strong>Review and respond</strong> from the itinerary to review the current sample version.</li><li>Once every included sample traveller is ready, the organiser can close the decision round in <strong>Decisions</strong>.</li><li>Open <strong>Bookings</strong> to see sample responsibilities and compare example provider offers.</li></ol>
   <HelpNote icon="lock" title="Fictional booking examples">The offers and booking reports are sample data. Use this view to explore how the handoff works.</HelpNote>
  </>:<>
   <p className="help-lede">Final journey is the readable destination itinerary for the exact locked plan.</p>
   <ol><li>Finish your personal review of the current itinerary version.</li><li>Wait for every included traveller to review and for the organiser to lock it.</li><li>Select <strong>Final journey</strong> or <strong>See my final journey</strong>.</li><li>Use the day tabs in Final journey for your schedule, and open the separate Bookings tab for provider links.</li></ol>
   <GuideVisual kind="journey"/>
   <HelpNote icon="lock" title="Planzo does not make reservations">Provider availability, routes and prices must be checked before purchase. Open the Bookings tab after lock; a saved or reported task is not a verified reservation.</HelpNote>
   <details><summary><Question>Why is Final journey unavailable?</Question></summary><p>The itinerary must be resolved, personally reviewed by everyone included and locked by the organiser first.</p></details>
   <details><summary><Question>Are the shown prices live quotes?</Question></summary><p>No. They are planning estimates with stated assumptions, not live quotes or guaranteed inventory.</p></details>
  </>;
  case'troubleshooting':return <>
   <p className="help-lede">Use the message on screen first; Planzo does not advertise a support channel in this prototype.</p>
   <ul><li><strong>Invitation unavailable:</strong> ask the organiser to check that it is Active and create a fresh link if needed.</li><li><strong>Email code rejected:</strong> use the newest code for the exact email address entered.</li><li><strong>Save did not complete:</strong> keep the form open and retry after the current action finishes.</li><li><strong>Shared trip looks out of date:</strong> select <strong>Refresh</strong> in the trip navigation.</li><li><strong>Cannot proceed:</strong> check the passport for planning progress. In shared trips, open <strong>Overview → Trip passport</strong> or <strong>Pact Passport</strong>.</li></ul>
   <GuideVisual kind="fixes"/>
   <details><summary><Question>Can I open Help while filling out a form?</Question></summary><p>Help in the top bar stays visible while you scroll. If a form has a Help link next to it, use that link to open the guide in a panel. Close the panel to return to the form, then save or confirm your entries.</p></details>
   {shell==='demo'&&<p className="caption">You are reading Help inside the fictional sample shell. Shared-app labels are documented accurately, but sample invitation, identity and storage behaviour is explicitly different.</p>}
  </>;
 }
}

export function HelpPage({initialTopic='organise-trip',shell,onReturn,onSelect,allowWalkthrough=true}:{initialTopic?:string;shell:'shared'|'demo';onReturn:()=>void;onSelect?:(topic:HelpTopic)=>void;allowWalkthrough?:boolean}){
 const valid=topics.some(x=>x.id===initialTopic)?initialTopic as HelpTopic:'organise-trip';
 const [selected,setSelected]=useState<HelpTopic>(valid),[walkthrough,setWalkthrough]=useState(false),article=useRef<HTMLElement>(null);
 useEffect(()=>setSelected(valid),[valid]);
 const select=(topic:HelpTopic,scroll=true)=>{setSelected(topic);onSelect?.(topic);if(scroll)requestAnimationFrame(()=>article.current?.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'}));};
 return <div className="help-page">
  <section className="help-intro" aria-labelledby="help-title">
   <div className="help-intro-copy">
    <div className="help-return"><button type="button" className="context-help-link context-help-button" onClick={onReturn}>← Return to Planzo</button></div>
    <h1 id="help-title">Help &amp; documentation</h1>
    <p>Find guides for each step of your trip.</p>
   </div>
   <HelpHeroArt/>
  </section>
  {walkthrough&&<InPlacePanel title="Three steps through Planzo" onClose={()=>setWalkthrough(false)}><ol className="walkthrough-steps"><li><span>1</span><div><h3>My private input</h3><p>Open My private input, complete your own dates, whole-trip budget and preferences, then confirm your summary.</p></div></li><li><span>2</span><div><h3>{shell==='demo'?'Plan':'Itinerary'}</h3><p>Select a day to read its schedule. Open a pending stop and choose View decision to compare the options.</p></div></li><li><span>3</span><div><h3>Review the plan</h3><p>{shell==='demo'?'Return to Plan and select Review and respond for the current version.':'Return to Itinerary and open Review and lock this itinerary to check your estimate and confirm your personal review.'}</p></div></li></ol></InPlacePanel>}
  <Card className="help-map">
   <div className="help-map-heading">
    <h2>Your Planzo journey</h2>
    {allowWalkthrough && <button type="button" className="context-help-link context-help-button" onClick={() => setWalkthrough(true)}>Three-step walkthrough</button>}
   </div>
   <div className="help-starts">
    <div className={selected==='organise-trip'?'selected':''}><div className="help-branch-heading"><span className="help-icon-tile"><Icon name="map"/></span><span><strong>Organiser</strong><small>Set the shared starting point</small></span></div><div className="help-path"><button aria-pressed={selected==='organise-trip'} onClick={()=>select('organise-trip')}><Icon name="calendar"/>Create a trip</button><span aria-hidden="true">→</span><button aria-pressed={selected==='organise-trip'} onClick={()=>select('organise-trip')}><Icon name="people"/>Invite travellers</button></div></div>
    <div className={selected==='join-trip'?'selected':''}><div className="help-branch-heading"><span className="help-icon-tile sand"><Icon name="people"/></span><span><strong>Traveller</strong><small>Join as yourself</small></span></div><div className="help-path"><button aria-pressed={selected==='join-trip'} onClick={()=>select('join-trip')}><Icon name="link"/>Open the invite</button><span aria-hidden="true">→</span><button aria-pressed={selected==='join-trip'} onClick={()=>select('join-trip')}><Icon name="mail"/>Verify your email</button></div></div>
   </div>
   <div className="help-flow-label"><span aria-hidden="true"></span><strong>Then everyone follows the shared sequence</strong><span aria-hidden="true"></span></div>
   <div className="help-shared-path" aria-label="Shared journey">{journey.map((step,index)=><div key={step.label}><button aria-pressed={selected===step.topic} onClick={()=>select(step.topic)}><span className="help-step-number">{index+1}</span><Icon name={step.icon}/><span className="help-step-label">{step.label}</span></button>{index<journey.length-1&&<span className="help-route-connector" aria-hidden="true">→</span>}</div>)}</div>
  </Card>
  <div className="help-content">
   <nav className="help-topics" aria-label="Help topics"><span className="eyebrow">TOPICS</span>{topics.map(topic=><button key={topic.id} className={selected===topic.id?'active':''} aria-current={selected===topic.id?'page':undefined} onClick={()=>select(topic.id)}><span className="help-topic-icon"><Icon name={topic.icon}/></span><span className="help-topic-copy"><strong>{topic.label}</strong><span>{topic.summary}</span></span></button>)}</nav>
   <article className="card help-article" ref={article} tabIndex={-1}><div className="help-article-heading"><span className="help-heading-icon"><Icon name={topics.find(x=>x.id===selected)!.icon}/></span><div><Badge tone="positive">Guide</Badge><h2>{topics.find(x=>x.id===selected)!.label}</h2></div></div><Guide topic={selected} shell={shell}/></article>
  </div>
 </div>;
}
