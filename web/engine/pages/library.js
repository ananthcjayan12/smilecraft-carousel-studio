import { api } from "../api.js";
import { title } from "../ui.js";
import { contentCard } from "./plan.js";
import { go, keepPolling } from "../app.js";

let items = [],
  format = "all",
  offset = 0;
export async function render(state) {
  const query = format === "all" ? "" : `&format=${format}`;
  const pages = await Promise.all(
    Array.from({ length: offset / 40 + 1 }, (_, i) => api(`/brands/${encodeURIComponent(state.brand.id)}/library?offset=${i * 40}${query}`, { cache: false })),
  );
  items = pages.flatMap((p) => p.items);
  keepPolling(items.some((i) => ["writing", "validating", "generating"].includes(i.status)));
  const tabs = [["all", "Everything"], ...Object.entries(state.catalog.formats).map(([k, v]) => [k, v.label + "s"])];
  return `${title("LIBRARY", "Everything the engine has made.", "Planned and custom pieces, newest first.", '<a class="btn primary" href="#/create">Create custom +</a>')}<div class="section-head"><div class="tabs" role="group" aria-label="Format">${tabs
    .map(([v, label]) => `<button class="${format === v ? "active" : ""}" data-action="format" data-format="${v}">${label}</button>`)
    .join("")}</div></div>${
    items.length
      ? `<div class="content-grid">${items.map((i) => contentCard(i, state, { controls: false })).join("")}</div>${items.length >= offset + 40 ? '<div class="center spaced"><button class="btn" data-action="more">Load more</button></div>' : ""}`
      : '<div class="panel empty-state"><span>▤</span><h2>Nothing here yet.</h2><p>Plan content from the bank or create a custom piece.</p><a class="btn primary" href="#/plan">Plan content →</a></div>'
  }`;
}
export async function action(name, el) {
  if (name === "format") {
    format = el.dataset.format;
    offset = 0;
  }
  if (name === "more") offset += 40;
  go("/library");
}
