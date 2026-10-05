import { api, image } from "../api.js";
import { esc, attr, title, status, retryJobs, itemLabel, ready, working, area, field, select, askText, badge } from "../ui.js";
import { go, toast, keepPolling } from "../app.js";

let item = null,
  template = null,
  frameIndex = 0,
  editing = false,
  currentId = "";

const copyButton = (label, key) => `<button class="btn small" data-action="copy" data-key="${key}">${label}</button>`;
function extrasPanel(it) {
  const x = it.extras || {},
    parts = [];
  if (x.script)
    parts.push(
      `<div class="panel"><div class="section-head"><h3>Reel script</h3>${copyButton("Copy script ↗", "script")}</div><p><b>First 2 seconds:</b> ${esc(x.script.hook)}</p><ol class="shot-list">${(x.script.shots || [])
        .map((s) => `<li><b>${esc(s.shot)}</b>${s.onScreen ? `<span>On screen: “${esc(s.onScreen)}”</span>` : ""}${s.voiceover ? `<span>Voiceover: ${esc(s.voiceover)}</span>` : ""}</li>`)
        .join("")}</ol><p><b>Closing:</b> ${esc(x.script.closing)}</p><p class="muted small-copy">Audio: ${esc(x.script.audio)}</p></div>`,
    );
  if (x.sticker && x.sticker.type !== "none")
    parts.push(
      `<div class="panel"><h3>Story sticker (add in the Instagram app)</h3><p>${badge(x.sticker.type, "violet")} ${esc(x.sticker.prompt)}</p>${(x.sticker.options || []).length ? `<p class="muted">${x.sticker.options.map(esc).join(" · ")}</p>` : ""}<p class="muted small-copy">The API can’t publish stickers, so the artwork leaves room for it.</p></div>`,
    );
  if (x.dmReply)
    parts.push(`<div class="panel"><div class="section-head"><h3>Keyword DM reply</h3>${copyButton("Copy ↗", "dmReply")}</div><p class="caption">${esc(x.dmReply)}</p><p class="muted small-copy">Paste into ManyChat (or your DM tool) for the ${esc(it.keyword || "keyword")} trigger. Replace [link] with the resource link.</p></div>`);
  if (x.altText) parts.push(`<div class="panel"><h3>Alt text</h3><p class="small-copy">${esc(x.altText)}</p></div>`);
  return parts.join("");
}
function editForm(it) {
  return `<form class="panel edit-form" data-form="edit"><h3>Edit copy</h3><p class="muted small-copy">Saving re-checks the copy. Changed frames lose their artwork; unchanged frames keep it.</p>${it.frames
    .map(
      (f, i) =>
        `<details ${i === frameIndex ? "open" : ""}><summary>${esc(f.role || `Frame ${i + 1}`)} · ${i + 1}</summary>${area("Heading", `heading-${i}`, f.heading, "", 2)}${area("Body", `body-${i}`, f.body)}${area("Visual concept", `visual-${i}`, f.visualPrompt)}</details>`,
    )
    .join("")}${area("Caption", "caption", it.caption, "", 8)}${field("Hashtags", "hashtags", (it.extras.hashtags || []).join(" "), "text", "Separate with spaces.")}${area("Keyword DM reply", "dmReply", it.extras.dmReply || "", "", 4)}${area("Alt text", "altText", it.extras.altText || "", "", 2)}<div class="form-actions"><button type="button" class="btn" data-action="cancel-edit">Cancel</button><button type="submit" class="btn primary">Save & check</button></div></form>`;
}
function setupForm(it, state) {
  const readyStyles = state.styles.filter((s) => s.status === "ready" && s.asset_id);
  return `<details class="panel setup-panel"><summary>Template, style & instructions</summary><form data-form="setup"><div class="two-col">${select(
    "Template",
    "templateId",
    state.templates.map((t) => [t.id, `${state.catalog.formats[t.format]?.label} · ${t.name}`]),
    it.template_id,
  )}${select("Style", "styleId", readyStyles.map((s) => [s.id, s.name]), it.style_id)}</div><div class="three-col">${select("Size", "ratio", (state.catalog.formats[it.format]?.ratios || []).map((r) => [r, r]), it.ratio)}${select("Countries", "region", Object.entries(state.catalog.regions), it.region)}${select(
    "Comment keyword",
    "keyword",
    [["", "No keyword"], ...state.magnets.map((m) => [m.keyword, m.keyword])],
    it.keyword,
  )}</div>${field("Hook / topic", "topic", it.topic)}${area("Instructions for the writer", "instructions", it.brief?.instructions || "", "Rewriting replaces the current copy and artwork.", 3)}<div class="form-actions"><button type="submit" class="btn primary" ${working(it) ? "disabled" : ""}>Save & rewrite ↻</button></div></form></details>`;
}
export async function render(state, params) {
  const id = params.get("id");
  if (!id) return '<a class="btn" href="#/library">Back to library</a>';
  if (id !== currentId) {
    currentId = id;
    frameIndex = 0;
    editing = false;
  }
  const data = await api(`/content/${encodeURIComponent(id)}`, { cache: false });
  item = data.item;
  template = data.template;
  const busy = working(item) || data.jobs.some((j) => ["queued", "running"].includes(j.status));
  keepPolling(busy);
  frameIndex = Math.min(frameIndex, Math.max(0, item.frames.length - 1));
  const frame = item.frames[frameIndex],
    copyApproved = item.copy_status === "approved",
    back = item.plan_id ? `#/plan?id=${encodeURIComponent(item.plan_id)}` : "#/library";
  const head = `<div class="review-top"><a href="${back}">← Back to ${item.plan_id ? "plan" : "library"}</a></div>${title(
    `${itemLabel(item, state.catalog).toUpperCase()} · ${template?.name || ""}`,
    item.topic,
    `${item.brief?.ideaNumber ? `Idea #${item.brief.ideaNumber} · ` : ""}${state.catalog.pillars[item.brief?.pillar] || "Custom"} · ${state.catalog.regions[item.region]}${item.keyword ? ` · Comment ${item.keyword}` : ""}${item.slot?.time ? ` · ${item.slot.time} IST` : ""}`,
    status(item),
  )}${retryJobs(data.jobs)}`;
  const progress = working(item)
    ? `<div class="generation-note panel" role="status"><span class="spinner"></span><p>${{ writing: "Writing copy with your template, brand rules and style…", validating: "Checking the copy against your brand rules…", generating: "Creating artwork from the approved copy…" }[item.status]}</p><button class="btn small" data-action="cancel">Stop</button></div>`
    : "";
  const issues = item.validation?.issues?.length
    ? `<div class="notice error"><div><b>${item.copy_status === "rejected" ? "The check found problems" : "Notes from the check"}</b><ul>${item.validation.issues.map((v) => `<li>${esc(v)}</li>`).join("")}</ul><p class="small-copy">Rewrite to fix them automatically, or edit the copy yourself.</p></div></div>`
    : "";
  if (!frame)
    return `${head}${progress}${issues}${setupForm(item, state)}${item.brief?.show ? `<div class="panel"><p><b>Show</b> ${esc(item.brief.show)}</p>${item.brief.angle ? `<p><b>Angle</b> ${esc(item.brief.angle)}</p>` : ""}</div>` : ""}${!working(item) ? '<button class="btn primary spaced" data-action="write">Write it →</button>' : ""}`;
  const canvas = ["story", "reel"].includes(item.format) ? "story" : item.format === "post" ? "post" : "carousel";
  const art = `<section class="art-panel"><div class="review-canvas ${canvas}">${
    frame.assetId
      ? `<img src="${image(frame.assetId)}" alt="${attr(frame.heading)}">`
      : `<div class="copy-preview"><small>${esc(frame.role || "")} · ${frameIndex + 1} / ${item.frames.length}</small><h2>${esc(frame.heading)}</h2><p>${esc(frame.body)}</p><span>${copyApproved ? (item.status === "generating" ? "Artwork is being created." : "Artwork will appear here.") : "Review the words before creating artwork."}</span></div>`
  }</div>${
    item.frames.length > 1
      ? `<div class="frame-strip">${item.frames.map((f, i) => `<button class="${i === frameIndex ? "selected" : ""}" data-action="frame" data-index="${i}" aria-label="Frame ${i + 1}">${f.assetId ? `<img src="${image(f.assetId, "thumbnail")}" alt="">` : "<span>✦</span>"}<small>${i + 1}</small></button>`).join("")}</div>`
      : ""
  }</section>`;
  const actions = `<div class="review-actions">${
    !copyApproved
      ? `<button class="btn primary full large" data-action="approve-copy" ${item.copy_status !== "validated" || working(item) ? "disabled" : ""}>Approve copy & create artwork →</button>`
      : ready(item)
        ? `<button class="btn primary full large" data-action="approve" ${item.status === "approved" ? "disabled" : ""}>${item.status === "approved" ? "✓ Approved" : "✓ Approve artwork"}</button>`
        : !working(item)
          ? '<button class="btn primary full" data-action="generate">Create remaining artwork →</button>'
          : ""
  }<div class="two-col"><button class="btn" data-action="edit" ${working(item) ? "disabled" : ""}>Edit copy</button><button class="btn" data-action="write" ${working(item) ? "disabled" : ""}>Rewrite ↻</button></div>${
    copyApproved && frame.assetId && !working(item) ? `<button class="btn full" data-action="redo-frame">Redo this ${item.format === "carousel" ? "slide" : "image"}…</button>` : ""
  }<button class="btn full" data-action="download" ${!ready(item) ? "disabled" : ""}>Download ↓</button><button class="btn full" data-action="posted" ${!ready(item) || item.posted_at ? "disabled" : ""}>${item.posted_at ? "✓ Posted" : "Mark as posted"}</button><button class="btn full danger" data-action="delete">Delete piece</button></div>`;
  return `${head}${progress}${issues}${setupForm(item, state)}<div class="review-layout">${art}<section class="review-details"><div class="panel"><p class="eyebrow">${esc(frame.role || "")} · ${copyApproved ? "APPROVED COPY" : item.copy_status === "validated" ? "CHECKED COPY" : "DRAFT"}</p><h2>${esc(frame.heading)}</h2><p class="slide-copy">${esc(frame.body)}</p><details><summary>Visual concept</summary><p>${esc(frame.visualPrompt)}</p>${frame.note ? `<p class="muted small-copy">Requested change: ${esc(frame.note)}</p>` : ""}</details></div><div class="panel caption-panel"><div class="section-head"><h3>Caption</h3>${copyButton("Copy ↗", "caption")}</div><p class="caption">${esc(item.caption)}</p>${item.extras.hashtags?.length ? `<p class="muted small-copy">${item.extras.hashtags.map(esc).join(" ")}</p>` : ""}</div>${editing ? editForm(item) : ""}${actions}</section></div>${extrasPanel(item)}`;
}
export async function action(name, el, state) {
  if (name === "frame") {
    frameIndex = Number(el.dataset.index);
    return go(`/review?id=${encodeURIComponent(currentId)}`);
  }
  if (name === "edit" || name === "cancel-edit") {
    editing = name === "edit";
    return go(`/review?id=${encodeURIComponent(currentId)}`);
  }
  if (name === "copy") {
    const x = item.extras || {};
    const value =
      el.dataset.key === "caption"
        ? `${item.caption}${x.hashtags?.length ? `\n\n${x.hashtags.join(" ")}` : ""}`
        : el.dataset.key === "script"
          ? [`HOOK: ${x.script.hook}`, ...x.script.shots.map((s, i) => `${i + 1}. ${s.shot}${s.onScreen ? ` | On screen: ${s.onScreen}` : ""}${s.voiceover ? ` | VO: ${s.voiceover}` : ""}`), `CLOSING: ${x.script.closing}`, `AUDIO: ${x.script.audio}`].join("\n")
          : x[el.dataset.key] || "";
    await navigator.clipboard.writeText(value);
    return toast("Copied.");
  }
  if (name === "download") {
    const { downloadPack } = await import("../export.js");
    return downloadPack([item], state, item.created_at.slice(0, 10));
  }
  if (name === "delete") {
    if (!confirm("Delete this piece?")) return;
    await api(`/content/${encodeURIComponent(currentId)}`, { method: "DELETE" });
    toast("Deleted.");
    return go(item.plan_id ? `/plan?id=${encodeURIComponent(item.plan_id)}` : "/library");
  }
  if (name === "redo-frame") {
    const note = await askText("Redo this image", "What should change? (optional)", "e.g. bigger keyword, less text, darker background");
    if (note === null) return;
    await api(`/content/${encodeURIComponent(currentId)}/frames/${item.frames[frameIndex].position}/regenerate`, { method: "POST", body: { note } });
    toast("Recreating this image. The rest stay as they are.");
    return go(`/review?id=${encodeURIComponent(currentId)}`);
  }
  const endpoint = { write: "write", "approve-copy": "approve-copy", approve: "approve", generate: "generate", cancel: "cancel", posted: "posted" }[name];
  if (endpoint) {
    await api(`/content/${encodeURIComponent(currentId)}/${endpoint}`, { method: "POST", body: {} });
    editing = false;
    if (name === "write") frameIndex = 0;
    return go(`/review?id=${encodeURIComponent(currentId)}`);
  }
}
export async function submit(name, data) {
  if (name === "edit") {
    await api(`/content/${encodeURIComponent(item.id)}`, {
      method: "PUT",
      body: {
        revision: item.revision,
        caption: data.get("caption"),
        hashtags: String(data.get("hashtags") || "").split(/\s+/).filter(Boolean),
        dmReply: data.get("dmReply"),
        altText: data.get("altText"),
        frames: item.frames.map((f, i) => ({ heading: data.get(`heading-${i}`), body: data.get(`body-${i}`), visualPrompt: data.get(`visual-${i}`) })),
      },
    });
    editing = false;
    toast("Saved. Checking the copy.");
  }
  if (name === "setup") {
    await api(`/content/${encodeURIComponent(item.id)}/setup`, { method: "PUT", body: { revision: item.revision, ...Object.fromEntries(data) } });
    frameIndex = 0;
    toast("Rewriting with the new settings.");
  }
  go(`/review?id=${encodeURIComponent(item.id)}`);
}
