// Content Engine defaults: formats, the daily posting playbook, preloaded templates and the
// SmileCraft brand profile. New brands are seeded from these; everything is editable in the app.
export { BANK_PILLARS, BANK_IDEAS, BANK_MAGNETS } from "./bank-data.mjs";

export const FORMATS = {
  carousel: { label: "Carousel", ratios: ["4:5", "1:1"], minFrames: 2, maxFrames: 10 },
  post: { label: "Static post", ratios: ["4:5", "1:1"], minFrames: 1, maxFrames: 1 },
  story: { label: "Story", ratios: ["9:16"], minFrames: 1, maxFrames: 1 },
  reel: { label: "Reel", ratios: ["9:16"], minFrames: 1, maxFrames: 6 },
};
export const CANVAS = { "4:5": [1080, 1350], "1:1": [1080, 1080], "9:16": [1080, 1920] };
export const REGIONS = { all: "All countries", US: "United States", UK: "United Kingdom", AU: "Australia" };

// Times are IST, taken from the growth-sprint playbook. They label plan items; nothing auto-publishes.
export const DAILY_SLOTS = [
  { time: "14:00", format: "carousel", label: "Carousel · Australia evening" },
  { time: "18:30", format: "reel", label: "Reel · UK lunch + US morning (Trial Reel first)" },
  { time: "06:30", format: "reel", label: "Reel · US evening" },
  { time: "14:30", format: "story", label: "Story · poll" },
  { time: "19:00", format: "story", label: "Story · share" },
  { time: "21:00", format: "story", label: "Story · proof" },
  { time: "07:00", format: "story", label: "Story · question box" },
];

export const FORMULA = "Hook → Value → SmileCraft → Comment KEYWORD";

export const DEFAULT_TEMPLATES = [
  {
    slug: "growth-carousel",
    name: "Growth carousel",
    format: "carousel",
    ratio: "4:5",
    roles: [
      "Hook",
      "The problem",
      "The insight",
      "How to fix it",
      "How to fix it",
      "Where SmileCraft fits",
      "Comment the keyword",
    ],
    instructions:
      "A practice-growth tip for practice owners and office managers. Slide 1 is a scroll-stopping hook of at most 9 words. Each middle slide teaches one concrete, specific step a practice can do this week. The SmileCraft slide says in one or two plain lines how SmileCraft removes the work, with no hype. The final slide says “Comment KEYWORD” and names the free resource.",
    visual:
      "Editorial slides with big confident type, generous white space and one simple supporting visual per slide (icons, simple diagrams, phone screens). No stock-photo smiles.",
  },
  {
    slug: "freebie-carousel",
    name: "Lead-magnet preview carousel",
    format: "carousel",
    ratio: "4:5",
    roles: ["Hook", "What’s inside", "A peek inside", "Who it’s for", "Comment the keyword"],
    instructions:
      "Promotes one free resource. Describe only what the resource actually contains (see the lead magnet). Slide 3 previews one useful piece of it in full so the post is valuable on its own. Final slide: “Comment KEYWORD” and what they will receive by DM.",
    visual:
      "Show the resource as clean document pages or cards in the brand colours; previews must be readable mock pages, never real patient data.",
  },
  {
    slug: "steal-carousel",
    name: "Steal-this-post carousel",
    format: "carousel",
    ratio: "4:5",
    roles: ["Hook", "Point 1", "Point 2", "Point 3", "Ask your dentist", "Want it with your logo?"],
    instructions:
      "Slides 1–5 are a ready-to-post patient-education carousel that a dental practice could publish as-is: accurate, general, no diagnosis or guaranteed results. Slide 6 speaks to practice owners: “Want this with your logo? Comment KEYWORD.”",
    visual: "Patient-friendly education design, calm and clear, simple dental illustrations, no patient photos.",
  },
  {
    slug: "relatable-carousel",
    name: "Relatable carousel",
    format: "carousel",
    ratio: "4:5",
    roles: ["Hook", "Moment 1", "Moment 2", "Moment 3", "The twist", "Comment the keyword"],
    instructions:
      "Light, kind humour that dental teams recognise from their own day. Never mock patients or staff. The twist slide turns the joke into a useful takeaway. Final slide: “Comment KEYWORD”.",
    visual: "Playful illustrated cards, bold type, Crafty the tooth mascot can appear as a reaction character.",
  },
  {
    slug: "meme-post",
    name: "Meme post",
    format: "post",
    ratio: "1:1",
    roles: ["Meme"],
    instructions:
      "A single meme or two-panel joke for dental teams. Heading is the setup line, body is the punchline. Kind humour only. The caption carries the “Comment KEYWORD” call to action.",
    visual: "Two-panel or top/bottom text meme layout in brand colours; illustrated characters, never real people.",
  },
  {
    slug: "question-post",
    name: "Question post",
    format: "post",
    ratio: "4:5",
    roles: ["Question"],
    instructions:
      "One bold question that invites comments from practice owners. Heading is the question; body is a short nudge such as “Be honest 👇”. The caption ends with the keyword offer.",
    visual: "Bold typographic post, one large question, lots of colour and space; no photo needed.",
  },
  {
    slug: "poll-story",
    name: "Poll story",
    format: "story",
    ratio: "9:16",
    roles: ["Poll"],
    instructions:
      "A vertical story that asks one quick poll question of practice owners. Heading is the question; body is one line of context. Return the poll sticker text and two short options. Leave room for the sticker.",
    visual:
      "Vertical story card; keep the top 250 px and bottom 350 px free of text; reserve an empty rounded area in the lower third for the poll sticker (do not draw the sticker).",
  },
  {
    slug: "proof-story",
    name: "Proof / share story",
    format: "story",
    ratio: "9:16",
    roles: ["Proof"],
    instructions:
      "A vertical story that shares progress, a result we actually have, or reshares today’s post with a “Comment KEYWORD” nudge. Never invent numbers; if the idea needs real numbers, write [number] placeholders for the team to fill in.",
    visual:
      "Vertical story card with a big headline and space for a screenshot or sticker in the middle; keep the top 250 px and bottom 350 px clear.",
  },
  {
    slug: "text-reel",
    name: "Text-on-screen reel",
    format: "reel",
    ratio: "9:16",
    roles: ["Cover hook", "Beat", "Beat", "Closing card"],
    instructions:
      "A 7–15 second reel built from on-screen text cards. The cover hook must land in the first 2 seconds. Each beat is one idea. The closing card says “Comment KEYWORD”. Also write the shot list and voiceover so the team can cut it with b-roll or as an animated slideshow.",
    visual:
      "Vertical text cards with very large type, high contrast, one idea per card; keep the top 250 px and bottom 350 px clear for Instagram’s interface.",
  },
  {
    slug: "demo-reel",
    name: "Product demo reel",
    format: "reel",
    ratio: "9:16",
    roles: ["Cover hook", "What happens", "The result"],
    instructions:
      "Shows SmileCraft working, filmed as a screen recording of the real product. The script’s shots describe exactly what to record on screen, with timestamps where they help. Never claim features beyond the brand’s product description. Closing line: “Comment KEYWORD”.",
    visual: "Vertical cover and result cards that frame a phone or laptop screen area; clean product-marketing look.",
  },
  {
    slug: "pov-reel",
    name: "POV / reaction reel (filmed)",
    format: "reel",
    ratio: "9:16",
    roles: ["Cover hook", "Punchline card"],
    instructions:
      "A short reel a team member films: a POV or reaction moment. Write the on-screen text, the exact shot (framing, expression, timing) and an audio suggestion. The cards are the cover and the closing punchline.",
    visual: "Vertical cover card with a bold POV line; illustrated or abstract background, no real faces.",
  },
];

export function defaultTemplateSlug(idea) {
  const { format, pillar, hook = "", show = "" } = idea || {};
  if (format === "reel")
    return pillar === "demo"
      ? "demo-reel"
      : pillar === "rel" && /\b(pov|reaction|face|look|stare|despair|zoom)\b/i.test(`${hook} ${show}`)
        ? "pov-reel"
        : "text-reel";
  if (format === "post") return /\?|👇|fill in|rate your|tag a/i.test(hook) ? "question-post" : "meme-post";
  if (format === "story") return pillar === "pub" ? "proof-story" : "poll-story";
  return { free: "freebie-carousel", steal: "steal-carousel", rel: "relatable-carousel" }[pillar] || "growth-carousel";
}

export const DEFAULT_BRAND = {
  name: "SmileCraft",
  profile: {
    product:
      "SmileCraft designs and writes branded Instagram carousels, posts and stories for dental practices. A practice sends its logo once, gets a ready draft every morning and approves, changes or skips it from their phone.",
    audience:
      "Dental practice owners and office managers in the US, UK and Australia. Dental students and hygienists follow fastest; owners and office managers buy.",
    voice: "Warm, direct and a little playful. Practical over hype. Sounds like a peer who knows how a dental office really runs.",
    offer: "Free demo: a 7-slide carousel designed in the practice’s own colours. Comment DEMO.",
    mascot: "Crafty, a friendly cartoon tooth",
    spelling: "US",
    rules: [
      "Say “practice”, not “clinic”.",
      "US-only posts use US spelling. UK and Australia posts use British spelling (colour, centre, organise).",
      "Never show prices in rupees. Use $, £ or A$, or leave prices out.",
      "Never invent statistics, results, client names, testimonials, prices or follower counts. Use [placeholders] for numbers the team must supply.",
      "Never show or describe identifiable patients. Patient photos and testimonials need written consent (HIPAA in the US).",
      "In the UK only GDC-registered specialists can be called “specialist”. Never promote Botox to the public in the UK or Australia.",
      "Australia: no testimonials about clinical care and no before/after outcome claims in advertising.",
      "Replies to reviews must never confirm that someone is a patient.",
      "Every feed post follows Hook → Value → SmileCraft → Comment KEYWORD.",
    ],
  },
  brand: { primary: "#0e7a5b", accent: "#c9472f", handle: "", website: "", bookingUrl: "" },
};
