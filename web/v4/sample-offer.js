// Free sample carousel offer: one form for the /free-carousel/ page and the pop-up, plus the links that open it.
// Links keep a real href so they still reach the page without JavaScript; marketing-public.js opens the pop-up instead.
export const sampleUrl='/free-carousel/';
export const sampleLink=(label,cls='btn')=>`<a class="${cls}" href="${sampleUrl}" data-sample-open>${label}</a>`;

const field=(p,name,label,control,hint='')=>`<div class="field m-sf-field"><label for="${p}-${name}">${label}<span class="m-req" aria-hidden="true">*</span></label>${control}${hint?`<small id="${p}-${name}-hint">${hint}</small>`:''}<span class="m-sf-error" id="${p}-${name}-error" hidden></span></div>`;
const input=(p,name,attrs,describedBy=`${p}-${name}-error`)=>`<input id="${p}-${name}" name="${name}" required aria-required="true" aria-describedby="${describedBy}" ${attrs}>`;

export function sampleForm(p){return `<form class="m-contact-form m-sample-form" data-sample-form novalidate aria-labelledby="${p}-title">
<h3 id="${p}-title">Request your free carousel</h3><p class="m-sf-lede">Four quick details. All fields are required.</p>
${field(p,'name','Your name',input(p,'name','autocomplete="name" maxlength="120"'))}
${field(p,'clinic','Clinic name',input(p,'clinic','autocomplete="organization" maxlength="160"'))}
${field(p,'email','Email',input(p,'email','type="email" autocomplete="email" maxlength="254" placeholder="you@yourclinic.com"'))}
${field(p,'instagram','Clinic Instagram',`<div class="m-ig"><span aria-hidden="true">@</span>${input(p,'instagram','maxlength="300" placeholder="yourclinic" autocapitalize="off" autocorrect="off" spellcheck="false"',`${p}-instagram-hint ${p}-instagram-error`)}</div>`,'Your public business profile. We use it to match your logo, colours and style.')}
<input class="m-hp" name="company" tabindex="-1" autocomplete="off" aria-hidden="true">
<button class="btn primary large full" type="submit">Send me my free carousel</button>
<p class="m-form-status" role="status" aria-live="polite" data-sample-status></p>
<p class="small-copy">By requesting, you confirm you can share this clinic’s branding with us. We’ll only contact you about your sample. <a href="/privacy/">Privacy notice</a></p>
</form><div class="m-form-done" data-sample-done tabindex="-1" hidden><span aria-hidden="true">✓</span><h3>Request received.</h3><p>We’ll email the sample carousel to your registered email within 12 hours.</p><a class="btn" href="/samples/">See the sample pack meanwhile →</a></div>`}
