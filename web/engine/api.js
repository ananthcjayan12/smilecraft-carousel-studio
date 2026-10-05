// Content Engine API client: same-origin JSON with a short GET cache, like the studio client.
let csrf = "";
const cache = new Map();
export const setCsrf = (value) => (csrf = value || "");
export const clearCache = () => cache.clear();
export async function api(path, { method = "GET", body, raw = false, headers = {}, cache: useCache = true } = {}) {
  const url = path.startsWith("/api/") ? path : `/api/engine${path}`;
  const saved = cache.get(url);
  if (method === "GET" && useCache && saved && saved.expires > Date.now()) return structuredClone(saved.value);
  if (method !== "GET") cache.clear();
  const sent = { ...headers };
  if (body !== undefined && !raw) sent["Content-Type"] = "application/json";
  if (raw) sent["Content-Type"] = body.type;
  if (csrf && method !== "GET") sent["X-CSRF-Token"] = csrf;
  const response = await fetch(url, {
    method,
    headers: sent,
    body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
    credentials: "same-origin",
  });
  if (response.status === 401) {
    location.href = "/login";
    throw Object.assign(Error("Sign in to continue."), { status: 401 });
  }
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(Error(value.error || "Please try again."), { status: response.status });
  if (method === "GET") cache.set(url, { value, expires: Date.now() + 8000 });
  return structuredClone(value);
}
export const image = (id, variant = "preview") => (id ? `/api/engine/assets/${encodeURIComponent(id)}/${variant}` : "");
