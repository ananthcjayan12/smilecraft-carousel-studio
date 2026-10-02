
const root = document.querySelector('#app');
const toastEl = document.querySelector('#toast');
const E = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const designCatalog = [
  ['teal-editorial-pro','Editorial Teal','Clear, modern and educational'],
  ['clinical-white','Clinical White','Minimal, premium and trustworthy'],
  ['warm-ivory','Warm Ivory','Friendly, calm and human'],
  ['deep-teal-premium','Deep Teal','High-end and confident'],
  ['mint-friendly','Mint Friendly','Fresh, approachable and bright'],
  ['airy-aqua','Airy Aqua','Light, open and contemporary'],
  ['kids-mint','Playful Mint','Friendly for family-focused clinics'],
  ['nature-sage','Nature Sage','Soft, wellness-led and organic'],
  ['warm-clinical','Warm Clinical','Professional without feeling cold'],
  ['premium-charcoal','Premium Charcoal','Bold, sophisticated and cosmetic-led']
];

const S = {
  me:null, bootstrap:null, status:null, clients:[], client:null, plan:null, view:'loading',
  onboarding:{step:'clinic',website:'',instagram:'',analysis:null,analysisPromise:null,goal:'Get more patient enquiries',frequency:3,styles:[],styleBatch:0,primaryIndex:0,savedStyleIds:[]},
  selectedItem:null, project:null, generation:null, filter:'all', busy:''
};

async function request(url, data, method = data === undefined ? 'GET' : 'POST') {
  const options = { method, headers:{} };
  if (method !== 'GET' && S.me?.csrf) options.headers['X-CSRF-Token'] = S.me.csrf;
  if (data !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(data);
  }
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || `Request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return payload;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const toast = text => {
  toastEl.textContent = text;
  toastEl.classList.add('show');
  setTimeout(() => toastEl.classList.remove('show'), 2600);
};
const weekStart = date => {
  const d = date ? new Date(date) : new Date();
  const day = d.getDay();
  d.setDate(d.getDate() - ((day + 6) % 7));
  return d.toISOString().slice(0,10);
};
const typeLabel = t => t === 'carousel' ? 'Carousel' : t === 'post' ? 'Post' : 'Story';
const assetUrl = (clientId, assetId) => assetId ? `/api/clients/${encodeURIComponent(clientId)}/assets/${encodeURIComponent(assetId)}` : '';
function provider(kind='image') {
  const source = kind === 'image' ? S.status?.imageProviders : S.status?.textProviders;
  if (source?.openai?.available) return kind === 'image' ? ['openai','gpt-image-2'] : ['openai','gpt-5.6-luna'];
  if (source?.gemini?.available) return kind === 'image' ? ['gemini','gemini-3.1-flash-image'] : ['gemini','gemini-3.8-flash'];
  throw new Error(`No ${kind} provider is configured.`);
}
function logo() {
  return `<div class="logo"><span class="logo-mark">◒</span><span>Srshti</span></div>`;
}
function publicLanding() {
  return `<div class="marketing">
    <nav class="marketing-nav">${logo()}<div class="marketing-links"><a href="#how">How it works</a><a href="#weekly">Weekly content</a><a href="#pricing">Pricing</a></div>
    <div class="marketing-actions"><a class="button ghost" href="/api/auth/google/start">Sign in</a><a class="button primary" href="/api/auth/google/start">Create my first week →</a></div></nav>
    <main>
      <section class="landing-hero">
        <div class="hero-copy"><span class="badge green">Built for dental clinics</span>
          <h1>Your clinic's social content, <span>ready every week.</span></h1>
          <p>Srshti learns your clinic once, plans fresh content from a curated dental knowledge library, creates it in your brand style, and gives you one clean place to approve the week.</p>
          <div class="hero-actions"><a class="button primary big" href="/api/auth/google/start">Create my first week →</a><span class="muted">$9/month founding price</span></div>
          <div class="hero-checks"><span><b>✓</b> Verified content inputs</span><span><b>✓</b> Clinic-specific design</span><span><b>✓</b> No prompt writing</span></div>
        </div>
        <div class="hero-stage">
          <div class="float-card left"><img loading="lazy" decoding="async" src="/assets/design-systems/crops/warm-ivory-1.jpg" alt="Srshti carousel example"></div>
          <div class="hero-phone"><div class="screen"><img loading="eager" decoding="async" fetchpriority="high" src="/assets/design-systems/crops/airy-aqua-1.jpg" alt="Dental social post preview"></div></div>
          <div class="float-card right"><img loading="lazy" decoding="async" src="/assets/design-systems/crops/teal-editorial-pro-1.jpg" alt="Dental carousel example"></div>
        </div>
      </section>
      <section class="landing-strip" id="how"><div class="strip-card">
        <div class="strip-item"><b>1. Add your clinic</b><span>Website + Instagram. We extract the useful brand and service details.</span></div>
        <div class="strip-item"><b>2. Pick a visual direction</b><span>See 3 polished clinic-specific styles first. Ask for more only if needed.</span></div>
        <div class="strip-item"><b>3. Approve your week</b><span>2 carousels, 1 post and 4 stories in one simple weekly review.</span></div>
      </div></section>
    </main>
  </div>`;
}
function onboardingTop(step, progress) {
  return `<div class="onboarding-shell"><div class="onboarding-top">${logo()}<span class="muted">Clinic setup · ${step}</span></div><div style="max-width:920px;margin:auto"><div class="progress-line"><i style="width:${progress}%"></i></div></div>`;
}
function clinicStep() {
  return onboardingTop('1 of 5', 16) + `<section class="onboarding-card"><div class="onboarding-head"><span class="badge">START HERE</span><h1>Tell us about your clinic</h1><p>Just your website is enough to begin. Instagram is optional.</p></div>
    <form id="clinic-form" class="form-grid">
      <div class="field span2"><label>Clinic website</label><input class="input" name="website" required placeholder="https://www.yourclinic.com" value="${E(S.onboarding.website)}"></div>
      <div class="field span2"><label>Instagram <span class="muted">(optional)</span></label><input class="input" name="instagram" placeholder="https://instagram.com/yourclinic" value="${E(S.onboarding.instagram)}"></div>
      <div class="span2"><button class="button primary big full" type="submit">Continue →</button></div>
      <div class="span2 muted" style="text-align:center;font-size:12px">We use this only to build your clinic profile and content style.</div>
    </form></section></div>`;
}
function quickStep() {
  const goals = ['Get more patient enquiries','Educate existing patients','Promote specific treatments','Build brand awareness'];
  return onboardingTop('2 of 5', 34) + `<section class="onboarding-card"><div class="onboarding-head"><span class="badge">WHILE WE ANALYSE YOUR CLINIC</span><h1>Just 2 quick choices</h1><p>No need to wait for the website analysis.</p></div>
    <div class="question-list"><strong>What's your main goal?</strong>
      ${goals.map(g => `<button class="choice ${S.onboarding.goal===g?'selected':''}" data-action="goal" data-value="${E(g)}"><span class="choice-dot"></span>${E(g)}</button>`).join('')}
      <strong style="margin-top:12px">How often do you want content?</strong>
      <div class="frequency">${[2,3,5].map(n => `<button class="choice ${S.onboarding.frequency===n?'selected':''}" data-action="frequency" data-value="${n}"><span class="choice-dot"></span>${n} posts/week</button>`).join('')}</div>
      <button class="button primary big full" data-action="finish-quick" style="margin-top:14px">Continue →</button>
      <div id="analysis-state" class="analysis-row"><span class="spin-mini"></span><span>Analysing website, logo, services and clinic details…</span></div>
    </div></section></div>`;
}
function analysisStep() {
  const a = S.onboarding.analysis || {};
  const services = a.services?.length ? a.services.join(' · ') : 'We will confirm services with you';
  return onboardingTop('3 of 5', 50) + `<section class="onboarding-card"><div class="onboarding-head"><span class="badge green">ANALYSIS READY</span><h1>We found your clinic</h1><p>Quickly check the important details. You can change anything.</p></div>
    <div class="analysis-preview">
      <div class="analysis-logo">${a.logoImage ? `<img src="${a.logoImage}" alt="Clinic logo">` : '<strong>'+E((a.name||'Clinic').slice(0,2).toUpperCase())+'</strong>'}</div>
      <div><h2 style="margin:0 0 6px">${E(a.name || 'Your clinic')}</h2><div class="muted">${E(a.location || a.website || '')}</div><div style="margin-top:10px">${E(services)}</div></div>
    </div>
    <div class="form-grid" style="margin-top:20px">
      <div class="field"><label>Clinic name</label><input id="confirm-name" class="input" value="${E(a.name||'')}"></div>
      <div class="field"><label>Location</label><input id="confirm-location" class="input" value="${E(a.location||'')}"></div>
      <div class="field"><label>Phone</label><input id="confirm-phone" class="input" value="${E(a.phone||'')}"></div>
      <div class="field"><label>Brand colour</label><input id="confirm-primary" class="input" type="color" value="${E(a.primary||'#5b5bd6')}"></div>
      <div class="span2"><button class="button primary big full" data-action="create-clinic">Looks good — create my styles →</button></div>
    </div></section></div>`;
}
