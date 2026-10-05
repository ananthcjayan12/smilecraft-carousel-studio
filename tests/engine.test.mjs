import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import sharp from "sharp";
import { createEngineService } from "../server/engine/service.mjs";
import { BANK_IDEAS, BANK_MAGNETS, DEFAULT_TEMPLATES, defaultTemplateSlug } from "../server/engine/defaults.mjs";
import { writingSchema, checkDraft } from "../server/engine/prompts.mjs";

const require = createRequire(import.meta.url);
function openSqlite() {
  try {
    const Database = require("better-sqlite3");
    const db = new Database(":memory:");
    return { exec: (sql) => db.exec(sql), prepare: (sql) => db.prepare(sql), transaction: (fn) => db.transaction(fn) };
  } catch {
    const { DatabaseSync } = require("node:sqlite");
    const db = new DatabaseSync(":memory:");
    return {
      exec: (sql) => db.exec(sql),
      prepare: (sql) => db.prepare(sql),
      transaction: (fn) => (...args) => {
        db.exec("BEGIN");
        try {
          const value = fn(...args);
          db.exec("COMMIT");
          return value;
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
      },
    };
  }
}
const schema =
  (await readFile(new URL("../cloudflare/migrations/0009_srshti_v4.sql", import.meta.url), "utf8")) +
  (await readFile(new URL("../cloudflare/migrations/0011_v4_content_pipeline.sql", import.meta.url), "utf8")) +
  (await readFile(new URL("../cloudflare/migrations/0015_content_engine.sql", import.meta.url), "utf8"));
const png = await sharp({ create: { width: 64, height: 80, channels: 4, background: "#0e7a5b" } }).png().toBuffer();

function d1(sqlite) {
  const statement = (sql, args) => {
    const s = sqlite.prepare(sql);
    return {
      first: async () => s.get(...args) || null,
      all: async () => ({ results: s.all(...args) }),
      run: async () => ({ meta: s.run(...args) }),
      execute: () => ({ meta: s.run(...args) }),
    };
  };
  const DB = { prepare: (sql) => ({ bind: (...args) => statement(sql, args) }) };
  DB.batch = async (list) => sqlite.transaction(() => list.map((s) => s.execute()))();
  return DB;
}
function fakeWriter({ invalidFirst = false } = {}) {
  let validations = 0;
  return async ({ prompt, schema: shape }) => {
    if (shape.properties.valid) {
      validations++;
      return invalidFirst && validations === 1 ? { valid: false, issues: ["Say practice, not clinic."] } : { valid: true, issues: [] };
    }
    const keyword = /"keyword":"([A-Z0-9]*)"/.exec(prompt)?.[1] || "";
    const count = shape.properties.frames.minItems;
    return {
      topic: "Written topic",
      summary: "A short summary.",
      frames: Array.from({ length: count }, (_, i) => ({ heading: `Heading ${i + 1}`, body: `Body ${i + 1}`, visualPrompt: `Visual ${i + 1}` })),
      caption: `Hook line\n\nValue.\n\n${keyword ? `Comment ${keyword} and we'll DM you.` : "Save this."}`,
      dmReply: "Thanks! Here it is: [link]",
      altText: "A slide.",
      hashtags: ["#dentalmarketing", "practice growth"],
      ...(shape.properties.script ? { script: { hook: "Look", shots: [{ shot: "A", onScreen: "B", voiceover: "" }, { shot: "C", onScreen: "", voiceover: "D" }], closing: "Comment", audio: "Calm" } } : {}),
      ...(shape.properties.sticker ? { sticker: { type: "poll", prompt: "Do you post weekly?", options: ["Yes", "Not really"] } } : {}),
    };
  };
}
function fixture(options = {}) {
  const sqlite = openSqlite();
  sqlite.exec(schema);
  const queue = [],
    objects = new Map(),
    renders = [];
  const service = createEngineService({
    db: d1(sqlite),
    capabilities: { local: true, generation: true },
    providerCatalog: async () => ({
      codex: { label: "Codex CLI", available: true, models: [["imagegen", "Codex"]], writingModels: [["gpt-test", "GPT test"]] },
    }),
    enqueue: async (id) => queue.push(id),
    designReference: async (id) => (id === "clinical-white" || id === "premium-charcoal" ? { bytes: png, mime: "image/png" } : null),
    saveImage: async (account, brandId, image) => {
      const key = `${account}/${brandId}/${crypto.randomUUID()}`;
      objects.set(key, { bytes: Buffer.from(image.bytes), mime: image.mime });
      return { mime: image.mime, originalKey: key, previewKey: key, thumbnailKey: key, size: image.bytes.length };
    },
    readImage: async (key) => objects.get(key) || null,
    generateText: options.generateText || fakeWriter(options),
    renderImage: async (input) => {
      renders.push(input);
      if (options.renderFails) throw Error("Provider down.");
      return { bytes: png, mime: "image/png" };
    },
  });
  const call = async (path, method = "GET", body, headers = {}) => {
    const url = new URL("http://engine.test/api/engine" + path);
    try {
      const response = await service.route(new Request(url, { method, body: body === undefined ? undefined : body instanceof Uint8Array ? body : JSON.stringify(body), headers }), "A", url);
      return response.headers.get("content-type")?.includes("json") ? await response.json() : response;
    } catch (error) {
      return { error: error.message, status: error.status };
    }
  };
  const drain = async () => {
    for (let i = 0; i < 400 && queue.length; i++) await service.consume(queue.shift());
  };
  return { sqlite, service, call, drain, queue, renders };
}

test("bootstrap seeds the SmileCraft brand, 100 ideas, 19 lead magnets and the default templates", async () => {
  const f = fixture();
  const boot = await f.call("/bootstrap");
  assert.equal(boot.brand.name, "SmileCraft");
  assert.equal(boot.ideaCount, BANK_IDEAS.length);
  assert.equal(BANK_IDEAS.length, 100);
  assert.equal(boot.magnets.length, BANK_MAGNETS.length);
  assert.equal(boot.templates.length, DEFAULT_TEMPLATES.length);
  assert.ok(boot.brand.profile.rules.some((r) => /practice/.test(r)));
  // A second bootstrap is idempotent.
  const again = await f.call("/bootstrap");
  assert.equal(again.brands.length, 1);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM engine_ideas").get().n, 100);
  // Every keyword in the bank has a lead magnet.
  for (const idea of BANK_IDEAS) assert.ok(BANK_MAGNETS.some((m) => m.keyword === idea.keyword), idea.keyword);
});

test("every idea maps to a template of its own format", () => {
  for (const idea of BANK_IDEAS) {
    const template = DEFAULT_TEMPLATES.find((t) => t.slug === defaultTemplateSlug(idea));
    assert.ok(template, `idea ${idea.n}`);
    assert.equal(template.format, idea.format, `idea ${idea.n}`);
  }
});

test("styles: created from references, uploaded, regenerated, defaulted and protected", async () => {
  const f = fixture();
  const { brand } = await f.call("/bootstrap");
  const b = encodeURIComponent(brand.id);
  const plan = await f.call(`/brands/${b}/plans`, "POST", {});
  assert.match(plan.error, /style/);
  const created = await f.call(`/brands/${b}/styles`, "POST", { referenceIds: ["clinical-white", "premium-charcoal", "not-real"], notes: "bold" });
  assert.equal(created.styles.length, 2);
  await f.drain();
  const boot = await f.call("/bootstrap");
  assert.ok(boot.styles.every((s) => s.status === "ready" && s.asset_id));
  assert.ok(boot.styles.some((s) => s.id === boot.brand.brand.defaultStyleId));
  assert.match(f.renders[0].prompt, /SmileCraft/);
  assert.match(f.renders[0].prompt, /Requested changes.*bold/s);
  // Upload your own template image as a style.
  const upload = await f.call(`/brands/${b}/styles/upload`, "POST", new Uint8Array(png), { "content-type": "image/png", "X-Style-Name": "Mine" });
  assert.equal(upload.styles.length, 3);
  const mine = upload.styles.find((s) => s.name === "Mine");
  assert.equal(mine.status, "ready");
  assert.notEqual(upload.brand.brand.defaultStyleId, mine.id);
  await f.call(`/brands/${b}`, "PUT", { revision: upload.brand.revision, defaultStyleId: mine.id });
  // Regenerating an uploaded style uses the upload as its base and the current board.
  await f.call(`/styles/${encodeURIComponent(mine.id)}/regenerate`, "POST", { notes: "darker" });
  await f.drain();
  const last = f.renders.at(-1);
  assert.equal(last.references.length, 2);
  assert.match(last.prompt, /brand's own template/);
  const removeDefault = await f.call(`/styles/${encodeURIComponent(mine.id)}`, "DELETE");
  assert.match(removeDefault.error, /default/);
  const renamed = await f.call(`/styles/${encodeURIComponent(mine.id)}`, "PUT", { name: "House style" });
  assert.ok(renamed.styles.some((s) => s.name === "House style"));
});

test("a plan picks unused ideas by format, writes, validates, auto-approves and draws every frame", async () => {
  const f = fixture();
  const { brand } = await f.call("/bootstrap");
  const b = encodeURIComponent(brand.id);
  await f.call(`/brands/${b}/styles`, "POST", { referenceIds: ["clinical-white"] });
  await f.drain();
  const { plan } = await f.call(`/brands/${b}/plans`, "POST", { date: "2026-10-06", counts: { carousel: 1, reel: 2, post: 1, story: 2 }, run: true });
  assert.equal(plan.items.length, 6);
  assert.deepEqual(
    plan.items.map((i) => i.format),
    ["carousel", "reel", "reel", "post", "story", "story"],
  );
  assert.equal(plan.items[0].slot.time, "14:00");
  assert.equal(new Set(plan.items.map((i) => i.idea_id)).size, 6);
  await f.drain();
  const done = (await f.call(`/plans/${encodeURIComponent(plan.id)}`)).plan;
  assert.equal(done.status, "ready");
  assert.equal(done.ready, 6);
  for (const item of done.items) {
    assert.equal(item.copy_status, "approved");
    assert.ok(item.frames.every((fr) => fr.assetId && fr.role));
    assert.ok(item.caption.includes(item.keyword));
  }
  const reel = done.items.find((i) => i.format === "reel");
  assert.equal(reel.ratio, "9:16");
  assert.ok(reel.extras.script.shots.length >= 2);
  const story = done.items.find((i) => i.format === "story");
  assert.equal(story.extras.sticker.type, "poll");
  assert.deepEqual(done.items[0].extras.hashtags, ["#dentalmarketing", "#practicegrowth"]);
  // Frame prompts carry the copy, the keyword on the last frame and the vertical safe zones.
  const last = f.renders.filter((r) => r.kind === "frame" && r.contentId === reel.id).sort((a, z) => a.frame.position - z.frame.position).at(-1);
  assert.match(last.prompt, new RegExp(`comment keyword "${reel.keyword}"`));
  assert.match(last.prompt, /top 250 px/);
  assert.deepEqual(last.canvas, [1080, 1920]);
  // The next plan avoids ideas already used.
  const next = (await f.call(`/brands/${b}/plans`, "POST", { counts: { carousel: 2, reel: 0, post: 0, story: 0 } })).plan;
  assert.ok(next.items.every((i) => !done.items.some((d) => d.idea_id === i.idea_id)));
  const approved = await f.call(`/plans/${encodeURIComponent(plan.id)}/approve`, "POST", {});
  assert.equal(approved.plan.status, "approved");
});

test("custom content waits for copy approval; rejected copy is rewritten with the issues; edits re-validate", async () => {
  const f = fixture({ invalidFirst: true });
  const { brand, templates } = await f.call("/bootstrap");
  const b = encodeURIComponent(brand.id);
  await f.call(`/brands/${b}/styles`, "POST", { referenceIds: ["clinical-white"] });
  await f.drain();
  const growth = templates.find((t) => t.slug === "growth-carousel");
  const { item } = await f.call(`/brands/${b}/content`, "POST", { topic: "Why recall texts work", templateId: growth.id, keyword: "reactivate", instructions: "Mention 18 months." });
  assert.equal(item.status, "writing");
  assert.equal(item.keyword, "REACTIVATE");
  await f.drain();
  let current = (await f.call(`/content/${encodeURIComponent(item.id)}`)).item;
  assert.equal(current.copy_status, "rejected");
  assert.equal(current.frames.length, growth.roles.length);
  const rejectedApproval = await f.call(`/content/${encodeURIComponent(item.id)}/approve-copy`, "POST", {});
  assert.match(rejectedApproval.error, /Validate/);
  await f.call(`/content/${encodeURIComponent(item.id)}/write`, "POST", {});
  await f.drain();
  current = (await f.call(`/content/${encodeURIComponent(item.id)}`)).item;
  assert.equal(current.copy_status, "validated");
  assert.equal(current.status, "copy_review");
  await f.call(`/content/${encodeURIComponent(item.id)}/approve-copy`, "POST", {});
  await f.drain();
  current = (await f.call(`/content/${encodeURIComponent(item.id)}`)).item;
  assert.equal(current.status, "ready");
  // Editing one frame clears only that frame's artwork and sends the copy back for checking.
  const frames = current.frames.map((fr, i) => ({ ...fr, heading: i === 1 ? "New heading" : fr.heading }));
  await f.call(`/content/${encodeURIComponent(item.id)}`, "PUT", { revision: current.revision, frames, caption: current.caption });
  current = (await f.call(`/content/${encodeURIComponent(item.id)}`)).item;
  assert.equal(current.status, "validating");
  assert.equal(current.frames.filter((fr) => !fr.assetId).length, 1);
  await f.drain();
  current = (await f.call(`/content/${encodeURIComponent(item.id)}`)).item;
  assert.equal(current.copy_status, "validated");
  await f.call(`/content/${encodeURIComponent(item.id)}/generate`, "POST", {});
  await f.drain();
  current = (await f.call(`/content/${encodeURIComponent(item.id)}`)).item;
  assert.equal(current.status, "ready");
  // Redo one frame with a note.
  const before = current.frames[2].assetId;
  await f.call(`/content/${encodeURIComponent(item.id)}/frames/3/regenerate`, "POST", { note: "bigger keyword" });
  await f.drain();
  current = (await f.call(`/content/${encodeURIComponent(item.id)}`)).item;
  assert.notEqual(current.frames[2].assetId, before);
  assert.match(f.renders.at(-1).prompt, /REQUESTED CHANGE for this frame: bigger keyword/);
  const posted = await f.call(`/content/${encodeURIComponent(item.id)}/posted`, "POST", {});
  assert.ok(posted.item.posted_at);
});

test("templates, ideas and lead magnets are editable and validated", async () => {
  const f = fixture();
  const { brand, templates } = await f.call("/bootstrap");
  const b = encodeURIComponent(brand.id);
  const bad = await f.call(`/brands/${b}/templates`, "POST", { name: "Too long", format: "post", roles: ["A", "B"] });
  assert.match(bad.error, /1 frame/);
  const { template } = await f.call(`/brands/${b}/templates`, "POST", { name: "Myth buster", format: "carousel", ratio: "1:1", roles: "Myth\nFact\nWhy\nComment the keyword", instructions: "Bust one myth." });
  assert.equal(template.roles.length, 4);
  assert.equal(template.ratio, "1:1");
  const copy = await f.call(`/brands/${b}/templates`, "POST", { fromId: templates[0].id });
  assert.equal(copy.template.name, `${templates[0].name} copy`);
  const edited = await f.call(`/templates/${encodeURIComponent(templates[0].id)}`, "PUT", { roles: ["Hook", "Point", "Comment the keyword"] });
  assert.equal(edited.template.roles.length, 3);
  await f.call(`/brands/${b}/templates/reset`, "POST", {});
  const reset = (await f.call(`/brands/${b}/templates`)).templates.find((t) => t.id === templates[0].id);
  assert.equal(reset.roles.length, DEFAULT_TEMPLATES[0].roles.length);
  const { idea } = await f.call(`/brands/${b}/ideas`, "POST", { pillar: "grow", format: "carousel", hook: "Your recall list is gold", keyword: "reactivate!" });
  assert.equal(idea.number, 101);
  assert.equal(idea.keyword, "REACTIVATE");
  await f.call(`/ideas/${encodeURIComponent(idea.id)}`, "DELETE");
  await f.call(`/ideas/${encodeURIComponent(`${brand.id}:idea:1`)}`, "DELETE");
  assert.equal((await f.call(`/brands/${b}/ideas`)).ideas.length, 99);
  await f.call(`/brands/${b}/ideas/restore`, "POST", {});
  assert.equal((await f.call(`/brands/${b}/ideas`)).ideas.length, 100);
  const magnets = await f.call(`/brands/${b}/magnets`, "POST", { keyword: "Tour", name: "Practice tour shot list" });
  assert.ok(magnets.magnets.some((m) => m.keyword === "TOUR"));
  const duplicate = await f.call(`/brands/${b}/magnets`, "POST", { keyword: "TOUR", name: "Again" });
  assert.match(duplicate.error, /already/);
  // Brand edits are revision-checked and keep rules as a list.
  const saved = await f.call(`/brands/${b}`, "PUT", { revision: brand.revision, name: "SmileCraft", primary: "#112233", rules: ["One", "", "Two"] });
  assert.deepEqual(saved.brand.profile.rules, ["One", "Two"]);
  const stale = await f.call(`/brands/${b}`, "PUT", { revision: brand.revision, name: "Old" });
  assert.match(stale.error, /changed/);
});

test("failed artwork is retryable and does not lose the approved copy", async () => {
  const f = fixture({ renderFails: true });
  const { brand, templates } = await f.call("/bootstrap");
  const b = encodeURIComponent(brand.id);
  const upload = await f.call(`/brands/${b}/styles/upload`, "POST", new Uint8Array(png), { "content-type": "image/png" });
  assert.equal(upload.styles.length, 1);
  const post = templates.find((t) => t.slug === "question-post");
  const { item } = await f.call(`/brands/${b}/content`, "POST", { topic: "Rate your Instagram", templateId: post.id, keyword: "AUDIT", auto: true });
  await f.drain();
  const data = await f.call(`/content/${encodeURIComponent(item.id)}`);
  assert.equal(data.item.status, "failed");
  assert.equal(data.item.copy_status, "approved");
  const failed = data.jobs.find((j) => j.kind === "frame" && j.status === "failed");
  assert.ok(failed);
  const retried = await f.call(`/jobs/${encodeURIComponent(failed.id)}/retry`, "POST", {});
  assert.equal(retried.ok, true);
});

test("writing schema and draft checks follow the template", () => {
  const reel = DEFAULT_TEMPLATES.find((t) => t.slug === "text-reel");
  const shape = writingSchema(reel);
  assert.equal(shape.properties.frames.minItems, reel.roles.length);
  assert.ok(shape.properties.script);
  assert.equal(checkDraft({ frames: [], caption: "x" }, reel), "The writer returned the wrong number of frames.");
  const frames = reel.roles.map(() => ({ heading: "H", body: "B", visualPrompt: "V" }));
  assert.match(checkDraft({ frames, caption: "No keyword here", keyword: "DEMO" }, reel), /DEMO/);
  assert.equal(checkDraft({ frames, caption: "Comment DEMO", keyword: "DEMO" }, reel), "");
});

test("cloud worker keeps the Content Engine for the administrator", async () => {
  const { default: worker } = await import("../cloudflare/worker.mjs");
  const config = JSON.parse(await readFile(new URL("../wrangler.json", import.meta.url), "utf8"));
  assert.ok(config.assets.run_worker_first.includes("/engine/*"));
  const env = {
    DB: { prepare: () => ({ bind: () => ({ first: async () => null, all: async () => ({ results: [] }), run: async () => ({ meta: {} }) }) }) },
    APP_ORIGIN: "https://studio.test",
    STATIC: { fetch: async () => new Response("static") },
  };
  const page = await worker.fetch(new Request("https://studio.test/engine/"), env);
  assert.equal(page.status, 302);
  const apiResponse = await worker.fetch(new Request("https://studio.test/api/engine/bootstrap"), env);
  assert.equal(apiResponse.status, 401);
});
