// Content Engine service: brand, styles, templates, content bank, plans and the
// write → validate → approve → artwork pipeline. Platform-agnostic: the local Node server
// (Codex/agy CLIs or API keys) and the Cloudflare Worker (API keys) supply `platform`.
import { DESIGN_SYSTEMS } from "../../web/design-systems.js";
import {
  BANK_IDEAS,
  BANK_MAGNETS,
  BANK_PILLARS,
  CANVAS,
  DAILY_SLOTS,
  DEFAULT_BRAND,
  DEFAULT_TEMPLATES,
  FORMATS,
  FORMULA,
  REGIONS,
  defaultTemplateSlug,
} from "./defaults.mjs";
import {
  TASKS,
  artworkPrompt,
  checkDraft,
  contentContext,
  stylePrompt,
  validationPrompt,
  validationSchema,
  writingPrompt,
  writingSchema,
} from "./prompts.mjs";

const now = () => new Date().toISOString(),
  id = () => crypto.randomUUID();
const parse = (value, fallback = {}) => {
  try {
    return JSON.parse(value) ?? fallback;
  } catch {
    return fallback;
  }
};
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const text = (v, max = 200) =>
  String(v ?? "")
    .trim()
    .slice(0, max);
const keywordOf = (v) =>
  String(v ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 24);
const hex = (v) => /^#[0-9a-f]{6}$/i.test(v || "");
const WORKING = ["writing", "validating", "generating"];
const IMAGE_TASKS = ["style", "artwork"];

const viewBrand = (r) => r && { ...r, profile: parse(r.profile_json), brand: parse(r.brand_json) };
const viewTemplate = (r) =>
  r && {
    id: r.id,
    brand_id: r.brand_id,
    slug: r.slug,
    name: r.name,
    format: r.format,
    ratio: r.ratio,
    roles: parse(r.roles_json, []),
    instructions: r.instructions,
    visual: r.visual,
    style_id: r.style_id || "",
    position: r.position,
    archived: Boolean(r.archived),
  };
const viewContent = (r) =>
  r && {
    ...r,
    slot: parse(r.slot_json),
    brief: parse(r.brief_json),
    frames: parse(r.frames_json, []),
    extras: parse(r.extras_json),
    validation: parse(r.validation_json),
    auto_artwork: Boolean(r.auto_artwork),
  };
const viewIdea = (r) => r && { ...r, archived: Boolean(r.archived) };

export function createEngineService(platform) {
  const db = platform.db,
    controllers = new Map();
  const first = (sql, ...args) =>
      db
        .prepare(sql)
        .bind(...args)
        .first(),
    all = async (sql, ...args) =>
      (
        await db
          .prepare(sql)
          .bind(...args)
          .all()
      ).results,
    run = (sql, ...args) =>
      db
        .prepare(sql)
        .bind(...args)
        .run();
  async function batch(statements) {
    if (!statements.length) return [];
    if (db.batch) return db.batch(statements.map(([sql, ...args]) => db.prepare(sql).bind(...args)));
    const results = [];
    for (const [sql, ...args] of statements) results.push(await run(sql, ...args));
    return results;
  }

  // ---------- provider choices (shared with the studio's Settings → Providers) ----------
  async function providerSettings(account, refresh = false) {
    const catalog = platform.providerCatalog ? await platform.providerCatalog(refresh) : {};
    const storedRow = await first(
      "SELECT tasks_json FROM v4_provider_settings WHERE account_id=?",
      platform.providerSettingsAccount || account,
    );
    const stored = parse((storedRow || (await platform.legacyProviderSettings?.()))?.tasks_json);
    const legacy = platform.snapshotGeneration?.();
    const tasks = {};
    for (const task of Object.keys(TASKS)) {
      const kind = IMAGE_TASKS.includes(task) ? "models" : "writingModels";
      const preferred =
        legacy &&
        catalog[legacy.provider]?.available &&
        catalog[legacy.provider]?.[kind]?.some(([m]) => m === legacy.model)
          ? legacy
          : null;
      const provider =
        preferred?.provider ||
        Object.keys(catalog).find((p) => catalog[p].available && catalog[p][kind]?.length) ||
        Object.keys(catalog).find((p) => catalog[p][kind]?.length) ||
        "openai";
      tasks[task] = stored[task] || preferred || { provider, model: catalog[provider]?.[kind]?.[0]?.[0] || "" };
    }
    return { tasks, providers: catalog };
  }
  async function taskChoice(account, task) {
    const settings = await providerSettings(account),
      choice = settings.tasks[task],
      entry = settings.providers[choice.provider],
      models = entry?.[IMAGE_TASKS.includes(task) ? "models" : "writingModels"];
    if (!entry?.available)
      throw fail(
        `${entry?.label || choice.provider} is unavailable for ${TASKS[task]}. Choose an available provider in Settings.`,
      );
    if (!models?.some(([m]) => m === choice.model) && !(choice.provider === "antigravity" && !entry.modelsLoaded))
      throw fail(`Choose a supported model for ${TASKS[task]} in Settings.`);
    return { ...choice };
  }

  // ---------- lookups ----------
  async function brand(account, brandId) {
    const b = viewBrand(await first("SELECT * FROM engine_brands WHERE account_id=? AND id=?", account, brandId));
    if (!b) throw fail("Brand not found.", 404);
    return b;
  }
  async function content(account, itemId) {
    const c = viewContent(await first("SELECT * FROM engine_content WHERE account_id=? AND id=?", account, itemId));
    if (!c) throw fail("Content not found.", 404);
    return c;
  }
  async function templateFor(account, brandId, templateId) {
    const t = viewTemplate(
      await first(
        "SELECT * FROM engine_templates WHERE account_id=? AND brand_id=? AND id=?",
        account,
        brandId,
        templateId,
      ),
    );
    if (!t) throw fail("Template not found.", 404);
    return t;
  }
  async function readyStyle(account, brandId, styleId) {
    const s = await first(
      "SELECT * FROM engine_styles WHERE id=? AND account_id=? AND brand_id=? AND status='ready' AND asset_id IS NOT NULL",
      styleId || "",
      account,
      brandId,
    );
    if (!s) throw fail("Choose a ready style. Create or upload one in Brand & styles.");
    return s;
  }
  async function assetImage(account, assetId) {
    if (!assetId) return null;
    const asset = await first("SELECT * FROM v4_assets WHERE id=? AND account_id=?", assetId, account);
    return asset ? platform.readImage(asset.original_key) : null;
  }
  const styles = (account, brandId) =>
    all(
      "SELECT id,name,reference_id,notes,asset_id,status,created_at FROM engine_styles WHERE account_id=? AND brand_id=? AND status!='deleted' ORDER BY created_at",
      account,
      brandId,
    );
  const templates = async (account, brandId, includeArchived = false) =>
    (
      await all(
        `SELECT * FROM engine_templates WHERE account_id=? AND brand_id=? ${includeArchived ? "" : "AND archived=0"} ORDER BY position,created_at`,
        account,
        brandId,
      )
    ).map(viewTemplate);
  const magnets = (account, brandId) =>
    all(
      "SELECT * FROM engine_magnets WHERE account_id=? AND brand_id=? ORDER BY star DESC,keyword",
      account,
      brandId,
    );
  const brandJobs = (account, brandId) =>
    all(
      "SELECT id,kind,status,progress,error,content_id,plan_id FROM engine_jobs WHERE account_id=? AND brand_id=? AND kind='style' AND status!='succeeded' ORDER BY created_at DESC LIMIT 20",
      account,
      brandId,
    );

  // ---------- seeding ----------
  function seedStatements(account, brandId, at) {
    const statements = [];
    DEFAULT_TEMPLATES.forEach((t, position) =>
      statements.push([
        "INSERT OR IGNORE INTO engine_templates(id,account_id,brand_id,slug,name,format,ratio,roles_json,instructions,visual,position,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
        `${brandId}:tpl:${t.slug}`,
        account,
        brandId,
        t.slug,
        t.name,
        t.format,
        t.ratio,
        JSON.stringify(t.roles),
        t.instructions,
        t.visual,
        position,
        at,
        at,
      ]),
    );
    for (const i of BANK_IDEAS)
      statements.push([
        "INSERT OR IGNORE INTO engine_ideas(id,account_id,brand_id,number,pillar,format,region,hook,show,angle,keyword,source,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,'bank',?,?)",
        `${brandId}:idea:${i.n}`,
        account,
        brandId,
        i.n,
        i.pillar,
        i.format,
        i.region,
        i.hook,
        i.show,
        i.angle,
        i.keyword,
        at,
        at,
      ]);
    for (const m of BANK_MAGNETS)
      statements.push([
        "INSERT OR IGNORE INTO engine_magnets(id,account_id,brand_id,keyword,name,description,how,star,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
        `${brandId}:mag:${m.keyword}`,
        account,
        brandId,
        m.keyword,
        m.name,
        m.description,
        m.how,
        m.star ? 1 : 0,
        at,
      ]);
    return statements;
  }
  async function ensureBrand(account) {
    const existing = await all("SELECT * FROM engine_brands WHERE account_id=? ORDER BY created_at", account);
    if (existing.length) return existing.map(viewBrand);
    const brandId = `${account}:brand`,
      at = now();
    await batch([
      [
        "INSERT OR IGNORE INTO engine_brands(id,account_id,name,profile_json,brand_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
        brandId,
        account,
        DEFAULT_BRAND.name,
        JSON.stringify(DEFAULT_BRAND.profile),
        JSON.stringify(DEFAULT_BRAND.brand),
        at,
        at,
      ],
      ...seedStatements(account, brandId, at),
    ]);
    return (await all("SELECT * FROM engine_brands WHERE account_id=? ORDER BY created_at", account)).map(viewBrand);
  }

  // ---------- jobs ----------
  async function job(account, brandId, kind, input, { planId = null, contentId = null, priority = 1, key = id() } = {}) {
    const existing = await first("SELECT * FROM engine_jobs WHERE account_id=? AND request_key=?", account, key);
    if (existing && !["cancelled", "failed"].includes(existing.status)) return existing;
    if (existing) key = `${key}:${id()}`;
    const task = kind === "frame" ? "artwork" : kind;
    const generation = Object.hasOwn(TASKS, task) ? await taskChoice(account, task) : undefined;
    const validationGeneration = kind === "writing" ? await taskChoice(account, "validation") : undefined;
    const jobId = id();
    await run(
      "INSERT INTO engine_jobs(id,account_id,brand_id,plan_id,content_id,kind,priority,input_json,created_at,request_key) VALUES(?,?,?,?,?,?,?,?,?,?)",
      jobId,
      account,
      brandId,
      planId,
      contentId,
      kind,
      priority,
      JSON.stringify({ ...input, ...(generation ? { generation } : {}), ...(validationGeneration ? { validationGeneration } : {}) }),
      now(),
      key,
    );
    try {
      await platform.enqueue(jobId);
    } catch {
      await run("UPDATE engine_jobs SET status='failed',error=? WHERE id=?", "Could not queue work. Retry this task.", jobId);
    }
    return first("SELECT * FROM engine_jobs WHERE id=?", jobId);
  }
  async function saveAsset(account, brandId, image) {
    const saved = await platform.saveImage(account, brandId, image),
      assetId = id();
    await run(
      "INSERT INTO v4_assets(id,account_id,clinic_id,mime,original_key,preview_key,thumbnail_key,width,height,size,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
      assetId,
      account,
      brandId,
      saved.mime,
      saved.originalKey,
      saved.previewKey,
      saved.thumbnailKey,
      saved.width || null,
      saved.height || null,
      saved.size,
      now(),
    );
    return assetId;
  }

  // ---------- content pipeline ----------
  async function newItem(account, b, input, planning = null) {
    const idea = input.idea || null;
    let template;
    if (input.templateId) template = await templateFor(account, b.id, input.templateId);
    else {
      const list = planning?.templates || (await templates(account, b.id));
      const slug = defaultTemplateSlug({ ...(idea || {}), format: input.format || idea?.format || "carousel" });
      template = list.find((t) => t.slug === slug) || list.find((t) => t.format === (input.format || idea?.format));
      if (!template) throw fail("No template is available for this format. Add one in Templates.");
    }
    if (template.archived) throw fail("This template is archived. Choose another template.");
    const readyIds = planning?.styleIds;
    const styleId =
      text(input.styleId, 100) ||
      template.style_id ||
      b.brand.defaultStyleId ||
      (readyIds ? [...readyIds][0] : (await styles(account, b.id)).find((s) => s.status === "ready")?.id) ||
      "";
    if (readyIds ? !readyIds.has(styleId) : !(await readyStyle(account, b.id, styleId)))
      throw fail("Choose a ready style. Create or upload one in Brand & styles.");
    const region = REGIONS[input.region] ? input.region : idea?.region || "all";
    const ratio = FORMATS[template.format].ratios.includes(input.ratio) ? input.ratio : template.ratio;
    const keyword = input.keyword !== undefined ? keywordOf(input.keyword) : keywordOf(idea?.keyword);
    const topic = text(input.topic, 300) || idea?.hook || "";
    if (!topic) throw fail("Enter a topic or hook.");
    const itemId = id(),
      at = now();
    const brief = {
      origin: idea ? "bank" : "custom",
      ideaNumber: idea?.number || null,
      pillar: idea?.pillar || text(input.pillar, 40) || "",
      hook: idea?.hook || topic,
      show: idea?.show || "",
      angle: idea?.angle || "",
      instructions: text(input.instructions, 4000),
    };
    const statement = [
      "INSERT INTO engine_content(id,account_id,brand_id,plan_id,position,slot_json,idea_id,template_id,style_id,format,ratio,region,keyword,topic,brief_json,auto_artwork,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'planned',?,?)",
      itemId,
      account,
      b.id,
      input.planId || null,
      input.position || 0,
      JSON.stringify(input.slot || {}),
      idea?.id || null,
      template.id,
      styleId,
      template.format,
      ratio,
      region,
      keyword,
      topic,
      JSON.stringify(brief),
      input.auto ? 1 : 0,
      at,
      at,
    ];
    if (planning) {
      planning.writes.push(statement);
      return { id: itemId };
    }
    await run(...statement);
    return content(account, itemId);
  }
  async function writeItem(account, item, { autoArtwork = item.auto_artwork } = {}) {
    if (WORKING.includes(item.status)) throw fail("Wait for the current task to finish or cancel it.");
    await Promise.all([
      readyStyle(account, item.brand_id, item.style_id),
      templateFor(account, item.brand_id, item.template_id),
      taskChoice(account, "writing"),
      taskChoice(account, "validation"),
    ]);
    const revision = item.revision + 1;
    const updated = await run(
      "UPDATE engine_content SET status='writing',copy_status='draft',validation_json=?,frames_json='[]',caption='',extras_json='{}',auto_artwork=?,revision=?,updated_at=? WHERE id=? AND account_id=? AND revision=?",
      JSON.stringify(item.copy_status === "rejected" ? { issues: item.validation.issues || [] } : {}),
      autoArtwork ? 1 : 0,
      revision,
      now(),
      item.id,
      account,
      item.revision,
    );
    if (!updated.meta.changes) throw fail("Content changed. Reload before writing.", 409);
    await job(
      account,
      item.brand_id,
      "writing",
      { revision, corrections: item.copy_status === "rejected" ? item.validation.issues || [] : [], autoArtwork: Boolean(autoArtwork) },
      { contentId: item.id, planId: item.plan_id, priority: item.position === 0 ? 0 : 1, key: `writing:${item.id}:${revision}` },
    );
  }
  async function queueItem(account, item, priority = 1) {
    if (item.copy_status !== "approved") throw fail("Approve the copy before creating artwork.");
    const template = await templateFor(account, item.brand_id, item.template_id);
    await Promise.all([readyStyle(account, item.brand_id, item.style_id), taskChoice(account, "artwork")]);
    const problem = checkDraft(item, template);
    if (problem) throw fail(problem);
    if (item.frames.every((f) => f.assetId)) {
      await run("UPDATE engine_content SET status='ready',updated_at=? WHERE id=? AND account_id=?", now(), item.id, account);
      return;
    }
    await run("UPDATE engine_content SET status='generating',updated_at=? WHERE id=? AND account_id=?", now(), item.id, account);
    await Promise.all(
      item.frames
        .filter((f) => !f.assetId)
        .map((f) =>
          job(
            account,
            item.brand_id,
            "frame",
            { position: f.position, revision: item.revision },
            {
              contentId: item.id,
              planId: item.plan_id,
              priority,
              key: `frame:${item.id}:${item.revision}:${f.position}:${f.attempt || 0}`,
            },
          ),
        ),
    );
  }
  async function approveCopy(account, item) {
    if (item.copy_status !== "validated" || !item.validation.valid)
      throw fail("Validate the draft before approving its copy.");
    await taskChoice(account, "artwork");
    const updated = await run(
      "UPDATE engine_content SET copy_status='approved',updated_at=? WHERE id=? AND account_id=? AND revision=? AND copy_status='validated'",
      now(),
      item.id,
      account,
      item.revision,
    );
    if (!updated.meta.changes) throw fail("Content changed. Reload before approving.", 409);
    await queueItem(account, await content(account, item.id), item.position === 0 ? 0 : 1);
  }
  async function approveItem(account, itemId) {
    const item = await content(account, itemId);
    if (!item.frames.length || !item.frames.every((f) => f.assetId)) throw fail("Wait for all artwork before approving.");
    await run(
      "UPDATE engine_content SET status='approved',updated_at=? WHERE id=? AND account_id=?",
      now(),
      itemId,
      account,
    );
    return content(account, itemId);
  }
  async function cancelJobs(account, where, ...args) {
    const cancelled = (
      await db
        .prepare(
          `UPDATE engine_jobs SET status='cancelled',request_key=request_key||':cancelled:'||id,error='Generation cancelled.',finished_at=? WHERE account_id=? AND ${where} AND status IN ('queued','running') RETURNING *`,
        )
        .bind(now(), account, ...args)
        .all()
    ).results;
    for (const j of cancelled) {
      controllers.get(j.id)?.abort();
      if (j.kind === "style")
        await run(
          "UPDATE engine_styles SET status=CASE WHEN asset_id IS NULL THEN 'cancelled' ELSE 'ready' END WHERE id=? AND status='generating'",
          parse(j.input_json).styleId,
        );
    }
    return cancelled.length;
  }
  async function itemContext(account, item) {
    const [b, template, idea] = await Promise.all([
      brand(account, item.brand_id),
      templateFor(account, item.brand_id, item.template_id),
      item.idea_id ? first("SELECT * FROM engine_ideas WHERE id=? AND account_id=?", item.idea_id, account) : null,
    ]);
    const magnet = item.keyword
      ? await first("SELECT * FROM engine_magnets WHERE account_id=? AND brand_id=? AND keyword=?", account, item.brand_id, item.keyword)
      : null;
    return { b, template, idea, magnet, context: contentContext(b, item, { template, idea, magnet }) };
  }

  // ---------- plans ----------
  async function getPlan(account, planId) {
    const plan = await first("SELECT * FROM engine_plans WHERE account_id=? AND id=?", account, planId);
    if (!plan) throw fail("Plan not found.", 404);
    const [rows, jobs] = await Promise.all([
      all("SELECT * FROM engine_content WHERE account_id=? AND plan_id=? ORDER BY position", account, planId),
      all(
        "SELECT id,kind,status,progress,error,content_id FROM engine_jobs WHERE account_id=? AND plan_id=? ORDER BY priority,created_at",
        account,
        planId,
      ),
    ]);
    const items = rows.map(viewContent),
      active = items.filter((i) => i.status !== "skipped");
    const ready = active.filter((i) => i.frames.length && i.frames.every((f) => f.assetId)).length;
    const status =
      plan.status === "cancelled"
        ? "cancelled"
        : active.length && active.every((i) => i.status === "approved")
          ? "approved"
          : active.length && ready === active.length
            ? "ready"
            : active.some((i) => WORKING.includes(i.status))
              ? "working"
              : active.some((i) => ["copy_review", "failed"].includes(i.status))
                ? "review"
                : "planned";
    return { ...plan, status, items, jobs, ready, total: active.length };
  }
  async function pickIdeas(account, b, { counts, pillars, region, ideaIds }) {
    const ideas = (
      await all("SELECT * FROM engine_ideas WHERE account_id=? AND brand_id=? AND archived=0 ORDER BY number", account, b.id)
    ).map(viewIdea);
    if (ideaIds?.length) {
      const chosen = ideaIds.map((value) => ideas.find((i) => i.id === value));
      if (chosen.some((i) => !i)) throw fail("One of the selected ideas no longer exists.");
      return chosen.map((idea) => ({ idea, format: idea.format }));
    }
    const usage = new Map(
      (
        await all(
          "SELECT idea_id,MAX(created_at) used FROM engine_content WHERE account_id=? AND brand_id=? AND idea_id IS NOT NULL AND status!='skipped' GROUP BY idea_id",
          account,
          b.id,
        )
      ).map((r) => [r.idea_id, r.used]),
    );
    let pool = ideas.filter(
      (i) =>
        (!pillars?.length || pillars.includes(i.pillar)) &&
        (!region || region === "all" || i.region === region || i.region === "all"),
    );
    if (!pool.length) throw fail("No ideas match these filters. Clear a filter or add ideas to the bank.");
    // Never-used ideas first, then the longest since last use; bank order breaks ties.
    pool.sort((a, z) => (usage.get(a.id) || "").localeCompare(usage.get(z.id) || "") || a.number - z.number);
    const picks = [],
      usedPillars = [];
    for (const [format, count] of Object.entries(counts))
      for (let n = 0; n < count; n++) {
        const candidates = pool.filter((i) => !picks.some((p) => p.idea.id === i.id));
        if (!candidates.length) break;
        const fresh = (list) => list.find((i) => !usedPillars.includes(i.pillar)) || list[0];
        const idea = fresh(candidates.filter((i) => i.format === format)) || fresh(candidates);
        if (!idea) break;
        usedPillars.push(idea.pillar);
        if (usedPillars.length >= Object.keys(BANK_PILLARS).length) usedPillars.length = 0;
        picks.push({ idea, format });
      }
    return picks;
  }
  async function createPlan(account, b, input) {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(input.date || "") ? input.date : now().slice(0, 10);
    const counts = {};
    // Plan order follows the daily playbook: carousel, reels, posts, then stories.
    for (const format of ["carousel", "reel", "post", "story"]) {
      const value = input.counts?.[format] ?? DAILY_SLOTS.filter((s) => s.format === format).length;
      counts[format] = Math.max(0, Math.min(14, Math.floor(Number(value) || 0)));
    }
    const ideaIds = Array.isArray(input.ideaIds) ? input.ideaIds.map((v) => text(v, 100)).filter(Boolean).slice(0, 30) : [];
    if (!ideaIds.length && !Object.values(counts).some(Boolean)) throw fail("Choose at least one post for this plan.");
    const pillars = Array.isArray(input.pillars) ? input.pillars.filter((p) => BANK_PILLARS[p]) : [];
    const [picks, list, readyStyles] = await Promise.all([
      pickIdeas(account, b, { counts, pillars, region: REGIONS[input.region] ? input.region : "all", ideaIds }),
      templates(account, b.id),
      all("SELECT id FROM engine_styles WHERE account_id=? AND brand_id=? AND status='ready' AND asset_id IS NOT NULL", account, b.id),
    ]);
    if (!readyStyles.length) throw fail("Create or upload a style in Brand & styles before planning content.");
    if (!picks.length) throw fail("No ideas are available for this plan.");
    const planId = id(),
      planning = { templates: list, styleIds: new Set(readyStyles.map((s) => s.id)), writes: [] };
    planning.writes.push([
      "INSERT INTO engine_plans(id,account_id,brand_id,title,plan_date,created_at) VALUES(?,?,?,?,?,?)",
      planId,
      account,
      b.id,
      text(input.title, 120) || `Content for ${date}`,
      date,
      now(),
    ]);
    const slotsLeft = [...DAILY_SLOTS];
    for (const [position, pick] of picks.entries()) {
      const slotIndex = slotsLeft.findIndex((s) => s.format === pick.format),
        slot = slotIndex >= 0 ? slotsLeft.splice(slotIndex, 1)[0] : {};
      await newItem(
        account,
        b,
        { idea: pick.idea, format: pick.format, planId, position, slot, auto: true, styleId: input.styleId },
        planning,
      );
    }
    await batch(planning.writes);
    const plan = await getPlan(account, planId);
    if (input.run) return generatePlan(account, plan, "all");
    return plan;
  }
  async function generatePlan(account, plan, stage) {
    if (!["writing", "images", "all"].includes(stage)) throw fail("Choose writing, images or a full run.");
    if (plan.items.some((i) => WORKING.includes(i.status))) throw fail("Wait for current tasks to finish.");
    await Promise.all(
      [...(stage === "images" ? [] : ["writing", "validation"]), ...(stage === "writing" ? [] : ["artwork"])].map((t) =>
        taskChoice(account, t),
      ),
    );
    await run("UPDATE engine_plans SET status='planned' WHERE id=? AND account_id=? AND status='cancelled'", plan.id, account);
    for (const item of plan.items) {
      if (item.status === "skipped") continue;
      const auto = stage === "all";
      if (
        stage !== "images" &&
        (!item.frames.length ||
          item.copy_status === "rejected" ||
          (["cancelled", "failed"].includes(item.status) && item.copy_status === "draft"))
      )
        await writeItem(account, item, { autoArtwork: auto });
      else if (stage !== "writing" && item.copy_status === "validated") await approveCopy(account, item);
      else if (stage !== "writing" && item.copy_status === "approved" && !item.frames.every((f) => f.assetId))
        await queueItem(account, item, item.position === 0 ? 0 : 1);
    }
    return getPlan(account, plan.id);
  }

  // ---------- job consumer ----------
  async function consume(jobId) {
    const target = await first("SELECT * FROM engine_jobs WHERE id=?", jobId);
    if (!target || target.status !== "queued") return;
    const row = await db
      .prepare("UPDATE engine_jobs SET status='running',started_at=?,lease_until=? WHERE id=? AND status='queued' RETURNING *")
      .bind(now(), Date.now() + 600000, target.id)
      .first();
    if (!row) return;
    const input = parse(row.input_json),
      account = row.account_id,
      controller = new AbortController();
    controllers.set(row.id, controller);
    const stillRunning = async () => Boolean(await first("SELECT id FROM engine_jobs WHERE id=? AND status='running'", row.id));
    const ensureRunning = async () => {
      if (!(await stillRunning())) throw fail("Generation cancelled.");
    };
    let heartbeat = Date.now();
    const poll = setInterval(() => {
      stillRunning()
        .then(async (running) => {
          if (!running) controller.abort();
          else if (Date.now() - heartbeat > 30000) {
            heartbeat = Date.now();
            await run("UPDATE engine_jobs SET lease_until=? WHERE id=? AND status='running'", Date.now() + 600000, row.id);
          }
        })
        .catch(() => {});
    }, 1000);
    try {
      const b = await brand(account, row.brand_id);
      let result = {};
      if (row.kind === "style") {
        const style = await first("SELECT * FROM engine_styles WHERE id=? AND account_id=?", input.styleId, account);
        if (!style) throw fail("Style not found.", 404);
        const uploaded = style.reference_id.startsWith("upload:");
        const base = uploaded
          ? await assetImage(account, style.reference_id.slice(7))
          : await platform.designReference(style.reference_id);
        if (!base) throw fail("The style reference is unavailable.");
        const current = input.revise && style.asset_id ? await assetImage(account, style.asset_id) : null;
        const image = await platform.renderImage({
          account,
          kind: "style",
          generation: input.generation,
          prompt: stylePrompt(b, DESIGN_SYSTEMS.find((d) => d.id === style.reference_id), {
            notes: input.notes || style.notes || "",
            revising: Boolean(current),
            uploaded,
          }),
          references: [base, current].filter(Boolean),
          logo: await assetImage(account, b.brand.logoAssetId),
          ratio: "4:3",
          signal: controller.signal,
          jobId: row.id,
        });
        await ensureRunning();
        const assetId = await saveAsset(account, b.id, image);
        await run(
          "UPDATE engine_styles SET asset_id=?,status='ready',notes=? WHERE id=? AND account_id=? AND EXISTS(SELECT 1 FROM engine_jobs WHERE id=? AND status='running')",
          assetId,
          text(input.notes ?? style.notes, 400),
          style.id,
          account,
          row.id,
        );
        // The first finished style becomes the default so planning works straight away.
        if (!b.brand.defaultStyleId)
          await run(
            "UPDATE engine_brands SET brand_json=json_set(brand_json,'$.defaultStyleId',?),revision=revision+1 WHERE id=? AND account_id=? AND COALESCE(json_extract(brand_json,'$.defaultStyleId'),'')=''",
            style.id,
            b.id,
            account,
          );
        result = { styleId: style.id };
      } else if (["writing", "validation"].includes(row.kind)) {
        let item = await content(account, row.content_id);
        if (item.revision !== input.revision) throw fail("Content changed while writing.");
        const { template, context } = await itemContext(account, item);
        if (row.kind === "writing") {
          const style = await readyStyle(account, b.id, item.style_id);
          const draft = await platform.generateText({
            account,
            generation: input.generation,
            prompt: writingPrompt({ ...item, validation: { issues: input.corrections || [] } }, context, style),
            schema: writingSchema(template),
            reference: await assetImage(account, style.asset_id),
            signal: controller.signal,
          });
          await ensureRunning();
          item = {
            ...item,
            topic: text(draft.topic, 300) || item.topic,
            brief: { ...item.brief, summary: text(draft.summary, 2000) },
            frames: draft.frames.map((f, i) => ({
              position: i + 1,
              role: template.roles[i],
              heading: text(f.heading, 160),
              body: text(f.body, 600),
              visualPrompt: text(f.visualPrompt, 700),
              assetId: "",
            })),
            caption: text(draft.caption, 2200),
            extras: {
              dmReply: text(draft.dmReply, 1000),
              altText: text(draft.altText, 500),
              hashtags: (draft.hashtags || []).map((h) => "#" + text(h, 60).replace(/^#+/, "").replace(/\s+/g, "")).filter((h) => h.length > 1).slice(0, 8),
              ...(draft.script ? { script: draft.script } : {}),
              ...(draft.sticker ? { sticker: draft.sticker } : {}),
            },
          };
        }
        const problem = checkDraft(item, template);
        if (problem) throw fail(problem);
        const generation = row.kind === "writing" ? input.validationGeneration : input.generation;
        const report = await platform.generateText({
          account,
          generation,
          prompt: validationPrompt(item, context),
          schema: validationSchema,
          signal: controller.signal,
        });
        await ensureRunning();
        if (typeof report.valid !== "boolean" || !Array.isArray(report.issues) || (report.valid && report.issues.length))
          throw fail("The validator returned an invalid review.");
        const validation = {
          valid: report.valid,
          issues: report.issues.map((i) => text(i, 600)),
          at: now(),
          provider: generation.provider,
        };
        const saved = await run(
          "UPDATE engine_content SET topic=?,brief_json=?,frames_json=?,caption=?,extras_json=?,copy_status=?,validation_json=?,status='copy_review',updated_at=? WHERE id=? AND account_id=? AND revision=? AND EXISTS(SELECT 1 FROM engine_jobs WHERE id=? AND status='running')",
          item.topic,
          JSON.stringify(item.brief),
          JSON.stringify(item.frames),
          item.caption,
          JSON.stringify(item.extras),
          validation.valid ? "validated" : "rejected",
          JSON.stringify(validation),
          now(),
          item.id,
          account,
          input.revision,
          row.id,
        );
        if (!saved.meta.changes) throw fail("Content changed while writing.");
        if (validation.valid && input.autoArtwork) await approveCopy(account, await content(account, item.id));
        result = { contentId: item.id, valid: validation.valid };
      } else if (row.kind === "frame") {
        let item = await content(account, row.content_id);
        if (item.revision !== input.revision) throw fail("Content changed while generating.");
        if (item.copy_status !== "approved") throw fail("Copy approval is required before artwork generation.");
        const frame = item.frames.find((f) => f.position === input.position);
        if (!frame) throw fail("Frame not found.");
        if (!frame.assetId) {
          const [template, style] = await Promise.all([
            templateFor(account, b.id, item.template_id),
            readyStyle(account, b.id, item.style_id),
          ]);
          const logo = await assetImage(account, b.brand.logoAssetId);
          const image = await platform.renderImage({
            account,
            kind: "frame",
            generation: input.generation,
            prompt: artworkPrompt(b, item, frame, { template, style, hasLogo: Boolean(logo), note: frame.note || "" }),
            references: [await assetImage(account, style.asset_id)].filter(Boolean),
            logo,
            ratio: item.ratio,
            canvas: CANVAS[item.ratio],
            frame,
            signal: controller.signal,
            jobId: row.id,
            contentId: item.id,
          });
          await ensureRunning();
          const assetId = await saveAsset(account, b.id, image);
          let attached = false;
          for (let attempt = 0; attempt < 8 && !attached; attempt++) {
            item = await content(account, row.content_id);
            if (item.revision !== input.revision) throw fail("Content changed while generating.");
            const frames = item.frames.map((f) => (f.position === input.position ? { ...f, assetId } : f)),
              ready = frames.every((f) => f.assetId);
            const saved = await run(
              "UPDATE engine_content SET frames_json=?,status=?,updated_at=? WHERE id=? AND account_id=? AND revision=? AND frames_json=? AND EXISTS(SELECT 1 FROM engine_jobs WHERE id=? AND status='running')",
              JSON.stringify(frames),
              ready ? "ready" : "generating",
              now(),
              item.id,
              account,
              item.revision,
              JSON.stringify(item.frames),
              row.id,
            );
            attached = Boolean(saved.meta.changes);
          }
          if (!attached) throw fail("Could not attach artwork. Retry this frame.");
        }
        result = { contentId: item.id, position: input.position };
      }
      await run(
        "UPDATE engine_jobs SET status='succeeded',progress=100,result_json=?,finished_at=? WHERE id=? AND status='running'",
        JSON.stringify(result),
        now(),
        row.id,
      );
    } catch (error) {
      if (!(await stillRunning())) return;
      const failed = await run(
        "UPDATE engine_jobs SET status='failed',error=?,finished_at=? WHERE id=? AND status='running'",
        text(error.message, 400),
        now(),
        row.id,
      );
      if (!failed.meta.changes) return;
      if (row.kind === "style")
        await run(
          "UPDATE engine_styles SET status=CASE WHEN asset_id IS NULL THEN 'failed' ELSE 'ready' END WHERE id=? AND account_id=?",
          input.styleId,
          account,
        );
      if (row.content_id)
        await run(
          "UPDATE engine_content SET status='failed',updated_at=? WHERE id=? AND account_id=? AND revision=?",
          now(),
          row.content_id,
          account,
          input.revision,
        );
    } finally {
      clearInterval(poll);
      controllers.delete(row.id);
    }
  }

  // ---------- styles ----------
  async function createStyles(account, b, referenceIds, notes) {
    await taskChoice(account, "style");
    const refs = [...new Set(referenceIds)].filter((r) => DESIGN_SYSTEMS.some((d) => d.id === r)).slice(0, 4);
    if (!refs.length) throw fail("Choose at least one reference design.");
    const existing = await styles(account, b.id);
    for (const ref of refs) {
      const design = DESIGN_SYSTEMS.find((d) => d.id === ref),
        same = existing.filter((s) => s.reference_id === ref).length,
        styleId = id();
      await run(
        "INSERT INTO engine_styles(id,account_id,brand_id,name,reference_id,notes,created_at) VALUES(?,?,?,?,?,?,?)",
        styleId,
        account,
        b.id,
        same ? `${design.name} ${same + 1}` : design.name,
        ref,
        text(notes, 400),
        now(),
      );
      await job(account, b.id, "style", { styleId, notes: text(notes, 400) }, { priority: 0, key: `style:${styleId}:1` });
    }
    return styles(account, b.id);
  }
  async function readImageBody(request, max) {
    const mime = (request.headers.get("content-type") || "").split(";")[0];
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (!["image/png", "image/jpeg", "image/webp"].includes(mime) || !bytes.length || bytes.length > max)
      throw fail(`Choose a PNG, JPEG or WebP image under ${Math.round(max / 1_000_000)} MB.`);
    return { bytes, mime };
  }

  // ---------- HTTP routes (/api/engine/...) ----------
  async function route(request, account, url) {
    const parts = url.pathname
        .slice("/api/engine".length)
        .split("/")
        .filter(Boolean)
        .map((part) => {
          try {
            return decodeURIComponent(part);
          } catch {
            throw fail("Invalid address.", 400);
          }
        }),
      method = request.method;
    const body = async () => {
      const raw = await request.text();
      if (raw.length > 65000) throw fail("Request too large.", 413);
      let input;
      try {
        input = raw ? JSON.parse(raw) : {};
      } catch {
        throw fail("Invalid JSON.");
      }
      if (!input || typeof input !== "object" || Array.isArray(input)) throw fail("Expected an object.");
      return input;
    };
    const json = (data) => Response.json(data, { headers: { "Cache-Control": "no-store" } });

    if (parts[0] === "bootstrap" && method === "GET") {
      const brands = await ensureBrand(account),
        b = brands.find((x) => x.id === url.searchParams.get("brand")) || brands[0];
      const [styleList, templateList, magnetList, jobs, ideaCount] = await Promise.all([
        styles(account, b.id),
        templates(account, b.id),
        magnets(account, b.id),
        brandJobs(account, b.id),
        first("SELECT COUNT(*) n FROM engine_ideas WHERE account_id=? AND brand_id=? AND archived=0", account, b.id),
      ]);
      return json({
        me: platform.viewer || null,
        capabilities: platform.capabilities || {},
        brands: brands.map(({ id: brandId, name }) => ({ id: brandId, name })),
        brand: b,
        styles: styleList,
        templates: templateList,
        magnets: magnetList,
        jobs,
        ideaCount: ideaCount?.n || 0,
        catalog: {
          pillars: BANK_PILLARS,
          formats: FORMATS,
          regions: REGIONS,
          slots: DAILY_SLOTS,
          formula: FORMULA,
          designs: DESIGN_SYSTEMS.map(({ id: designId, name, kind, img }) => ({ id: designId, name, kind, img })),
        },
      });
    }
    if (parts[0] === "providers" && parts.length === 1 && method === "GET")
      return json(await providerSettings(account, url.searchParams.get("refresh") === "1"));

    if (parts[0] === "brands" && parts[1]) {
      const b = await brand(account, parts[1]);
      if (parts.length === 2 && method === "GET") return json({ brand: b, styles: await styles(account, b.id), jobs: await brandJobs(account, b.id) });
      if (parts.length === 2 && method === "PUT") {
        const input = await body();
        if (Number(input.revision) !== b.revision) throw fail("Brand details changed. Reload before saving.", 409);
        const profile = { ...b.profile };
        for (const [key, max] of [["product", 1500], ["audience", 800], ["voice", 600], ["offer", 600], ["mascot", 200]])
          if (input[key] !== undefined) profile[key] = text(input[key], max);
        if (["US", "UK"].includes(input.spelling)) profile.spelling = input.spelling;
        if (Array.isArray(input.rules)) profile.rules = input.rules.map((r) => text(r, 400)).filter(Boolean).slice(0, 30);
        const brandJson = { ...b.brand };
        for (const key of ["primary", "accent"]) if (hex(input[key])) brandJson[key] = input[key];
        for (const [key, max] of [["handle", 60], ["website", 300], ["bookingUrl", 300]])
          if (input[key] !== undefined) brandJson[key] = text(input[key], max);
        if (input.defaultStyleId !== undefined) {
          if (input.defaultStyleId) await readyStyle(account, b.id, input.defaultStyleId);
          brandJson.defaultStyleId = text(input.defaultStyleId, 100);
        }
        const saved = await run(
          "UPDATE engine_brands SET name=?,profile_json=?,brand_json=?,revision=revision+1,updated_at=? WHERE id=? AND account_id=? AND revision=?",
          text(input.name, 100) || b.name,
          JSON.stringify(profile),
          JSON.stringify(brandJson),
          now(),
          b.id,
          account,
          b.revision,
        );
        if (!saved.meta.changes) throw fail("Brand details changed. Reload before saving.", 409);
        return json({ brand: await brand(account, b.id) });
      }
      if (parts[2] === "logo" && method === "POST") {
        const image = await readImageBody(request, 2_000_000),
          logoAssetId = await saveAsset(account, b.id, image);
        const colours = Object.fromEntries(
          ["primary", "accent"].map((k) => [k, request.headers.get("X-Logo-" + k)]).filter(([, v]) => hex(v)),
        );
        await run(
          "UPDATE engine_brands SET brand_json=?,revision=revision+1,updated_at=? WHERE id=? AND account_id=?",
          JSON.stringify({ ...b.brand, ...colours, logoAssetId }),
          now(),
          b.id,
          account,
        );
        return json({ brand: await brand(account, b.id) });
      }
      if (parts[2] === "styles" && parts.length === 3 && method === "POST") {
        const input = await body();
        return json({ styles: await createStyles(account, b, Array.isArray(input.referenceIds) ? input.referenceIds : [], input.notes) });
      }
      if (parts[2] === "styles" && parts[3] === "upload" && method === "POST") {
        const image = await readImageBody(request, 10_000_000),
          assetId = await saveAsset(account, b.id, image),
          styleId = id();
        const name = text(decodeURIComponent(request.headers.get("X-Style-Name") || ""), 80) || "Uploaded template";
        await run(
          "INSERT INTO engine_styles(id,account_id,brand_id,name,reference_id,asset_id,status,created_at) VALUES(?,?,?,?,?,?,'ready',?)",
          styleId,
          account,
          b.id,
          name,
          `upload:${assetId}`,
          assetId,
          now(),
        );
        if (!b.brand.defaultStyleId)
          await run(
            "UPDATE engine_brands SET brand_json=?,revision=revision+1 WHERE id=? AND account_id=?",
            JSON.stringify({ ...b.brand, defaultStyleId: styleId }),
            b.id,
            account,
          );
        return json({ styles: await styles(account, b.id), brand: await brand(account, b.id) });
      }
      if (parts[2] === "templates" && parts.length === 3 && method === "GET")
        return json({ templates: await templates(account, b.id, url.searchParams.get("archived") === "1") });
      if (parts[2] === "templates" && parts.length === 3 && method === "POST") {
        const input = await body();
        const source = input.fromId ? await templateFor(account, b.id, input.fromId) : null;
        const values = templateValues({ ...(source || {}), ...input, name: input.name || (source ? `${source.name} copy` : "") });
        if (values.style_id) await readyStyle(account, b.id, values.style_id);
        const templateId = id(),
          at = now();
        const position = (await first("SELECT COALESCE(MAX(position),0)+1 p FROM engine_templates WHERE brand_id=?", b.id)).p;
        await run(
          "INSERT INTO engine_templates(id,account_id,brand_id,slug,name,format,ratio,roles_json,instructions,visual,style_id,position,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
          templateId,
          account,
          b.id,
          `custom-${templateId.slice(0, 8)}`,
          values.name,
          values.format,
          values.ratio,
          JSON.stringify(values.roles),
          values.instructions,
          values.visual,
          values.style_id || null,
          position,
          at,
          at,
        );
        return json({ template: await templateFor(account, b.id, templateId) });
      }
      if (parts[2] === "templates" && parts[3] === "reset" && method === "POST") {
        const at = now();
        await batch([
          ...seedStatements(account, b.id, at).filter(([sql]) => sql.includes("engine_templates")),
          ...DEFAULT_TEMPLATES.map((t, position) => [
            "UPDATE engine_templates SET name=?,format=?,ratio=?,roles_json=?,instructions=?,visual=?,position=?,archived=0,updated_at=? WHERE account_id=? AND brand_id=? AND slug=?",
            t.name,
            t.format,
            t.ratio,
            JSON.stringify(t.roles),
            t.instructions,
            t.visual,
            position,
            at,
            account,
            b.id,
            t.slug,
          ]),
        ]);
        return json({ templates: await templates(account, b.id) });
      }
      if (parts[2] === "ideas" && parts.length === 3 && method === "GET") {
        const [ideas, usage] = await Promise.all([
          all(
            `SELECT * FROM engine_ideas WHERE account_id=? AND brand_id=? ${url.searchParams.get("archived") === "1" ? "" : "AND archived=0"} ORDER BY number`,
            account,
            b.id,
          ),
          all(
            "SELECT idea_id,COUNT(*) uses,MAX(created_at) last_used FROM engine_content WHERE account_id=? AND brand_id=? AND idea_id IS NOT NULL AND status!='skipped' GROUP BY idea_id",
            account,
            b.id,
          ),
        ]);
        const used = new Map(usage.map((u) => [u.idea_id, u]));
        return json({
          ideas: ideas.map((i) => ({ ...viewIdea(i), uses: used.get(i.id)?.uses || 0, lastUsed: used.get(i.id)?.last_used || "" })),
        });
      }
      if (parts[2] === "ideas" && parts.length === 3 && method === "POST") {
        const values = ideaValues(await body()),
          ideaId = id(),
          at = now();
        const number = (await first("SELECT COALESCE(MAX(number),0)+1 n FROM engine_ideas WHERE brand_id=?", b.id)).n;
        await run(
          "INSERT INTO engine_ideas(id,account_id,brand_id,number,pillar,format,region,hook,show,angle,keyword,notes,source,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'custom',?,?)",
          ideaId,
          account,
          b.id,
          number,
          values.pillar,
          values.format,
          values.region,
          values.hook,
          values.show,
          values.angle,
          values.keyword,
          values.notes,
          at,
          at,
        );
        return json({ idea: viewIdea(await first("SELECT * FROM engine_ideas WHERE id=?", ideaId)) });
      }
      if (parts[2] === "ideas" && parts[3] === "restore" && method === "POST") {
        const at = now();
        await batch([
          ...seedStatements(account, b.id, at).filter(([sql]) => !sql.includes("engine_templates")),
          ["UPDATE engine_ideas SET archived=0,updated_at=? WHERE account_id=? AND brand_id=? AND source='bank' AND archived=1", at, account, b.id],
        ]);
        return json({ ok: true });
      }
      if (parts[2] === "magnets" && parts.length === 3 && method === "POST") {
        const values = magnetValues(await body());
        await run(
          "INSERT INTO engine_magnets(id,account_id,brand_id,keyword,name,description,how,star,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
          id(),
          account,
          b.id,
          values.keyword,
          values.name,
          values.description,
          values.how,
          values.star,
          now(),
        ).catch(() => {
          throw fail("That keyword already has a lead magnet.", 409);
        });
        return json({ magnets: await magnets(account, b.id) });
      }
      if (parts[2] === "plans" && method === "POST") return json({ plan: await createPlan(account, b, await body()) });
      if (parts[2] === "plans" && method === "GET") {
        const plans = await all(
          "SELECT p.*,(SELECT COUNT(*) FROM engine_content c WHERE c.plan_id=p.id AND c.status!='skipped') total,(SELECT COUNT(*) FROM engine_content c WHERE c.plan_id=p.id AND c.status IN ('ready','approved')) ready FROM engine_plans p WHERE p.account_id=? AND p.brand_id=? ORDER BY p.plan_date DESC,p.created_at DESC LIMIT 60",
          account,
          b.id,
        );
        if (url.searchParams.get("latest") === "1") return json({ plan: plans[0] ? await getPlan(account, plans[0].id) : null, plans });
        return json({ plans });
      }
      if (parts[2] === "content" && method === "POST") {
        const input = await body();
        const idea = input.ideaId
          ? viewIdea(await first("SELECT * FROM engine_ideas WHERE id=? AND account_id=? AND brand_id=?", text(input.ideaId, 100), account, b.id))
          : null;
        if (input.ideaId && !idea) throw fail("Idea not found.", 404);
        if (input.format && !FORMATS[input.format]) throw fail("Choose carousel, post, story or reel.");
        const item = await newItem(account, b, {
          idea,
          format: input.format,
          templateId: text(input.templateId, 100),
          styleId: text(input.styleId, 100),
          region: input.region,
          ratio: input.ratio,
          keyword: input.keyword,
          topic: input.topic,
          instructions: input.instructions,
          pillar: input.pillar,
          auto: Boolean(input.auto),
        });
        if (input.write !== false) await writeItem(account, item, { autoArtwork: Boolean(input.auto) });
        return json({ item: await content(account, item.id) });
      }
      if (parts[2] === "library" && method === "GET") {
        const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0),
          format = FORMATS[url.searchParams.get("format")] ? url.searchParams.get("format") : null;
        const rows = await all(
          `SELECT * FROM engine_content WHERE account_id=? AND brand_id=? ${format ? "AND format=?" : ""} ORDER BY created_at DESC,position LIMIT 40 OFFSET ?`,
          account,
          b.id,
          ...(format ? [format] : []),
          offset,
        );
        return json({ items: rows.map(viewContent) });
      }
    }
    if (parts[0] === "styles" && parts[1]) {
      const style = await first("SELECT * FROM engine_styles WHERE id=? AND account_id=? AND status!='deleted'", parts[1], account);
      if (!style) throw fail("Style not found.", 404);
      const b = await brand(account, style.brand_id);
      if (parts.length === 2 && method === "PUT") {
        const name = text((await body()).name, 80);
        if (!name) throw fail("Enter a style name.");
        await run("UPDATE engine_styles SET name=? WHERE id=? AND account_id=?", name, style.id, account);
        return json({ styles: await styles(account, b.id) });
      }
      if (parts[2] === "regenerate" && method === "POST") {
        const notes = text((await body()).notes, 400);
        await taskChoice(account, "style");
        const started = await run(
          "UPDATE engine_styles SET status='generating' WHERE id=? AND account_id=? AND status IN ('ready','failed','cancelled')",
          style.id,
          account,
        );
        if (!started.meta.changes) throw fail("This style is already being created.", 409);
        await job(account, b.id, "style", { styleId: style.id, notes, revise: Boolean(style.asset_id) }, { priority: 0, key: `style:${style.id}:${id()}` });
        return json({ styles: await styles(account, b.id) });
      }
      if (parts.length === 2 && method === "DELETE") {
        if (b.brand.defaultStyleId === style.id) throw fail("Choose another default style before removing this one.");
        const used = await first("SELECT id FROM engine_templates WHERE style_id=? AND archived=0 LIMIT 1", style.id);
        if (used) throw fail("A template uses this style. Change that template first.");
        await cancelJobs(account, "kind='style' AND json_extract(input_json,'$.styleId')=?", style.id);
        await run("UPDATE engine_styles SET status='deleted' WHERE id=? AND account_id=?", style.id, account);
        return json({ styles: await styles(account, b.id) });
      }
    }
    if (parts[0] === "templates" && parts[1]) {
      const row = await first("SELECT * FROM engine_templates WHERE id=? AND account_id=?", parts[1], account);
      if (!row) throw fail("Template not found.", 404);
      if (parts.length === 2 && method === "PUT") {
        const values = templateValues({ ...viewTemplate(row), ...(await body()) });
        if (values.style_id) await readyStyle(account, row.brand_id, values.style_id);
        await run(
          "UPDATE engine_templates SET name=?,format=?,ratio=?,roles_json=?,instructions=?,visual=?,style_id=?,archived=0,updated_at=? WHERE id=? AND account_id=?",
          values.name,
          values.format,
          values.ratio,
          JSON.stringify(values.roles),
          values.instructions,
          values.visual,
          values.style_id || null,
          now(),
          row.id,
          account,
        );
        return json({ template: await templateFor(account, row.brand_id, row.id) });
      }
      if (parts.length === 2 && method === "DELETE") {
        await run("UPDATE engine_templates SET archived=1,updated_at=? WHERE id=? AND account_id=?", now(), row.id, account);
        return json({ templates: await templates(account, row.brand_id) });
      }
    }
    if (parts[0] === "ideas" && parts[1]) {
      const row = await first("SELECT * FROM engine_ideas WHERE id=? AND account_id=?", parts[1], account);
      if (!row) throw fail("Idea not found.", 404);
      if (parts.length === 2 && method === "PUT") {
        const values = ideaValues({ ...row, ...(await body()) });
        await run(
          "UPDATE engine_ideas SET pillar=?,format=?,region=?,hook=?,show=?,angle=?,keyword=?,notes=?,archived=0,updated_at=? WHERE id=? AND account_id=?",
          values.pillar,
          values.format,
          values.region,
          values.hook,
          values.show,
          values.angle,
          values.keyword,
          values.notes,
          now(),
          row.id,
          account,
        );
        return json({ idea: viewIdea(await first("SELECT * FROM engine_ideas WHERE id=?", row.id)) });
      }
      if (parts.length === 2 && method === "DELETE") {
        await run("UPDATE engine_ideas SET archived=1,updated_at=? WHERE id=? AND account_id=?", now(), row.id, account);
        return json({ ok: true });
      }
    }
    if (parts[0] === "magnets" && parts[1]) {
      const row = await first("SELECT * FROM engine_magnets WHERE id=? AND account_id=?", parts[1], account);
      if (!row) throw fail("Lead magnet not found.", 404);
      if (method === "PUT") {
        const values = magnetValues({ ...row, ...(await body()), keyword: row.keyword });
        await run(
          "UPDATE engine_magnets SET name=?,description=?,how=?,star=? WHERE id=? AND account_id=?",
          values.name,
          values.description,
          values.how,
          values.star,
          row.id,
          account,
        );
        return json({ magnets: await magnets(account, row.brand_id) });
      }
      if (method === "DELETE") {
        await run("DELETE FROM engine_magnets WHERE id=? AND account_id=?", row.id, account);
        return json({ magnets: await magnets(account, row.brand_id) });
      }
    }
    if (parts[0] === "plans" && parts[1]) {
      const plan = await getPlan(account, parts[1]);
      if (parts.length === 2 && method === "GET") return json({ plan });
      if (parts[2] === "generate" && method === "POST") return json({ plan: await generatePlan(account, plan, (await body()).stage || "all") });
      if (parts[2] === "approve" && method === "POST") {
        const active = plan.items.filter((i) => i.status !== "skipped");
        if (!active.length || active.some((i) => !i.frames.length || !i.frames.every((f) => f.assetId)))
          throw fail("All artwork in this plan must be ready before approval.");
        for (const item of active) await approveItem(account, item.id);
        return json({ plan: await getPlan(account, plan.id) });
      }
      if (parts[2] === "cancel" && method === "POST") {
        await run("UPDATE engine_plans SET status='cancelled' WHERE id=? AND account_id=?", plan.id, account);
        await cancelJobs(account, "plan_id=?", plan.id);
        await run(
          "UPDATE engine_content SET status='cancelled',updated_at=? WHERE plan_id=? AND account_id=? AND status IN ('writing','validating','generating')",
          now(),
          plan.id,
          account,
        );
        return json({ plan: await getPlan(account, plan.id) });
      }
      if (parts.length === 2 && method === "DELETE") {
        await cancelJobs(account, "plan_id=?", plan.id);
        await batch([
          ["DELETE FROM engine_jobs WHERE account_id=? AND plan_id=?", account, plan.id],
          ["DELETE FROM engine_content WHERE account_id=? AND plan_id=?", account, plan.id],
          ["DELETE FROM engine_plans WHERE account_id=? AND id=?", account, plan.id],
        ]);
        return json({ ok: true });
      }
    }
    if (parts[0] === "content" && parts[1]) {
      const item = await content(account, parts[1]);
      const reply = async () =>
        json({
          item: await content(account, item.id),
          jobs: await all(
            "SELECT id,kind,status,progress,error FROM engine_jobs WHERE account_id=? AND content_id=? ORDER BY created_at DESC LIMIT 30",
            account,
            item.id,
          ),
          template: await templateFor(account, item.brand_id, item.template_id).catch(() => null),
        });
      if (parts.length === 2 && method === "GET") return reply();
      if (parts[2] === "write" && method === "POST") {
        await writeItem(account, item);
        return reply();
      }
      if (parts[2] === "approve-copy" && method === "POST") {
        await approveCopy(account, item);
        return reply();
      }
      if (parts[2] === "generate" && method === "POST") {
        if (item.copy_status === "validated") await approveCopy(account, item);
        else await queueItem(account, item, 0);
        return reply();
      }
      if (parts[2] === "approve" && method === "POST") {
        await approveItem(account, item.id);
        return reply();
      }
      if (parts[2] === "posted" && method === "POST") {
        if (!item.frames.length || !item.frames.every((f) => f.assetId)) throw fail("Finish the artwork before marking it as posted.");
        await run("UPDATE engine_content SET posted_at=COALESCE(posted_at,?) WHERE id=? AND account_id=?", now(), item.id, account);
        return reply();
      }
      if (parts[2] === "cancel" && method === "POST") {
        await cancelJobs(account, "content_id=?", item.id);
        if (WORKING.includes(item.status))
          await run("UPDATE engine_content SET status='cancelled',updated_at=? WHERE id=? AND account_id=?", now(), item.id, account);
        return reply();
      }
      if (parts[2] === "skip" && method === "POST") {
        await cancelJobs(account, "content_id=?", item.id);
        await run(
          "UPDATE engine_content SET status=?,updated_at=? WHERE id=? AND account_id=?",
          item.status === "skipped" ? (item.frames.length ? "copy_review" : "planned") : "skipped",
          now(),
          item.id,
          account,
        );
        return reply();
      }
      if (parts[2] === "frames" && parts[3] && parts[4] === "regenerate" && method === "POST") {
        if (WORKING.includes(item.status)) throw fail("Wait for the current task to finish.");
        if (item.copy_status !== "approved") throw fail("Approve the copy before creating artwork.");
        const position = Number(parts[3]),
          note = text((await body()).note, 600);
        if (!item.frames.some((f) => f.position === position)) throw fail("Frame not found.", 404);
        const frames = item.frames.map((f) =>
          f.position === position ? { ...f, assetId: "", note, attempt: (f.attempt || 0) + 1 } : f,
        );
        const saved = await run(
          "UPDATE engine_content SET frames_json=?,status='planned',updated_at=? WHERE id=? AND account_id=? AND revision=?",
          JSON.stringify(frames),
          now(),
          item.id,
          account,
          item.revision,
        );
        if (!saved.meta.changes) throw fail("Content changed. Reload and retry.", 409);
        await queueItem(account, await content(account, item.id), 0);
        return reply();
      }
      if (parts[2] === "setup" && method === "PUT") {
        if (WORKING.includes(item.status)) throw fail("Cancel the current task before changing this piece.");
        const input = await body();
        if (Number(input.revision) !== item.revision) throw fail("Content changed. Reload before editing.", 409);
        const template = await templateFor(account, item.brand_id, text(input.templateId, 100) || item.template_id);
        const styleId = text(input.styleId, 100) || item.style_id;
        await readyStyle(account, item.brand_id, styleId);
        const ratio = FORMATS[template.format].ratios.includes(input.ratio) ? input.ratio : template.ratio;
        const brief = { ...item.brief, instructions: input.instructions !== undefined ? text(input.instructions, 4000) : item.brief.instructions };
        const saved = await run(
          "UPDATE engine_content SET template_id=?,style_id=?,format=?,ratio=?,region=?,keyword=?,topic=?,brief_json=?,revision=revision+1,updated_at=? WHERE id=? AND account_id=? AND revision=?",
          template.id,
          styleId,
          template.format,
          ratio,
          REGIONS[input.region] ? input.region : item.region,
          input.keyword !== undefined ? keywordOf(input.keyword) : item.keyword,
          text(input.topic, 300) || item.topic,
          JSON.stringify(brief),
          now(),
          item.id,
          account,
          item.revision,
        );
        if (!saved.meta.changes) throw fail("Content changed. Reload before editing.", 409);
        await writeItem(account, await content(account, item.id));
        return reply();
      }
      if (parts.length === 2 && method === "PUT") {
        const input = await body();
        if (Number(input.revision) !== item.revision) throw fail("Content changed. Reload before editing.", 409);
        if (WORKING.includes(item.status)) throw fail("Cancel or wait for the current task before editing.");
        if (!item.frames.length) throw fail("Write a draft before editing copy.");
        if (!Array.isArray(input.frames) || input.frames.length !== item.frames.length) throw fail("Supply every frame before saving copy.");
        const template = await templateFor(account, item.brand_id, item.template_id);
        const frames = item.frames.map((f, i) => {
          const next = {
            heading: text(input.frames[i].heading, 160),
            body: text(input.frames[i].body, 600),
            visualPrompt: text(input.frames[i].visualPrompt ?? f.visualPrompt, 700),
          };
          const changed = next.heading !== f.heading || next.body !== f.body || next.visualPrompt !== f.visualPrompt;
          return { ...f, ...next, ...(changed ? { assetId: "" } : {}) };
        });
        const extras = { ...item.extras };
        if (input.dmReply !== undefined) extras.dmReply = text(input.dmReply, 1000);
        if (input.altText !== undefined) extras.altText = text(input.altText, 500);
        if (Array.isArray(input.hashtags)) extras.hashtags = input.hashtags.map((h) => "#" + text(h, 60).replace(/^#+/, "").replace(/\s+/g, "")).filter((h) => h.length > 1).slice(0, 8);
        const next = { ...item, frames, caption: text(input.caption, 2200), extras };
        const problem = checkDraft(next, template);
        if (problem) throw fail(problem);
        await taskChoice(account, "validation");
        const revision = item.revision + 1;
        const saved = await run(
          "UPDATE engine_content SET frames_json=?,caption=?,extras_json=?,copy_status='draft',validation_json='{}',status='validating',revision=?,updated_at=? WHERE id=? AND account_id=? AND revision=?",
          JSON.stringify(frames),
          next.caption,
          JSON.stringify(extras),
          revision,
          now(),
          item.id,
          account,
          item.revision,
        );
        if (!saved.meta.changes) throw fail("Content changed. Reload before editing.", 409);
        await job(account, item.brand_id, "validation", { revision, autoArtwork: false }, { contentId: item.id, planId: item.plan_id, key: `validation:${item.id}:${revision}` });
        return reply();
      }
      if (parts.length === 2 && method === "DELETE") {
        await cancelJobs(account, "content_id=?", item.id);
        await batch([
          ["DELETE FROM engine_jobs WHERE account_id=? AND content_id=?", account, item.id],
          ["DELETE FROM engine_content WHERE account_id=? AND id=?", account, item.id],
        ]);
        return json({ ok: true });
      }
    }
    if (parts[0] === "jobs" && parts[1] && parts[2] === "retry" && method === "POST") {
      const j = await first("SELECT * FROM engine_jobs WHERE id=? AND account_id=?", parts[1], account);
      if (!j) throw fail("Job not found.", 404);
      if (!["failed", "cancelled"].includes(j.status)) throw fail("Only failed or cancelled tasks can be retried.");
      if (j.content_id) {
        const item = await content(account, j.content_id);
        if (item.revision !== parse(j.input_json).revision)
          throw fail("This task belongs to an older draft. Use the current controls instead.");
        await run(
          "UPDATE engine_content SET status=?,updated_at=? WHERE id=? AND account_id=?",
          { frame: "generating", validation: "validating" }[j.kind] || "writing",
          now(),
          item.id,
          account,
        );
      }
      if (j.plan_id) await run("UPDATE engine_plans SET status='planned' WHERE id=? AND status='cancelled'", j.plan_id);
      if (j.kind === "style") await run("UPDATE engine_styles SET status='generating' WHERE id=? AND account_id=?", parse(j.input_json).styleId, account);
      await run("UPDATE engine_jobs SET status='queued',error=NULL,finished_at=NULL WHERE id=? AND account_id=?", j.id, account);
      try {
        await platform.enqueue(j.id);
      } catch {
        await run("UPDATE engine_jobs SET status='failed',error=? WHERE id=?", "Could not queue work. Please retry.", j.id);
        throw fail("Could not queue work. Please retry.", 503);
      }
      return json({ ok: true });
    }
    if (parts[0] === "assets" && parts[1] && method === "GET") {
      const asset = await first("SELECT * FROM v4_assets WHERE account_id=? AND id=?", account, parts[1]);
      if (!asset) throw fail("Image not found.", 404);
      const variant = parts[2] || "preview",
        key = variant === "original" ? asset.original_key : variant === "thumbnail" ? asset.thumbnail_key : asset.preview_key;
      const object = await platform.readImage(key);
      if (!object) throw fail("Image unavailable.", 404);
      return new Response(object.bytes, {
        headers: {
          "Content-Type": object.mime || asset.mime,
          "Cache-Control": "private,max-age=3600",
          Vary: "Cookie",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
    throw fail("Route not found.", 404);
  }

  return {
    route,
    consume,
    ensureBrand,
    async recover() {
      await run("UPDATE engine_jobs SET status='queued',error='Recovered interrupted work.' WHERE status='running' AND lease_until<?", Date.now());
      for (const r of await all("SELECT id FROM engine_jobs WHERE status='queued'")) await platform.enqueue(r.id);
    },
  };
}

function templateValues(input) {
  const format = FORMATS[input.format] ? input.format : null;
  if (!format) throw fail("Choose carousel, post, story or reel.");
  const spec = FORMATS[format];
  const roles = (Array.isArray(input.roles) ? input.roles : String(input.roles || "").split("\n"))
    .map((r) => text(r, 60))
    .filter(Boolean);
  if (roles.length < spec.minFrames || roles.length > spec.maxFrames)
    throw fail(`A ${spec.label.toLowerCase()} needs ${spec.minFrames === spec.maxFrames ? spec.minFrames : `${spec.minFrames}–${spec.maxFrames}`} frame role(s), one per line.`);
  const name = text(input.name, 80);
  if (!name) throw fail("Enter a template name.");
  return {
    name,
    format,
    ratio: spec.ratios.includes(input.ratio) ? input.ratio : spec.ratios[0],
    roles,
    instructions: text(input.instructions, 2000),
    visual: text(input.visual, 1000),
    style_id: text(input.style_id ?? input.styleId, 100),
  };
}
function ideaValues(input) {
  if (!BANK_PILLARS[input.pillar]) throw fail("Choose a content pillar.");
  if (!FORMATS[input.format]) throw fail("Choose carousel, post, story or reel.");
  const hook = text(input.hook, 300);
  if (!hook) throw fail("Enter the hook.");
  return {
    pillar: input.pillar,
    format: input.format,
    region: REGIONS[input.region] ? input.region : "all",
    hook,
    show: text(input.show, 600),
    angle: text(input.angle, 600),
    keyword: keywordOf(input.keyword),
    notes: text(input.notes, 2000),
  };
}
function magnetValues(input) {
  const keyword = keywordOf(input.keyword),
    name = text(input.name, 160);
  if (!keyword || !name) throw fail("Enter a keyword and a name.");
  return {
    keyword,
    name,
    description: text(input.description, 1000),
    how: text(input.how, 600),
    star: input.star ? 1 : 0,
  };
}
