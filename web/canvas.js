const W = 1080, H = 1350;

export async function optimizedImage(file, limit = 1280) {
  if (!file?.type?.startsWith('image/')) throw new Error('Please choose a PNG, JPEG or WebP image.');
  if (file.size > 16_000_000) throw new Error('Image is over 16 MB. Please resize first.');
  const image = await createImageBitmap(file); const scale = Math.min(1, limit / Math.max(image.width, image.height));
  const canvas = document.createElement('canvas'); canvas.width = Math.round(image.width * scale); canvas.height = Math.round(image.height * scale);
  canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height); image.close();
  return canvas.toDataURL(file.type === 'image/png' ? 'image/png' : 'image/jpeg', .9);
}

export async function finalArtworkBlob(dataUrl) {
  if (!/^data:image\/(png|jpeg|webp);base64,/i.test(dataUrl || '')) throw new Error('Generate this slide artwork before downloading it.');
  const blob = await (await fetch(dataUrl)).blob();
  const image = await createImageBitmap(blob);
  const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  const scale = Math.max(W / image.width, H / image.height);
  const width = image.width * scale, height = image.height * scale;
  ctx.drawImage(image, (W - width) / 2, (H - height) / 2, width, height); image.close();
  return new Promise((resolve, reject) => canvas.toBlob(result => result ? resolve(result) : reject(new Error('Could not prepare final PNG.')), 'image/png'));
}
