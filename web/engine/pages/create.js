import { api } from "../api.js";
import { esc, attr, title, field, area, select, badge } from "../ui.js";
import { go, toast } from "../app.js";

const slugFor = (idea) => {
  if (!idea) return "growth-carousel";
  if (idea.format === "reel") return idea.pillar === "demo" ? "demo-reel" : "text-reel";
  if (idea.format === "post") return /\?|👇|fill in|rate your|tag a/i.test(idea.hook) ? "question-post" : "meme-post";
  if (idea.format === "story") return idea.pillar === "pub" ? "proof-story" : "poll-story";
  return { free: "freebie-carousel", steal: "steal-carousel", rel: "relatable-carousel" }[idea.pillar] || "growth-carousel";
};
const ratioOptions = (state, template) => (state.catalog.formats[template?.format]?.ratios || ["4:5"]).map((r) => [r, r]);

export async function render(state, params) {
  const ideaId = params.get("idea");
  const idea = ideaId ? (await api(`/brands/${encodeURIComponent(state.brand.id)}/ideas`)).ideas.find((i) => i.id === ideaId) : null;
  const readyStyles = state.styles.filter((s) => s.status === "ready" && s.asset_id);
  if (!readyStyles.length)
    return `${title("CREATE", "Start with a style.", "Every post uses a brand style.")}<a class="btn primary" href="#/brand">Set up brand & styles →</a>`;
  const template =
    state.templates.find((t) => t.slug === slugFor(idea) && (!idea || t.format === idea.format)) ||
    state.templates.find((t) => !idea || t.format === idea.format) ||
    state.templates[0];
  const c = state.catalog;
  return `${title(idea ? `IDEA #${idea.number} · ${c.pillars[idea.pillar] || ""}` : "YOUR OWN IDEA", idea ? idea.hook : "Create custom content.", idea ? "Adjust anything below, then write it. The bank idea stays unchanged." : "Write a hook and any instructions. The engine writes, checks and designs it with your brand rules.")}<form class="panel create-content-form" data-form="create">${idea ? `<input type="hidden" name="ideaId" value="${attr(idea.id)}"><div class="idea-summary">${badge(c.formats[idea.format]?.label || idea.format)}${idea.region !== "all" ? badge(`${idea.region} only`, "warn") : ""}${idea.show ? `<p><b>Show</b> ${esc(idea.show)}</p>` : ""}${idea.angle ? `<p><b>Angle</b> ${esc(idea.angle)}</p>` : ""}</div>` : ""}${field(idea ? "Hook (optional change)" : "Hook / topic", "topic", idea ? "" : "", "text", idea ? `Leave empty to use: ${idea.hook}` : "The first line people read.")}<div class="two-col">${select(
    "Template",
    "templateId",
    state.templates.map((t) => [t.id, `${c.formats[t.format]?.label} · ${t.name} (${t.roles.length})`]),
    template?.id,
    'data-change="template"',
  )}${select("Size", "ratio", ratioOptions(state, template), template?.ratio)}</div><div class="two-col">${select(
    "Style",
    "styleId",
    readyStyles.map((s) => [s.id, s.name]),
    template?.style_id || state.brand.brand.defaultStyleId || readyStyles[0].id,
  )}${select("Countries", "region", Object.entries(c.regions), idea?.region || "all")}</div><div class="two-col">${select(
    "Comment keyword",
    "keyword",
    [["", "No keyword"], ...state.magnets.map((m) => [m.keyword, `${m.keyword} · ${m.name}`])],
    idea ? idea.keyword : "DEMO",
  )}${!idea ? select("Pillar", "pillar", [["", "None"], ...Object.entries(c.pillars)], "") : "<span></span>"}</div>${area("Instructions for the writer (optional)", "instructions", "", "Facts to include, things to avoid, the exact message. Numbers you give here may be used; nothing else is invented.", 4)}<label class="check-row"><input type="checkbox" name="auto" checked><span>Approve the copy automatically once it passes the check, then create the artwork.</span></label><div class="form-actions"><a class="btn" href="#/${idea ? "bank" : "plan"}">Cancel</a><button type="submit" class="btn primary">Write it →</button></div></form>`;
}
export function change(name, el, state) {
  if (name === "template") {
    const template = state.templates.find((t) => t.id === el.value),
      ratio = el.form.querySelector("[name=ratio]");
    ratio.innerHTML = ratioOptions(state, template)
      .map(([v]) => `<option value="${attr(v)}" ${v === template?.ratio ? "selected" : ""}>${esc(v)}</option>`)
      .join("");
    if (template?.style_id) el.form.querySelector("[name=styleId]").value = template.style_id;
  }
}
export async function submit(name, data, state) {
  if (name !== "create") return;
  const { item } = await api(`/brands/${encodeURIComponent(state.brand.id)}/content`, {
    method: "POST",
    body: {
      ideaId: data.get("ideaId") || undefined,
      topic: data.get("topic"),
      templateId: data.get("templateId"),
      ratio: data.get("ratio"),
      styleId: data.get("styleId"),
      region: data.get("region"),
      keyword: data.get("keyword"),
      pillar: data.get("pillar") || undefined,
      instructions: data.get("instructions"),
      auto: data.has("auto"),
    },
  });
  toast("Writing your content now.");
  go(`/review?id=${encodeURIComponent(item.id)}`);
}
