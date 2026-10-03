# Landing page and advertising readiness

Updated 3 October 2026. Implemented locally; no production deployment was performed.

## Editable launch pricing

Single source: `web/v4/marketing.js`. USD monthly prices: Starter $29 / 100 usage credits; Pro $99 / 500; Founding clinic $149 / 900. Credit quantities match existing plan migrations. Generation currently costs 10 credits per image and writing 1–2 credits. Prices are proposed launch offers, not a validated margin model: actual provider cost, revisions, support and tax obligations need commercial monitoring. There is no automated checkout or renewal.

`npm run web:build` renders the homepage and public pages using `scripts/build-marketing.mjs`, then bundles the studio. Edit policy source in that build script rather than generated HTML. The public pages render meaningful content without JS. Private studio account/API rules are unchanged.

## Implemented

- Responsive landing page in the existing lavender/DM Sans/Manrope design system.
- Hero "app film": a five-chapter animated walkthrough (Brand → Plan → Write → Design → Approve) of an example clinic, mirroring real studio labels and behaviour, with an animated cursor, pause/play, clickable chapters, a compact layout for phones and static end-states for reduced motion. The Write chapter shows the real `checkDraft` rejection message for an outcome claim.
- Showcase of a CSS-rendered five-slide carousel (Hook → Science → Impact → Action → CTA) and a story, with live style switching. Slides are illustrative, not generated output, and use a fictional example clinic.
- Savings calculator (`estimate()` in `marketing.js`): designer hours × editable rate vs the smallest plan covering the mix. Assumptions: 3 h per carousel, 1 h per post, 45 min per story; 52/12/12 credits plus a 20% revision allowance. All assumptions are shown on the page and labelled as an estimate, not a quote. Revisit if credit costs change.
- Compliance-aware section describing only enforced guardrails (approved-source span check, blocked outcome terms, unsupported numbers, image-prompt rules, CTA only on final slide, no patient data), plus a filterable wall of 12 standards across AU/IE/US. Seals are original typographic marks, **not official logos**: regulator and professional-body logos (Ahpra, FTC, ADA, Dental Council, etc.) generally cannot be used commercially and would imply endorsement, which conflicts with the ad-policy requirement against misleading affiliation. A non-affiliation disclaimer sits under the wall.
- USD pricing, allowances, taxes/conversion disclosures and realistic launch limitations.
- Pricing, about, contact/support, privacy, terms, payments/refunds, cookies, acceptable use and dental marketing guide pages.
- Contact form opens an email draft; it does not claim an email was sent.
- Public review reminder checklist; it is not an automated validator or saved clinic approval.
- No fabricated customer logos, testimonials, medical outcomes or compliance certifications.
- Crawlable HTML, public sitemap, and robots permissions for OAI-AdsBot and OAI-SearchBot. Private API and legacy studio are excluded.
- No optional analytics or advertising pixel added. A tracking-consent banner is not needed for nonexistent tracking; add appropriate controls before introducing nonessential tracking.

## Sources reviewed and limits

- https://openai.com/policies/ad-policies/ — reviewed current policy, updated 10 September 2026. Accurate identity/offers, truthful claims, destination integrity, no misleading affiliation/interface imitation; dental/medical advertising is restricted.
- https://help.openai.com/en/articles/20001212-create-ads-for-chatgpt-ads — clear relevant destination; valid links; do not block OpenAI crawlers.
- https://www.ftc.gov/business-guidance/resources/advertising-faqs-guide-small-business — fetched FTC primary guidance on truthful advertising, evidence, and state rules.
- https://www.ahpra.gov.au/Resources/Advertising-hub.aspx — official advertising hub. Detailed guidance appeared in official search results but automated fetch of the detailed page returned 403; the site links the hub and does not claim exhaustive verification.
- https://www.dentalcouncil.ie/ — official regulator. Search returned public-relations guidance but the indexed detailed page/PDF returned 404 when fetched. The website directs readers to the current regulator site and avoids claiming a validated Irish rule engine.

Before running ads, confirm advertiser eligibility and geographic availability in Ads Manager. OpenAI's restrictions on health-service ads outside the US mean AU/IE targeting must not be assumed eligible. Srshti is software, but its dental focus may require review. Legal pages or robots directives cannot guarantee approval, and robots cannot override a production WAF challenge.

## Business details to verify before public launch

Contact uses the public support address (`hello@srshti.co.in`) and name (Ananth C. Jayan) from the project context. Confirm the intended public support channel and legal trading entity/address; do not invent a registered company or regional office. The privacy notice reflects the existing infrastructure but does not establish GDPR transfer safeguards, a DPA, HIPAA/BAA support, or regulator certification. Verify actual retention, transfer arrangements, tax treatment, refund operations and any mandatory jurisdictional disclosures before accepting customers who require them.

No assertion is made that the website or all generated content is legally compliant. The implemented wording describes the review features actually available, with the clinic retaining publication responsibility.
