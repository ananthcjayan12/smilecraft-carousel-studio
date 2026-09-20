const W = 1080, H = 1350;
const cache = new Map();
function load(src) { if (!src) return Promise.resolve(null); if (cache.has(src)) return cache.get(src); const p = new Promise((resolve, reject) => { const img = new Image(); img.crossOrigin = 'anonymous'; img.onload = () => resolve(img); img.onerror = () => reject(new Error('Could not load the selected image.')); img.src = src; }); cache.set(src, p); return p; }
function rr(ctx, x, y, w, h, r = 24) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }
function fillRounded(ctx, x, y, w, h, r, color) { ctx.fillStyle = color; rr(ctx, x, y, w, h, r); ctx.fill(); }
function withAlpha(ctx, amount, fn) { ctx.save(); ctx.globalAlpha = amount; fn(); ctx.restore(); }
function curvedLines(ctx, x, y, radius, color) { ctx.strokeStyle = color; ctx.lineWidth = 1.2; for (let i = 0; i < 13; i++) { ctx.beginPath(); ctx.arc(x, y, radius + i * 15, Math.PI * .04, Math.PI * 1.15); ctx.stroke(); } }
function tooth(ctx, x, y, scale, options = {}) {
  ctx.save(); ctx.translate(x, y); ctx.scale(scale, scale); ctx.shadowColor = options.shadow || 'rgba(15,245,235,.2)'; ctx.shadowBlur = 30;
  const g = ctx.createLinearGradient(-90, -95, 100, 118); g.addColorStop(0, '#ffffff'); g.addColorStop(.65, '#f4fcff'); g.addColorStop(1, '#bee6ed');
  ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(-97, -57); ctx.bezierCurveTo(-132, -124, -22, -128, 0, -96); ctx.bezierCurveTo(29, -126, 132, -119, 98, -47); ctx.bezierCurveTo(96, -5, 78, 75, 55, 112); ctx.bezierCurveTo(27, 159, 23, 41, 0, 42); ctx.bezierCurveTo(-26, 38, -29, 157, -58, 114); ctx.bezierCurveTo(-85, 67, -99, -10, -97, -57); ctx.closePath(); ctx.fill(); ctx.shadowBlur = 0;
  ctx.strokeStyle = 'rgba(14,113,124,.16)'; ctx.lineWidth = 2; ctx.stroke(); ctx.strokeStyle = 'rgba(255,255,255,.92)'; ctx.lineWidth = 8; ctx.beginPath(); ctx.moveTo(-71, -76); ctx.quadraticCurveTo(-36, -94, -15, -77); ctx.stroke(); ctx.restore();
}
function textLines(ctx, text, width, maxLines = 7) {
  const words = String(text || '').replace(/\s+/g, ' ').trim().split(' '); let lines = [], line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > width && line) { lines.push(line); line = word; } else line = next;
  }
  if (line) lines.push(line);
  // Extremely long words have to shrink through font sizing, never clip their glyphs.
  return lines.slice(0, maxLines);
}
function drawWrapped(ctx, value, x, y, maxW, { font = 50, maxLines = 5, lineHeight = 1.45, color = 'white', weight = 700, align = 'left', maxHeight = 370 } = {}) {
  const text = String(value || ' '); ctx.textAlign = align; ctx.textBaseline = 'top';
  let size = font, lines;
  while (size >= 24) {
    ctx.font = `${weight} ${size}px "Noto Sans Malayalam", "Nirmala UI", sans-serif`;
    lines = textLines(ctx, text, maxW, maxLines + 2);
    if (lines.length <= maxLines && lines.length * size * lineHeight <= maxHeight && lines.every(s => ctx.measureText(s).width <= maxW)) break;
    size -= 2;
  }
  lines = textLines(ctx, text, maxW, maxLines);
  ctx.fillStyle = color; ctx.shadowColor = 'rgba(0,18,24,.3)'; ctx.shadowBlur = 7;
  lines.forEach((line, i) => ctx.fillText(line, x, y + i * size * lineHeight)); ctx.shadowBlur = 0;
  return lines.length * size * lineHeight;
}
function cropImage(ctx, img, x, y, w, h, r = 35) {
  ctx.save(); rr(ctx, x, y, w, h, r); ctx.clip(); const ratio = Math.max(w / img.width, h / img.height); const dw = img.width * ratio, dh = img.height * ratio; ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh); ctx.restore();
}
function ellipseImage(ctx, img, x, y, radius) {
  ctx.save(); ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.clip(); const ratio = Math.max(radius * 2 / img.width, radius * 2 / img.height); const dw = img.width * ratio, dh = img.height * ratio; ctx.drawImage(img, x - dw / 2, y - dh / 2, dw, dh); ctx.restore();
  ctx.strokeStyle = '#9af1e9'; ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(x, y, radius + 4, 0, Math.PI * 2); ctx.stroke();
}
function drawIllustration(ctx, x, y, scale, accent, i) {
  ctx.save(); ctx.translate(x, y); ctx.scale(scale, scale);
  const radial = ctx.createRadialGradient(0, 20, 0, 0, 0, 248); radial.addColorStop(0, 'rgba(29,218,213,.42)'); radial.addColorStop(1, 'rgba(12,164,166,0)');
  ctx.fillStyle = radial; ctx.beginPath(); ctx.arc(0, 0, 248, 0, Math.PI * 2); ctx.fill();
  tooth(ctx, 0, 0, 1.17);
  ctx.shadowColor = accent; ctx.shadowBlur = 15; ctx.strokeStyle = '#a3fffa'; ctx.lineWidth = 6; ctx.beginPath(); ctx.ellipse(0, 155, 146, 24, 0, 0, Math.PI * 2); ctx.stroke(); ctx.shadowBlur = 0;
  if (i === 0) {
    fillRounded(ctx, 126, -145, 66, 66, 20, accent); ctx.fillStyle = 'white'; ctx.font = 'bold 45px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('?', 159, -96);
  } else if (i === 1) {
    ctx.strokeStyle = accent; ctx.lineWidth = 9; ctx.beginPath(); ctx.moveTo(93, -35); ctx.lineTo(185, -87); ctx.stroke(); ctx.beginPath(); ctx.arc(186, -88, 13, 0, Math.PI * 2); ctx.fillStyle = '#ffffff'; ctx.fill();
  } else if (i === 2) {
    ctx.strokeStyle = '#eafdfd'; ctx.lineWidth = 9; ctx.beginPath(); ctx.moveTo(132, -70); ctx.lineTo(172, -48); ctx.lineTo(224, -116); ctx.stroke();
  } else if (i === 3) {
    ctx.strokeStyle = accent; ctx.lineWidth = 8; ctx.beginPath(); ctx.arc(4, 5, 190, 4.4, 6); ctx.stroke();
  } else {
    ctx.fillStyle = '#b6f5ea'; ctx.font = 'bold 44px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('✦', 144, -130);
  }
  ctx.restore();
}
function brandFooter(ctx, brand, isLast, accent) {
  if (brand.logo) {
    // loaded logo is handled independently by caller, here a no-logo brand mark remains consistent.
  }
  ctx.lineWidth = 2; ctx.strokeStyle = accent; ctx.beginPath(); ctx.moveTo(58, 1195); ctx.lineTo(1022, 1195); ctx.stroke();
  ctx.save(); ctx.translate(87, 1245); tooth(ctx, 0, 0, .16, { shadow: 'transparent' }); ctx.restore();
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.font = 'bold 34px Arial, sans-serif'; ctx.fillStyle = 'white'; ctx.fillText(brand.name || 'SmileCraft', 121, 1242);
  ctx.font = '20px Arial, sans-serif'; ctx.letterSpacing = '4px'; ctx.fillStyle = '#a9dadb'; ctx.fillText(brand.tagline || 'DENTAL CLINIC', 122, 1270); ctx.letterSpacing = '0px';
  if (isLast) { fillRounded(ctx, 610, 1213, 412, 70, 35, accent); ctx.font = 'bold 27px Arial, sans-serif'; ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.fillText('Book an appointment  →', 816, 1251); }
  else { ctx.textAlign = 'right'; ctx.font = '25px Arial, sans-serif'; ctx.fillStyle = '#89d0d0'; ctx.fillText('SWIPE  →', 1015, 1255); }
}
function baseDesign(ctx, template, brand, index) {
  const primary = brand.paletteOverride ? brand.primary : template.dark; const accent = brand.paletteOverride ? brand.accent : template.teal;
  const bg = ctx.createLinearGradient(0, 0, W, H); bg.addColorStop(0, primary); bg.addColorStop(.55, '#0a454e'); bg.addColorStop(1, template.id === 'premium' ? '#041923' : '#052c35'); ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  withAlpha(ctx, .19, () => { curvedLines(ctx, -15, -22, 140, '#83dad4'); curvedLines(ctx, 1018, 1140, 170, '#5ac6c3'); });
  ctx.textAlign = 'right'; ctx.font = 'bold 36px Arial, sans-serif'; ctx.fillStyle = '#8fdfda'; ctx.fillText(`${String(index + 1).padStart(2, '0')} / 05`, 1016, 79);
  for (let d = 0; d < 5; d++) { ctx.fillStyle = d === index ? '#a2fff2' : '#477b82'; ctx.beginPath(); ctx.arc(906 + d * 26, 115, 7, 0, Math.PI * 2); ctx.fill(); }
  return accent;
}
export async function renderSlide(project, index, { canvas = null, preview = false } = {}) {
  const c = canvas || document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d'); if (!ctx) throw new Error('Canvas not supported by this browser');
  await document.fonts?.ready;
  const slide = project.slides[index], tpl = (project.customTemplates || []).find(t => t.id === project.template) || project.templates?.find?.(t => t.id === project.template) || null;
  const actualTemplate = tpl || { id: project.template, dark: '#073a42', teal: '#13b2ae', light: '#b2f2eb', layout: project.template === 'clean' ? 'minimal' : project.template === 'friendly' ? 'circle' : 'split' };
  const accent = baseDesign(ctx, actualTemplate, project.brand, index);
  const image = await load(slide.image).catch(() => null);
  const layout = actualTemplate.layout || 'split';
  const isLast = index === 4;
  const heading = slide.heading || 'ഇവിടെ നിങ്ങളുടെ തലക്കെട്ട്';
  const body = slide.body || 'നിങ്ങളുടെ സന്ദേശം ഇവിടെ';
  let headY = 176, headX = 82, headW = 914;
  if (layout === 'minimal') { headW = 860; headX = 110; }
  withAlpha(ctx, .86, () => fillRounded(ctx, 80, 147, 175, 46, 23, '#0d7982'));
  ctx.fillStyle = '#d6fff8'; ctx.font = 'bold 21px Arial, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(slide.role.toUpperCase(), 167, 171);
  headY = 230;
  const headH = drawWrapped(ctx, heading, headX, headY, headW, { font: 66, maxLines: 3, maxHeight: 295, lineHeight: 1.49, weight: 800 });
  const heroTop = Math.max(480, headY + headH + 30);
  if (layout === 'minimal') {
    fillRounded(ctx, 88, heroTop, 904, 525, 42, 'rgba(6,93,102,.48)');
    if (image) cropImage(ctx, image, 108, heroTop + 19, 864, 490, 31);
    else drawIllustration(ctx, 540, heroTop + 225, 1.35, accent, index);
    drawWrapped(ctx, body, 112, Math.min(1082, heroTop + 563), 855, { font: 42, maxLines: 3, maxHeight: 180, weight: 500, color: '#d7ffff' });
  } else if (layout === 'circle') {
    if (image) ellipseImage(ctx, image, 545, heroTop + 248, 233);
    else drawIllustration(ctx, 540, heroTop + 234, 1.35, accent, index);
    drawWrapped(ctx, body, 110, Math.min(1048, heroTop + 525), 860, { font: 42, maxLines: 3, maxHeight: 180, weight: 500, color: '#e2ffff', align: 'center' });
  } else {
    if (image) cropImage(ctx, image, 86, heroTop + 8, 910, 492, 34);
    else drawIllustration(ctx, 540, heroTop + 247, 1.35, accent, index);
    drawWrapped(ctx, body, 100, Math.min(1072, heroTop + 535), 880, { font: 42, maxLines: 3, maxHeight: 165, weight: 500, color: '#e2ffff' });
  }
  brandFooter(ctx, project.brand, isLast, accent);
  if (project.brand.logo) {
    const logo = await load(project.brand.logo).catch(() => null);
    if (logo) { const r = Math.min(62 / logo.width, 62 / logo.height); ctx.drawImage(logo, 53, 1215, logo.width * r, logo.height * r); }
  }
  if (preview) { const ctx2 = c.getContext('2d'); ctx2.strokeStyle = 'rgba(255,255,255,.08)'; ctx2.lineWidth = 2; ctx2.strokeRect(1, 1, W - 2, H - 2); }
  return c;
}
export async function renderThumb(project, index) { const c = await renderSlide(project, index, { preview: true }); return c.toDataURL('image/jpeg', .77); }
export async function renderPngBlob(project, index) { const canvas = await renderSlide(project, index); return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not render PNG')), 'image/png')); }
export async function optimizedImage(file, limit = 1024) {
  if (!file?.type?.startsWith('image/')) throw new Error('Please choose a PNG, JPEG or WebP image.');
  if (file.size > 16_000_000) throw new Error('Image is over 16 MB. Please resize first.');
  const image = await createImageBitmap(file); const scale = Math.min(1, limit / Math.max(image.width, image.height));
  const canvas = document.createElement('canvas'); canvas.width = Math.round(image.width * scale); canvas.height = Math.round(image.height * scale);
  canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height); image.close();
  return canvas.toDataURL('image/jpeg', .84);
}
