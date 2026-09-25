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
