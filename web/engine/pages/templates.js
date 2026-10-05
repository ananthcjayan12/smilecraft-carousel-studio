import { api, image } from "../api.js";
import { esc, attr, title, field, area, select, badge } from "../ui.js";
import { go, toast, refreshBrand } from "../app.js";

function form(state, t = {}) {
  const c = state.catalog,
    format = t.format || "carousel",
    readyStyles = state.styles.filter((s) => s.status === "ready" && s.asset_id);
  return `<form class="panel template-form" data-form="template" data-id="${attr(t.id || "")}"><h2>${t.id ? `Edit “${esc(t.name)}”` : "New template"}</h2><div class="three-col">${field("Name", "name", t.name || "")}${select(
    "Format",
    "format",
    Object.entries(c.formats).map(([k, v]) => [k, v.label]),
    format,
    'data-change="format"',
  )}${select("Size", "ratio", c.formats[format].ratios.map((r) => [r, r]), t.ratio)}</div>${area(
    "Frame roles, one per line",
    "roles",
    (t.roles || ["Hook", "Point", "Point", "Comment the keyword"]).join("\n"),
    `One line per slide or card, in order. Carousels 2–10, reels 1–6, posts and stories 1.`,
    6,
  )}${area("Writing instructions", "instructions", t.instructions || "", "How the writer should fill each role, the tone and the call to action.", 5)}${area("Art direction", "visual", t.visual || "", "How every frame should look. Applied on top of the style.", 3)}${select(
    "Style for this template",
    "style_id",
    [["", "Brand default style"], ...readyStyles.map((s) => [s.id, s.name])],
    t.style_id || "",
  )}<div class="form-actions"><button type="button" class="btn" data-action="close">Cancel</button><button type="submit" class="btn primary">Save template</button></div></form>`;
}
export async function render(state, params) {
  const editing = state.templates.find((t) => t.id === params.get("edit")),
    adding = params.get("add") === "1",
    c = state.catalog;
  const groups = Object.entries(c.formats)
    .map(([format, spec]) => {
      const list = state.templates.filter((t) => t.format === format);
      return list.length
        ? `<h2 class="group-title">${esc(spec.label)}s</h2><div class="template-grid">${list
            .map((t) => {
              const style = state.styles.find((s) => s.id === t.style_id);
              return `<article class="panel template-card"><div class="card-status">${badge(t.ratio)}${badge(`${t.roles.length} ${t.roles.length === 1 ? "frame" : "frames"}`, "violet")}${style ? badge(style.name, "good") : ""}</div><h3>${esc(t.name)}</h3><ol class="roles">${t.roles.map((r) => `<li>${esc(r)}</li>`).join("")}</ol><p class="small-copy">${esc(t.instructions)}</p>${style?.asset_id ? `<img class="template-style" src="${image(style.asset_id, "thumbnail")}" alt="">` : ""}<div class="style-buttons"><button class="btn small" data-action="edit" data-id="${attr(t.id)}">Edit</button><button class="btn small" data-action="duplicate" data-id="${attr(t.id)}">Duplicate</button><button class="btn small" data-action="archive" data-id="${attr(t.id)}">Archive</button></div></article>`;
            })
            .join("")}</div>`
        : "";
    })
    .join("");
  return `${title("TEMPLATES", "How each format is written and drawn.", "Templates set the frames, the writing instructions and the art direction. Change them any time; new and rewritten content uses the latest version.", '<button class="btn" data-action="reset">Restore default templates</button><button class="btn primary" data-action="add">New template +</button>')}${adding ? form(state) : ""}${editing ? form(state, editing) : ""}${groups}`;
}
export async function action(name, el, state) {
  if (name === "add") return go("/templates?add=1");
  if (name === "close") return go("/templates");
  if (name === "edit") return go(`/templates?edit=${encodeURIComponent(el.dataset.id)}`);
  if (name === "duplicate") {
    const { template } = await api(`/brands/${encodeURIComponent(state.brand.id)}/templates`, { method: "POST", body: { fromId: el.dataset.id } });
    await refreshBrand();
    toast("Template duplicated.");
    return go(`/templates?edit=${encodeURIComponent(template.id)}`);
  }
  if (name === "archive") {
    if (!confirm("Archive this template? Content already made with it is kept.")) return;
    await api(`/templates/${encodeURIComponent(el.dataset.id)}`, { method: "DELETE" });
    await refreshBrand();
    toast("Template archived.");
    return go("/templates");
  }
  if (name === "reset") {
    if (!confirm("Restore the preloaded templates to their original wording? Your own templates are not changed.")) return;
    await api(`/brands/${encodeURIComponent(state.brand.id)}/templates/reset`, { method: "POST", body: {} });
    await refreshBrand();
    toast("Default templates restored.");
    return go("/templates");
  }
}
export function change(name, el, state) {
  if (name === "format") {
    el.form.querySelector("[name=ratio]").innerHTML = state.catalog.formats[el.value].ratios.map((r) => `<option value="${r}">${r}</option>`).join("");
  }
}
export async function submit(name, data, state, formEl) {
  if (name !== "template") return;
  const body = Object.fromEntries(data),
    templateId = formEl.dataset.id;
  body.roles = String(body.roles || "")
    .split("\n")
    .map((r) => r.trim())
    .filter(Boolean);
  await api(templateId ? `/templates/${encodeURIComponent(templateId)}` : `/brands/${encodeURIComponent(state.brand.id)}/templates`, {
    method: templateId ? "PUT" : "POST",
    body,
  });
  await refreshBrand();
  toast("Template saved.");
  go("/templates");
}
