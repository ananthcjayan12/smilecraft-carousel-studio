import { starterSlides } from "./data.js";
import { IMAGE_MODELS, WRITING_MODELS } from "./provider-models.js";
import { runConcurrent } from "./batch-runner.js";
import { makeZip, downloadBlob } from "./zip.js";
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
  imageProgress: null,
  customLanguage: false,
  tab: "overview",
  form: false,
  import: null,
  importId: "",
  regenerationNotes: {},
  create: { clientId: "", goal: "Educate", topic: "", facts: "" },
};
const api = async (u, d, m = d === undefined ? "GET" : "POST", raw = false) => {
  let o = { method: m, headers: {} };
  if (d !== undefined) {
    o.body = raw ? d : JSON.stringify(d);
    o.headers["Content-Type"] = raw ? "application/zip" : "application/json";
  }
  let r = await fetch(u, o),
    j = await r.json().catch(() => ({}));
  if (!r.ok) throw Error(j.error || "Something went wrong.");
  return j;
};
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
  });
  render();
}
async function project(id) {
  S.p = (await api(`/api/clients/${S.client.id}/projects/${id}`)).project;
  S.p.language ||= S.p.contextSnapshot?.language || "english";
  S.customLanguage = !(pk(S.client.businessPackId).languages || []).some(
    (language) => language.id === S.p.language,
  );
  S.view = "studio";
  S.i = 0;
  render();
}
function nav() {
  return `<aside><button class="brand" data-a="nav" data-v="home">✦ <b>Carousel <em>Studio</em></b><small>Creative workspace</small></button>${[
    ["home", "⌂ Home"],
    ["create", "＋ Create carousel"],
    ["projects", "▧ Projects"],
    ["clients", "◉ Clients"],
    ["library", "✦ Library"],
    ["settings", "⚙ Settings"],
  ]
    .map(
      ([v, x]) =>
        `<button class="nav ${S.view === v || (v === "clients" && S.view === "client") ? "on" : ""}" data-a="nav" data-v="${v}">${x}</button>`,
    )
    .join(
      "",
    )}<p class="side-note"><b>Make ideas publish-ready.</b>Draft, review and export in one calm workflow.</p></aside>`;
}
function shell(x) {
  root.innerHTML = `<div class="shell">${nav()}<main><header><span>Carousel Studio${S.client ? " / " + E(S.client.name) : ""}</span><button class="btn primary" data-a="nav" data-v="create">＋ Create carousel</button></header>${x}</main></div>`;
}
const card = (p) =>
  `<button class="project" data-a="open" data-c="${E(p.clientId || S.client.id)}" data-id="${E(p.id)}"><i>${E(pk(p.businessPackId || S.client.businessPackId).icon || "✦")}</i><span><small>${E(p.clientName || S.client?.name || "Client")}</small><b>${E(p.topic || "Untitled carousel")}</b><em>${status(p)}</em></span><strong>Open →</strong></button>`;
function home() {
  return `<section class="hero"><span>YOUR CREATIVE WORKSPACE</span><h1>Create carousels<br>people want to swipe.</h1><p>Turn a client brief into polished, reviewed social content.</p><button class="btn primary big" data-a="nav" data-v="create">Create a carousel →</button></section><div class="metrics">${[
    ["Clients", S.dash.clients],
    ["Projects", S.dash.projects],
    ["Need review", S.dash.review],
    ["Generating", S.dash.running],
  ]
    .map((x) => `<div><b>${x[1] || 0}</b>${x[0]}</div>`)
    .join(
      "",
    )}</div><h2>Pick up where you left off</h2><p class="muted">Every project shows its next useful step.</p><div class="list">${S.all.slice(0, 6).map(card).join("") || '<div class="empty">Add a client, then create your first carousel.</div>'}</div>`;
}
function create() {
  return `<div class="intro"><span>NEW PROJECT</span><h1>Let’s make a carousel.</h1><p>Start with the message. We’ll guide the production steps.</p></div><section class="card form"><h2>1. Choose a client</h2><select class="control" data-x="clientId">${S.clients.map((c) => `<option value="${c.id}" ${c.id === S.create.clientId ? "selected" : ""}>${E(c.name)} · ${E(pk(c.businessPackId).name)}</option>`).join("")}</select><h2>2. What is this for?</h2><div class="goals">${["Educate", "Promote a service", "Answer a question", "Announce an offer", "Showcase work", "Custom"].map((x) => `<button class="goal ${S.create.goal === x ? "sel" : ""}" data-a="goal" data-v="${x}">${x}</button>`).join("")}</div><h2>3. Tell us the core idea</h2><textarea class="control" data-x="topic" placeholder="What should this carousel cover?">${E(S.create.topic)}</textarea><label>Important facts or things to avoid <small>Optional</small></label><textarea class="control" data-x="facts">${E(S.create.facts)}</textarea><p class="muted">Generation settings use your workspace defaults. They are kept out of the creative flow.</p><button class="btn primary big right" data-a="new">Create draft →</button></section>`;
}
function clients() {
  return `<div class="intro row"><div><span>CLIENTS</span><h1>Your client space.</h1><p>Brand, rules and styles stay separate for every business.</p></div><button class="btn primary" data-a="form">＋ Add client</button></div>${S.form ? `<section class="card add"><input id="name" class="control" placeholder="Business name"><select id="pack" class="control">${S.packs.map((x) => `<option value="${x.id}">${E(x.icon)} ${E(x.name)}</option>`).join("")}</select><button class="btn primary" data-a="add">Create client</button></section>` : ""}<div class="clients">${S.clients.map((c) => `<button data-a="client" data-id="${c.id}"><i>${E(pk(c.businessPackId).icon)}</i><b>${E(c.name)}</b><small>${E(pk(c.businessPackId).name)}</small>Open workspace →</button>`).join("") || '<div class="empty">No clients yet.</div>'}</div>`;
}
function clientPage() {
  return `<div class="intro row"><div><span>${E(pk(S.client.businessPackId).name)}</span><h1>${E(S.client.name)}</h1><p>Finish your brand kit for stronger, safer results.</p></div><button class="btn primary" data-a="create-client">Create carousel →</button></div><div class="tabs">${[
    ["overview", "Overview"],
    ["projects", "Projects"],
    ["brand", "Brand kit"],
    ["styles", "Styles"],
  ]
    .map(
      (x) =>
        `<button class="${S.tab === x[0] ? "on" : ""}" data-a="tab" data-v="${x[0]}">${x[1]}</button>`,
    )
    .join(
      "",
    )}</div>${S.tab === "overview" ? `<section class="card ready"><h2>Make this client ready to create</h2>${["Business details", "Contact details", "Logo and colours", "Choose a style"].map((x, i) => `<button data-a="tab" data-v="${i === 3 ? "styles" : "brand"}">○ ${x}<span>Add →</span></button>`).join("")}</section>` : S.tab === "projects" ? `<div class="list">${S.projects.map(card).join("") || '<div class="empty">No projects yet.</div>'}</div>` : S.tab === "brand" ? brand() : styles(S.templates, true)}`;
}
function brand() {
  let b = S.client.brand || {},
    p = S.client.profile || {},
    q = pk(S.client.businessPackId);
  return `<section class="card form"><h2>Brand kit</h2><p class="muted">These changes improve future projects. Existing work stays protected.</p><label>Business name</label><input class="control" data-b="name" value="${E(b.name || S.client.name)}"><div class="two"><label>Phone<input class="control" data-b="phone" value="${E(b.phone || "")}"></label><label>Location / service area<input class="control" data-b="location" value="${E(b.location || "")}"></label></div><div class="two"><label>Primary colour<input type="color" data-b="primary" value="${E(b.primary || "#073a42")}"></label><label>Accent colour<input type="color" data-b="accent" value="${E(b.accent || "#14ada9")}"></label></div>${(q.onboardingFields || []).map(([k, l, t]) => `<label>${E(l)}${t === "textarea" ? `<textarea class="control" data-p="${k}">${E(p[k] || "")}</textarea>` : `<input class="control" data-p="${k}" value="${E(p[k] || "")}">`}</label>`).join("")}<button class="btn primary right" data-a="save">Save brand kit</button></section>`;
}
const img = (t) => {
  let r = t.mode === "slides" ? t.data?.slides?.[0] : t.data;
  if (r?.staticPath) return r.staticPath;
  if (!r?.assetId) return "";
  return t.clientId === null
    ? `/api/template-assets/${r.assetId}`
    : `/api/clients/${S.client?.id}/assets/${r.assetId}`;
};
function styles(ts, upload = false) {
  return `<section class="card form"><div class="style-head"><div><h2>Visual styles</h2><p class="muted">Choose a style for consistent carousel artwork.</p></div>${upload ? `<label class="btn upload">＋ Upload design package<input type="file" data-file="design-package" accept=".zip,application/zip"></label>` : ""}</div>${S.import ? `<div class="import-status ${S.import.unresolved ? "warn" : ""}"><b>${E(S.import.kind || "Design package")} detected</b><span>${E(S.import.message || `${S.import.images?.length || 0} images validated.`)}</span>${S.import.unresolved ? `<small>Confirm the detected image order to map slides 1–5.</small><button class="btn primary" data-a="confirm-design">Use detected order</button>` : `<button class="btn primary" data-a="install-design">Install for ${E(S.client.name)}</button>`}</div>` : ""}<div class="styles">${ts.map((t) => `<div>${img(t) ? `<img src="${img(t)}">` : "✦"}<b>${E(t.name)}</b><small>${t.clientId === null ? "Shared" : "Private"} style</small></div>`).join("") || '<div class="empty">No styles installed yet. Upload a ZIP design package above.</div>'}</div></section>`;
}
function library() {
  return `<div class="intro"><span>LIBRARY</span><h1>Styles and creative references.</h1><p>Shared styles are available to compatible client types.</p></div>${styles(S.shared)}`;
}
function settings() {
  return `<div class="intro"><span>SETTINGS</span><h1>Workspace settings.</h1><p>Technical setup stays here, away from your creative work.</p></div><section class="card form"><h2>Generation providers</h2>${Object.entries(
    S.status.textProviders || {},
  )
    .map(
      ([k, v]) =>
        `<p class="provider">${E(v.label || k)} <b>${v.available ? "Ready" : "Not connected"}</b></p>`,
    )
    .join("")}</section>`;
}
function render() {
  let content =
    S.view === "home"
      ? home()
      : S.view === "create"
        ? create()
        : S.view === "projects"
          ? `<div class="intro"><span>PROJECTS</span><h1>All projects.</h1><p>Find the next action for every client.</p></div><div class="list">${S.all.map(card).join("") || '<div class="empty">No projects yet.</div>'}</div>`
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
}
function studio() {
  let p = S.p;
  return `<div class="studio-title"><button data-a="back">← Projects</button><h1>${E(p.topic || "New carousel")}</h1><p>${E(S.client.name)} · ${status(p)}</p></div><div class="steps">${["Brief", "Copy", "Style", "Review", "Export"].map((x, i) => `<button class="${p.stage === i ? "on" : ""}" data-a="stage" data-v="${i}">${i + 1}. ${x}</button>`).join("")}</div>${p.stage === 0 ? brief() : p.stage === 1 ? copy() : p.stage === 2 ? design() : p.stage === 3 ? review() : exportPage()}`;
}
function writingControls() {
  const g =
    S.p.generation ||
    (S.p.generation = {
      writingProvider: "codex",
      writingModel: "gpt-5.6-sol",
    });
  const models = WRITING_MODELS[g.writingProvider] || [];
  return `<div class="model-panel"><label>Writing provider<select class="control" data-g="writingProvider">${Object.keys(
    WRITING_MODELS,
  )
    .map(
      (id) =>
        `<option value="${id}" ${id === g.writingProvider ? "selected" : ""} ${S.status.textProviders?.[id]?.available ? "" : "disabled"}>${E(S.status.textProviders?.[id]?.label || id)}${S.status.textProviders?.[id]?.available ? "" : " — unavailable"}</option>`,
    )
    .join(
      "",
    )}</select></label><label>Model<select class="control" data-g="writingModel">${models.map(([id, label]) => `<option value="${id}" ${id === g.writingModel ? "selected" : ""}>${E(label)}</option>`).join("")}</select></label></div>`;
}
function imageControls() {
  const g =
    S.p.generation ||
    (S.p.generation = {
      provider: "openai",
      model: "gpt-image-2",
    });
  const models = IMAGE_MODELS[g.provider] || [];
  return `<div class="model-panel"><label>Image provider<select class="control" data-g="provider" ${S.busy ? "disabled" : ""}>${Object.keys(
    IMAGE_MODELS,
  )
    .map(
      (id) =>
        `<option value="${id}" ${id === g.provider ? "selected" : ""} ${S.status.imageProviders?.[id]?.available ? "" : "disabled"}>${E(S.status.imageProviders?.[id]?.label || id)}${S.status.imageProviders?.[id]?.available ? "" : " — unavailable"}</option>`,
    )
    .join(
      "",
    )}</select></label><label>Image model<select class="control" data-g="model" ${S.busy ? "disabled" : ""}>${models.map(([id, label]) => `<option value="${id}" ${id === g.model ? "selected" : ""}>${E(label)}</option>`).join("")}</select></label></div>`;
}
function templateSelector() {
  return `<div class="styles">${S.templates.map((t) => `<button class="${S.p.templateId === t.id ? "sel" : ""}" data-a="style" data-v="${t.id}" ${S.busy ? "disabled" : ""}>${img(t) ? `<img src="${img(t)}">` : "✦"}<b>${E(t.name)}</b></button>`).join("") || '<div class="empty">No compatible templates are installed for this client.</div>'}</div>`;
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
    )}</div><h2>Choose the language</h2>${languageControl()}<h2>Choose a reference template</h2><p class="muted">The selected template guides copy length, hierarchy and visual concepts for the five-slide draft.</p>${templateSelector()}<h2>Choose the writing model</h2><p class="muted">This provider will write one coherent five-slide draft using the selected reference and language combination.</p>${writingControls()}${S.busy === "draft" ? `<div class="generation-progress" role="status"><div class="spinner"></div><div><b>Creating your five-slide draft…</b><span>Reviewing the brief, language, reference template and story before preparing slide copy.</span></div><i></i></div>` : ""}<button class="btn" data-a="starter" ${S.busy ? "disabled" : ""}>Use editable starter</button><button class="btn primary right" data-a="draft" ${S.busy || !S.p.topic.trim() || !S.p.templateId || !String(S.p.language || "").trim() ? "disabled" : ""}>${S.busy === "draft" ? "Generating draft…" : "Generate draft →"}</button></section>`;
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
  return `<section class="card form"><span>STEP 3 OF 5</span><h2>Choose the image model</h2><p class="muted">Select the provider and model used to turn the approved copy into artwork.</p>${imageControls()}<h2>Generate artwork</h2><p class="muted">Using <b>${E(S.templates.find((t) => t.id === S.p.templateId)?.name || "the selected reference")}</b>. ${ap() === 5 ? "Your copy is approved. Generate all five slides, then inspect each one." : `Approve ${5 - ap()} more slides first.`}</p>${progress ? `<div class="generation-progress" role="status" aria-live="polite"><div class="spinner"></div><div><b>${progress.total === 1 ? `Creating slide ${S.i + 1}…` : `Creating carousel artwork… ${progress.completed}/${progress.total}`}</b><span>${progress.active ? `${progress.active} image${progress.active === 1 ? "" : "s"} generating now. ` : ""}${progress.failed ? `${progress.failed} failed. ` : ""}You can leave this screen open while generation finishes.</span></div><i class="determinate" style="width:${progressPercent}%"></i></div>` : ""}<button class="btn" data-a="one" ${S.busy || !s.approved || !S.p.templateId ? "disabled" : ""}>${S.busy === "image" ? "Generating slide…" : s.artworkAssetId ? "Regenerate selected" : "Generate selected"}</button>${im() === 5 ? `<button class="btn primary right" data-a="go-review" ${S.busy ? "disabled" : ""}>Go to review →</button>` : `<button class="btn primary right" data-a="all" ${S.busy || ap() !== 5 || !S.p.templateId ? "disabled" : ""}>${S.busy === "images" ? `Generating ${progress?.completed || 0}/${progress?.total || 5}…` : "Generate all 5 slides →"}</button>`}</section>`;
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
  return `<section class="card export"><span>FINAL STEP</span><h1>${ok ? "Ready to publish." : "Almost there."}</h1><p>${ap()}/5 copy approved · ${im()}/5 images ready · ${rv()}/5 reviewed</p><button class="btn primary big" data-a="export" ${ok ? "" : "disabled"}>Download carousel ZIP ↓</button></section>`;
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
async function job(stage, extra = {}) {
  S.busy = stage;
  if (stage === "image")
    S.imageProgress = { completed: 0, total: 1, active: 1, failed: 0 };
  render();
  try {
    await save();
    let g = S.p.generation || {},
      r = await api(`/api/clients/${S.client.id}/projects/${S.p.id}/jobs`, {
        stage,
        provider: stage === "image" ? g.provider : g.writingProvider,
        model: stage === "image" ? g.model : g.writingModel,
        ...extra,
        idempotencyKey: crypto.randomUUID(),
      });
    if (r.project) S.p = r.project;
    if (stage === "image") S.imageProgress.completed = 1;
    toast(stage === "image" ? "Slide artwork is ready to review." : "Ready for review.");
  } catch (e) {
    toast(e.message);
  } finally {
    S.busy = "";
    S.imageProgress = null;
    render();
  }
}
async function act(n) {
  try {
    let a = n.dataset.a;
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
      return render();
    }
    if (a === "tab") {
      S.tab = n.dataset.v;
      return render();
    }
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
    if (a === "back") {
      S.view = "client";
      S.tab = "projects";
      return client(S.client.id);
    }
    if (a === "stage") {
      S.p.stage = +n.dataset.v;
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
    if (a === "all") {
      S.busy = "images";
      const ids = S.p.slides
        .map((x, i) => (x.artworkAssetId ? null : i))
        .filter((x) => x !== null);
      S.imageProgress = {
        completed: 0,
        total: ids.length,
        active: 0,
        failed: 0,
      };
      render();
      try {
        await save();
        const g = S.p.generation;
        const batch = await runConcurrent(
          ids,
          3,
          (i) =>
            api(`/api/clients/${S.client.id}/projects/${S.p.id}/jobs`, {
              stage: "image",
              provider: g.provider,
              model: g.model,
              slideIndex: i,
              idempotencyKey: crypto.randomUUID(),
            }),
          {
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
        const failed = batch.results.filter(
          (result) => result.status === "rejected",
        ).length;
        toast(
          failed
            ? `${ids.length - failed} image${ids.length - failed === 1 ? "" : "s"} ready; ${failed} failed. Retry to generate the missing slides.`
            : "All artwork is ready to review.",
        );
      } finally {
        S.busy = "";
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
    if (a === "export") {
      let f = [];
      for (let i = 0; i < 5; i++) {
        let r = await fetch(
          `/api/clients/${S.client.id}/assets/${S.p.slides[i].artworkAssetId}`,
        );
        f.push({
          name: `slide-${i + 1}.png`,
          data: new Uint8Array(await r.arrayBuffer()),
        });
      }
      f.push({
        name: "project.json",
        data: new TextEncoder().encode(JSON.stringify(S.p)),
      });
      downloadBlob(
        new Blob([makeZip(f)], { type: "application/zip" }),
        "carousel.zip",
      );
      toast("Your carousel ZIP is downloading.");
    }
  } catch (e) {
    toast(e.message);
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
  let x = e.target;
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
  try {
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
      g[x.dataset.g] = x.value;
      if (x.dataset.g === "writingProvider")
        g.writingModel = WRITING_MODELS[x.value]?.[0]?.[0] || "";
      if (x.dataset.g === "provider")
        g.model = IMAGE_MODELS[x.value]?.[0]?.[0] || "";
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
  } catch (error) {
    S.import = null;
    toast(error.message);
    render();
  }
};
await load();
render();
