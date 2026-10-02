function styleStep() {
  const ready = S.onboarding.styles.filter(x=>x.image).length;
  return onboardingTop('4 of 5', 70) + `<section class="onboarding-card" style="max-width:1080px"><div class="onboarding-head"><span class="badge">YOUR VISUAL IDENTITY</span><h1>Pick the style that feels most like you</h1><p>We create only 3 first. If none feels right, ask for 3 more.</p></div>
    <div class="style-grid">${S.onboarding.styles.map((s,i)=>`
      <button class="style-card ${S.onboarding.primaryIndex===i?'selected':''}" data-action="select-style" data-value="${i}" ${!s.image?'disabled':''}>
        <div class="style-preview ${!s.image?'skeleton':''}">${s.image ? `<img decoding="async" src="${s.image}" alt="${E(s.name)}">` : '<span class="muted">Creating style…</span>'}</div>
        <h3>${E(s.name)}</h3><p>${E(s.description)}</p>
        <span class="style-state badge ${S.onboarding.primaryIndex===i?'green':'gray'}">${S.onboarding.primaryIndex===i?'Primary':'Preview'}</span>
      </button>`).join('')}</div>
    <div style="display:flex;gap:10px;justify-content:center;margin-top:20px;flex-wrap:wrap">
      <button class="button" data-action="more-styles" ${S.busy||ready<3?'disabled':''}>Generate 3 more styles</button>
      <button class="button primary big" data-action="save-styles" ${ready<3||S.busy?'disabled':''}>${S.busy==='saving-styles'?'Saving your brand…':'Use these styles →'}</button>
    </div>
    <p class="muted" style="text-align:center;margin:13px 0 0">Your favourite becomes primary; the other two stay available as backup styles.</p>
  </section></div>`;
}
function topicStep() {
  const plan = S.plan;
  const main = plan?.items?.filter(x=>x.type!=='story') || [];
  const stories = plan?.items?.filter(x=>x.type==='story') || [];
  return onboardingTop('5 of 5', 90) + `<section class="onboarding-card" style="max-width:1080px"><div class="onboarding-head"><span class="badge green">WEEK 1</span><h1>Here are your first content ideas</h1><p>Chosen from your clinic services, verified content cards and the global anti-repeat tracker.</p></div>
    <div class="topic-grid">${main.map(item=>topicCard(item)).join('')}</div>
    <div class="card" style="padding:16px;margin-top:16px"><strong>Stories this week</strong><div class="muted" style="margin-top:6px">${stories.map(x=>E(x.angle)).join(' · ')}</div></div>
    <button class="button primary big full" data-action="generate-week" style="margin-top:18px">Create my first week →</button>
  </section></div>`;
}
function topicCard(item) {
  return `<article class="topic-card"><span class="badge">${E(typeLabel(item.type))} · ${E(item.pillar)}</span><h3>${E(item.angle)}</h3><p>${E(item.topic)}</p><div class="topic-actions"><button class="button primary" data-action="approve-topic" data-id="${E(item.id)}">✓ Keep</button><button class="button" data-action="replace-topic" data-id="${E(item.id)}">↻ Replace</button></div></article>`;
}
function generationStep() {
  const g = S.generation || {percent:8,label:'Preparing your first carousel…'};
  return onboardingTop('Creating Week 1', 96) + `<section class="onboarding-card"><div class="onboarding-head"><span class="badge">CREATING REAL CONTENT</span><h1>Your first polished carousel is being made</h1><p>We show the first real result as soon as it is ready; the rest of the week continues in parallel.</p></div>
    <div class="generate-progress card"><div class="progress-ring" style="--p:${g.percent}%"><b>${g.percent}%</b></div><div><h3 style="margin:0 0 5px">${E(g.label)}</h3><div class="muted">${E(g.detail||'Using your selected brand style and verified clinic content.')}</div></div></div>
  </section></div>`;
}
