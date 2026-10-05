// Local Content Engine: same storage, provider registry and CLI/API adapters as the local studio.
// Codex CLI or Antigravity CLI (agy) write and draw on this computer; API keys in .env also work.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import sharp from "sharp";
import { db, storageRoot } from "../store.mjs";
import { localDb, localProviders } from "../v4/local.mjs";
import { localStructured } from "../v4/text-local.mjs";
import { generateReferenceImage, generateSlideImage, withImageCancellation } from "../image-providers.mjs";
import { withProviderSlot } from "../provider-concurrency.mjs";
import { createEngineService } from "./service.mjs";

const dir = join(storageRoot, "engine-assets"),
  designs = resolve("web", "assets", "design-systems");
await mkdir(dir, { recursive: true });
db.exec(await readFile(new URL("../../cloudflare/migrations/0015_content_engine.sql", import.meta.url), "utf8"));

const agyModel = (provider, model) => (provider === "antigravity" && !/-image$/.test(model) ? model : "");
const dataUrl = (image) =>
  image ? `data:${image.mime || "image/png"};base64,${Buffer.from(image.bytes).toString("base64")}` : "";
const parseData = (value) => {
  const m = /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/.exec(value || "");
  if (!m) throw Error("Provider returned no image.");
  return { bytes: Buffer.from(m[2], "base64"), mime: m[1] };
};

let service,
  active = 0;
const pending = [];
function pump() {
  while (pending.length && active < 5) {
    const jobId = pending.shift();
    active++;
    setTimeout(
      () =>
        service
          .consume(jobId)
          .catch((e) => console.error("Engine job failed", e.message))
          .finally(() => {
            active--;
            pump();
          }),
      0,
    );
  }
}

service = createEngineService({
  viewer: { user: { email: "Local workspace" }, account: { id: "local", role: "owner" }, csrf: "", isAdmin: true },
  db: localDb,
  capabilities: {
    local: true,
    get generation() {
      try {
        localProviders.requireReady();
        return true;
      } catch {
        return false;
      }
    },
  },
  providerCatalog: async (refresh) => (await localProviders.status({ refresh })).providers,
  snapshotGeneration: () => localProviders.selected(),
  enqueue: async (jobId) => {
    pending.push(jobId);
    pump();
  },
  async designReference(id) {
    if (!/^[a-z0-9-]+$/.test(id)) return null;
    try {
      return { bytes: await readFile(join(designs, `${id}.png`)), mime: "image/png" };
    } catch {
      return null;
    }
  },
  async saveImage(account, brandId, image) {
    const bytes = Buffer.from(image.bytes),
      key = join(dir, crypto.randomUUID()),
      meta = await sharp(bytes).metadata();
    const originalKey = key + (image.mime === "image/jpeg" ? ".jpg" : image.mime === "image/webp" ? ".webp" : ".png"),
      previewKey = key + "-preview.webp",
      thumbnailKey = key + "-thumb.webp";
    await Promise.all([
      writeFile(originalKey, bytes),
      sharp(bytes).resize({ width: 1000, withoutEnlargement: true }).webp({ quality: 78 }).toFile(previewKey),
      sharp(bytes).resize({ width: 400, withoutEnlargement: true }).webp({ quality: 72 }).toFile(thumbnailKey),
    ]);
    return { mime: image.mime, originalKey, previewKey, thumbnailKey, width: meta.width, height: meta.height, size: bytes.length };
  },
  async readImage(key) {
    try {
      return {
        bytes: await readFile(key),
        mime: key.endsWith(".webp") ? "image/webp" : key.endsWith(".jpg") ? "image/jpeg" : "image/png",
      };
    } catch {
      return null;
    }
  },
  async generateText({ generation, prompt, schema, reference, signal }) {
    return withProviderSlot(
      generation.provider,
      () => localStructured({ ...generation, prompt, schema, reference, signal }),
      "text",
    );
  },
  async renderImage({ kind, generation, prompt, references, logo, ratio, canvas, frame, signal, jobId, contentId }) {
    const { provider, model } = localProviders.requireReady(generation);
    if (kind === "style")
      return parseData(
        await withProviderSlot(provider, () =>
          generateReferenceImage({
            ...generation,
            provider,
            model,
            agyModel: agyModel(provider, model),
            prompt,
            referenceImages: references.map(dataUrl),
            logoImage: dataUrl(logo),
            signal,
          }),
        ),
      );
    const result = parseData(
      await withProviderSlot(provider, () =>
        withImageCancellation(
          signal,
          () => {
            signal?.throwIfAborted();
            return generateSlideImage({
              ...generation,
              provider,
              model,
              contentId,
              jobId,
              prompt,
              slide: { approved: true, role: frame.role, heading: frame.heading, body: frame.body, visualPrompt: frame.visualPrompt },
              slideNumber: frame.position,
              contextSnapshot: { businessPack: { id: "engine", name: "Content Engine" }, brand: {}, profile: {} },
              aspectRatio: ratio,
              brand: {},
              logoImage: dataUrl(logo),
              referenceImage: dataUrl(references[0]),
              workDir: storageRoot,
            });
          },
          { agyModel: agyModel(provider, model) },
        ),
      ),
    );
    const [width, height] = canvas;
    return {
      bytes: await sharp(result.bytes).resize(width, height, { fit: "contain", background: "#ffffff" }).png().toBuffer(),
      mime: "image/png",
    };
  },
});

export const localEngine = service;
await service.recover();
