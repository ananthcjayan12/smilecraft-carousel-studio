import { api } from "../api.js";
import { imageOptions } from "../../image-options.js";
import { esc, title, badge } from "../ui.js";
import { go, toast, refreshBrand } from "../app.js";

const TASKS = { writing: "Content writing", validation: "Copy validation", style: "Style creation", artwork: "Artwork generation" };
const kindOf = (task) => (["style", "artwork"].includes(task) ? "models" : "writingModels");
let config = null;
function output(task, selected) {
  const option = imageOptions(selected.provider, selected.model);
  return option
    ? `<label class="field">${option.label}<select name="${task}-${option.key}">${option.values.map((v) => `<option value="${v}" ${(selected[option.key] || option.defaultValue) === v ? "selected" : ""}>${v}</option>`).join("")}</select></label>`
    : "";
}
export async function render(state, params) {
  // The mapping is shared with the client studio, so both apps use the same providers and models.
  config = await api("/api/v4/providers" + (params.get("refresh") ? "?refresh=1" : ""), { cache: false });
  const local = state.capabilities.local;
  return `${title("AI SETTINGS", "Who writes and who draws.", local ? "Local: Codex CLI or Antigravity CLI (agy) on this computer, or API keys from .env." : "Cloud: the server's OpenAI, Gemini and Claude API keys.")}<div class="settings-grid"><section class="panel provider-panel"><h2>Provider for each task</h2><p class="muted small-copy">Shared with the client studio. Running tasks keep the model they started with.</p><form data-form="providers">${Object.entries(TASKS)
    .map(([task, label]) => {
      const selected = config.tasks[task],
        kind = kindOf(task);
      return `<fieldset><legend>${label}</legend><div class="two-col"><label class="field">Provider<select name="${task}-provider" data-task="${task}" data-change="provider">${Object.entries(config.providers)
        .map(([id, p]) => `<option value="${esc(id)}" ${selected.provider === id ? "selected" : ""} ${!p.available || !p[kind]?.length ? "disabled" : ""}>${esc(p.label)}${p.available && p[kind]?.length ? "" : " · unavailable"}</option>`)
        .join("")}</select></label><label class="field">Model<select name="${task}-model" data-task="${task}" data-change="model">${(config.providers[selected.provider]?.[kind] || [])
        .map(([id, label]) => `<option value="${esc(id)}" ${selected.model === id ? "selected" : ""}>${esc(label)}</option>`)
        .join("")}</select></label></div><div data-output="${task}">${kind === "models" ? output(task, selected) : ""}</div></fieldset>`;
    })
    .join("")}<button class="btn primary spaced" type="submit">Save</button></form><button class="btn spaced" data-action="refresh">Refresh availability ↻</button></section><section class="panel"><h2>Providers</h2>${Object.values(config.providers)
    .map((p) => `<p><b>${esc(p.label)}</b> ${badge(p.available ? "Available" : "Unavailable", p.available ? "good" : "warn")}<br><span class="muted small-copy">${esc(p.detail || "")}</span></p>`)
    .join("")}<p class="muted small-copy">${local ? "Sign in with codex login, or install and sign in to agy, then refresh. Add OPENAI_API_KEY, GEMINI_API_KEY or ANTHROPIC_API_KEY to .env to use APIs locally." : "Add API keys as Worker secrets through the deployment workflow."}</p></section></div>`;
}
export async function action(name) {
  if (name === "refresh") {
    await refreshBrand();
    toast("Availability refreshed.");
    go("/settings?refresh=1");
  }
}
export function change(name, el) {
  const task = el.dataset.task,
    kind = kindOf(task),
    form = el.form;
  if (name === "provider") {
    const models = config.providers[el.value]?.[kind] || [];
    form.querySelector(`[name="${task}-model"]`).innerHTML = models.map(([id, label]) => `<option value="${esc(id)}">${esc(label)}</option>`).join("");
  }
  if (kind === "models")
    form.querySelector(`[data-output="${task}"]`).innerHTML = output(task, {
      provider: form.querySelector(`[name="${task}-provider"]`).value,
      model: form.querySelector(`[name="${task}-model"]`).value,
    });
}
export async function submit(name, data) {
  if (name !== "providers") return;
  const tasks = Object.fromEntries(
    Object.keys(TASKS).map((task) => [
      task,
      {
        provider: data.get(`${task}-provider`),
        model: data.get(`${task}-model`),
        ...Object.fromEntries(["quality", "imageSize"].filter((k) => data.has(`${task}-${k}`)).map((k) => [k, data.get(`${task}-${k}`)])),
      },
    ]),
  );
  config = await api("/api/v4/providers", { method: "PUT", body: { tasks } });
  await refreshBrand();
  toast("AI settings saved.");
  go("/settings");
}
