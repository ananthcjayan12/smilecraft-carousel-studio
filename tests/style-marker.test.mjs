import test from 'node:test';
import assert from 'node:assert/strict';
import { attachStyleMarker, appendMarkNote, styleReferenceImage, styleVariantInstructions } from '../web/style-variant.js';

function markerCanvas() {
  const labels = [], draws = [];
  const context = { clearRect() {}, drawImage(...args) { draws.push(args); }, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, arc() {}, fill() {}, fillText(...args) { labels.push(args); } };
  return { width: 1600, height: 900, labels, draws, getContext: () => context, getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 450 }), setPointerCapture() {}, toDataURL: () => 'data:image/png;base64,marked' };
}
const pointer = { button: 0, pointerId: 1, clientX: 200, clientY: 100, preventDefault() {} };

test('each completed mark adds one matching note and undo does not reuse its number', () => {
  const canvas = markerCanvas(), strokes = [];
  let nextNumber = 1, notes = 'Keep the layout.';
  attachStyleMarker(canvas, {}, strokes, false, {
    getMarkNumber: () => nextNumber++,
    onMark: number => { notes = appendMarkNote(notes, number); },
  });
  canvas.onpointerdown(pointer);
  canvas.onpointermove({ ...pointer, clientX: 300 });
  canvas.onpointerup();
  canvas.onlostpointercapture();
  assert.equal(strokes[0].number, 1);
  assert.equal(notes, 'Keep the layout.\nMark 1: ');
  notes += 'Replace the photo.';
  canvas.onpointerdown(pointer); canvas.onpointerup();
  assert.equal(strokes[1].number, 2);
  strokes.pop();
  canvas.onpointerdown(pointer); canvas.onpointercancel();
  assert.deepEqual(strokes.map(stroke => stroke.number), [1, 3]);
  assert.match(notes, /Mark 1: Replace the photo\.\nMark 2: \nMark 3: $/);
  assert.deepEqual(canvas.labels.slice(-2).map(label => label[0]), ['1', '3']);
});

test('export preserves the full image dimensions and includes numbered badges', () => {
  const canvas = markerCanvas(), previousDocument = globalThis.document;
  globalThis.document = { createElement: () => canvas };
  try {
    const image = { naturalWidth: 2048, naturalHeight: 1536 };
    const stroke = [{ x: 1, y: 0 }]; stroke.number = 7;
    assert.equal(styleReferenceImage(image, [stroke]), 'data:image/png;base64,marked');
    assert.deepEqual(canvas.draws[0], [image, 0, 0, 2048, 1536]);
    assert.equal(canvas.labels[0][0], '7');
    assert.ok(canvas.labels[0][1] < canvas.width);
    assert.ok(canvas.labels[0][2] > 0);
  } finally { globalThis.document = previousDocument; }
});

test('variation instructions connect note numbers to badges and remove annotation labels', () => {
  const prompt = styleVariantInstructions({ sourceTemplateId: 'style', revisionNotes: 'Mark 2: Warm colours.' });
  assert.match(prompt, /Match each "Mark N:" instruction/);
  assert.match(prompt, /Mark 2: Warm colours/);
  assert.match(prompt, /including every numbered badge/);
});
