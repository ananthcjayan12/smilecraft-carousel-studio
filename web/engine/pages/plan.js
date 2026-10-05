import { api } from "../api.js";
import { esc, attr, title, badge, status, thumb, retryJobs, itemLabel, ready, working, field, select } from "../ui.js";
import { go, toast, keepPolling } from "../app.js";

let current = null,
  plans = [];

export function contentCard(item, state, { controls = true } = {}) {
  const pillar = state.catalog.pillars[item.brief?.pillar] || "Custom";
  const slot = item.slot?.time ? `<small class="slot">${esc(item.slot.time)} IST · ${esc(item.slot.label)}</small>` : "";
  const art = item.format === "post" ? "post" : ["story", "reel"].includes(item.format) ? "story" : "carousel";
  return `<article class="content-card ${item.status === "skipped" ? "is-skipped" : ""}"><a class="content-art ${art}" href="#/review?id=${attr(item.id)}" aria-label="Review ${attr(item.topic)}">${thumb(item)}<span class="art-type">${esc(itemLabel(item, state.catalog))}</span></a><div class="content-info"><div class="card-status">${status(item)}${item.keyword ? badge(`Comment ${item.keyword}`, "violet") : ""}</div>${slot}<h3>${esc(item.topic)}</h3><p class="muted small-copy">${item.brief?.ideaNumber ? `Idea #${item.brief.ideaNumber} · ` : ""}${esc(pillar)}${item.region !== "all" ? ` · ${esc(item.region)} only` : ""}</p><a class="btn ${ready(item) ? "primary" : ""} small full" href="#/review?id=${attr(item.id)}">${ready(item) ? "Review artwork →" : item.frames.length ? "Review copy →" : "Open →"}</a>${
    controls && item.plan_id
      ? `<button class="btn small full spaced" data-action="skip" data-id="${attr(item.id)}" ${working(item) ? "disabled" : ""}>${item.status === "skipped" ? "Include again" : "Skip this piece"}</button>`
      : ""
  }</div></article>`;
}
function planForm(state, cancellable = false) {
  const counts = {};
  for (const slot of state.catalog.slots) counts[slot.format] = (counts[slot.format] || 0) + 1;
  const readyStyles = state.styles.filter((s) => s.status === "ready" && s.asset_id);
  return `<form class="panel plan-form" data-form="plan"><div class="section-head"><div><p class="eyebrow">NEW PLAN</p><h2>Pick ideas from the content bank</h2><p class="muted">The engine chooses unused ideas, rotates pillars and fills your daily slots. Choose exact ideas in the <a href="#/bank">content bank</a> instead if you prefer.</p></div></div><div class="three-col">${field("Date", "date", new Date().toISOString().slice(0, 10), "date")}${field("Title (optional)", "title", "")}${select("Countries", "region", Object.entries(state.catalog.regions), "all")}</div><fieldset><legend>How many of each</legend><div class="count-row">${[
    ["carousel", "Carousels"],
    ["reel", "Reels"],
    ["post", "Static posts"],
    ["story", "Stories"],
  ]
    .map(([format, label]) => field(label, `count-${format}`, counts[format] || 0, "number", "", 'min="0" max="14"'))
    .join("")}</div><small class="muted">Defaults follow the daily playbook: ${state.catalog.slots.map((s) => `${s.time} ${s.format}`).join(", ")} (IST).</small></fieldset><fieldset><legend>Pillars (leave empty for all)</legend><div class="chip-row">${Object.entries(state.catalog.pillars)
    .map(([key, label]) => `<label class="chip-check"><input type="checkbox" name="pillars" value="${attr(key)}"><span>${esc(label)}</span></label>`)
    .join("")}</div></fieldset>${select(
    "Style",
    "styleId",
    [["", "Each template's style (or the default)"], ...readyStyles.map((s) => [s.id, s.name])],
    "",
  )}<label class="check-row"><input type="checkbox" name="run" checked><span>Write, check and design everything now. Validated copy is approved automatically.</span></label><div class="form-actions">${cancellable ? '<button type="button" class="btn" data-action="cancel-form">Cancel</button>' : ""}<button type="submit" class="btn primary">Create plan →</button></div></form>`;
}
export async function render(state, params) {
  const brandId = state.brand.id,
    creating = params.has("new");
  const wanted = params.get("id");
  if (creating && !params.get("id")) {
    const data = await api(`/brands/${encodeURIComponent(brandId)}/plans`);
    plans = data.plans;
    current = null;
    keepPolling(false);
    return `${title("NEW PLAN", "Plan your content.", `${state.ideaCount} ideas in your content bank`, plans.length ? '<a class="btn" href="#/plan">Back to latest plan</a>' : "")}${planForm(state, Boolean(plans.length))}`;
  }
  if (wanted) {
    current = (await api(`/plans/${encodeURIComponent(wanted)}`, { cache: false })).plan;
    plans = (await api(`/brands/${encodeURIComponent(brandId)}/plans`)).plans;
  } else {
    const data = await api(`/brands/${encodeURIComponent(brandId)}/plans?latest=1`, { cache: false });
    current = data.plan;
    plans = data.plans;
  }
  const readyStyles = state.styles.filter((s) => s.status === "ready" && s.asset_id);
  const heading = title(
    "INSTAGRAM CONTENT ENGINE",
    current ? current.title : "Plan your content.",
    current ? `${current.plan_date} · ${current.total} pieces · ${state.brand.name}` : `${state.ideaCount} ideas in your content bank · ${state.brand.name}`,
    `${plans.length ? `<label class="field inline-field">Plan<select data-change="open-plan">${plans.map((p) => `<option value="${attr(p.id)}" ${p.id === current?.id ? "selected" : ""}>${esc(p.plan_date)} · ${esc(p.title)} (${p.ready}/${p.total})</option>`).join("")}</select></label>` : ""}<button class="btn primary" data-action="new-plan">New plan +</button>`,
  );
  if (!readyStyles.length)
    return `${heading}<div class="panel empty-state"><span>◈</span><h2>Start with your brand style.</h2><p>Add your logo, then create a style from a reference design or upload your own template. Every post uses a style.</p><a class="btn primary" href="#/brand">Set up brand & styles →</a></div>`;
  if (!current) {
    keepPolling(false);
    return `${heading}${planForm(state)}`;
  }
  const p = current,
    active = p.items.filter((i) => i.status !== "skipped"),
    busy = p.items.some(working) || p.jobs.some((j) => ["queued", "running"].includes(j.status));
  keepPolling(busy);
  const validated = active.filter((i) => ["validated", "approved"].includes(i.copy_status)).length,
    approved = active.filter((i) => i.status === "approved").length;
  const allReady = active.length > 0 && p.ready === active.length;
  const next = allReady
    ? `<button class="btn primary" data-action="approve-plan" ${p.status === "approved" ? "disabled" : ""}>${p.status === "approved" ? "✓ All approved" : "Approve all artwork"}</button><button class="btn" data-action="download">Download pack ↓</button>`
    : `<button class="btn primary" data-action="run" data-stage="all" ${busy ? "disabled" : ""}>${p.status === "cancelled" ? "Resume · " : ""}Run everything →</button><button class="btn" data-action="run" data-stage="writing" ${busy ? "disabled" : ""}>Write copy only</button>${validated ? `<button class="btn" data-action="run" data-stage="images" ${busy ? "disabled" : ""}>Create images for checked copy</button>` : ""}`;
  return `${heading}<div class="week-stats"><div><span>Pieces</span><b>${active.length}</b></div><div><span>Copy checked</span><b>${validated} / ${active.length}</b></div><div><span>Artwork ready</span><b>${p.ready} / ${active.length}</b></div><div><span>Approved</span><b>${approved} / ${active.length}</b></div></div>${retryJobs(p.jobs)}<div class="panel plan-footer"><div><h3>${busy ? "The engine is working." : allReady ? "Everything is ready to review." : validated ? "Copy is checked and ready for artwork." : "Ready when you are."}</h3><p>${busy ? "Pieces update as they finish. You can leave this page; work continues in the background." : "Run the whole plan, or write copy first and review it before creating images."}</p></div><div class="heading-actions">${next}${busy ? '<button class="btn" data-action="stop">Stop</button>' : ""}<button class="btn" data-action="delete-plan">Delete plan</button></div></div><div class="content-grid">${p.items.map((i) => contentCard(i, state)).join("")}</div>`;
}
export async function change(name, el) {
  if (name === "open-plan") go(`/plan?id=${encodeURIComponent(el.value)}`);
}
export async function action(name, el, state) {
  if (name === "new-plan") return go("/plan?new=1");
  if (name === "cancel-form") return go(current ? `/plan?id=${encodeURIComponent(current.id)}` : "/plan");
  if (name === "run") {
    current = (await api(`/plans/${encodeURIComponent(current.id)}/generate`, { method: "POST", body: { stage: el.dataset.stage } })).plan;
    toast(el.dataset.stage === "writing" ? "Writing copy for every piece." : el.dataset.stage === "images" ? "Creating artwork for checked copy." : "Running the whole plan.");
    return go(`/plan?id=${encodeURIComponent(current.id)}`);
  }
  if (name === "stop") {
    await api(`/plans/${encodeURIComponent(current.id)}/cancel`, { method: "POST", body: {} });
    toast("Plan paused. Finished pieces stay ready.");
    return go(`/plan?id=${encodeURIComponent(current.id)}`);
  }
  if (name === "approve-plan") {
    await api(`/plans/${encodeURIComponent(current.id)}/approve`, { method: "POST", body: {} });
    toast("All artwork approved.");
    return go(`/plan?id=${encodeURIComponent(current.id)}`);
  }
  if (name === "delete-plan") {
    if (!confirm("Delete this plan and all of its pieces? Artwork files stay in storage but are no longer listed.")) return;
    await api(`/plans/${encodeURIComponent(current.id)}`, { method: "DELETE" });
    toast("Plan deleted.");
    current = null;
    return go("/plan");
  }
  if (name === "skip") {
    await api(`/content/${encodeURIComponent(el.dataset.id)}/skip`, { method: "POST", body: {} });
    return go(`/plan?id=${encodeURIComponent(current.id)}`);
  }
  if (name === "download") {
    const { downloadPack } = await import("../export.js");
    await downloadPack(current.items.filter((i) => i.status !== "skipped"), state, current.plan_date);
  }
}
export async function submit(name, data, state) {
  if (name !== "plan") return;
  const counts = Object.fromEntries(["carousel", "reel", "post", "story"].map((f) => [f, Number(data.get(`count-${f}`)) || 0]));
  const { plan } = await api(`/brands/${encodeURIComponent(state.brand.id)}/plans`, {
    method: "POST",
    body: {
      date: data.get("date"),
      title: data.get("title"),
      region: data.get("region"),
      counts,
      pillars: data.getAll("pillars"),
      styleId: data.get("styleId") || undefined,
      run: data.has("run"),
    },
  });
  toast(data.has("run") ? "Plan created. The engine is writing and designing it now." : "Plan created.");
  go(`/plan?id=${encodeURIComponent(plan.id)}`);
}
