import { styleModels, styleProviders } from './style-providers.js';
import { attachStyleMarker, styleReferenceImage, appendMarkNote } from './style-variant.js';
import { IMAGE_FORMATS, imageFormat } from './image-formats.js';
import { finalArtworkBlob } from './canvas.js';
import { starterSlides } from "./data.js";
import { IMAGE_MODELS, WRITING_MODELS } from "./provider-models.js";
import { createGenerationRun } from "./generation-run.js";
import { runConcurrent } from "./batch-runner.js";
import { makeZip, downloadBlob } from "./zip.js";
import { analyzeLogoColors } from "./logo-colors.js";
import { DESIGN_SYSTEMS } from "./design-systems.js";
const root = document.querySelector("#app"),
  T = document.querySelector("#toast"),
  E = (v) =>
    String(v ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
let S = {
  me: null,
  adminAccounts: [],
  companionDevices: [],
  pairing: null,
  view: "home",
  packs: [],
  clients: [],
  all: [],
  dash: {},
  status: {},
  shared: [],
  client: null,
  projects: [],
  templates: [],
  p: null,
  i: 0,
  busy: "",
  generationRun: null,
  imageProgress: null,
  exportProgress: null,
  exportResult: null,
  customLanguage: false,
  tab: "overview",
  form: false,
  makerOpen: false,
  variant: null,
  removeStyleId: "",
  import: null,
  importId: "",
  regenerationNotes: {},
  logoColors: null,
  maker: { name: '', businessType: '', primary: '#073a42', accent: '#14ada9', language: 'English', languageNotes: '', direction: '', provider: 'openai', model: IMAGE_MODELS.openai[0][0], designId: DESIGN_SYSTEMS[0].id, logoImage: '', logoName: '', moodImage: '', moodName: '', progress: 0, total: 0 },
  create: { clientId: "", goal: "Educate", topic: "", facts: "" },
};
const api = async (u, d, m = d === undefined ? "GET" : "POST", raw = false) => {
  let o = { method: m, headers: {} };
  if (m !== 'GET' && S.me?.csrf) o.headers['X-CSRF-Token'] = S.me.csrf;
  if (d !== undefined) {
    o.body = raw ? d : JSON.stringify(d);
    o.headers["Content-Type"] = raw ? "application/zip" : "application/json";
  }
  let r = await fetch(u, o),
    j = await r.json().catch(() => ({}));
  if (r.status === 401) { location.assign('/login'); throw Error('Sign in to continue.'); }
  if (!r.ok) throw Error(j.error || `Request failed (${r.status}${r.status === 413 ? ": file is too large" : ""}).`);
  return j;
};
const fileDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(Error("Could not read that image."));
    reader.onload = () => resolve(String(reader.result || ""));
    reader.readAsDataURL(file);
  });
const toast = (x) => {
    T.textContent = x;
    T.classList.add("show");
    setTimeout(() => T.classList.remove("show"), 4000);
  },
  pk = (id) => S.packs.find((x) => x.id === id) || {},
  sp = () => S.p?.slides[S.i],
  ap = () => S.p?.slides.filter((x) => x.approved).length || 0,
  im = () => S.p?.slides.filter((x) => x.artworkAssetId).length || 0,
  rv = () =>
    S.p?.slides.filter((x) => x.artworkAssetId && x.artworkReviewed).length ||
    0;
const status = (p) => {
  let a = p.slides.filter((x) => x.approved).length,
    i = p.slides.filter((x) => x.artworkAssetId).length,
    r = p.slides.filter((x) => x.artworkAssetId && x.artworkReviewed).length;
  return r === 5
    ? "Ready to export"
    : i
      ? `${5 - r} need review`
      : a === 5
        ? "Ready to generate"
        : a
          ? "Copy needs review"
          : "Brief started";
};
async function load() {
  S.me = await api('/api/me');
  S.adminAccounts = S.me.isAdmin ? (await api('/api/admin/accounts')).accounts : [];
  S.companionDevices = S.me.companionEnabled ? (await api('/api/companion/devices')).devices : [];
  let [a, b, c, d, e, f] = await Promise.all([
    api("/api/business-packs"),
    api("/api/clients"),
    api("/api/dashboard"),
    api("/api/status"),
    api("/api/all-projects"),
    api("/api/templates/shared"),
  ]);
  Object.assign(S, {
    packs: a.packs,
    clients: b.clients,
    dash: c,
    status: d,
    all: e.projects,
    shared: f.templates,
  });
  S.create.clientId ||= S.clients[0]?.id;
}
async function client(id) {
  if(S.me?.companionEnabled) S.companionDevices = (await api('/api/companion/devices')).devices;
  let [a, b, c] = await Promise.all([
    api(`/api/clients/${id}`),
    api(`/api/clients/${id}/projects`),
    api(`/api/clients/${id}/templates`),
  ]);
  Object.assign(S, {
    client: a.client,
    projects: b.projects,
    templates: c.templates,
    view: "client",
    tab: "overview",
    p: null,
    logoColors: null,
    maker: { ...S.maker, name: a.client.brand?.name || a.client.name, businessType: pk(a.client.businessPackId).name || '', primary: a.client.brand?.primary || '#073a42', accent: a.client.brand?.accent || '#14ada9', provider: S.maker.provider, logoImage: '', logoName: '', moodImage: '', moodName: '', progress: 0, total: 0 },
    makerOpen: false,
    variant: null,
    removeStyleId: "",
  });
  normalizeStyleProvider();
  render();
}
async function project(id) {
  const [projectData, stylesData] = await Promise.all([api(`/api/clients/${S.client.id}/projects/${id}`), api(`/api/clients/${S.client.id}/templates`)]);
  S.p = projectData.project;
  S.templates = stylesData.templates;
  if (S.me?.companionEnabled) S.companionDevices = (await api('/api/companion/devices')).devices;
  S.p.language ||= S.p.contextSnapshot?.language || "english";
  S.customLanguage = !(pk(S.client.businessPackId).languages || []).some(
    (language) => language.id === S.p.language,
  );
  S.view = "studio";
  S.i = 0;
  render();
}
function nav() {
  return `<aside aria-label="Main navigation"><button class="brand" data-a="nav" data-v="home"><span class="brand-mark" aria-hidden="true">✦</span><span class="brand-name"><b>Carousel <em>Studio</em></b><small>Creative workspace</small></span></button><div class="nav-label">WORKSPACE</div>${[
    ["home", "⌂ Home"],
    ["create", "＋ Create carousel"],
    ["projects", "▧ Projects"],
    ["clients", "◉ Clients"],
    ["library", "✦ Library"],
    ["settings", "⚙ Settings"],
  ]
    .map(
      ([v, x]) =>
        `<button class="nav ${S.view === v || (v === "clients" && S.view === "client") ? "on" : ""}" data-a="nav" data-v="${v}" ${S.view === v || (v === "clients" && S.view === "client") ? 'aria-current="page"' : ""}>${x}</button>`,
    )
    .join(
      "",
    )}<div class="side-note"><span class="side-note-label">YOUR WORKSPACE</span><b>${E(S.me?.credits ?? 0)} credits available</b><small>Manage clients, build carousels, and review every slide.</small></div></aside>`;
}
function shell(x) {
  root.innerHTML = `<div class="shell">${nav()}<main><header class="topbar"><span class="breadcrumb">Workspace${S.client ? " <span aria-hidden=\"true\">/</span> " + E(S.client.name) : ""}</span><button class="btn primary" data-a="nav" data-v="create">＋ New carousel</button></header>${x}</main></div>`;
}
const card = (p) =>
  `<button class="project" data-a="open" data-c="${E(p.clientId || S.client.id)}" data-id="${E(p.id)}"><i>${E(pk(p.businessPackId || S.client.businessPackId).icon || "✦")}</i><span><small>${E(p.clientName || S.client?.name || "Client")}</small><b>${E(p.topic || "Untitled carousel")}</b><em>${status(p)}</em></span><strong>${p.slides?.every(s => s.artworkAssetId && s.artworkReviewed) ? 'Export' : p.slides?.some(s => s.artworkAssetId) ? 'Review artwork' : p.slides?.every(s => s.approved) ? 'Create images' : p.slides?.some(s => s.approved) ? 'Review copy' : 'Continue brief'} →</strong></button>`;
function home() {
  return `<section class="hero"><div class="hero-copy"><span>GOOD TO SEE YOU</span><h1>Make your next carousel<br>with confidence.</h1><p>Start with an idea. Shape the copy, choose a style, and review every slide before it goes out.</p><button class="btn primary big" data-a="nav" data-v="create">Create a carousel <span aria-hidden="true">→</span></button></div><div class="hero-steps" aria-label="How it works"><span>YOUR WORKFLOW</span><div><b>01</b><p>Write the brief</p></div><div><b>02</b><p>Review the copy</p></div><div><b>03</b><p>Approve the design</p></div></div></section><div class="metrics">${[
    ["Clients", S.dash.clients],
    ["Projects", S.dash.projects],
    ["Need review", S.dash.review],
    ["Generating", S.dash.running],
  ]
    .map((x) => `<div><b>${x[1] || 0}</b>${x[0]}</div>`)
    .join(
      "",
    )}</div><div class="section-heading"><div><span>YOUR WORK</span><h2>Pick up where you left off</h2><p class="muted">Open a project to continue from its latest step.</p></div><button class="btn" data-a="nav" data-v="projects">View all projects →</button></div><div class="list">${S.all.slice(0, 6).map(card).join("") || '<div class="empty">Add a client, then create your first carousel.</div>'}</div>`;
}
function create() {
  return `<div class="intro"><span>NEW CAROUSEL</span><h1>Start with the idea.</h1><p>Three quick choices set up your draft. You can refine everything in the editor.</p></div><div class="create-layout"><section class="card form create-form"><div class="form-step"><span class="step-number">01</span><div><h2>Who is this for?</h2><p>Choose the client whose brand and rules should guide this carousel.</p><label class="sr-only" for="create-client">Client</label><select id="create-client" class="control" data-x="clientId">${S.clients.map((c) => `<option value="${c.id}" ${c.id === S.create.clientId ? "selected" : ""}>${E(c.name)} · ${E(pk(c.businessPackId).name)}</option>`).join("")}</select></div></div><div class="form-step"><span class="step-number">02</span><div><h2>What should it do?</h2><p>Pick the main purpose. This helps shape the story.</p><div class="goals">${["Educate", "Promote a service", "Answer a question", "Announce an offer", "Showcase work", "Custom"].map((x) => `<button class="goal ${S.create.goal === x ? "sel" : ""}" data-a="goal" data-v="${x}" aria-pressed="${S.create.goal === x}">${x}</button>`).join("")}</div></div></div><div class="form-step"><span class="step-number">03</span><div><h2>What is the core idea?</h2><p>One sentence is enough to begin.</p><label class="sr-only" for="create-topic">Carousel topic</label><textarea id="create-topic" class="control" data-x="topic" placeholder="e.g. What to expect at your first dental visit">${E(S.create.topic)}</textarea><label for="create-facts">Facts, offers, or things to avoid <small>Optional</small></label><textarea id="create-facts" class="control" data-x="facts" placeholder="Add any details that must be accurate or included.">${E(S.create.facts)}</textarea></div></div><div class="form-actions"><span>You can edit the brief before generating copy.</span><button class="btn primary big" data-a="new" ${S.clients.length ? '' : 'disabled'}>Continue to brief →</button></div></section><aside class="guide-card" aria-label="What happens next"><span>WHAT HAPPENS NEXT</span><h2>A clear path to publish</h2><ol><li>Shape the message</li><li>Review five slides of copy</li><li>Create and inspect artwork</li><li>Export your carousel</li></ol><p>Every slide stays editable throughout the process.</p></aside></div>`;
}
function clients() {
  return `<div class="intro row"><div><span>CLIENTS</span><h1>Every brand, in one place.</h1><p>Keep each client’s details, styles, and projects together.</p></div><button class="btn primary" data-a="form" aria-expanded="${S.form}">${S.form ? 'Close form' : '＋ Add client'}</button></div>${S.form ? `<section class="card add"><div><h2>Add a client</h2><p class="muted">A name and business type are enough to get started.</p></div><label>Business name<input id="name" class="control" placeholder="e.g. Harbor Dental Studio"></label><label>Business type<select id="pack" class="control">${S.packs.map((x) => `<option value="${x.id}">${E(x.icon)} ${E(x.name)}</option>`).join("")}</select></label><button class="btn primary" data-a="add">Create client →</button></section>` : ""}<div class="section-heading"><div><span>CLIENT WORKSPACES</span><h2>${S.clients.length} ${S.clients.length === 1 ? 'client' : 'clients'}</h2></div></div><div class="clients">${S.clients.map((c) => `<button data-a="client" data-id="${c.id}"><i aria-hidden="true">${E(pk(c.businessPackId).icon)}</i><b>${E(c.name)}</b><small>${E(pk(c.businessPackId).name)}</small><span>Open workspace <span aria-hidden="true">→</span></span></button>`).join("") || '<div class="empty">No clients yet. Add your first client to build a carousel.</div>'}</div>`;
}
function clientPage() {
  const brandData = S.client.brand || {}, profile = S.client.profile || {};
  const checks = [["Business details", Boolean(brandData.name && Object.values(profile).some(Boolean)), "brand"], ["Contact details", Boolean(brandData.phone || brandData.location), "brand"], ["Logo and colours", Boolean(brandData.logoAssetId), "brand"], ["Choose a style", Boolean(S.templates.some(t => t.clientId === S.client.id)), "styles"]];
  return `<div class="intro row"><div><span>${E(pk(S.client.businessPackId).name)} WORKSPACE</span><h1>${E(S.client.name)}</h1><p>Manage this client’s brand, projects, and visual direction.</p></div><button class="btn primary" data-a="create-client">Create carousel →</button></div><div class="tabs" role="tablist" aria-label="Client sections">${[
    ["overview", "Overview"],
    ["projects", "Projects"],
    ["brand", "Brand kit"],
    ["styles", "Styles"],
  ]
    .map(
      (x) =>
        `<button class="${S.tab === x[0] ? "on" : ""}" data-a="tab" data-v="${x[0]}" role="tab" aria-selected="${S.tab === x[0]}">${x[1]}</button>`,
    )
    .join(
      "",
    )}</div>${S.tab === "overview" ? `<div class="client-overview"><section class="card ready"><span class="eyebrow">GET READY</span><h2>Set up this client</h2><p class="muted">Complete these details to make future carousels more consistent.</p>${checks.map(([label, done, tab]) => `<button data-a="tab" data-v="${tab}"><span class="check-icon ${done ? 'done' : ''}">${done ? '✓' : '○'}</span><span class="check-copy"><b>${label}</b><small>${done ? 'Added' : 'Needs attention'}</small></span><span class="check-action">${done ? 'Review' : 'Add'} →</span></button>`).join("")}</section><section class="overview-next"><span class="eyebrow">NEXT STEP</span><h2>Ready to create?</h2><p>Start a new carousel using this client’s details. You can add more brand information at any time.</p><button class="btn primary" data-a="create-client">Create carousel →</button></section></div>` : S.tab === "projects" ? `<div class="section-heading"><div><span>PROJECTS</span><h2>${S.projects.length} ${S.projects.length === 1 ? 'carousel' : 'carousels'}</h2></div><label class="btn upload">Import project JSON<input type="file" data-file="project-json" accept="application/json,.json"></label></div><div class="list">${S.projects.map(card).join("") || '<div class="empty">No carousels for this client yet. Create one to get started.</div>'}</div>` : S.tab === "brand" ? brand() : styles(S.templates, true)}`;
}
function brand() {
  let b = S.client.brand || {},
    p = S.client.profile || {},
    q = pk(S.client.businessPackId),
    logoUrl = b.logoAssetId
      ? `/api/clients/${S.client.id}/assets/${b.logoAssetId}`
      : "";
  const suggested = S.logoColors
    ? `<div class="logo-analysis"><span><i class="color-dot" style="background:${E(S.logoColors.primary)}"></i><i class="color-dot" style="background:${E(S.logoColors.accent)}"></i> Colours found in this logo</span><button class="btn" data-a="use-logo-colors">Use these colours</button></div>`
    : "";
  return `<section class="card form brand-form"><span class="eyebrow">BRAND KIT</span><h2>Make every carousel feel like ${E(S.client.name)}.</h2><p class="muted">These details guide future projects. Existing work stays as it is until you update it.</p><div class="brand-section"><div class="brand-section-heading"><span class="step-number">01</span><div><h3>Business and contact</h3><p>Use the details customers should see.</p></div></div><label>Business name<input class="control" data-b="name" value="${E(b.name || S.client.name)}"></label><div class="two"><label>Phone<input class="control" data-b="phone" value="${E(b.phone || "")}"></label><label>Location / service area<input class="control" data-b="location" value="${E(b.location || "")}"></label></div></div><div class="brand-section"><div class="brand-section-heading"><span class="step-number">02</span><div><h3>Logo and colours</h3><p>Keep the same visual identity on every slide.</p></div></div><label>Logo <small>PNG, JPEG or WebP</small></label><div class="logo-analysis">${logoUrl ? `<img src="${logoUrl}" alt="${E(b.name || S.client.name)} logo" style="max-width:160px;max-height:72px;object-fit:contain;object-position:left">` : `<span class="muted">No logo uploaded yet.</span>`}<label class="btn upload">${logoUrl ? "Replace logo" : "Upload logo"}<input type="file" data-file="logo" accept="image/png,image/jpeg,image/webp"></label></div>${suggested}<div class="two"><label>Primary colour<input type="color" data-b="primary" value="${E(b.primary || "#073a42")}"></label><label>Accent colour<input type="color" data-b="accent" value="${E(b.accent || "#14ada9")}"></label></div></div><div class="brand-section"><div class="brand-section-heading"><span class="step-number">03</span><div><h3>Business guidance</h3><p>Add facts and rules the writing should follow.</p></div></div>${(q.onboardingFields || []).map(([k, l, t]) => `<label>${E(l)}${t === "textarea" ? `<textarea class="control" data-p="${k}">${E(p[k] || "")}</textarea>` : `<input class="control" data-p="${k}" value="${E(p[k] || "")}">`}</label>`).join("")}</div><div class="brand-actions"><span>Changes guide new work for this client.</span><button class="btn primary" data-a="save">Save brand kit</button></div></section>`;
}
const img = (t) => {
  let r = t.mode === "slides" ? t.data?.slides?.[0] : t.data;
  if (r?.staticPath) return r.staticPath;
  if (!r?.assetId) return "";
  return t.clientId === null
    ? `/api/template-assets/${r.assetId}`
    : `/api/clients/${S.client?.id}/assets/${r.assetId}`;
};
function styles(ts, editable = false) {
  const upload = editable ? `<div class="row" style="gap:12px;flex-wrap:wrap"><label class="btn upload">Upload one reference image<input type="file" data-file="style-image" accept="image/png,image/jpeg,image/webp"></label><label class="btn upload">Import five-slide design ZIP<input type="file" data-file="design-package" accept=".zip,application/zip"></label></div>${S.import ? `<div class="card form"><h3>Package preview</h3><p>${E(S.import.kind)} · ${S.import.images?.length || 0} images</p>${S.import.unresolved ? `<p>Choose five images to map before installing.</p><button class="btn" data-a="confirm-design">Use first five images</button>` : `<p>${(S.import.manifest?.templates || S.import.templates || []).map(t => E(t.name)).join(', ')}</p><button class="btn primary" data-a="install-design">Install styles</button>`}</div>` : ''}` : '';
  return `<section class="card style-library"><div class="style-head"><div><span class="eyebrow">VISUAL LIBRARY</span><h2>${editable ? 'Styles for this client' : 'Explore design references'}</h2><p class="muted">Use a consistent visual direction across all five slides.</p></div></div>${upload}<div class="styles">${ts.map((t) => `<div>${img(t) ? `<img src="${img(t)}" alt="${E(t.name)} reference">` : "✦"}<b>${E(t.name)}</b><small>${t.id.startsWith("builtin:") ? "Inspiration only" : t.clientId === null ? "Shared style" : "Private style"}</small>${editable && t.clientId === S.client.id ? `<div class="style-actions"><button class="btn" data-a="style-variant" data-id="${E(t.id)}" ${S.busy ? 'disabled' : ''}>Mark & create variation</button><button class="btn" data-a="style-remove" data-id="${E(t.id)}" ${S.busy ? 'disabled' : ''}>Remove</button></div>${S.removeStyleId === t.id ? `<div class="style-remove-confirm"><p>Remove this style from the client library? Existing artwork is kept. Projects using it will need another style for new generation.</p><button class="btn" data-a="style-remove-cancel">Cancel</button><button class="btn primary" data-a="style-remove-confirm" data-id="${E(t.id)}">Remove style</button></div>` : ''}` : ''}</div>`).join("") || '<div class="empty">No styles installed yet.</div>'}</div></section>${editable ? styleVariantEditor() : ''}${editable ? `<details class="card maker-disclosure" ${S.makerOpen ? 'open' : ''}><summary data-a="maker-toggle"><span><span class="eyebrow">CUSTOM DESIGN</span><strong>Create a new style from your brand</strong><small>Use a logo and a creative direction to generate five reusable references.</small></span><b aria-hidden="true">＋</b></summary>${styleMaker()}</details>` : ''}`;
}
function normalizeStyleProvider() {
  const available=styleProviders(S.status,S.me?.companionEnabled,S.companionDevices);
  if(!available.some(([id])=>id===S.maker.provider)) S.maker.provider=available[0]?.[0] || S.maker.provider;
  const models=styleModels(S.maker.provider,S.companionDevices);
  if(!models.some(([id])=>id===S.maker.model)) S.maker.model=models[0]?.[0] || '';
}
async function renderClientStyle(clientId, input) {
  let result=await api(`/api/clients/${clientId}/style-maker/render`,input);
  if(!result.job) return result;
  const deadline=Date.now()+12*60*1000;
  while(Date.now()<deadline) {
    await new Promise(resolve=>setTimeout(resolve,1500));
    result=await api(`/api/clients/${clientId}/style-maker/jobs/${result.job.id}`);
    if(result.image) return result;
    if(['failed','cancelled','expired'].includes(result.job.status)) throw Error(result.job.error || 'Companion generation did not finish.');
  }
  throw Error('Companion generation timed out. Check that the companion is running.');
}
function styleVariantEditor() {
  const v = S.variant;
  if (!v) return '';
  const available = styleProviders(S.status, S.me?.companionEnabled, S.companionDevices);
  return `<section class="card form style-variant-editor"><div class="row"><div><span class="eyebrow">STYLE VARIATION</span><h2>${E(v.source.name)}</h2></div><button class="btn" data-a="variant-close" ${S.busy ? 'disabled' : ''}>Close</button></div><p class="muted">Draw on the full image. Each mark gets a number and a matching line below where you can describe the change. The result is saved as a new style.</p><div class="variant-preview"><canvas id="style-marker" width="${v.image.naturalWidth}" height="${v.image.naturalHeight}" aria-label="Mark areas to change on the full design"></canvas></div><div class="row"><button class="btn" data-a="variant-undo" ${S.busy ? 'disabled' : ''}>Undo mark</button><button class="btn" data-a="variant-clear" ${S.busy ? 'disabled' : ''}>Clear marks</button></div><label>What changes would you like?<textarea class="control" data-variant="direction" placeholder="Describe the changes you want, including any areas you marked">${E(v.direction)}</textarea></label><label>New style name<input class="control" data-variant="name" value="${E(v.name)}"></label><div class="two"><label>Image provider<select class="control" data-maker="provider">${available.map(([id, x]) => `<option value="${E(id)}" ${S.maker.provider === id ? 'selected' : ''}>${E(x.label || id)}</option>`).join('')}</select></label><label>Image model<select class="control" data-maker="model">${styleModels(S.maker.provider, S.companionDevices).map(([id, label]) => `<option value="${E(id)}" ${S.maker.model === id ? 'selected' : ''}>${E(label)}</option>`).join('')}</select></label></div><p class="muted">${['codex','antigravity'].includes(S.maker.provider) ? 'Companion generation costs 0 Smilecraft credits.' : 'Creating a variation costs 10 credits in the cloud.'}</p><button class="btn primary" data-a="variant-generate" ${S.busy || !available.length ? 'disabled' : ''}>${S.busy === 'variant' ? 'Creating variation…' : 'Create new style from these changes'}</button></section>`;
}
async function openStyleVariant(id) {
  if(S.me?.companionEnabled) S.companionDevices = (await api('/api/companion/devices')).devices;
  normalizeStyleProvider();
  const source = S.templates.find(t => t.id === id && t.clientId === S.client.id);
  if (!source) throw Error('Client style not found.');
  S.busy = 'variant-loading'; render();
  try {
    const url = img(source);
    if (!url) throw Error('This style has no reference image.');
    const response = await fetch(url);
    if (!response.ok) throw Error('Could not load the style reference.');
    const referenceImage = await fileDataUrl(await response.blob());
    const image = new Image(); image.src = referenceImage; await image.decode();
    S.variant = { source, image, referenceImage, strokes: [], nextMarkNumber: 1, direction: '', name: `${source.name} — variation` };
  } finally { S.busy = ''; render(); }
  root.querySelector('.style-variant-editor')?.scrollIntoView({behavior:'smooth', block:'start'});
}
async function generateStyleVariant() {
  const v = S.variant, m = S.maker, clientId = S.client.id;
  if (!v.name.trim()) throw Error('Add a name for the new style.');
  if (!v.direction.replace(/^Mark \d+:\s*$/gm, '').trim()) throw Error('Describe the changes you want next to the mark numbers.');
  const revisionNotes = v.direction.trim();
  S.busy = 'variant'; render();
  try {
    const result = await renderClientStyle(clientId, { sourceTemplateId: v.source.id, designId: DESIGN_SYSTEMS[0].id, referenceImage: v.referenceImage, moodImage: v.strokes.length ? styleReferenceImage(v.image, v.strokes) : '', revisionNotes, name: m.name, businessType: m.businessType, brand: {name:m.name, primary:m.primary, accent:m.accent}, primary:m.primary, accent:m.accent, language:m.language, languageNotes:m.languageNotes, logoImage:m.logoImage, provider:m.provider, model:m.model });
    await api(`/api/clients/${clientId}/templates`, {name:v.name.trim(), image:result.image});
    S.templates = (await api(`/api/clients/${clientId}/templates`)).templates;
    S.me = await api('/api/me'); S.variant = null;
    toast('New style added to this client.');
  } finally { S.busy = ''; render(); }
}
function styleMaker() {
  const m = S.maker, available = styleProviders(S.status, S.me?.companionEnabled, S.companionDevices);
  const hasLogo = Boolean(m.logoImage || S.client.brand?.logoAssetId);
  return `<section class="card form style-maker"><h2>Design details</h2><p class="muted">Add your exact logo and creative direction. Each design direction creates five reusable slide references for this client.</p><div class="two"><label>Business name<input class="control" data-maker="name" value="${E(m.name)}"></label><label>Industry / business type<input class="control" data-maker="businessType" value="${E(m.businessType)}"></label></div><div class="two"><label>Primary colour<input type="color" data-maker="primary" value="${E(m.primary)}"></label><label>Accent colour<input type="color" data-maker="accent" value="${E(m.accent)}"></label></div><div class="two"><label>Exact logo <small>${S.client.brand?.logoAssetId ? 'Brand kit logo ready' : 'Required'}</small><span class="maker-upload"><input type="file" data-file="maker-logo" accept="image/png,image/jpeg,image/webp">${E(m.logoName || (S.client.brand?.logoAssetId ? 'Use brand kit logo or replace it' : 'Choose a logo'))}</span></label><label>Visual mood reference <small>Optional</small><span class="maker-upload"><input type="file" data-file="maker-mood" accept="image/png,image/jpeg,image/webp">${E(m.moodName || 'Choose an image')}</span></label></div><div class="two"><label>Language style<select class="control" data-maker="language">${['English','Malayalam + English','Hindi + English','Arabic + English','Custom mix'].map(x => `<option ${m.language === x ? 'selected' : ''}>${E(x)}</option>`).join('')}</select></label><label>Language notes<input class="control" data-maker="languageNotes" value="${E(m.languageNotes)}" placeholder="e.g. Malayalam headlines, English details"></label></div><label>Creative direction<textarea class="control" data-maker="direction" placeholder="Audience, mood, photography and things to avoid">${E(m.direction)}</textarea></label><h3>Choose a design direction</h3><p class="muted">These sample dental boards are inspiration only. Generated styles use this client’s business, logo and colours.</p><div class="maker-directions">${DESIGN_SYSTEMS.map(d => `<button type="button" class="maker-direction ${m.designId === d.id ? 'sel' : ''}" data-a="maker-design" data-v="${d.id}"><img src="${E(d.img)}" alt=""><b>${E(d.name)}</b><small>${E(d.kind)}</small></button>`).join('')}</div><div class="two"><label>Image provider<select class="control" data-maker="provider">${available.map(([id, value]) => `<option value="${E(id)}" ${m.provider === id ? 'selected' : ''}>${E(value.label || id)}</option>`).join('')}</select></label><label>Image model<select class="control" data-maker="model">${styleModels(m.provider, S.companionDevices).map(([id, label]) => `<option value="${E(id)}" ${m.model === id ? 'selected' : ''}>${E(label)}</option>`).join('')}</select></label></div><p class="muted">Each generated direction costs 10 credits in the cloud. Review generated text and logo before publishing.</p>${S.busy === 'maker' ? `<p role="status">Creating style ${m.progress + 1} of ${m.total}…</p>` : ''}<div class="row" style="gap:10px;flex-wrap:wrap"><button class="btn primary" data-a="maker-generate" ${S.busy || !hasLogo || !available.length ? 'disabled' : ''}>Create selected style</button><button class="btn" data-a="maker-all" ${S.busy || !hasLogo || !available.length ? 'disabled' : ''}>Create all 10 styles</button></div></section>`;
}
async function cropStyleBoard(dataUrl, crop) {
  const board = new Image();
  board.src = dataUrl;
  await board.decode();
  const panel = (1 - crop.left - crop.right - crop.gap * 4) / 5;
  return Array.from({ length: 5 }, (_, i) => {
    const canvas = document.createElement('canvas');
    canvas.width = 768; canvas.height = 960;
    const x = (crop.left + i * (panel + crop.gap)) * board.naturalWidth;
    canvas.getContext('2d').drawImage(board, x, crop.top * board.naturalHeight, panel * board.naturalWidth, (crop.bottom - crop.top) * board.naturalHeight, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', .88);
  });
}
async function generateStyles(designs) {
  const m = S.maker;
  if (!m.name.trim() || !m.businessType.trim()) throw Error('Add the business name and industry first.');
  if (!m.logoImage && !S.client.brand?.logoAssetId) throw Error('Add a logo first.');
  S.busy = 'maker'; m.progress = 0; m.total = designs.length; render();
  const errors = [];
  try {
    await runConcurrent(designs, 5, async (design) => {
      try {
        const result = await renderClientStyle(S.client.id, { designId: design.id, design: { name: design.name, kind: design.kind }, name: m.name, brand: { name: m.name, primary: m.primary, accent: m.accent }, businessType: m.businessType, primary: m.primary, accent: m.accent, language: m.language, languageNotes: m.languageNotes, direction: m.direction, provider: m.provider, model: m.model, logoImage: m.logoImage, moodImage: m.moodImage });
        const images = await cropStyleBoard(result.image, design.crop);
        await api(`/api/clients/${S.client.id}/templates`, { name: `${m.name} — ${design.name}`, images });
      } catch (error) { errors.push(`${design.name}: ${error.message}`); }
      m.progress++; render();
    });
    S.templates = (await api(`/api/clients/${S.client.id}/templates`)).templates;
    S.me = await api('/api/me');
    toast(errors.length ? `${m.total - errors.length}/${m.total} styles created. ${errors[0]}` : `${m.total} style${m.total === 1 ? '' : 's'} added to this client.`);
  } finally { S.busy = ''; render(); }
}
function library() {
  return `<div class="intro"><span>LIBRARY</span><h1>Styles and creative references.</h1><p>Built-in examples are inspiration for creating new designs. Create or import each client’s own styles inside their workspace.</p></div>${styles(S.shared)}`;
}
function settings() {
  const companion = S.me?.companionEnabled ? `<section class="card form"><h2>AI on your computer</h2><p><a href="https://github.com/ananthcjayan12/smilecraft-carousel-studio/releases/latest" target="_blank" rel="noopener noreferrer">Download Smilecraft Companion</a></p><p>Use your signed-in Codex or Antigravity CLI for carousel writing and slide images. Keep Smilecraft Companion running while generating. Local generation uses your CLI subscription and costs 0 Smilecraft credits.</p><button class="btn" data-a="pair-code">Create pairing code</button>${S.pairing ? `<p>One-time code (expires in 5 minutes): <code>${E(S.pairing.code)}</code></p>` : ''}<p class="muted">In the companion, enter this website URL and the code above. Then select the local provider in a carousel.</p>${S.companionDevices.map(d=>`<div class="row" style="margin:12px 0;gap:12px;align-items:center"><span><b>${E(d.name)}</b><small style="display:block">${d.online?'Online':'Offline'} · Codex ${d.capabilities?.codex?.ready?'ready':'unavailable'} · Antigravity ${d.capabilities?.antigravity?.ready?'ready':'unavailable'}</small></span><button class="btn" data-a="revoke-device" data-id="${E(d.id)}">Revoke</button></div>`).join('')}</section>` : '';
  const admin = S.me?.isAdmin ? `<section class="card form"><h2>Assign plans and credits</h2><p class="muted">Each account gets its plan credits once per month. Repeat allocations for the same month are safe.</p><label>Allocation month<input class="control" id="allocation-month" type="month" value="${new Date().toISOString().slice(0, 7)}"></label>${S.adminAccounts.map(account => `<div class="row" style="margin:12px 0;gap:12px;align-items:center"><span><b>${E(account.name)}</b><small style="display:block">${E(account.email)}</small></span><select class="control" id="plan-${E(account.id)}"><option value="access" ${account.planId === 'access' ? 'selected' : ''}>Access · 0</option><option value="starter" ${account.planId === 'starter' ? 'selected' : ''}>Starter · 100</option><option value="pro" ${account.planId === 'pro' ? 'selected' : ''}>Pro · 500</option></select><button class="btn" data-a="allocate" data-id="${E(account.id)}">Allocate</button><button class="btn" data-a="toggle-companion" data-id="${E(account.id)}" data-enabled="${account.companionEnabled?1:0}">${account.companionEnabled?'Disable companion':'Enable companion'}</button></div>`).join('')}</section>` : '';
  return `<div class="intro"><span>SETTINGS</span><h1>Workspace settings.</h1><p>${E(S.me?.user?.email || '')}</p></div><section class="card form"><h2>${E(S.me?.credits ?? 0)} credits available</h2><p class="muted">Plan: ${E(S.me?.plan?.planId || 'access')}. A cloud five-slide draft costs 2 credits, a cloud rewrite costs 1, and each generated image or style costs 10.</p><p class="muted">OpenAI and Gemini keys are managed by the service owner in the cloud.</p><button class="btn" data-a="logout">Sign out</button></section>${companion}${admin}`;
}
function render() {
  let content =
    S.view === "home"
      ? home()
      : S.view === "create"
        ? create()
        : S.view === "projects"
          ? `<div class="intro"><span>ALL PROJECTS</span><h1>Find your next step.</h1><p>Every carousel shows what needs attention before it is ready to share.</p></div><div class="section-heading"><div><span>YOUR CAROUSELS</span><h2>${S.all.length} ${S.all.length === 1 ? 'project' : 'projects'}</h2></div></div><div class="list">${S.all.map(card).join("") || '<div class="empty">No projects yet. Create a carousel to get started.</div>'}</div>`
          : S.view === "clients"
            ? clients()
            : S.view === "client"
              ? clientPage()
              : S.view === "library"
                ? library()
                : S.view === "settings"
                  ? settings()
                  : studio();
  shell(content);
  const marker = root.querySelector('#style-marker');
  if (marker && S.variant) {
    const variant = S.variant;
    attachStyleMarker(marker, variant.image, variant.strokes, Boolean(S.busy), {
      getMarkNumber: () => variant.nextMarkNumber++,
      onMark: number => {
        variant.direction = appendMarkNote(variant.direction, number);
        const notes = root.querySelector('[data-variant="direction"]');
        if (notes) { notes.value = variant.direction; notes.scrollTop = notes.scrollHeight; }
      },
    });
  }
}
function studio() {
  let p = S.p;
  const stepNotes = ["Set the direction", "Approve the words", "Create the artwork", "Inspect each slide", "Download your files"];
  return `<div class="studio-title"><button data-a="back">← Back to projects</button><div class="studio-title-row"><div><span class="eyebrow">CAROUSEL EDITOR</span><h1>${E(p.topic || "New carousel")}</h1><p>${E(S.client.name)} <span aria-hidden="true">·</span> ${status(p)}</p></div><span class="studio-progress">Step ${p.stage + 1} of 5</span></div></div><div class="steps" aria-label="Carousel steps">${["Brief", "Copy", "Style", "Review", "Export"].map((x, i) => `<button class="${p.stage === i ? "on" : ""}" data-a="stage" data-v="${i}" ${p.stage === i ? 'aria-current="step"' : ''}><span class="step-dot">${i < p.stage ? '✓' : i + 1}</span><span><b>${x}</b><small>${stepNotes[i]}</small></span></button>`).join("")}</div>${S.generationRun ? `<div role="status"><button class="btn" data-a="stop-generation" ${S.generationRun.stopping ? "disabled" : ""}>${S.generationRun.stopping ? "Stopping…" : "Stop generation"}</button><p class="muted">Stops unfinished jobs. Work already processed by the AI provider may still cost money.</p></div>` : ""}<div class="studio-workspace" style="--artwork-ratio:${imageFormat(p.generation?.aspectRatio).ratio.replace(':', '/')}">${p.stage === 0 ? brief() : p.stage === 1 ? copy() : p.stage === 2 ? design() : p.stage === 3 ? review() : exportPage()}</div>`;
}
function writingControls() {
  const g =
    S.p.generation ||
    (S.p.generation = {
      writingProvider: "openai",
      writingModel: "gpt-5.6-sol",
    });
  const local = ['codex','antigravity'].includes(g.writingProvider);
  const discovered = local ? [...new Map(S.companionDevices.filter(d=>d.online && d.capabilities?.[g.writingProvider]?.ready).flatMap(d=>d.capabilities[g.writingProvider].models || []).map(m=>[m.id,[m.id,m.label]])).values()] : [];
  const models = local ? [['','CLI default'], ...discovered] : WRITING_MODELS[g.writingProvider] || [];
  return `<div class="model-panel"><label>Writing provider<select class="control" data-g="writingProvider">${Object.keys(
    { openai: WRITING_MODELS.openai, gemini: WRITING_MODELS.gemini, ...(S.me?.companionEnabled ? {codex: WRITING_MODELS.codex, antigravity: WRITING_MODELS.antigravity} : {}) },
  )
    .map(
      (id) =>
        `<option value="${id}" ${id === g.writingProvider ? "selected" : ""} ${S.status.textProviders?.[id]?.available ? "" : "disabled"}>${E(S.status.textProviders?.[id]?.label || id)}${S.status.textProviders?.[id]?.available ? "" : " — unavailable"}</option>`,
    )
    .join(
      "",
    )}</select></label><label>Model<select class="control" data-g="writingModel">${models.map(([id, label]) => `<option value="${id}" ${id === g.writingModel ? "selected" : ""}>${E(label)}</option>`).join("")}</select></label></div>`;
}
function formatControl() {
  const format = imageFormat(S.p.generation?.aspectRatio);
  return `<label>Output format<select class="control" data-g="aspectRatio" ${S.busy ? 'disabled' : ''}>${IMAGE_FORMATS.map(f => `<option value="${f.ratio}" ${f.ratio === format.ratio ? 'selected' : ''}>${E(f.label)} · ${f.ratio} · ${f.width} × ${f.height}</option>`).join('')}</select></label><p class="muted">Every slide uses this format. Changing it clears existing artwork and keeps approved copy. Downloads preserve the full image, adding margins if needed.</p>`;
}
function imageControls() {
  const g =
    S.p.generation ||
    (S.p.generation = {
      provider: "openai",
      model: "gpt-image-2",
    });
  const local = ['codex','antigravity'].includes(g.provider);
  const localModels = local ? [...new Map(S.companionDevices.filter(d=>d.online && d.capabilities?.[g.provider]?.ready).flatMap(d=>d.capabilities[g.provider].imageModels || []).map(m=>[m.id,[m.id,m.label]])).values()] : [];
  const models = local ? (localModels.length ? localModels : [['','Start the companion to load image models']]) : IMAGE_MODELS[g.provider] || [];
  const available = id => ['codex','antigravity'].includes(id) ? Boolean(S.me?.companionEnabled && S.companionDevices.some(d=>d.online && d.capabilities?.[id]?.ready && d.capabilities[id].imageModels?.length)) : Boolean(S.status.imageProviders?.[id]?.available);
  const label = id => ['codex','antigravity'].includes(id) ? `${id==='codex'?'Codex':'Antigravity'} on your computer` : S.status.imageProviders?.[id]?.label || id;
  return `<div class="model-panel"><label>Image provider<select class="control" data-g="provider" ${S.busy ? "disabled" : ""}>${Object.keys(
    { openai: IMAGE_MODELS.openai, gemini: IMAGE_MODELS.gemini, ...(S.me?.companionEnabled ? {codex: IMAGE_MODELS.codex,antigravity: IMAGE_MODELS.antigravity} : {}) },
  )
    .map(
      (id) =>
        `<option value="${id}" ${id === g.provider ? "selected" : ""} ${available(id) ? "" : "disabled"}>${E(label(id))}${available(id) ? "" : " — unavailable"}</option>`,
    )
    .join(
      "",
    )}</select></label><label>Image model<select class="control" data-g="model" ${S.busy ? "disabled" : ""}>${models.map(([id, label]) => `<option value="${id}" ${id === g.model ? "selected" : ""}>${E(label)}</option>`).join("")}</select></label></div>`;
}
function templateSelector() {
  const selected = S.templates.find(t => t.id === S.p.templateId);
  return `<details class="template-picker" ${selected ? '' : 'open'}><summary><span>${selected && img(selected) ? `<img src="${img(selected)}" alt="">` : '<span class="template-placeholder">✦</span>'}</span><span><small>CURRENT REFERENCE</small><b>${E(selected?.name || 'Choose a reference style')}</b><em>${selected ? 'Click to browse other styles' : 'Pick a style to continue'}</em></span><strong aria-hidden="true">Browse styles ↓</strong></summary><div class="styles">${S.templates.map((t) => `<button class="${S.p.templateId === t.id ? "sel" : ""}" data-a="style" data-v="${t.id}" aria-pressed="${S.p.templateId === t.id}" ${S.busy ? "disabled" : ""}>${img(t) ? `<img src="${img(t)}" alt="">` : "✦"}<b>${E(t.name)}</b></button>`).join("") || '<div class="empty">No compatible templates are installed for this client.</div>'}</div></details>`;
}
function languageControl() {
  const pack = pk(S.client.businessPackId);
  const selected =
    S.p.language || S.p.contextSnapshot?.language || pack.defaultLanguage || "english";
  const custom =
    S.customLanguage ||
    !(pack.languages || []).some((language) => language.id === selected);
  return `<label>Language combination<select class="control" data-language-preset ${S.busy ? "disabled" : ""}>${(pack.languages || []).map((language) => `<option value="${E(language.id)}" ${!custom && language.id === selected ? "selected" : ""}>${E(language.label)}</option>`).join("")}<option value="custom" ${custom ? "selected" : ""}>Custom language or combination…</option></select></label>${custom ? `<label>Custom language instructions<input class="control" data-z="language" value="${E(S.p.language || "")}" placeholder="e.g. Hindi + English, Tamil, or Arabic + Malayalam" ${S.busy ? "disabled" : ""}></label>` : ""}<p class="muted">Headlines, supporting copy and captions will follow this language choice.</p>`;
}
function brief() {
  return `<section class="card form"><span>STEP 1 OF 5</span><h2>Shape the message</h2><label>Topic</label><textarea class="control" data-z="topic" ${S.busy ? "disabled" : ""}>${E(S.p.topic)}</textarea><label>Facts and requirements <small>Optional</small></label><textarea class="control" data-z="notes" ${S.busy ? "disabled" : ""}>${E(S.p.notes || "")}</textarea><div class="suggest">${(
    pk(S.client.businessPackId).topics || []
  )
    .slice(0, 5)
    .map(
      (x) =>
        `<button data-a="topic" data-v="${E(x[2])}" ${S.busy ? "disabled" : ""}>${E(x[1])}</button>`,
    )
    .join(
      "",
    )}</div><h2>Choose the language</h2>${languageControl()}<h2>Choose the output format</h2>${formatControl()}<h2>Choose a reference template</h2><p class="muted">The selected template guides copy length, hierarchy and visual concepts for the five-slide draft.</p>${templateSelector()}<h2>Choose the writing model</h2><p class="muted">This provider will write one coherent five-slide draft using the selected reference and language combination.</p>${writingControls()}${S.busy === "draft" ? `<div class="generation-progress" role="status"><div class="spinner"></div><div><b>Creating your five-slide draft…</b><span>Reviewing the brief, language, reference template and story before preparing slide copy.</span></div><i></i></div>` : ""}<button class="btn" data-a="starter" ${S.busy ? "disabled" : ""}>Use editable starter</button><button class="btn primary right" data-a="draft" ${S.busy || !S.p.topic.trim() || !S.p.templateId || !String(S.p.language || "").trim() ? "disabled" : ""}>${S.busy === "draft" ? "Generating draft…" : "Generate draft →"}</button></section>`;
}
function copy() {
  let s = sp();
  return `<section class="card form"><div class="slides">${S.p.slides.map((x, i) => `<button class="${S.i === i ? "on" : ""}" data-a="slide" data-v="${i}">${i + 1}<small>${x.approved ? "✓" : "Review"}</small></button>`).join("")}</div><h2>Slide ${S.i + 1}: ${E(s.role)}</h2><label>Headline<textarea class="control" data-s="heading">${E(s.heading)}</textarea></label><label>Supporting copy<textarea class="control" data-s="body">${E(s.body)}</textarea></label><label>Visual direction<textarea class="control" data-s="visualPrompt">${E(s.visualPrompt)}</textarea></label><button class="btn" data-a="revise">Rewrite with AI</button><button class="btn primary right" data-a="approve">${s.approved ? "Reopen approval" : "Approve & continue →"}</button><p class="muted">${ap()}/5 approved. ${ap() === 5 ? "Choose an image model when ready." : "Editing an approved slide reopens its review."}</p></section>`;
}
function design() {
  let s = sp();
  const progress = S.imageProgress;
  const progressPercent = progress
    ? Math.round((progress.completed / Math.max(1, progress.total)) * 100)
    : 0;
  return `<section class="card form"><span>STEP 3 OF 5</span><h2>Choose the image model</h2><p class="muted">Select the provider and model used to turn the approved copy into artwork.</p>${imageControls()}${formatControl()}<h2>Generate artwork</h2><p class="muted">Using <b>${E(S.templates.find((t) => t.id === S.p.templateId)?.name || "the selected reference")}</b>. ${ap() === 5 ? "Your copy is approved. Generate all five slides, then inspect each one." : `Approve ${5 - ap()} more slides first.`}</p>${progress ? `<div class="generation-progress" role="status" aria-live="polite"><div class="spinner"></div><div><b>${progress.total === 1 ? `Creating slide ${S.i + 1}…` : `Creating carousel artwork… ${progress.completed}/${progress.total}`}</b><span>${progress.active ? `${progress.active} image${progress.active === 1 ? "" : "s"} generating now. ` : ""}${progress.failed ? `${progress.failed} failed. ` : ""}You can leave this screen open while generation finishes.</span></div><i class="determinate" style="width:${progressPercent}%"></i></div>` : ""}<button class="btn" data-a="one" ${S.busy || !s.approved || !S.p.templateId ? "disabled" : ""}>${S.busy === "image" ? "Generating slide…" : s.artworkAssetId ? "Regenerate selected" : "Generate selected"}</button>${im() > 0 ? `<button class="btn" data-a="regenerate-all" ${S.busy || ap() !== 5 || !S.p.templateId ? "disabled" : ""}>Regenerate all 5 slides</button>` : ""}${im() === 5 ? `<button class="btn primary right" data-a="go-review" ${S.busy ? "disabled" : ""}>Go to review →</button>` : `<button class="btn primary right" data-a="all" ${S.busy || ap() !== 5 || !S.p.templateId ? "disabled" : ""}>${S.busy === "images" ? `Generating ${progress?.completed || 0}/${progress?.total || 5}…` : "Generate all 5 slides →"}</button>`}</section>`;
}
const art = (s) =>
  s.artworkAssetId
    ? `<img class="art" src="/api/clients/${S.client.id}/assets/${s.artworkAssetId}">`
    : `<div class="art empty">Generate this slide first.</div>`;
function review() {
  let s = sp();
  const allReady = im() === 5;
  return `<section class="card form"><div class="review-toolbar"><p><b>${rv()}/5 reviewed</b><span>${allReady ? "Approve the complete carousel at once, or inspect each slide." : "Generate every slide before approving the full carousel."}</span></p><button class="btn" data-a="approve-all" ${S.busy || !allReady || rv() === 5 ? "disabled" : ""}>Approve all</button></div><div class="thumbs">${S.p.slides.map((x, i) => `<button class="${S.i === i ? "on" : ""}" data-a="slide" data-v="${i}">${x.artworkAssetId ? `<img src="/api/clients/${S.client.id}/assets/${x.artworkAssetId}">` : i + 1}<small>${x.artworkReviewed ? "✓ Reviewed" : "Check"}</small></button>`).join("")}</div><div class="review">${art(s)}<div><span>SLIDE ${S.i + 1} REVIEW</span><h2>Check the final details.</h2><b>${E(s.heading)}</b><p>${E(s.body)}</p>${["Text matches approved copy", "Brand details are correct", "Image is relevant and polished", "Nothing is cut off"].map((x) => `<label class="check"><input type="checkbox" ${s.artworkReviewed ? "checked" : ""}>${x}</label>`).join("")}<div class="regenerate"><label>What should change? <small>Optional</small><textarea class="control" data-regeneration-note placeholder="e.g. Make the image brighter and give the headline more space" ${S.busy ? "disabled" : ""}>${E(S.regenerationNotes[S.i] || "")}</textarea></label></div><div class="review-actions"><button class="btn primary" data-a="review" ${S.busy || !s.artworkAssetId ? "disabled" : ""}>${s.artworkReviewed ? "Reopen review" : "Looks good →"}</button><button class="btn" data-a="regenerate" ${S.busy || !s.artworkAssetId ? "disabled" : ""}>${S.busy === "image" ? "Regenerating…" : "Regenerate"}</button></div></div></div></section>`;
}
function exportPage() {
  let ok = ap() === 5 && im() === 5 && rv() === 5;
  const progress = S.exportProgress;
  const progressView = progress ? `<div class="export-progress" role="status" aria-live="polite"><b>${E(progress.message)}</b>${progress.state === "working" ? `<div class="export-track"><i style="width:${Math.round(progress.done / 7 * 100)}%"></i></div><small>${progress.done}/7 steps complete</small>` : ""}</div>` : "";
  const resultView = S.exportResult ? `<p class="export-result">ZIP prepared. Check your browser’s Downloads list to confirm it was saved.</p>` : "";
  return `<section class="card export"><span>FINAL STEP</span><h1>${ok ? "Ready to publish." : "Almost there."}</h1><p>${ap()}/5 copy approved · ${im()}/5 images ready · ${rv()}/5 reviewed</p><div class="export-captions"><h2>Social captions</h2><p class="muted">Edit these before exporting. Each caption is included as a separate text file in the ZIP.</p><label>Instagram caption<textarea class="control" data-z="instagram" ${S.busy ? "disabled" : ""}>${E(S.p.instagram || "")}</textarea></label><label>Facebook caption<textarea class="control" data-z="facebook" ${S.busy ? "disabled" : ""}>${E(S.p.facebook ?? S.p.instagram ?? "")}</textarea></label></div><button class="btn primary big" data-a="export" ${ok && !S.busy ? "" : "disabled"}>${S.busy === "export" ? "Preparing carousel ZIP…" : "Download carousel ZIP ↓"}</button><button class="btn" data-a="export-portable" ${S.busy ? 'disabled' : ''}>Download editable project backup</button>${progressView}${resultView}</section>`;
}
async function exportPortable() {
  if (S.busy) return;
  S.busy = 'backup'; render();
  try {
    await save();
    const readImage = async (url) => {
      const response = await fetch(url);
      if (!response.ok) throw Error('Could not collect a project image.');
      const blob = await response.blob();
      return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(Error('Could not read project image.')); reader.readAsDataURL(blob); });
    };
    const embeddedAssets = { artworks: {} };
    for (const slide of S.p.slides) if (slide.artworkAssetId) embeddedAssets.artworks[slide.id] = await readImage(`/api/clients/${S.client.id}/assets/${slide.artworkAssetId}`);
    const template = S.templates.find(item => item.id === S.p.templateId);
    if (template) {
      const refs = template.mode === 'slides' ? template.data.slides : [template.data];
      embeddedAssets.template = { name: template.name, mode: template.mode, crops: template.data.crops, images: await Promise.all(refs.map(ref => readImage(ref.staticPath || `/api/clients/${S.client.id}/assets/${ref.assetId}`))) };
    }
    if (S.p.contextSnapshot?.brand?.logoAssetId) embeddedAssets.logo = await readImage(`/api/clients/${S.client.id}/assets/${S.p.contextSnapshot.brand.logoAssetId}`);
    downloadBlob(new Blob([JSON.stringify({ project: S.p, embeddedAssets })], { type: 'application/json' }), `carousel-project-${S.p.id}.json`);
    toast('Editable project backup downloaded.');
  } finally { S.busy = ''; render(); }
}
async function exportCarousel() {
  if (S.busy) return;
  clearTimeout(timer);
  S.p.facebook ??= S.p.instagram || "";
  S.busy = "export";
  S.exportResult = null;
  const progress = (done, message, state = "working") => { S.exportProgress = { done, message, state }; render(); };
  try {
    await save();
    progress(0, "Collecting slide 1 of 5…");
    const files = [];
    for (let i = 0; i < 5; i++) {
      const response = await fetch(`/api/clients/${S.client.id}/assets/${S.p.slides[i].artworkAssetId}`);
      if (!response.ok) throw Error(`Could not load slide ${i + 1} (${response.status}).`);
      const artwork = await finalArtworkBlob(await response.blob(), S.p.generation?.aspectRatio);
      files.push({ name: `slide-${i + 1}.png`, data: new Uint8Array(await artwork.arrayBuffer()) });
      progress(i + 1, i < 4 ? `Collecting slide ${i + 2} of 5…` : "Creating ZIP…");
    }
    const encoder = new TextEncoder();
    files.push({ name: "instagram-caption.txt", data: encoder.encode(S.p.instagram || "") });
    files.push({ name: "facebook-caption.txt", data: encoder.encode(S.p.facebook ?? S.p.instagram ?? "") });
    files.push({ name: "project.json", data: encoder.encode(JSON.stringify(S.p)) });
    const zip = await makeZip(files);
    progress(6, "Starting browser download…");
    downloadBlob(zip, "carousel.zip");
    S.exportResult = { filename: "carousel.zip" };
    progress(7, "Browser download started.", "done");
  } catch (error) {
    progress(S.exportProgress?.done || 0, error.message, "failed");
    throw error;
  } finally {
    S.busy = "";
    render();
  }
}
async function save() {
  let p = S.p,
    r = await api(
      `/api/clients/${S.client.id}/projects/${p.id}`,
      {
        expectedRevision: p.revision,
        topic: p.topic,
        notes: p.notes,
        language: p.language,
        stage: p.stage,
        templateId: p.templateId,
        slides: p.slides,
        instagram: p.instagram,
        facebook: p.facebook,
        generation: p.generation,
      },
      "PATCH",
    );
  S.p = r.project;
}
let timer;
const later = () => {
  clearTimeout(timer);
  timer = setTimeout(() => save().catch((e) => toast(e.message)), 500);
};
function beginGeneration() {
  const base = `/api/clients/${S.client.id}/projects/${S.p.id}`;
  const run = createGenerationRun(id => api(`${base}/jobs/${id}`, undefined, 'DELETE'));
  S.generationRun = run;
  return run;
}
async function trackGeneration(run, id, refreshProject = true) {
  // A failed stop request must not discard the ID or stop monitoring the job.
  try { await run.track(id); } catch (error) { toast(error.message); }
  try { await waitForJob(id, refreshProject); }
  finally { run.finish(id); }
}
async function job(stage, extra = {}) {
  if (S.busy) return;
  const run = beginGeneration();
  S.busy = stage;
  if (stage === "image")
    S.imageProgress = { completed: 0, total: 1, active: 1, failed: 0 };
  render();
  try {
    clearTimeout(timer);
    await save();
    if (run.stopped) return;
    let g = S.p.generation || {},
      r = await api(`/api/clients/${S.client.id}/projects/${S.p.id}/jobs`, {
        stage,
        provider: stage === "image" ? g.provider : g.writingProvider,
        model: stage === "image" ? g.model : g.writingModel,
        ...extra,
        idempotencyKey: crypto.randomUUID(),
      });
    if (r.job) await trackGeneration(run, r.job.id);
    else if (r.project) S.p = r.project;
    S.me = await api('/api/me');
    if (stage === "image") S.imageProgress.completed = 1;
    toast(stage === "image" ? "Slide artwork is ready to review." : "Ready for review.");
  } catch (e) {
    if (run.stopped) {
      S.p = (await api(`/api/clients/${S.client.id}/projects/${S.p.id}`)).project;
      S.me = await api('/api/me');
    }
    toast(e.message);
  } finally {
    S.busy = "";
    S.generationRun = null;
    S.imageProgress = null;
    render();
  }
}
async function waitForJob(id, refreshProject = true) {
  const base = `/api/clients/${S.client.id}/projects/${S.p.id}`;
  for (let attempt = 0; attempt < 360; attempt++) {
    const { job: current } = await api(`${base}/jobs/${id}`);
    if (current.status === 'succeeded') {
      if (refreshProject) S.p = (await api(base)).project;
      return;
    }
    if (['failed', 'cancelled', 'expired'].includes(current.status)) throw Error(current.error || 'Generation failed. Credits were returned.');
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  throw Error('Generation is still running. Reopen this project to see the result.');
}
async function act(n) {
  try {
    let a = n.dataset.a;
    if (['maker','variant','variant-loading','style-removing'].includes(S.busy)) return;
    if (a === 'maker-toggle') { if(S.me?.companionEnabled) S.companionDevices = (await api('/api/companion/devices')).devices; normalizeStyleProvider(); S.makerOpen = !S.makerOpen; n.parentElement.open = S.makerOpen; return render(); }
    if (a === 'stop-generation' && S.generationRun) {
      const stopping = S.generationRun.stop();
      render();
      try { await stopping; toast('Stop requested. Finished artwork is kept.'); }
      finally { render(); }
      return;
    }
    if (S.generationRun && !['slide'].includes(a)) return;
    if (a === 'logout') { await api('/api/auth/logout', {}, 'POST'); location.assign('/login'); return; }
    if (a === 'allocate') {
      const accountId = n.dataset.id;
      const planId = document.getElementById(`plan-${accountId}`).value;
      const period = document.getElementById('allocation-month').value;
      await api(`/api/admin/accounts/${accountId}/allocate`, { planId, period });
      await load(); render(); toast('Plan and monthly credits assigned.'); return;
    }
    if (a === "nav") {
      S.view = n.dataset.v;
      S.client = S.p = null;
      await load();
      return render();
    }
    if (a === "client") return client(n.dataset.id);
    if (a === "open") {
      await client(n.dataset.c);
      return project(n.dataset.id);
    }
    if (a === "form") {
      S.form = !S.form;
      return render();
    }
    if (a === "add") {
      let name = document.querySelector("#name").value;
      if (!name) throw Error("Add a business name first.");
      let r = await api("/api/clients", {
        name,
        businessPackId: document.querySelector("#pack").value,
      });
      await load();
      return client(r.client.id);
    }
    if (a === "goal") {
      S.create.goal = n.dataset.v;
      return render();
    }
    if (a === "new" || a === "create-client") {
      if (a === "create-client") {
        S.create.clientId = S.client.id;
        S.view = "create";
        return render();
      }
      await client(S.create.clientId);
      let r = await api(`/api/clients/${S.client.id}/projects`, {});
      S.p = r.project;
      S.p.topic = S.create.topic;
      S.p.notes = `Goal: ${S.create.goal}\n${S.create.facts}`;
      await save();
      S.view = "studio";
      if (S.me?.companionEnabled) S.companionDevices = (await api('/api/companion/devices')).devices;
      return render();
    }
    if (a === "tab") {
      S.tab = n.dataset.v;
      return render();
    }
    if (a === 'style-remove') { S.removeStyleId = n.dataset.id; return render(); }
    if (a === 'style-remove-cancel') { S.removeStyleId = ''; return render(); }
    if (a === 'style-remove-confirm') {
      S.busy = 'style-removing'; render();
      try { await api(`/api/clients/${S.client.id}/templates/${encodeURIComponent(n.dataset.id)}`, undefined, 'DELETE'); }
      finally { S.busy = ''; }
      if (S.variant?.source.id === n.dataset.id) S.variant = null;
      S.removeStyleId = ''; S.templates = (await api(`/api/clients/${S.client.id}/templates`)).templates;
      toast('Style removed.'); return render();
    }
    if (a === 'style-variant') return await openStyleVariant(n.dataset.id);
    if (a === 'variant-close') { S.variant = null; return render(); }
    if (a === 'variant-undo') { S.variant.strokes.pop(); return render(); }
    if (a === 'variant-clear') { S.variant.strokes = []; return render(); }
    if (a === 'variant-generate') return await generateStyleVariant();
    if (a === 'maker-design') { S.maker.designId = n.dataset.v; return render(); }
    if (a === 'maker-generate' || a === 'maker-all') return generateStyles(a === 'maker-all' ? DESIGN_SYSTEMS : DESIGN_SYSTEMS.filter(d => d.id === S.maker.designId));
    if (a === "confirm-design") {
      const images = (S.import.images || []).slice(0, 5);
      if (images.length !== 5)
        throw Error(
          "This package must contain exactly five slide images or a valid manifest.",
        );
      const r = await api(
        `/api/template-imports/${S.importId}`,
        {
          templates: [
            {
              id: "mapped-five-slide",
              name: "Imported five-slide style",
              mode: "slides",
              slides: images.map((image, i) => ({
                position: i + 1,
                image: image.name,
              })),
            },
          ],
        },
        "PATCH",
      );
      S.import = r.preview;
      S.import.unresolved = false;
      toast("Slide order confirmed. Review and install the package.");
      return render();
    }
    if (a === "install-design") {
      await api(`/api/template-imports/${S.importId}/install`, {}, "POST");
      S.templates = (
        await api(`/api/clients/${S.client.id}/templates`)
      ).templates;
      S.import = null;
      S.importId = "";
      toast("Design package installed for this client.");
      return render();
    }
    if (a === "save") {
      let b = { ...S.client.brand },
        p = { ...S.client.profile };
      document
        .querySelectorAll("[data-b]")
        .forEach((x) => (b[x.dataset.b] = x.value));
      document
        .querySelectorAll("[data-p]")
        .forEach((x) => (p[x.dataset.p] = x.value));
      S.client = (
        await api(
          `/api/clients/${S.client.id}`,
          {
            expectedRevision: S.client.revision,
            name: b.name || S.client.name,
            brand: b,
            profile: p,
          },
          "PATCH",
        )
      ).client;
      toast("Brand kit saved.");
      return render();
    }
    if (a === "use-logo-colors") {
      if (!S.logoColors) return;
      document.querySelector('[data-b="primary"]').value = S.logoColors.primary;
      document.querySelector('[data-b="accent"]').value = S.logoColors.accent;
      toast("Logo colours selected. Save the brand kit to keep them.");
      return;
    }
    if (a === "back") {
      S.view = "client";
      S.tab = "projects";
      return client(S.client.id);
    }
    if (a === "stage") {
      S.p.stage = +n.dataset.v;
      if (S.p.stage === 1 && S.me?.companionEnabled) S.companionDevices = (await api('/api/companion/devices')).devices;
      later();
      return render();
    }
    if (a === "go-review") {
      S.p.stage = 3;
      later();
      return render();
    }
    if (a === "topic") {
      S.p.topic = n.dataset.v;
      later();
      return render();
    }
    if (a === "starter") {
      S.p.slides = starterSlides(S.p.topic).map((x, i) => ({
        ...S.p.slides[i],
        ...x,
      }));
      S.p.stage = 1;
      later();
      return render();
    }
    if (a === "draft") return job("draft");
    if (a === "slide") {
      S.i = +n.dataset.v;
      return render();
    }
    if (a === "approve") {
      let s = sp();
      s.approved = !s.approved;
      if (!s.approved) {
        s.artworkAssetId = "";
        s.artworkReviewed = false;
      } else if (S.i < 4) S.i++;
      later();
      return render();
    }
    if (a === "revise")
      return job("revise", {
        slideIndex: S.i,
        correction: "Make this clearer and more engaging.",
      });
    if (a === "style") {
      S.p.templateId = n.dataset.v;
      S.p.slides.forEach((x) => {
        x.artworkAssetId = "";
        x.artworkReviewed = false;
      });
      later();
      return render();
    }
    if (a === "one") return job("image", { slideIndex: S.i });
    if (a === "all" || a === "regenerate-all") {
      if (S.busy || ap() !== 5 || !S.p.templateId) return;
      const regenerate = a === "regenerate-all";
      const run = beginGeneration();
      S.busy = "images";
      const ids = S.p.slides
        .map((x, i) => (regenerate || !x.artworkAssetId ? i : null))
        .filter((x) => x !== null);
      S.imageProgress = {
        completed: 0,
        total: ids.length,
        active: 0,
        failed: 0,
      };
      render();
      try {
        clearTimeout(timer);
        await save();
        const g = S.p.generation;
        const batch = await runConcurrent(
          ids,
          Math.min(5, ids.length),
          async (i) => {
            const created = await api(`/api/clients/${S.client.id}/projects/${S.p.id}/jobs`, {
              stage: "image",
              provider: g.provider,
              model: g.model,
              slideIndex: i,
              idempotencyKey: crypto.randomUUID(),
            });
            await trackGeneration(run, created.job.id, false);
          },
          {
            shouldContinue: () => !run.stopped,
            onStart: ({ active }) => {
              S.imageProgress.active = active;
              render();
            },
            onComplete: ({ active, completed, result }) => {
              S.imageProgress.active = active;
              S.imageProgress.completed = completed;
              if (result.status === "rejected") S.imageProgress.failed++;
              render();
            },
          },
        );
        S.p = (
          await api(`/api/clients/${S.client.id}/projects/${S.p.id}`)
        ).project;
        S.me = await api('/api/me');
        const failed = batch.results.filter(
          (result) => result.status === "rejected",
        ).length;
        toast(
          run.stopped ? 'Generation stopped. Finished artwork is kept; cancelled jobs use no app credits.' : failed
            ? regenerate
              ? `${ids.length - failed} slides regenerated; ${failed} failed. Previous artwork was kept for failed slides. Retry slides ${batch.results.flatMap((result, index) => result.status === "rejected" ? [ids[index] + 1] : []).join(", ")}.`
              : `${ids.length - failed} image${ids.length - failed === 1 ? "" : "s"} ready; ${failed} failed. Retry to generate the missing slides.`
            : "All artwork is ready to review.",
        );
      } finally {
        S.busy = "";
        S.generationRun = null;
        S.imageProgress = null;
      }
      return render();
    }
    if (a === "review") {
      let s = sp();
      s.artworkReviewed = !s.artworkReviewed;
      if (s.artworkReviewed && S.i < 4) S.i++;
      later();
      return render();
    }
    if (a === "approve-all") {
      S.p.slides.forEach((slide) => {
        if (slide.artworkAssetId) slide.artworkReviewed = true;
      });
      later();
      toast("All five slides are approved.");
      return render();
    }
    if (a === "regenerate") {
      const slideIndex = S.i;
      const correction = String(S.regenerationNotes[slideIndex] || "").trim();
      await job("image", { slideIndex, correction });
      delete S.regenerationNotes[slideIndex];
      return render();
    }

    if (a === 'pair-code') { S.pairing=await api('/api/companion/devices/pairing',{}); return render(); }
    if (a === 'revoke-device') { await api(`/api/companion/devices/${n.dataset.id}`,undefined,'DELETE'); S.companionDevices=(await api('/api/companion/devices')).devices; return render(); }
    if (a === 'toggle-companion') { const enabled=n.dataset.enabled!=='1'; await api(`/api/admin/accounts/${n.dataset.id}/companion`,{enabled},'PATCH'); S.adminAccounts=(await api('/api/admin/accounts')).accounts; S.me=await api('/api/me'); S.status=await api('/api/status'); return render(); }
    if (a === "export") {
      return await exportCarousel();
    }
    if (a === 'export-portable') return await exportPortable();
  } catch (e) {
    toast(e.message);
    if (S.busy === '') render();
  }
}
root.onclick = (e) => {
  let n = e.target.closest("[data-a]");
  if (n) {
    e.preventDefault();
    act(n);
  }
};
root.oninput = (e) => {
  if (e.target.dataset.variant && S.variant) {
    S.variant[e.target.dataset.variant] = e.target.value;
    return;
  }
  let x = e.target;
  if (x.dataset.maker && x.dataset.maker !== 'provider') S.maker[x.dataset.maker] = x.value;
  if (x.dataset.regenerationNote !== undefined) {
    S.regenerationNotes[S.i] = x.value;
    return;
  }
  if (x.dataset.x) S.create[x.dataset.x] = x.value;
  if (x.dataset.z) {
    S.p[x.dataset.z] = x.value;
    later();
    if (x.dataset.z === "language") {
      const draft = document.querySelector('[data-a="draft"]');
      if (draft)
        draft.disabled =
          Boolean(S.busy) ||
          !S.p.topic.trim() ||
          !S.p.templateId ||
          !String(S.p.language || "").trim();
    }
  }
  if (x.dataset.s) {
    let s = sp();
    s[x.dataset.s] = x.value;
    s.approved = false;
    s.artworkAssetId = "";
    s.artworkReviewed = false;
    later();
  }
};
root.onchange = async (e) => {
  const x = e.target;
  if (x.dataset.variant && S.variant) {
    S.variant[x.dataset.variant] = x.value;
  }
  try {
    if (x.dataset.maker === 'provider') {
      S.maker.provider = x.value;
      if(S.me?.companionEnabled) S.companionDevices = (await api('/api/companion/devices')).devices;
      S.maker.model = styleModels(x.value,S.companionDevices)[0]?.[0] || '';
      return render();
    }
    if (['maker-logo', 'maker-mood'].includes(x.dataset.file) && x.files?.[0]) {
      const file = x.files[0];
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 12_000_000) throw Error('Choose a PNG, JPEG or WebP image under 12 MB.');
      const key = x.dataset.file === 'maker-logo' ? 'logo' : 'mood';
      S.maker[`${key}Image`] = await fileDataUrl(file);
      S.maker[`${key}Name`] = file.name;
      if (key === 'logo') {
        const colors = await analyzeLogoColors(S.maker.logoImage);
        S.maker.primary = colors.primary; S.maker.accent = colors.accent;
      }
      return render();
    }
    if (x.dataset.languagePreset !== undefined) {
      if (x.value === "custom") {
        S.customLanguage = true;
        S.p.language = "";
        return render();
      }
      S.customLanguage = false;
      S.p.language = x.value;
      later();
      return render();
    }
    if (x.dataset.g) {
      const g = S.p.generation || (S.p.generation = {});
      if (x.dataset.g === "aspectRatio" && imageFormat(g.aspectRatio).ratio !== x.value) {
        S.p.slides = S.p.slides.map(slide => ({ ...slide, artworkAssetId: '', artworkReviewed: false, artworkReviewedAt: '' }));
      }
      g[x.dataset.g] = x.value;
      if (x.dataset.g === "writingProvider")
        g.writingModel = ["codex","antigravity"].includes(x.value) ? "" : WRITING_MODELS[x.value]?.[0]?.[0] || "";
      if (x.dataset.g === "writingProvider" && ["codex","antigravity"].includes(x.value) && S.me?.companionEnabled)
        S.companionDevices = (await api('/api/companion/devices')).devices;
      if (x.dataset.g === "provider" && ["codex","antigravity"].includes(x.value) && S.me?.companionEnabled)
        S.companionDevices = (await api('/api/companion/devices')).devices;
      if (x.dataset.g === "provider")
        g.model = ["codex","antigravity"].includes(x.value) ? (S.companionDevices.find(d=>d.online && d.capabilities?.[x.value]?.ready)?.capabilities[x.value].imageModels?.[0]?.id || '') : IMAGE_MODELS[x.value]?.[0]?.[0] || "";
      later();
      render();
    }
    if (x.dataset.file === "design-package" && x.files?.[0]) {
      const file = x.files[0];
      if (!file.name.toLowerCase().endsWith(".zip"))
        throw Error("Choose a ZIP design package.");
      S.import = {
        kind: "Uploading package",
        message: "Validating images, structure and compatibility…",
      };
      render();
      const r = await api(
        `/api/template-imports?clientId=${encodeURIComponent(S.client.id)}&businessPackId=${encodeURIComponent(S.client.businessPackId)}&scope=client`,
        await file.arrayBuffer(),
        "POST",
        true,
      );
      S.importId = r.id;
      S.import = r.preview;
      toast("Design package validated.");
      render();
    }
    if (x.dataset.file === 'style-image' && x.files?.[0]) {
      const file = x.files[0];
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 20_000_000) throw Error('Choose a PNG, JPEG or WebP image under 20 MB.');
      await api(`/api/clients/${S.client.id}/templates`, { name: file.name.replace(/\.[^.]+$/, ''), image: await fileDataUrl(file) });
      S.templates = (await api(`/api/clients/${S.client.id}/templates`)).templates;
      toast('Reference style added.'); return render();
    }
    if (x.dataset.file === 'project-json' && x.files?.[0]) {
      const file = x.files[0];
      if (file.size > 30_000_000) throw Error('Project JSON is too large.');
      const value = JSON.parse(await file.text());
      const result = await api(`/api/clients/${S.client.id}/import-project`, value.project ? value : { project: value });
      S.projects = (await api(`/api/clients/${S.client.id}/projects`)).projects;
      toast('Project imported.'); return project(result.project.id);
    }
    if (x.dataset.file === "logo" && x.files?.[0]) {
      const file = x.files[0];
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type))
        throw Error("Choose a PNG, JPEG or WebP logo.");
      if (file.size > 20_000_000) throw Error("Logo must be 20 MB or smaller.");
      const image = await fileDataUrl(file);
      const [upload, colors] = await Promise.all([
        api(`/api/clients/${S.client.id}/assets`, {
          image,
          kind: "client-logo",
          name: file.name,
        }),
        analyzeLogoColors(image),
      ]);
      S.client = (
        await api(
          `/api/clients/${S.client.id}`,
          {
            expectedRevision: S.client.revision,
            brand: { ...S.client.brand, logoAssetId: upload.asset.id },
          },
          "PATCH",
        )
      ).client;
      S.logoColors = colors;
      toast("Logo uploaded. Review the detected colours below.");
      render();
    }
  } catch (error) {
    S.import = null;
    toast(error.message);
    render();
  }
};
try { await load(); render(); } catch (error) { root.textContent = error.message; }
