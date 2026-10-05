import { api, image } from "../api.js";
import { esc, attr, title, field, area, select, badge, askText, retryJobs } from "../ui.js";
import { go, toast, refreshBrand, keepPolling } from "../app.js";
import { detectLogoColours, prepareLogo } from "../../v4/logo-colours.js";

let open = "";
export async function render(state, params, { fresh } = {}) {
  if (fresh) await refreshBrand();
  const b = state.brand,
    p = b.profile,
    styles = state.styles;
  open = params.get("open") ?? (styles.length ? open : "styles");
  keepPolling(styles.some((s) => s.status === "generating"));
  const brandForm = `<form class="panel brand-form" data-form="brand"><div class="section-head"><h2>Brand details</h2><button type="submit" class="btn primary">Save brand</button></div><div class="logo-upload">${b.brand.logoAssetId ? `<img src="${image(b.brand.logoAssetId, "thumbnail")}" alt="Logo">` : '<span class="clinic-avatar">◈</span>'}<div><b>Logo</b><small>PNG, JPEG or WebP under 2 MB. Colours are picked up automatically.</small><label class="btn small upload">${b.brand.logoAssetId ? "Replace logo" : "Upload logo"}<input type="file" accept="image/png,image/jpeg,image/webp" data-change="logo"></label></div></div><div class="three-col">${field("Brand name", "name", b.name)}${field("Instagram handle", "handle", b.brand.handle || "", "text", "Shown small on artwork, e.g. @smilecraft")}${select("Default spelling (posts for all countries)", "spelling", [["US", "US English"], ["UK", "British English"]], p.spelling || "US")}</div><div class="three-col"><label class="field">Primary colour<input name="primary" type="color" value="${attr(b.brand.primary)}"></label><label class="field">Accent colour<input name="accent" type="color" value="${attr(b.brand.accent)}"></label>${field("Website", "website", b.brand.website || "", "url")}</div>${area("What you sell", "product", p.product, "The writer never promises features beyond this.", 3)}${area("Audience", "audience", p.audience, "", 2)}<div class="two-col">${area("Voice", "voice", p.voice, "", 2)}${area("Main offer", "offer", p.offer, "", 2)}</div>${field("Mascot (optional)", "mascot", p.mascot || "", "text", "e.g. Crafty, a friendly cartoon tooth. Leave empty for none.")}${area("Brand rules (one per line)", "rules", (p.rules || []).join("\n"), "Every draft is checked against these before artwork is made.", 9)}</form>`;
  const styleCards = styles
    .map((s) => {
      const isDefault = b.brand.defaultStyleId === s.id;
      return `<article class="style-card ${isDefault ? "chosen" : ""}">${
        s.asset_id
          ? `<div class="style-media ${s.status === "generating" ? "busy" : ""}"><img src="${image(s.asset_id)}" alt="${attr(s.name)}" loading="lazy">${s.status === "generating" ? '<div class="regenerating"><span class="spinner"></span><p>Applying your changes…</p></div>' : ""}</div>`
          : `<div class="style-skeleton">${s.status === "generating" ? '<span class="spinner"></span><p>Creating this style…</p>' : `<p>${s.status === "failed" ? "This style needs a retry." : "Generation stopped."}</p>`}</div>`
      }<div class="style-card-body"><div><b>${esc(s.name)}</b>${isDefault ? badge("Default", "violet") : ""}${s.reference_id.startsWith("upload:") ? badge("Uploaded") : ""}</div>${s.notes ? `<small class="muted">Notes: ${esc(s.notes)}</small>` : ""}<div class="style-buttons"><button class="btn small" data-action="default-style" data-id="${attr(s.id)}" ${s.status !== "ready" || isDefault ? "disabled" : ""}>Make default</button><button class="btn small" data-action="regenerate" data-id="${attr(s.id)}" data-name="${attr(s.name)}" ${s.status === "generating" ? "disabled" : ""}>${s.asset_id ? "Change ↻" : "Retry ↻"}</button><button class="btn small" data-action="rename" data-id="${attr(s.id)}" data-name="${attr(s.name)}">Rename</button><button class="btn small" data-action="remove-style" data-id="${attr(s.id)}" ${isDefault ? "disabled" : ""}>Remove</button></div></div></article>`;
    })
    .join("");
  const designs = state.catalog.designs
    .map((d, i) => `<label class="design-pick"><input type="checkbox" name="referenceIds" value="${attr(d.id)}" ${i < 3 && !styles.length ? "checked" : ""}><img src="${attr(d.img)}" alt="" loading="lazy"><span><b>${esc(d.name)}</b><small>${esc(d.kind)}</small></span></label>`)
    .join("");
  return `${title("BRAND & STYLES", "Your look, set once.", "Add your logo and colours, then create styles. Change any of it whenever you like; new content uses the latest version.")}${brandForm}<div class="section-head"><div><h2>Styles</h2><p class="muted">A style is a five-panel design board. The writer reads it to judge text length; the artist follows it for every frame.</p></div><button class="btn" data-action="toggle-new">${open === "styles" ? "Close" : "Add styles +"}</button></div>${retryJobs(state.jobs)}${
    open === "styles"
      ? `<div class="two-col style-new"><form class="panel" data-form="styles"><h3>Create from reference designs</h3><p class="muted small-copy">Pick up to 4. Each becomes your own style in your colours with your logo.</p><div class="design-grid">${designs}</div>${area("Direction (optional)", "notes", "", "e.g. bold and playful, lots of white space, big keyword on the last panel", 2)}<button type="submit" class="btn primary">Create styles ✦</button></form><form class="panel" data-form="upload"><h3>Upload your own template</h3><p class="muted small-copy">A finished post or a design board (PNG, JPEG or WebP, under 10 MB). It works as a style straight away, and you can ask the engine to rework it later.</p>${field("Style name", "name", "My template")}<label class="btn upload">Choose image<input type="file" name="file" accept="image/png,image/jpeg,image/webp" required></label><button type="submit" class="btn primary spaced">Upload style</button></form></div>`
      : ""
  }<div class="style-grid">${styleCards || '<div class="panel"><p>No styles yet. Create one from a reference design or upload your template.</p></div>'}</div>`;
}
export async function action(name, el, state) {
  if (name === "toggle-new") {
    open = open === "styles" ? "" : "styles";
    return go("/brand?open=" + open);
  }
  if (name === "default-style") {
    await saveBrand(state, { defaultStyleId: el.dataset.id });
    toast("Default style updated.");
    return go("/brand");
  }
  if (name === "regenerate") {
    const notes = await askText(`Change “${el.dataset.name}”`, "What should change? (optional)", "e.g. darker background, bigger headings, more playful");
    if (notes === null) return;
    state.styles = (await api(`/styles/${encodeURIComponent(el.dataset.id)}/regenerate`, { method: "POST", body: { notes } })).styles;
    toast("Updating the style. The current version stays until the new one is ready.");
    return go("/brand");
  }
  if (name === "rename") {
    const value = await askText("Rename style", "Style name", "", el.dataset.name);
    if (!value) return;
    state.styles = (await api(`/styles/${encodeURIComponent(el.dataset.id)}`, { method: "PUT", body: { name: value } })).styles;
    return go("/brand");
  }
  if (name === "remove-style") {
    if (!confirm("Remove this style? Existing artwork keeps its look.")) return;
    state.styles = (await api(`/styles/${encodeURIComponent(el.dataset.id)}`, { method: "DELETE" })).styles;
    toast("Style removed.");
    return go("/brand");
  }
}
async function saveBrand(state, values) {
  const save = () => api(`/brands/${encodeURIComponent(state.brand.id)}`, { method: "PUT", body: { ...values, revision: state.brand.revision } });
  let data;
  try {
    data = await save();
  } catch (error) {
    if (error.status !== 409) throw error;
    await refreshBrand();
    data = await save();
  }
  state.brand = data.brand;
}
export async function change(name, el, state) {
  if (name !== "logo") return;
  const file = el.files[0];
  if (!file) return;
  if (file.size > 2_000_000) throw Error("Choose a logo smaller than 2 MB.");
  const [colours, upload] = await Promise.all([detectLogoColours(file), prepareLogo(file)]);
  state.brand = (
    await api(`/brands/${encodeURIComponent(state.brand.id)}/logo`, {
      method: "POST",
      body: upload,
      raw: true,
      headers: colours ? { "X-Logo-primary": colours.primary, "X-Logo-accent": colours.accent } : {},
    })
  ).brand;
  toast(colours ? "Logo saved and colours detected. Adjust them if needed." : "Logo saved.");
  go("/brand");
}
export async function submit(name, data, state) {
  if (name === "brand") {
    const values = Object.fromEntries(data);
    values.rules = String(values.rules || "")
      .split("\n")
      .map((r) => r.trim())
      .filter(Boolean);
    await saveBrand(state, values);
    toast("Brand saved. New writing uses these details and rules.");
    return go("/brand");
  }
  if (name === "styles") {
    const referenceIds = data.getAll("referenceIds");
    if (!referenceIds.length) throw Error("Choose at least one reference design.");
    state.styles = (await api(`/brands/${encodeURIComponent(state.brand.id)}/styles`, { method: "POST", body: { referenceIds, notes: data.get("notes") } })).styles;
    open = "";
    toast("Creating your styles in parallel. They appear here as they finish.");
    return go("/brand?open=");
  }
  if (name === "upload") {
    const file = data.get("file");
    if (!file?.size) throw Error("Choose an image to upload.");
    if (file.size > 10_000_000) throw Error("Choose an image under 10 MB.");
    const result = await api(`/brands/${encodeURIComponent(state.brand.id)}/styles/upload`, {
      method: "POST",
      body: file,
      raw: true,
      headers: { "X-Style-Name": encodeURIComponent(data.get("name") || "My template") },
    });
    state.styles = result.styles;
    state.brand = result.brand;
    open = "";
    toast("Template uploaded. It is ready to use.");
    return go("/brand?open=");
  }
}
