import { image } from "./api.js";
export const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export const attr = esc;
export const badge = (text, kind = "") => `<span class="badge ${kind}">${esc(text)}</span>`;
export const title = (eyebrow, heading, subtitle, actions = "") =>
  `<div class="page-heading"><div><p class="eyebrow">${esc(eyebrow)}</p><h1>${esc(heading)}</h1><p class="muted">${esc(subtitle)}</p></div>${actions ? `<div class="heading-actions">${actions}</div>` : ""}</div>`;
export const field = (label, name, value = "", type = "text", hint = "", extra = "") =>
  `<label class="field">${esc(label)}<input name="${name}" type="${type}" value="${attr(value)}" ${extra}>${hint ? `<small>${esc(hint)}</small>` : ""}</label>`;
export const area = (label, name, value = "", hint = "", rows = 3) =>
  `<label class="field">${esc(label)}<textarea name="${name}" rows="${rows}">${esc(value)}</textarea>${hint ? `<small>${esc(hint)}</small>` : ""}</label>`;
export const select = (label, name, options, selected, extra = "") =>
  `<label class="field">${esc(label)}<select name="${name}" ${extra}>${options
    .map(([value, text]) => `<option value="${attr(value)}" ${String(value) === String(selected ?? "") ? "selected" : ""}>${esc(text)}</option>`)
    .join("")}</select></label>`;
export const working = (item) => ["writing", "validating", "generating"].includes(item?.status);
export const ready = (item) => item.frames.length > 0 && item.frames.every((f) => f.assetId);
export const formatLabel = (format, catalog) => catalog?.formats?.[format]?.label || format;
export function itemLabel(item, catalog) {
  const n = item.frames?.length;
  return `${formatLabel(item.format, catalog)}${item.format === "carousel" && n ? ` · ${n} slides` : item.format === "reel" && n ? ` · ${n} cards` : ""} · ${item.ratio}`;
}
export function status(item) {
  const values = {
    approved: ["Approved", "good"],
    skipped: ["Skipped", "warn"],
    cancelled: ["Paused", "warn"],
    failed: ["Needs attention", "warn"],
    ready: ["Review artwork", "violet"],
    generating: ["Creating artwork", "violet"],
    writing: ["Writing copy", "violet"],
    validating: ["Checking copy", "violet"],
    copy_review: [item.copy_status === "rejected" ? "Copy needs revision" : "Review copy", item.copy_status === "rejected" ? "warn" : "violet"],
    planned: ["Planned", ""],
  };
  const [label, kind] = values[item.status] || ["Planned", ""];
  return badge(label, kind) + (item.posted_at ? badge("Posted", "good") : "");
}
export function thumb(item) {
  const frame = (item.frames || []).find((f) => f.assetId);
  return frame
    ? `<img src="${image(frame.assetId, "thumbnail")}" alt="${attr(item.topic)}" loading="lazy" decoding="async">`
    : `<div class="art-placeholder"><span>✦</span><small>${item.status === "generating" ? "Creating artwork" : item.status === "failed" ? "Task needs a retry" : item.status === "writing" ? "Writing copy" : item.frames.length ? "Copy ready to review" : "Not written yet"}</small></div>`;
}
const jobNames = { style: "style", frame: "artwork", writing: "writing", validation: "validation" };
export function retryJobs(jobs = []) {
  let dismissed = new Set();
  try {
    dismissed = new Set(JSON.parse(sessionStorage.getItem("engine-dismissed") || "[]"));
  } catch {}
  return jobs
    .filter((j) => j.status === "failed" && !dismissed.has(j.id))
    .map(
      (j) =>
        `<div class="notice error"><span>${esc(j.error || "This task could not be completed.")}</span><button class="btn small" data-action="retry" data-id="${attr(j.id)}">Retry ${esc(jobNames[j.kind] || "task")}</button><button class="notice-dismiss" data-action="dismiss-error" data-id="${attr(j.id)}" aria-label="Dismiss" title="Dismiss">×</button></div>`,
    )
    .join("");
}
const nav = [
  ["/plan", "▦", "Content plan"],
  ["/bank", "☰", "Content bank"],
  ["/create", "✦", "Create custom"],
  ["/library", "▤", "Library"],
  ["/brand", "◈", "Brand & styles"],
  ["/templates", "▣", "Templates"],
  ["/settings", "⚙", "AI settings"],
];
export function shell(state, route, content) {
  const b = state.brand,
    selected = route.split("?")[0];
  const logo = b?.brand?.logoAssetId
    ? `<img class="engine-logo" src="${image(b.brand.logoAssetId, "thumbnail")}" alt="">`
    : `<span class="clinic-avatar">${esc((b?.name || "S")[0])}</span>`;
  return `<div class="workspace engine"><aside class="sidebar"><a class="wordmark" href="#/plan"><span class="brand-mark">e</span>content<span class="v4">engine</span></a><div class="clinic-switch">${logo}<div><b>${esc(b?.name || "Your brand")}</b><small>Instagram content engine</small></div></div><nav aria-label="Content Engine">${nav
    .map(([link, icon, name]) => `<a href="#${link}" class="${selected.startsWith(link) ? "selected" : ""}"><span>${icon}</span>${name}</a>`)
    .join("")}</nav><div class="sidebar-bottom"><div class="tiny-card"><span>✦</span><b>${esc(state.catalog?.formula || "")}</b><p>Every feed post follows the formula.</p></div><a href="/">Client studio ↗</a><small>${esc(state.me?.user?.email || "")}</small></div></aside><div class="workspace-body"><header class="topbar"><a class="mobile-wordmark" href="#/plan">✦ engine</a><span class="topbar-title">Instagram content engine</span><div>${state.capabilities?.local ? badge("Local · Codex / agy / API", "good") : badge("Cloud · API providers", "violet")}${state.capabilities?.generation ? "" : badge("No image provider ready", "warn")}</div></header><main id="main" tabindex="-1">${content}</main><nav class="mobile-nav" aria-label="Mobile">${nav
    .slice(0, 5)
    .map(([link, icon, name]) => `<a href="#${link}" class="${selected.startsWith(link) ? "selected" : ""}">${icon}<small>${name.split(" ")[0]}</small></a>`)
    .join("")}</nav></div></div>`;
}
export function askText(heading, label, placeholder = "", value = "") {
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "style-changes";
    dialog.innerHTML = `<form method="dialog"><h2>${esc(heading)}</h2><label class="field">${esc(label)}<textarea name="notes" maxlength="600" rows="3" placeholder="${attr(placeholder)}">${esc(value)}</textarea></label><div class="form-actions"><button class="btn" value="cancel" formnovalidate>Cancel</button><button class="btn primary" value="ok">Continue</button></div></form>`;
    dialog.addEventListener("close", () => {
      resolve(dialog.returnValue === "ok" ? dialog.querySelector("textarea").value.trim() : null);
      dialog.remove();
    });
    document.body.append(dialog);
    dialog.showModal();
    dialog.querySelector("textarea").focus();
  });
}
