import { api } from "../api.js";
import { esc, attr, title, badge, field, area, select } from "../ui.js";
import { go, toast, refreshBrand } from "../app.js";

const filters = { pillar: "all", format: "all", region: "all", q: "", usage: "all" };
const selected = new Set();
let ideas = [],
  tab = "ideas";

function ideaForm(state, idea = {}) {
  const c = state.catalog;
  return `<form class="panel idea-form" data-form="idea" data-id="${attr(idea.id || "")}"><h2>${idea.id ? `Edit idea #${idea.number}` : "Add an idea"}</h2><div class="three-col">${select("Pillar", "pillar", Object.entries(c.pillars), idea.pillar || "grow")}${select(
    "Format",
    "format",
    Object.entries(c.formats).map(([k, v]) => [k, v.label]),
    idea.format || "carousel",
  )}${select("Countries", "region", Object.entries(c.regions), idea.region || "all")}</div>${field("Hook", "hook", idea.hook || "", "text", "The first line people read.")}${area("What to show", "show", idea.show || "")}${area("SmileCraft angle", "angle", idea.angle || "")}<div class="two-col">${select(
    "Comment keyword",
    "keyword",
    [["", "No keyword"], ...state.magnets.map((m) => [m.keyword, `${m.keyword} · ${m.name}`])],
    idea.keyword || "",
  )}${area("Notes for the writer (optional)", "notes", idea.notes || "", "", 2)}</div><div class="form-actions"><button type="button" class="btn" data-action="close-form">Cancel</button>${idea.id ? `<button type="button" class="btn" data-action="archive" data-id="${attr(idea.id)}">Remove from bank</button>` : ""}<button type="submit" class="btn primary">${idea.id ? "Save idea" : "Add to bank"}</button></div></form>`;
}
function magnetForm(m = {}) {
  return `<form class="panel" data-form="magnet" data-id="${attr(m.id || "")}"><h2>${m.id ? `Edit ${esc(m.keyword)}` : "Add a lead magnet"}</h2><div class="two-col">${field("Keyword", "keyword", m.keyword || "", "text", "Capital letters, e.g. AUDIT", m.id ? "readonly" : "")}${field("Name", "name", m.name || "")}</div>${area("What it contains", "description", m.description || "", "The writer only promises what is listed here.")}${area("How to make it", "how", m.how || "", "", 2)}<label class="check-row"><input type="checkbox" name="star" ${m.star ? "checked" : ""}><span>Strong offer (build first)</span></label><div class="form-actions"><button type="button" class="btn" data-action="close-form">Cancel</button>${m.id ? `<button type="button" class="btn" data-action="delete-magnet" data-id="${attr(m.id)}">Delete</button>` : ""}<button type="submit" class="btn primary">Save lead magnet</button></div></form>`;
}
const matches = (i) =>
  (filters.pillar === "all" || i.pillar === filters.pillar) &&
  (filters.format === "all" || i.format === filters.format) &&
  (filters.region === "all" || i.region === filters.region || i.region === "all") &&
  (filters.usage === "all" || (filters.usage === "unused" ? !i.uses : i.uses > 0)) &&
  (!filters.q || `${i.hook} ${i.show} ${i.angle} ${i.keyword} ${i.number}`.toLowerCase().includes(filters.q.toLowerCase()));

export async function render(state, params, { fresh }) {
  if (!ideas.length || fresh || params.get("reload")) ideas = (await api(`/brands/${encodeURIComponent(state.brand.id)}/ideas`, { cache: false })).ideas;
  tab = params.get("tab") || tab;
  const c = state.catalog,
    editing = params.get("edit"),
    adding = params.get("add") === "1";
  const head = title(
    "CONTENT BANK",
    "Every idea, ready to post.",
    `${ideas.length} ideas · ${state.magnets.length} lead magnets. Pick ideas to plan, create one now, or add your own.`,
    `<div class="tabs" role="group" aria-label="Bank"><button class="${tab === "ideas" ? "active" : ""}" data-action="tab" data-tab="ideas">Ideas <span>${ideas.length}</span></button><button class="${tab === "magnets" ? "active" : ""}" data-action="tab" data-tab="magnets">Lead magnets <span>${state.magnets.length}</span></button></div>`,
  );
  if (tab === "magnets") {
    const edit = state.magnets.find((m) => m.id === editing);
    return `${head}<div class="section-head"><p class="muted">Each keyword sends one free resource by DM. Posts with that keyword promise only what is listed here.</p><button class="btn" data-action="add-magnet">Add lead magnet +</button></div>${adding ? magnetForm() : ""}${edit ? magnetForm(edit) : ""}<div class="magnet-grid">${state.magnets
      .map(
        (m) =>
          `<article class="panel magnet ${m.star ? "star" : ""}"><div class="card-status"><span class="keyword">${esc(m.keyword)}</span>${m.star ? badge("Build first", "violet") : ""}</div><h3>${esc(m.name)}</h3><p>${esc(m.description)}</p><p class="muted small-copy">How to make it: ${esc(m.how)}</p><p class="muted small-copy">Used in ${ideas.filter((i) => i.keyword === m.keyword).length} ideas</p><button class="btn small" data-action="edit-magnet" data-id="${attr(m.id)}">Edit</button></article>`,
      )
      .join("")}</div>`;
  }
  const visible = ideas.filter(matches),
    edit = ideas.find((i) => i.id === editing);
  const chips = (key, options) =>
    `<div class="chip-row">${options
      .map(([value, label, count]) => `<button class="chip ${filters[key] === value ? "on" : ""}" data-action="filter" data-key="${key}" data-value="${attr(value)}">${esc(label)}${count !== undefined ? `<small>${count}</small>` : ""}</button>`)
      .join("")}</div>`;
  return `${head}<div class="panel bank-filters">${chips("pillar", [["all", "All pillars", ideas.length], ...Object.entries(c.pillars).map(([k, v]) => [k, v, ideas.filter((i) => i.pillar === k).length])])}${chips("format", [
    ["all", "All formats"],
    ...Object.entries(c.formats).map(([k, v]) => [k, v.label, ideas.filter((i) => i.format === k).length]),
  ])}<div class="filter-line">${chips("region", Object.entries(c.regions).map(([k, v]) => [k, k === "all" ? "Everywhere" : v]))}${chips("usage", [
    ["all", "Any"],
    ["unused", "Not used yet"],
    ["used", "Used"],
  ])}<input class="search" type="search" placeholder="Search hooks, keywords, #numbers" value="${attr(filters.q)}" data-change="search"></div></div><div class="section-head bank-actions"><p><b>${visible.length}</b> ideas shown${selected.size ? ` · <b>${selected.size}</b> selected` : ""}</p><div class="heading-actions">${selected.size ? `<button class="btn" data-action="clear-selection">Clear</button><button class="btn primary" data-action="plan-selected">Plan & run ${selected.size} selected →</button>` : ""}<button class="btn" data-action="add-idea">Add idea +</button><button class="btn" data-action="restore">Restore preloaded ideas</button></div></div>${adding ? ideaForm(state) : ""}${edit ? ideaForm(state, edit) : ""}<div class="idea-grid">${visible
    .map(
      (i) =>
        `<article class="panel idea ${selected.has(i.id) ? "picked" : ""}"><div class="idea-top"><label class="pick"><input type="checkbox" data-change="pick" value="${attr(i.id)}" ${selected.has(i.id) ? "checked" : ""}><span>#${i.number}</span></label>${badge(c.pillars[i.pillar] || i.pillar, "violet")}${badge(c.formats[i.format]?.label || i.format)}${i.region !== "all" ? badge(`${i.region} only`, "warn") : ""}${i.uses ? badge(`Used ${i.uses}×`, "good") : ""}</div><h3>${esc(i.hook)}</h3>${i.show ? `<p><b>Show</b> ${esc(i.show)}</p>` : ""}${i.angle ? `<p><b>Angle</b> ${esc(i.angle)}</p>` : ""}<div class="idea-foot">${i.keyword ? `<span class="keyword-line">Comment <b>${esc(i.keyword)}</b> · ${esc(state.magnets.find((m) => m.keyword === i.keyword)?.name || "no lead magnet yet")}</span>` : "<span></span>"}<div><button class="btn small" data-action="edit" data-id="${attr(i.id)}">Edit</button><a class="btn small primary" href="#/create?idea=${encodeURIComponent(i.id)}">Create →</a></div></div></article>`,
    )
    .join("") || '<div class="panel empty-state"><p>No ideas match these filters.</p></div>'}</div>`;
}
export async function action(name, el, state) {
  if (name === "tab") return go(`/bank?tab=${el.dataset.tab}`);
  if (name === "filter") {
    filters[el.dataset.key] = el.dataset.value;
    return go(`/bank?tab=ideas`);
  }
  if (name === "add-idea") return go("/bank?tab=ideas&add=1");
  if (name === "add-magnet") return go("/bank?tab=magnets&add=1");
  if (name === "edit") return go(`/bank?tab=ideas&edit=${encodeURIComponent(el.dataset.id)}`);
  if (name === "edit-magnet") return go(`/bank?tab=magnets&edit=${encodeURIComponent(el.dataset.id)}`);
  if (name === "close-form") return go(`/bank?tab=${tab}`);
  if (name === "clear-selection") {
    selected.clear();
    return go(`/bank?tab=ideas`);
  }
  if (name === "archive") {
    await api(`/ideas/${encodeURIComponent(el.dataset.id)}`, { method: "DELETE" });
    ideas = ideas.filter((i) => i.id !== el.dataset.id);
    selected.delete(el.dataset.id);
    toast("Idea removed. Restore preloaded ideas any time.");
    return go("/bank?tab=ideas");
  }
  if (name === "delete-magnet") {
    if (!confirm("Delete this lead magnet? Ideas keep their keyword.")) return;
    state.magnets = (await api(`/magnets/${encodeURIComponent(el.dataset.id)}`, { method: "DELETE" })).magnets;
    return go("/bank?tab=magnets");
  }
  if (name === "restore") {
    await api(`/brands/${encodeURIComponent(state.brand.id)}/ideas/restore`, { method: "POST", body: {} });
    ideas = [];
    await refreshBrand();
    toast("Preloaded ideas and lead magnets restored. Your edits were kept.");
    return go("/bank?tab=ideas&reload=1");
  }
  if (name === "plan-selected") {
    const { plan } = await api(`/brands/${encodeURIComponent(state.brand.id)}/plans`, {
      method: "POST",
      body: { ideaIds: [...selected], run: true, title: `${selected.size} picked ideas` },
    });
    selected.clear();
    toast("Plan created. The engine is writing and designing it now.");
    return go(`/plan?id=${encodeURIComponent(plan.id)}`);
  }
}
export async function change(name, el) {
  if (name === "pick") {
    el.checked ? selected.add(el.value) : selected.delete(el.value);
    return go("/bank?tab=ideas");
  }
  if (name === "search") {
    filters.q = el.value.trim();
    return go("/bank?tab=ideas");
  }
}
export async function submit(name, data, state, form) {
  const values = Object.fromEntries(data);
  if (name === "idea") {
    const ideaId = form.dataset.id;
    const { idea } = await api(ideaId ? `/ideas/${encodeURIComponent(ideaId)}` : `/brands/${encodeURIComponent(state.brand.id)}/ideas`, {
      method: ideaId ? "PUT" : "POST",
      body: values,
    });
    ideas = ideaId ? ideas.map((i) => (i.id === idea.id ? { ...i, ...idea } : i)) : [...ideas, { ...idea, uses: 0 }];
    toast(ideaId ? "Idea saved." : `Idea #${idea.number} added to the bank.`);
    return go("/bank?tab=ideas");
  }
  if (name === "magnet") {
    const magnetId = form.dataset.id;
    state.magnets = (
      await api(magnetId ? `/magnets/${encodeURIComponent(magnetId)}` : `/brands/${encodeURIComponent(state.brand.id)}/magnets`, {
        method: magnetId ? "PUT" : "POST",
        body: { ...values, star: data.has("star") },
      })
    ).magnets;
    toast("Lead magnet saved.");
    return go("/bank?tab=magnets");
  }
}
