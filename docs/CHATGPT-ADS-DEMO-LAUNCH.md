# Dental demo campaign setup

Public destination: `/dental-demo/`. Supporting pages: `/samples/`, `/how-it-works/`, `/pricing/`, `/about/`, `/contact/`, `/privacy/`, `/terms/`, `/refunds/`, `/cookies/`, `/acceptable-use/`, `/compliance/`.

The founding offer for the first 100 paid clinics is $80 USD per paid month plus applicable taxes, with 1,000 shared generation credits. New weeks use two five-slide carousels, two single-image stories and two single-image posts. Image generation costs 10 credits; each standard piece uses 1 brief + 2 writing + 1 validation credit, making the initial weekly pack 164 credits. Five packs use 820 credits before style setup and revisions. Existing weeks and subscriptions are preserved. Run Cloudflare migration `0013_weekly_content_plan.sql` before activating the new `weekly-content` plan. Payment, monthly allocations and renewal remain manual; there is no automated billing or post publishing.

## Connect free scheduling

Calendly Free supports one event type and one connected calendar, enough for this one-on-one demo. Create a 15-minute event called **Srshti dental content demo** in the operator's account. Connect the actual availability calendar and Google Meet (or a supported video provider). Set the host timezone to Asia/Kolkata, a 10-minute buffer, a sensible booking notice period, and times suitable for AU, US, Ireland and UK buyers. Confirm these choices with the operator while setting up the event. Do not promise reminders that require a paid plan.

Use invitee questions for practice name, website, country and role. Explain that the demo is free and the service costs $80 USD/month plus tax. Ask for business details only. Add a privacy-notice link to the event description. The scheduling provider sends the actual invitation and confirmation; an email request is never treated as a booking.

Set the real event URL in `web/marketing-settings.json` under `bookingUrl`, then run `npm run web:build`. Alternatively set `SRSHTI_DEMO_BOOKING_URL` in the build environment. Only HTTPS `calendly.com/<owner>/<event>` URLs are accepted. Until configured, the demo page shows an "Email to book a time" button instead of the calendar. There is no invented live booking link.

The calendar is embedded directly on `/dental-demo/` (visitors pick a time, enter name and email, and Calendly confirms it by email). An "open in a new tab" link is also available. No external redirect after booking is needed, so the flow does not depend on Calendly's paid redirect feature.

## Optional ChatGPT Ads measurement

Create the website pixel in Ads Manager and set its public ID in `web/marketing-settings.json` under `pixelId` (or the build environment `SRSHTI_ADS_PIXEL_ID`). Do not put an API key or access token in this file. Build again.

The pixel SDK loads only after advertising-measurement consent, which defaults to off. Rejecting it does not block demo enquiries or scheduling. Consent can be changed on `/cookies/`. The pixel receives page views, `lead_created` for completed free-carousel requests and `appointment_scheduled` for confirmed bookings, never form fields. `lead_created` fires only after the server saves a request (HTTP 201); its `event_id` is the stored lead id, so a repeat request from the same email and Instagram handle is deduplicated rather than counted twice, and honeypot-blocked bots never trigger it. On the embedded calendar, `appointment_scheduled` is sent only for a Calendly `event_scheduled` message from the exact iframe window and the Calendly origin, with a valid scheduled-event URI. Repeated events are deduplicated in the page and carry the event URI as `event_id`. Bookings in an external tab are not automatically measured by this implementation; use calendar records for reconciliation. Do not count email-draft preparation as a lead or appointment.

Before ads, verify a real completed booking and a real free-carousel request each produce one conversion when measurement is allowed and none when rejected. In Ads Manager, use `lead_created` as the optimisation event for campaigns that send traffic to the free sample. Dates or times selected without completing the booking must produce none. The live event/account and actual pixel ID are needed for this final end-to-end verification.

## Public deployment and ad review

Deploy only after reviewing business identity, policy text, tax disclosures, payment arrangements and scheduling availability. The pages do not claim legal certification or guaranteed ChatGPT approval. The public offer is a business content tool for dental practices, not dental treatment. Keep ad creative and context hints consistent with that offer; do not promote medical outcomes, patient acquisition guarantees or regulator/OpenAI endorsements.

`robots.txt` allows OAI-AdsBot and OAI-SearchBot on public pages. Verify the real production domain, HTTPS, redirects, firewall/bot rules, images and policy links after deployment; robots.txt cannot override a blocked firewall. OpenAI still reviews the advertiser, creative and destination.

References checked 3 October 2026:
- https://openai.com/policies/ad-policies/
- https://help.openai.com/en/articles/20001243-advertiser-guidance-for-allowing-openai-web-crawlers
- https://developers.openai.com/ads/measurement-pixel
- https://developers.openai.com/ads/supported-events
- https://calendly.com/pricing
- https://calendly.com/help/embed-options-overview

## Free carousel requests

Every "free sample" call to action (hero, navigation, pricing, closing bands, demo page and a floating reminder after scrolling) opens the same form in a pop-up; without JavaScript they link to `/free-carousel/`, which keeps the form inline for direct ad traffic. Campaign tags from the landing URL are kept for the visit, so a request made on a later page is still attributed. The form asks for four things: name, clinic name, email and the clinic's Instagram handle. Submissions go to `POST /api/public/sample-request` (Worker or local server), which validates them and saves them to the `sample_requests` table (D1 in the cloud, SQLite locally). A repeat of the same email and Instagram handle keeps the original lead. A hidden honeypot field drops simple bots.

The administrator (the `ADMIN_EMAIL` account) reviews them in the studio under **Leads** (`#/leads`, also linked from the admin dashboard): filter by status, update each lead's status (New, Contacted, Sample sent, Demo booked, Customer, Not a fit), keep notes, and download everything as a CSV. No extra secrets or setup are needed; the table is created by migration `0014_sample_requests.sql`, which the deploy workflow applies.

Confirm authorisation, brand details and delivery timing by email before preparing one five-slide carousel and caption. One sample per practice, no purchase obligation. Do not request Instagram credentials or patient information. Track the first 100 paid clinic activations manually and confirm founding eligibility before payment. The $80 monthly rate continues with uninterrupted monthly renewal; later pricing is not advertised yet.
