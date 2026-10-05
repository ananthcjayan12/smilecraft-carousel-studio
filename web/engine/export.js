import { makeZip, downloadBlob } from "../zip.js";
import { image } from "./api.js";

const slug = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
function notes(item, brand) {
  const x = item.extras || {};
  const lines = [
    `# ${item.topic}`,
    "",
    `Format: ${item.format} · ${item.ratio} · ${item.frames.length} frame(s)`,
    item.slot?.time ? `Slot: ${item.slot.time} IST · ${item.slot.label}` : "",
    item.keyword ? `Comment keyword: ${item.keyword}` : "",
    item.region !== "all" ? `Countries: ${item.region} only` : "",
    "",
    "## Caption",
    item.caption,
    "",
    x.hashtags?.length ? `## Hashtags\n${x.hashtags.join(" ")}\n` : "",
    x.altText ? `## Alt text\n${x.altText}\n` : "",
    x.dmReply ? `## Keyword DM reply (${item.keyword})\n${x.dmReply}\n` : "",
    x.sticker && x.sticker.type !== "none" ? `## Story sticker (add in the app)\n${x.sticker.type}: ${x.sticker.prompt}${x.sticker.options?.length ? `\nOptions: ${x.sticker.options.join(" / ")}` : ""}\n` : "",
    x.script
      ? `## Reel script\nFirst 2 seconds: ${x.script.hook}\n${x.script.shots.map((s, i) => `${i + 1}. ${s.shot}${s.onScreen ? `\n   On screen: ${s.onScreen}` : ""}${s.voiceover ? `\n   Voiceover: ${s.voiceover}` : ""}`).join("\n")}\nClosing: ${x.script.closing}\nAudio: ${x.script.audio}\n`
      : "",
    "## Frames",
    ...item.frames.map((f) => `${f.position}. [${f.role || ""}] ${f.heading}${f.body ? ` — ${f.body}` : ""}`),
    "",
    `Made with the ${brand.name} Content Engine. Check every image and fact before posting.`,
  ];
  return lines.filter((l) => l !== "").join("\n") + "\n";
}
export async function downloadPack(items, state, date) {
  const files = [];
  const done = items.filter((i) => i.frames.length && i.frames.every((f) => f.assetId));
  if (!done.length) throw Error("Wait for artwork before downloading.");
  for (const [index, item] of done.entries()) {
    const folder = `${String(index + 1).padStart(2, "0")}-${item.format}-${slug(item.topic)}`;
    for (const frame of item.frames) {
      const response = await fetch(image(frame.assetId, "original"), { credentials: "same-origin" });
      if (!response.ok) throw Error("An image could not be downloaded. Please retry.");
      const type = response.headers.get("content-type") || "";
      files.push({
        name: `${folder}/${String(frame.position).padStart(2, "0")}.${type.includes("jpeg") ? "jpg" : type.includes("webp") ? "webp" : "png"}`,
        data: await response.blob(),
      });
    }
    files.push({ name: `${folder}/caption.txt`, data: `${item.caption}${item.extras?.hashtags?.length ? `\n\n${item.extras.hashtags.join(" ")}` : ""}\n` });
    files.push({ name: `${folder}/post.md`, data: notes(item, state.brand) });
  }
  downloadBlob(await makeZip(files), `${slug(state.brand.name)}-${date}.zip`);
}
