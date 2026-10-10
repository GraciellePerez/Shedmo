import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { clampPan, fitPhoto, isOutsidePhoto } from '../../src/features/messaging/components/photoViewerGeometry.ts';

test('portrait and landscape photos retain aspect ratio within viewer bounds', () => {
  for (const [w, h] of [[400, 1200], [1600, 900], [100, 100]]) {
    const size = fitPhoto(w, h, 390, 844);
    assert.ok(Math.abs(size.width / size.height - w / h) < 0.00001);
    assert.ok(size.width <= 390 && size.height <= 844 * 0.84);
  }
});

test('pan bounds prevent dragging the photo offscreen and reset at minimum zoom', () => {
  assert.equal(clampPan(200, 390, 390, 1), 0);
  assert.equal(clampPan(900, 390, 390, 2), 195);
  assert.equal(clampPan(-900, 390, 390, 2), -195);
  assert.equal(clampPan(30, 100, 390, 2), 0);
});

test('backdrop hit testing accounts for letterboxing, zoom, and panning', () => {
  assert.equal(isOutsidePhoto(195, 422, 200, 300, 390, 844, 1, 0, 0), false);
  assert.equal(isOutsidePhoto(20, 422, 200, 300, 390, 844, 1, 0, 0), true);
  assert.equal(isOutsidePhoto(195, 30, 200, 300, 390, 844, 1, 0, 0), true);
  assert.equal(isOutsidePhoto(20, 422, 200, 300, 390, 844, 2, 0, 0), false);
  assert.equal(isOutsidePhoto(20, 422, 200, 300, 390, 844, 2, 100, 0), true);
});

test('viewer gives gestures priority over dismissal and resets by remounting', () => {
  const viewer = readFileSync('src/features/messaging/components/PhotoViewer.tsx', 'utf8');
  assert.match(viewer, /Gesture.Exclusive\(Gesture.Simultaneous\(pinch, pan\), tap\)/);
  assert.match(viewer, /event.numberOfTouches > 1\) manager.fail\(\)/);
  assert.match(viewer, /Math.max\(1, Math.min\(4,/);
  assert.match(viewer, /top: insets.top \+ spacing.sm/);
  const attachment = readFileSync('src/features/messaging/components/ChatImageAttachment.tsx', 'utf8');
  assert.match(attachment, /expanded \? <PhotoViewer key=\{path\}/);
});
