import { formatInstructions } from './image-formats.js';
export function styleVariantInstructions(input) {
  if (!input.sourceTemplateId) return '';
  return `Act as a senior brand designer. Edit the supplied complete reference image to create a reusable style variation for this business: ${JSON.stringify(String(input.brand?.name || input.name || '').slice(0,100))}. Industry: ${JSON.stringify(String(input.businessType || '').slice(0,100))}. Language: ${String(input.language || 'English').slice(0,120)}; ${String(input.languageNotes || '').slice(0,400)}. Use the supplied logo exactly when provided, otherwise retain the existing logo. Use neutral placeholders without inventing facts, prices, addresses or claims.\n\nSTYLE VARIATION: The first image is this client's full existing design. Preserve the complete composition, proportions, layout and useful visual identity while applying these requested changes: ${String(input.revisionNotes || '').slice(0, 4000)}. The optional mood image is an annotated copy of the same full image; numbered red marks identify areas to change. Match each "Mark N:" instruction to the red badge with the same number in the annotated image. Apply numbered instructions only to their matching marked areas; unnumbered instructions apply to the whole design. Marks are editing guidance only: remove all red annotation strokes from the final artwork, including every numbered badge. ${formatInstructions(input.aspectRatio)} Adapt the composition to the chosen canvas while retaining its visual identity. Return one complete image. Do not crop, cut up, rearrange or split the design into slides or add extra panels.`;
}

export function paintStyleImage(canvas, image, strokes = []) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#ef3340'; ctx.fillStyle = '#ef3340'; ctx.lineWidth = 6; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const stroke of strokes) {
    if (!stroke.length) continue;
    ctx.beginPath(); ctx.moveTo(stroke[0].x * canvas.width, stroke[0].y * canvas.height);
    for (const p of stroke.slice(1)) ctx.lineTo(p.x * canvas.width, p.y * canvas.height);
    ctx.stroke();
    if (stroke.length === 1) { ctx.beginPath(); ctx.arc(stroke[0].x * canvas.width, stroke[0].y * canvas.height, 3, 0, Math.PI * 2); ctx.fill(); }
  }
  // Draw badges last so later strokes cannot cover their numbers.
  const radius = Math.max(18, Math.min(canvas.width, canvas.height) * .025);
  strokes.forEach((stroke, index) => {
    if (!stroke.length) return;
    const x = Math.max(radius, Math.min(canvas.width - radius, stroke[0].x * canvas.width));
    const y = Math.max(radius, Math.min(canvas.height - radius, stroke[0].y * canvas.height));
    ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = '#ef3340'; ctx.fill();
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = Math.max(2, radius / 10); ctx.stroke();
    ctx.fillStyle = '#ffffff'; ctx.font = `bold ${radius}px sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(stroke.number ?? index + 1), x, y, radius * 1.6);
  });
}

export function attachStyleMarker(canvas, image, strokes, disabled = false, { getMarkNumber, onMark } = {}) {
  paintStyleImage(canvas, image, strokes);
  if (disabled) return;
  let active = null;
  const point = event => { const r = canvas.getBoundingClientRect(); return { x: Math.max(0, Math.min(1, (event.clientX-r.left)/r.width)), y: Math.max(0, Math.min(1, (event.clientY-r.top)/r.height)) }; };
  canvas.onpointerdown = event => { if (event.button !== 0) return; event.preventDefault(); canvas.setPointerCapture(event.pointerId); active = [point(event)]; active.number = getMarkNumber ? getMarkNumber() : Math.max(0, ...strokes.map((stroke, i) => stroke.number ?? i + 1)) + 1; strokes.push(active); paintStyleImage(canvas, image, strokes); };
  canvas.onpointermove = event => { if (active) { active.push(point(event)); paintStyleImage(canvas, image, strokes); } };
  canvas.onpointerup = canvas.onpointercancel = canvas.onlostpointercapture = () => {
    if (!active) return;
    const number = active.number; active = null;
    onMark?.(number);
  };
}

export function styleReferenceImage(image, strokes = []) {
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
  paintStyleImage(canvas, image, strokes);
  return canvas.toDataURL('image/png');
}

export function appendMarkNote(notes, number) {
  return `${notes}${notes && !notes.endsWith('\n') ? '\n' : ''}Mark ${number}: `;
}
