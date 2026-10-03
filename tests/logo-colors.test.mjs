import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickLogoColors } from '../web/logo-colors.js';

test('logo color analysis ignores transparent and white pixels and selects distinct brand colors', () => {
  const pixels = [];
  for (let i = 0; i < 40; i++) pixels.push(12, 110, 126, 255);
  for (let i = 0; i < 20; i++) pixels.push(242, 153, 38, 255);
  for (let i = 0; i < 100; i++) pixels.push(255, 255, 255, i % 2 ? 255 : 0);
  const result = pickLogoColors(Uint8ClampedArray.from(pixels));
  assert.equal(result.primary, '#0c6e7e');
  assert.equal(result.accent, '#f29926');
});

test('single-color logos receive a contrasting fallback accent', () => {
  const pixels = Uint8ClampedArray.from(Array.from({ length: 20 }, () => [40, 80, 120, 255]).flat());
  const result = pickLogoColors(pixels);
  assert.equal(result.primary, '#285078');
  assert.notEqual(result.accent, result.primary);
});

test('transparent logos are flattened onto a backdrop that keeps their lettering visible', async () => {
  const { logoBackdrop } = await import('../web/v4/logo-colours.js');
  const px = (...pixels) => new Uint8ClampedArray(pixels.flat());
  // Black monogram on transparency (e.g. SS/B): white backdrop, never black.
  assert.equal(logoBackdrop(px([0, 0, 0, 255], [0, 0, 0, 0], [0, 0, 0, 0], [80, 180, 180, 255])), '#ffffff');
  // White logo on transparency: dark backdrop.
  assert.equal(logoBackdrop(px([255, 255, 255, 255], [250, 250, 250, 255], [0, 0, 0, 0])), '#1f2329');
  // Already opaque: leave untouched.
  assert.equal(logoBackdrop(px([0, 0, 0, 255], [255, 255, 255, 255])), null);
});
