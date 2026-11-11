import { useEffect } from 'react';

export function PrivacyPolicy() {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = 'Privacy policy · Planzo';
    return () => { document.title = previousTitle; };
  }, []);

  return (
    <article className="privacy-policy" aria-labelledby="privacy-title">
      <div className="privacy-intro">
        <h1 id="privacy-title">Privacy policy</h1>
        <p className="small muted">Updated <time dateTime="2026-11-11">11 November 2026</time></p>
        <p className="privacy-lede">This policy explains how the Planzo group trip-planning prototype uses information when you visit, sign in, or join a shared trip.</p>
      </div>

      <section aria-labelledby="information">
        <h2 id="information">Information Planzo uses</h2>
        <ul>
          <li><strong>Account information.</strong> Planzo uses your email address and, if you provide it, your display name. Supabase Auth handles passwords, email codes and sign-in sessions.</li>
          <li><strong>Trip information.</strong> Planzo stores trip details, membership, itinerary versions, votes, review responses and the planning input you submit. Input can include availability, a budget, a departure city, preferences and travel requirements.</li>
          <li><strong>Booking and payment information.</strong> Planzo stores booking reports, shared expenses and refunds, splits, records of transfers made outside Planzo, and the history of changes to those records.</li>
          <li><strong>Browser and service data.</strong> Planzo uses browser storage for sign-in sessions. Hosting and service providers may record IP addresses, requests and technical errors to run and protect the service.</li>
        </ul>
      </section>

      <section aria-labelledby="sharing">
        <h2 id="sharing">What your trip group can see</h2>
        <p>Trip members can see the shared trip, member names or display labels, itinerary, and group progress and outcomes. Planzo uses private inputs to check whether a trip works for everyone. It keeps individual budget ceilings and departure cities out of the shared itinerary. Review the requests marked for shared planning before confirming your input.</p>
        <p>Travellers included in the trip can see the shared booking records and payments ledger.</p>
        <ul>
          <li><strong>Bookings.</strong> Included travellers can see the itinerary item, booking status, provider, total paid, who booked, and any reference or notes entered. Booking history shows who saved each update and when.</li>
          <li><strong>Payments.</strong> Included travellers can see expense and refund descriptions, amounts, who paid or received a refund, dates, notes, each traveller's share, and group balances. Transfer records show the sender, recipient, amount, method, date, status and any notes entered. Activity history shows who made updates and when.</li>
        </ul>
        <p>When the voting feature is enabled, a concern note stays private unless its author chooses to share it with the organiser. Share trip invitation links only with the people you intend to invite.</p>
      </section>

      <section aria-labelledby="providers">
        <h2 id="providers">Services that help run Planzo</h2>
        <p>Figma hosts the Planzo app, GitHub Pages hosts these information pages, and Supabase handles accounts, trip storage and server functions. Planzo uses this information to provide sign-in, trip planning, voting and service support.</p>
        <p>Gemini itinerary planning is enabled for all travellers. After travellers confirm the requests they want to share, Planzo sends only those reviewed requests, the destination, group size and shared dates to Google Gemini to propose an itinerary. Planzo may ask Gemini once more to correct an incomplete schedule. Individual budget ceilings, starting cities and raw private preference paragraphs remain in Supabase and are not sent for itinerary generation. Google's free service may use submitted material for improvement and human review. Keep names and private reasons out of shared planning requests.</p>
      </section>

      <section aria-labelledby="gmail">
        <h2 id="gmail">Gmail and voting reminders</h2>
        <p>When voting reminders are enabled, the Planzo operator authorizes a designated Gmail account with the <code>gmail.send</code> permission. Planzo uses it only to send voting reminders requested by a trip organiser. Travellers sign in to Planzo with their own email and do not grant Planzo access to their Google accounts.</p>
        <p>A reminder sends the pending voter's email address, a short message and a link to the trip's voting page through Gmail. The reminder excludes ballot choices, private notes and budgets. Planzo keeps the sender's authorization credentials in server-side Supabase secrets and stores delivery status to limit repeat reminders. The permission gives Planzo no access to read or manage the Gmail inbox.</p>
        <p>Planzo's use and transfer of information received from Google APIs will adhere to the Google API Services User Data Policy, including its Limited Use requirements. <a href="https://developers.google.com/terms/api-services-user-data-policy">Google API Services User Data Policy</a></p>
      </section>

      <section aria-labelledby="controls">
        <h2 id="controls">Your choices and requests</h2>
        <p>You can review or update your planning input in Planzo. Organisers can move a trip to Deleted trips, where it can be restored. Moving a trip there leaves its data available for restoration.</p>
        <p>For questions or requests about access, correction or deletion, reply to a Planzo email or ask the person who invited you to put you in touch with the Planzo project team. Use the email associated with your account when making a request. Keep passwords and sign-in codes out of your message.</p>
        <p>The Gmail account owner can revoke Planzo's permission at any time in their <a href="https://myaccount.google.com/connections">Google Account connections</a>.</p>
      </section>
    </article>
  );
}
