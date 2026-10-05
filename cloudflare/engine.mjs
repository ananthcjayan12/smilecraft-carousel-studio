// Cloud Content Engine: the same D1, private R2, image optimisation and generation queue as the
// hosted studio, with the server's API keys. The engine is the administrator's own marketing tool,
// so it does not draw from client credit balances.
import { createEngineService } from "../server/engine/service.mjs";
import { apiStructured } from "../server/v4/text-api.mjs";
import { cloudLegacyProviderSettings, cloudProviderCatalog, providerImage } from "./v4.mjs";

const fail = (message, status = 409) => Object.assign(Error(message), { status });

export function cloudEngine(env, { viewer = null, isAdmin = false } = {}) {
  return createEngineService({
    viewer: viewer
      ? {
          user: { id: viewer.user_id, email: viewer.email },
          account: { id: viewer.account_id, role: viewer.role },
          csrf: viewer.csrf,
          isAdmin,
        }
      : null,
    db: env.DB,
    providerSettingsAccount: "studio-global",
    legacyProviderSettings: () => cloudLegacyProviderSettings(env),
    providerCatalog: async () => cloudProviderCatalog(env),
    capabilities: { local: false, generation: Boolean(env.OPENAI_API_KEY || env.GEMINI_API_KEY) },
    enqueue: (id) => env.GENERATION.send({ engineJobId: id }),
    async designReference(id) {
      if (!/^[a-z0-9-]+$/.test(id)) return null;
      const response = await env.STATIC.fetch(new Request(`${env.APP_ORIGIN}/assets/design-systems/${id}.png`));
      return response.ok ? { bytes: new Uint8Array(await response.arrayBuffer()), mime: "image/png" } : null;
    },
    async saveImage(account, brandId, image) {
      if (!env.IMAGES) throw fail("Image optimisation is not configured.");
      const prefix = `${account}/engine/${brandId}/${crypto.randomUUID()}`,
        originalKey = `${prefix}/original`,
        previewKey = `${prefix}/preview.webp`,
        thumbnailKey = `${prefix}/thumb.webp`,
        original = new Uint8Array(image.bytes);
      const resize = async (width) =>
        (
          await env.IMAGES.input(new Response(original).body)
            .transform({ width })
            .output({ format: "image/webp", quality: width === 1000 ? 78 : 72 })
        )
          .response()
          .arrayBuffer();
      const [preview, thumb, info] = await Promise.all([resize(1000), resize(400), env.IMAGES.info(new Response(original).body)]);
      await Promise.all([
        env.ASSETS.put(originalKey, original, { httpMetadata: { contentType: image.mime } }),
        env.ASSETS.put(previewKey, preview, { httpMetadata: { contentType: "image/webp" } }),
        env.ASSETS.put(thumbnailKey, thumb, { httpMetadata: { contentType: "image/webp" } }),
      ]);
      return {
        mime: image.mime,
        originalKey,
        previewKey,
        thumbnailKey,
        width: info.width || null,
        height: info.height || null,
        size: original.byteLength,
      };
    },
    async readImage(key) {
      const object = await env.ASSETS.get(key);
      return object ? { bytes: new Uint8Array(await object.arrayBuffer()), mime: object.httpMetadata?.contentType } : null;
    },
    generateText: ({ generation, prompt, schema, reference, signal }) =>
      apiStructured({ ...generation, prompt, schema, reference, signal, env }),
    renderImage: ({ generation, prompt, references, logo, ratio, signal }) =>
      providerImage(env, { prompt, references: [...references, logo].filter(Boolean), ratio, signal, generation }),
  });
}
