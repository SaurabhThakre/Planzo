# Planzo email setup

The first live data slice is implemented against **Trip Pact**, project `ewysgpuwvufbklesdhuj`. The user reports custom SMTP and the `{{ .Token }}` variables in Magic Link and Confirm Signup completed. The user has confirmed organiser email confirmation/sign-in, guest-code joining/private-input saving, and returning-guest email-code sign-in with the saved input restored. Membership/save metadata was separately verified on the server. The first password recovery email arrived but returned to `http://localhost:3000/` with `otp_expired`. After the user signed in to the dashboard, its Site URL was independently confirmed as localhost and its redirect allowlist was empty. Both were corrected to the actual Planzo preview on 15 October 2026. A later recovery-link test reached Home without the new-password form. The user explicitly approved recovery email codes. The Recovery template was changed to send `{{ .Token }}` as a code, with no clickable verification link, and the matching screen verifies it through Supabase before showing new-password fields. The user then confirmed the complete real-inbox recovery-code → new password → sign-out → new-password sign-in sequence works. Keep provider passwords and API keys in the provider/Supabase settings; do not paste them into chat or application source.

## 1. Configure a sender

1. Choose an email delivery service that supports SMTP, or use an existing service you control. Complete its sender/domain verification and the DNS records it supplies. A website custom domain is optional, but your email provider may require a sender domain you control.
2. In [Trip Pact email settings](https://supabase.com/dashboard/project/ewysgpuwvufbklesdhuj/auth/smtp), enable custom SMTP. If the dashboard navigation has moved, open Authentication → Email → SMTP settings.
3. Enter the provider's SMTP host, port, username and password, and the verified From address. Use **Planzo** as sender name. Save. Enter credentials yourself in that secure screen.
4. Keep Email authentication, new-user signup and email confirmation enabled. Set a suitable mail rate limit for the small pilot; never disable confirmation to work around delivery failures.

Supabase's default sender limits recipients to members of the Supabase organization and is not suitable for the intended outside-user pilot. Configuring the sender does not send a trip invitation to anyone automatically; organisers copy their trip link themselves.

## 2. Include the email code in templates

Open [Auth email templates](https://supabase.com/dashboard/project/ewysgpuwvufbklesdhuj/auth/templates).

Set the **Magic Link / Sign in** template to include the following literal template variable:

```html
<h2>Your Planzo sign-in code</h2>
<p>Enter this code in Planzo:</p>
<p><strong>{{ .Token }}</strong></p>
<p>If you did not request this code, you can ignore this email.</p>
```

Also include `{{ .Token }}` in **Confirm signup**, because the first email-code request may create a new guest identity. Retain the confirmation link for organisers:

```html
<h2>Confirm your Planzo email</h2>
<p>If Planzo is asking for a code, enter: <strong>{{ .Token }}</strong></p>
<p>If you created an organiser account, <a href="{{ .ConfirmationURL }}">confirm your email</a>, then return to Planzo.</p>
<p>If you did not request this, you can ignore this email.</p>
```

The user explicitly approved **Reset password / Recovery** codes on 15 October 2026. Its saved template is recorded in `backend/RECOVERY_EMAIL.html`:

```html
<h2>Reset your Planzo password</h2>
<p>Enter this recovery code on the Planzo password recovery screen:</p>
<p><strong>{{ .Token }}</strong></p>
<p>After Planzo verifies the code, you can choose a new password.</p>
<p>Use the newest recovery email. Keep this code private.</p>
<p>If you did not request a password reset, you can ignore this email.</p>
```

The recovery email deliberately contains no clickable verification link, avoiding an email scanner consuming the one-time credential. In Planzo, request an email, enter its code, then choose a password yourself. This calls `verifyOtp` with `type:'recovery'`; it does not use the ordinary guest sign-in code as a password-reset credential. Supabase still enforces token verification and its expiry/rate limits. Older recovery links remain handled by the callback screen when a recovery session can be verified; unusable links show guidance to request a fresh code.

Use a short code lifetime and retain the resend/brute-force limits. The app accepts the code format returned by Supabase. Organiser confirmation/sign-in, guest joining and returning sign-in, and password recovery with a fresh code and new-password sign-in are all user-confirmed successful.

## 3. Configure app return URLs

In [Auth URL configuration](https://supabase.com/dashboard/project/ewysgpuwvufbklesdhuj/auth/url-configuration):

- **Site URL:** currently the exact preview origin below, followed by `/`, saved and visibly verified in the dashboard on 15 October 2026. Replace this with the eventual published Planzo URL before release. Figma Make can supply a `.figma.site` URL; you do not need to buy a website domain for this. The Figma editor link is not an app return URL.
- Allow the app's exact confirmation, guest fallback and recovery callback URLs. For an app hosted at the origin root, these are the origin followed by `/?auth=confirmed`, `/?auth=guest` and `/?auth=recovery`.
- For the current development preview only, the observed app origin is `https://app-m3why3vww3r4xrqwukti4nzf2xhumphdpdyshbxavaupaf34tf72.makeproxy-c.figma.site`. The three exact `/?auth=confirmed`, `/?auth=guest` and `/?auth=recovery` redirects were saved and visibly verified. No wildcard was added. If Make gives it a new preview hostname, update the configuration to that actual hostname.
- Add a localhost return URL only if you intend to test locally. The current development port is 8443.

The guest invite remains in the URL hash / same-tab session while the user enters the code. Guest verification does not depend on clicking an email link. Organiser confirmation links should normally be opened in the same browser that requested them because this app uses PKCE. Cross-device return is supported by signing in again with the verified email. Recovery now uses a code entered into Planzo, so the email itself may be read in another browser.

### Recovery failure reported on 15 October 2026

The user received the recovery email, but the browser landed at `http://localhost:3000/` with `access_denied` / `otp_expired`. The app calls `resetPasswordForEmail` with `callbackUrl('recovery')`, constructed from its actual origin/path plus `?auth=recovery`. The dashboard independently confirmed the localhost default and no allowed redirects. The Site URL and the three exact callbacks were corrected to the actual preview. The Recovery template initially used `{{ .ConfirmationURL }}` correctly. After another link reached Home without restoring a recovery session, the user explicitly approved changing it to the code-only template above. Evidence: `backend/recovery-url-configuration.jpg`. No full recovery link or token is needed for diagnosis.

Request a **fresh** recovery email and enter its code in Planzo. Email may open in another browser; the code is entered back into the app. Old link-based PKCE recovery required the requesting browser/context, which was fragile when moving out of the embedded preview. Discard the old link. `otp_expired` also means the verification link was invalid, already consumed or expired; correcting a return URL does not make an old link valid again. If a newly requested code is immediately rejected, check the code type, newest-email selection and Auth logs without exposing tokens. Do not disable email verification or weaken expiry/rate limits as a workaround.

## 4. Verify with your team

1. Organiser A signup, confirmation and sign-in: **user-confirmed**. Authenticated UI trip creation, invitation creation/revocation, own draft restoration and own confirmation: **verified** using `Planzo connection check (test)`. Create a fresh invite for the second-inbox check; select/copy the visible link manually if the embedded browser cannot copy automatically.
2. Member B invitation → email code → joining → saved input: **user-confirmed successful**. Server readback confirms guest/member revision 1 is confirmed, a private draft exists and one immutable snapshot exists.
3. A sees B’s completion status: **verified in the live organiser overview** with two joined members and both inputs confirmed. No guest ceiling, origin or raw note is displayed. Administrative verification queried only counts/status, not guest answers.
4. B signs out, selects Sign in → Sign in with an email code and returns to the same membership and saved input: **user-confirmed successful**. Returning after invitation expiry/revocation remains covered by the database boundary checks, rather than a separate real-inbox test. This returning-user path does not create a new account. Repeated joining through a valid invite must not create a second member.
5. Outsider C cannot open the trip without accepting a valid invite. A revoked invite must fail for a new member.
6. A requests a recovery email, enters its code in Planzo, saves a new password, signs out and signs in with it: **user-confirmed successful on 15 October 2026**, after URL correction and the approved code-only Recovery template. The user entered and submitted the code and new password personally. Expired/already-used credentials, wrong codes and incorrect passwords remain additional pilot failure-case checks; do not treat those as independently exercised here.

The database/access tests already run are separate from these real-inbox checks. Publishing and the final published-origin tests are still separate steps. Ask the next assistant to read `docs/SUPABASE_SLICE_HANDOFF.md` before continuing.

Sources: [SMTP](https://supabase.com/docs/guides/auth/auth-smtp), [email OTP and templates](https://supabase.com/docs/guides/auth/auth-email-passwordless), [return URLs](https://supabase.com/docs/guides/auth/redirect-urls), [single-use links and email scanners](https://supabase.com/docs/guides/deployment/going-into-prod).
