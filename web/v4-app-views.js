function appSidebar(active='week') {
  const items=[['home','⌂','Home'],['week','▣','This Week'],['calendar','□','Calendar'],['library','◇','Content Library'],['brand','✦','Brand Settings'],['integrations','↗','Integrations']];
  return `<aside class="sidebar">${logo()}<div class="nav-label">WORKSPACE</div><nav>${items.map(([id,ic,label])=>`<button class="nav-item ${active===id?'active':''}" data-action="nav" data-value="${id}"><span class="nav-icon">${ic}</span>${label}</button>`).join('')}</nav><div class="sidebar-bottom"><div class="plan-mini"><b>Founding Clinic</b><span>$9/month · weekly content</span></div></div></aside>`;
}
function topbar() {
  return `<header class="topbar"><div class="clinic-switch"><span class="logo-mark" style="width:27px;height:27px;border-radius:9px">◒</span><span>${E(S.client?.name || 'Your clinic')}</span></div><div style="display:flex;gap:8px"><span class="badge green">Week 1</span><button class="button" data-action="logout">Sign out</button></div></header>`;
}
function mobileNav(active='week') {
  return `<nav class="mobile-nav">${[['home','Home'],['week','Week'],['calendar','Calendar'],['brand','Brand']].map(([id,label])=>`<button class="${active===id?'active':''}" data-action="nav" data-value="${id}">${label}</button>`).join('')}</nav>`;
}
function thisWeekPage() {
  const items = (S.plan?.items || []).filter(item => S.filter==='all' || item.type===S.filter);
  const approved = S.plan?.items?.filter(x=>x.approved).length || 0;
  return `<div class="app-shell">${appSidebar('week')}<main class="app-main">${topbar()}<div class="page">
    <div class="page-head"><div><h1>Your Week</h1><p>Review only what needs attention. Everything else stays out of the way.</p></div><button class="button" data-action="regenerate-plan">↻ Refresh ideas</button></div>
    <section class="week-summary"><div><h2>Week 1 is ${approved ? 'in review' : 'being prepared'} ✨</h2><p>2 carousels · 1 post · 4 stories</p></div><div class="week-stats"><span>${approved}/7 approved</span><span>${S.plan?.items?.filter(x=>x.projectId).length||0}/7 created</span></div></section>
    <div class="filter-tabs">${[['all','All'],['carousel','Carousels'],['post','Post'],['story','Stories']].map(([id,label])=>`<button class="filter-tab ${S.filter===id?'active':''}" data-action="filter" data-value="${id}">${label}</button>`).join('')}</div>
    <div class="content-grid">${items.map(contentCard).join('')}</div>
  </div>${mobileNav('week')}</main></div>`;
}
function contentCard(item) {
  const media = item.projectId ? projectPreview(item) : '';
  return `<article class="content-card ${E(item.type)}" data-item="${E(item.id)}">
    <div class="content-thumb">${media || `<div class="content-placeholder">${item.status==='generating'?'<div class="spinner"></div><strong>Generating…</strong>':'<strong>'+E(typeLabel(item.type))+'</strong><br><span>'+E(item.angle)+'</span>'}</div>`}<span class="content-type">${E(typeLabel(item.type))}</span></div>
    <div class="content-body"><h3>${E(item.angle)}</h3><p>${E(item.topic)}</p></div>
    <div class="content-foot"><span class="content-status ${item.approved?'approved':''}">${item.approved?'✓ Approved':item.status==='ready'?'Ready to review':item.status==='generating'?'Creating':'Planned'}</span><button class="button" style="min-height:32px;padding:6px 9px;font-size:11px" data-action="review-item" data-id="${E(item.id)}">${item.projectId?'Review':'Open'}</button></div>
  </article>`;
}
function projectPreview(item) {
  const p = item._project;
  if (!p) return '';
  const first = p.slides?.find(s=>s.artworkAssetId);
  return first ? `<img loading="lazy" decoding="async" src="${assetUrl(S.client.id,first.artworkAssetId)}" alt="${E(item.angle)}">` : '';
}
function reviewPage(item) {
  const p=item._project;
  const slides=p?.slides||[];
  const images=slides.filter(s=>s.artworkAssetId);
  const preview = item.type==='carousel'
    ? `<div class="carousel-strip">${slides.map((s,i)=>s.artworkAssetId?`<img loading="${i?'lazy':'eager'}" decoding="async" src="${assetUrl(S.client.id,s.artworkAssetId)}" alt="Slide ${i+1}">`:`<div style="width:min(280px,72vw);aspect-ratio:4/5;border-radius:14px" class="skeleton"></div>`).join('')}</div>`
    : `<div class="single-preview ${E(item.type)}">${images[0]?`<img decoding="async" src="${assetUrl(S.client.id,images[0].artworkAssetId)}" alt="${E(item.angle)}">`:'<div class="skeleton" style="width:320px;aspect-ratio:4/5;border-radius:16px"></div>'}</div>`;
  const caption = p?.instagram || item.angle;
  return `<div class="app-shell">${appSidebar('week')}<main class="app-main">${topbar()}<div class="page">
    <div class="page-head"><div><button class="button ghost" data-action="back-week">← Back to week</button><h1 style="margin-top:12px">Review Your ${E(typeLabel(item.type))}</h1><p>Approve it, make a quick edit, or replace it.</p></div><span class="badge">${E(typeLabel(item.type))}${item.type==='carousel'?' · 5 slides':''}</span></div>
    <div class="review-shell"><section class="card review-stage">${preview}</section><aside class="review-side">
      <section class="card review-panel"><h3>Caption</h3><div class="caption">${E(caption)}</div></section>
      <section class="card review-panel"><h3>Quick actions</h3><div class="review-actions">
        <button class="button primary" data-action="approve-item" data-id="${E(item.id)}">✓ Approve</button>
        <button class="button" data-action="edit-project" data-id="${E(item.id)}">✎ Edit</button>
        <button class="button" data-action="replace-item" data-id="${E(item.id)}">↻ Replace</button>
      </div></section>
      <section class="card review-panel"><h3>Publishing</h3><div class="muted">Scheduling comes after the whole week is approved, so review stays focused.</div></section>
    </aside></div>
  </div>${mobileNav('week')}</main></div>`;
}
function calendarPage() {
  const days=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const items=S.plan?.items||[];
  return `<div class="app-shell">${appSidebar('calendar')}<main class="app-main">${topbar()}<div class="page"><div class="page-head"><div><h1>Content Calendar</h1><p>Your week at a glance.</p></div><button class="button primary">Schedule approved content</button></div>
  <div class="schedule-grid">${days.map((d,i)=>`<div class="day"><b>${d}</b>${items.filter((_,idx)=>idx%7===i).map(x=>`<div class="day-item">${E(typeLabel(x.type))}<br>${E(x.angle.slice(0,42))}</div>`).join('')}</div>`).join('')}</div></div>${mobileNav('calendar')}</main></div>`;
}
function brandPage() {
  const b=S.client?.brand||{},p=S.client?.profile||{};
  return `<div class="app-shell">${appSidebar('brand')}<main class="app-main">${topbar()}<div class="page"><div class="page-head"><div><h1>Brand Settings</h1><p>Change the details future weeks should follow.</p></div></div>
  <section class="card" style="padding:22px;max-width:760px"><div class="form-grid"><div class="field"><label>Clinic name</label><input class="input" value="${E(b.name||S.client.name)}" readonly></div><div class="field"><label>Location</label><input class="input" value="${E(b.location||'')}" readonly></div><div class="field span2"><label>Services</label><div class="notice">${E((p.services||[]).join(' · ') || 'Add services during the next profile update')}</div></div><div class="field"><label>Primary colour</label><input class="input" type="color" value="${E(b.primary||'#5b5bd6')}" disabled></div><div class="field"><label>Main goal</label><input class="input" value="${E(p.v4Goal||'')}" readonly></div></div></section>
  </div>${mobileNav('brand')}</main></div>`;
}
function render() {
  let html='';
  if (S.view==='loading') html='<div class="v4-loading"><div><div class="spinner" style="margin:auto"></div><p>Loading Srshti…</p></div></div>';
  else if (S.view==='landing') html=publicLanding();
  else if (S.view==='onboarding') {
    const st=S.onboarding.step;
    html=st==='clinic'?clinicStep():st==='quick'?quickStep():st==='analysis'?analysisStep():st==='styles'?styleStep():st==='topics'?topicStep():generationStep();
  } else if (S.view==='week') html=thisWeekPage();
  else if (S.view==='review') html=reviewPage(S.selectedItem);
  else if (S.view==='calendar') html=calendarPage();
  else if (S.view==='brand') html=brandPage();
  else html=thisWeekPage();
  root.innerHTML=html;
}
