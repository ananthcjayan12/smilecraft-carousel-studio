import { api, setCsrf } from "./api.js";
import { shell, esc } from "./ui.js";
import * as plan from "./pages/plan.js";
import * as bank from "./pages/bank.js";
import * as create from "./pages/create.js";
import * as review from "./pages/review.js";
import * as library from "./pages/library.js";
import * as brand from "./pages/brand.js";
import * as templates from "./pages/templates.js";
import * as settings from "./pages/settings.js";

const app = document.querySelector("#app");
const pages = { plan, bank, create, review, library, brand, templates, settings };
export const state = { me: null, brand: null, styles: [], templates: [], magnets: [], jobs: [], catalog: null, capabilities: {}, busy: false };
let renderToken = 0,
  poll = null;

export function toast(message, error = false) {
  const el = document.querySelector("#toast");
  el.textContent = message;
  el.className = `visible ${error ? "error" : ""}`;
  clearTimeout(el.timer);
  el.timer = setTimeout(() => (el.className = ""), 6000);
}
export const route = () => location.hash.slice(1) || "/plan";
export function go(next) {
  if (location.hash === `#${next}`) render();
  else location.hash = next;
}
export async function refreshBrand() {
  const data = await api(`/bootstrap?brand=${encodeURIComponent(state.brand?.id || "")}`, { cache: false });
  Object.assign(state, {
    me: data.me || state.me,
    brand: data.brand,
    styles: data.styles,
    templates: data.templates,
    magnets: data.magnets,
    jobs: data.jobs,
    catalog: data.catalog,
    capabilities: data.capabilities,
    ideaCount: data.ideaCount,
  });
  return data;
}
// Pages report whether background work is running so the view refreshes until it settles.
export function keepPolling(active) {
  clearTimeout(poll);
  if (!active) return;
  poll = setTimeout(() => {
    if (document.hidden) return keepPolling(true);
    render({ fresh: true });
  }, 2500);
}
export async function render({ fresh = false } = {}) {
  const token = ++renderToken,
    current = route(),
    [path, query = ""] = current.split("?"),
    name = path.split("/")[1] || "plan",
    page = pages[name] || pages.plan;
  clearTimeout(poll);
  try {
    const html = await page.render(state, new URLSearchParams(query), { fresh });
    if (token !== renderToken) return;
    const full = shell(state, current, html);
    const focus = document.activeElement;
    const editing =
      current === app.dataset.route &&
      ((focus && focus.matches("input,textarea,select") && app.contains(focus)) || app.querySelector("form[data-dirty=true]"));
    if (!editing || !fresh) {
      app.innerHTML = full;
      app.dataset.route = current;
      page.mounted?.(state, new URLSearchParams(query));
    } else keepPolling(true);
  } catch (error) {
    if (token !== renderToken) return;
    toast(error.message, true);
    if (!app.dataset.route)
      app.innerHTML = `<div class="boot"><h1>We couldn’t open the Content Engine.</h1><p>${esc(error.message)}</p><button class="btn primary" data-action="reload">Try again</button></div>`;
    console.error(error);
  }
}
async function act(handler, element) {
  if (state.busy) return;
  state.busy = true;
  const button = element?.tagName === "BUTTON",
    old = button ? element.textContent : "";
  if (button) {
    element.disabled = true;
    element.setAttribute("aria-busy", "true");
  }
  try {
    await handler();
  } catch (e) {
    toast(e.message, true);
  } finally {
    state.busy = false;
    if (button && element.isConnected) {
      element.disabled = false;
      element.removeAttribute("aria-busy");
      if (old) element.textContent = old;
    }
  }
}
const currentPage = () => pages[route().split("?")[0].split("/")[1]] || pages.plan;
app.addEventListener("click", (event) => {
  const el = event.target.closest("[data-action]");
  if (!el) return;
  event.preventDefault();
  const action = el.dataset.action;
  if (action === "reload") return location.reload();
  if (action === "dismiss-error") {
    let dismissed = [];
    try {
      dismissed = JSON.parse(sessionStorage.getItem("engine-dismissed") || "[]");
    } catch {}
    dismissed.push(el.dataset.id);
    sessionStorage.setItem("engine-dismissed", JSON.stringify(dismissed));
    el.closest(".notice")?.remove();
    return;
  }
  if (action === "retry")
    return act(async () => {
      await api(`/jobs/${el.dataset.id}/retry`, { method: "POST", body: {} });
      toast("Task queued again.");
      render({ fresh: true });
    }, el);
  const page = currentPage();
  if (page.action) act(() => page.action(action, el, state, event), el);
});
app.addEventListener("input", (event) => {
  const form = event.target.closest("form");
  if (form) form.dataset.dirty = "true";
});
app.addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.target;
  if (!form.matches("[data-form]")) return;
  const page = currentPage();
  if (page.submit)
    act(async () => {
      await page.submit(form.dataset.form, new FormData(form), state, form);
      delete form.dataset.dirty;
    }, form.querySelector("button[type=submit]"));
});
app.addEventListener("change", (event) => {
  const el = event.target;
  if (!el.matches("[data-change]")) return;
  const page = currentPage();
  if (page.change) act(() => page.change(el.dataset.change, el, state), el);
});
window.addEventListener("hashchange", () => {
  window.scrollTo(0, 0);
  render();
});
window.addEventListener("visibilitychange", () => {
  if (!document.hidden) render({ fresh: true });
});
(async () => {
  try {
    await refreshBrand();
    setCsrf(state.me?.csrf);
  } catch (e) {
    app.innerHTML = `<div class="boot"><h1>We couldn’t open the Content Engine.</h1><p>${esc(e.message)}</p><a class="btn primary" href="/login">Sign in</a></div>`;
    return;
  }
  render();
})();
