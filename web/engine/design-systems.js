// Original FlossPost boards, including their palette, typography and motif guides.
// Keep this catalog separate from the studio's dental-practice templates.
export const ENGINE_DESIGN_SYSTEMS = [
  {
    id: "flosspost-warm-playful",
    name: "FlossPost · Warm Playful",
    kind: "Warm off-white + indigo, pink accents and friendly tooth illustrations",
  },
  {
    id: "flosspost-clean-white",
    name: "FlossPost · Clean White",
    kind: "White + pale lavender, indigo speech bubbles and playful checklists",
  },
  {
    id: "flosspost-bold-indigo",
    name: "FlossPost · Bold Indigo",
    kind: "Bold indigo + lavender, chunky white headlines and bright pink emphasis",
  },
].map((design) => ({ ...design, img: `/assets/design-systems/${design.id}.png` }));
