import {Button,Coast,Icon} from './ui';
import './landing.css';

export function LandingPage({onCreate,onJoin,onSignIn,onWalkthrough}:{onCreate:()=>void;onJoin:()=>void;onSignIn:()=>void;onWalkthrough:()=>void}){
 return <div className="landing-page">
  <section className="landing-hero" aria-labelledby="landing-title">
   <div className="landing-copy"><span className="landing-eyebrow"><span/>Good trips start with everyone.</span>
    <h1 id="landing-title">Less back-and-forth.<br/><em>More getting away.</em></h1>
    <p className="landing-description">Turn everyone’s dates, budgets and must-dos into one shared trip. Plan it, book it and split the costs in the same place.</p>
    <div className="landing-actions"><Button onClick={onCreate}>Create a trip <span aria-hidden="true">↗</span></Button><Button variant="secondary" onClick={onJoin}>Join with an invite</Button></div>
    <p className="landing-signin">Already planning something? <button onClick={onSignIn}>Sign in</button></p>
    <div className="landing-assurance"><Icon name="lock"/><span>Your private limits stay private. Your group gets the shared plan.</span></div>
   </div>
   <div className="landing-preview" aria-label="Illustrative trip preview, not a bookable offer">
    <div className="landing-preview-image"><span className="landing-example">Example trip</span><Coast variant="large"/><span className="landing-trip-tag"><Icon name="people"/>Made for your kind of group</span></div>
    <div className="landing-preview-body"><div className="landing-preview-title"><div><span className="landing-eyebrow">A little less planning. A lot more Goa.</span><h2>Three days, together.</h2></div><span className="landing-preview-icon"><Icon name="plane"/></span></div>
     <ol className="landing-mini-days"><li><span>01</span><div><strong>Explore Panaji</strong><small>Colourful streets & a slower start</small></div><Icon name="map"/></li><li><span>02</span><div><strong>Find your beach</strong><small>Room for everyone’s must-dos</small></div><Icon name="sun"/></li><li><span>03</span><div><strong>One last wander</strong><small>Keep the plan. Leave some breathing room.</small></div><Icon name="coffee"/></li></ol>
     <div className="landing-preview-footer"><span>Itinerary</span><span aria-hidden="true">→</span><span>Bookings</span><span aria-hidden="true">→</span><span>Payments</span></div>
    </div>
   </div>
  </section>
  <section className="landing-benefits" aria-label="Why plan with Planzo">
   <div><span className="landing-feature-icon"><Icon name="lock"/></span><div><h2>Private preferences</h2><p>Share your limits with Planzo, without the group-chat awkwardness.</p></div></div>
   <div><span className="landing-feature-icon"><Icon name="people"/></span><div><h2>One plan, everyone’s say</h2><p>Review the itinerary together before making it final.</p></div></div>
   <div><span className="landing-feature-icon"><Icon name="wallet"/></span><div><h2>Bookings to balances</h2><p>Keep booking details, shared expenses and settlements connected.</p></div></div>
  </section>
  <section className="landing-how" aria-labelledby="landing-how-title"><div className="landing-section-heading"><div><span className="landing-eyebrow">FROM “WE SHOULD GO” TO “LET’S GO”</span><h2 id="landing-how-title">A plan the whole group can get behind.</h2></div><button onClick={onWalkthrough}>See how it works <span aria-hidden="true">↗</span></button></div>
   <ol>{[['Invite your people','Start a trip and share one invite.'],['Tell us what works','Choose your dates, budget and must-dos privately.'],['Agree on the plan','Review each day and give your own yes or no.'],['Book. Go. Split.','Track bookings and add expenses along the way.']].map(([title,description],i)=><li key={title}><span className="landing-step-number">0{i+1}</span><h3>{title}</h3><p>{description}</p></li>)}</ol>
  </section>
 </div>;
}
