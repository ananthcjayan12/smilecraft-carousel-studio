import { DESIGN_SYSTEMS, readTemplatePackZip, blobToDataUrl } from './design-systems.js';

// One-time local installation: all references remain original AI-generated PNGs.
// Persist images as files on the user's localhost server, not in browser localStorage.
export async function installTemplatePack(file, onProgress = () => {}) {
  const images = await readTemplatePackZip(file);
  const entries = [...DESIGN_SYSTEMS.map(system => [system.id, images.get(system.id + '.png')]), ['clinic-logo', images.get('clinic-logo.jpg')]];
  let done = 0;
  for (const [id, blob] of entries) {
    const response = await fetch('/api/template-pack', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, image: await blobToDataUrl(blob) }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Template installation failed for ' + id);
    onProgress(++done, entries.length);
  }
  return { installed: DESIGN_SYSTEMS.map(t => t.id), logo: await blobToDataUrl(images.get('clinic-logo.jpg')) };
}
