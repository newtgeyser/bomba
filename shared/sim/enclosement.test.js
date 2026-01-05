import test from 'node:test';
import assert from 'node:assert/strict';
import { EnclosementDepth, makeEnclosementOrder, maxRings, ringsToFill } from './enclosement.js';

test('enclosement ringsToFill matches classic sizes', () => {
  assert.equal(ringsToFill(EnclosementDepth.None, 15, 11), 0);
  assert.equal(ringsToFill(EnclosementDepth.ALittle, 15, 11), 2);
  assert.equal(ringsToFill(EnclosementDepth.ALot, 15, 11), 4);
  assert.equal(ringsToFill(EnclosementDepth.AllTheWay, 15, 11), maxRings(15, 11));
});

test('enclosement order starts at top-left and goes clockwise', () => {
  const order = makeEnclosementOrder(5, 4, EnclosementDepth.ALittle);
  assert.deepEqual(order.slice(0, 8), [
    [0, 0],
    [1, 0],
    [2, 0],
    [3, 0],
    [4, 0],
    [4, 1],
    [4, 2],
    [4, 3],
  ]);
  // Must include bottom edge and return up left edge.
  assert.deepEqual(order.slice(8, 13), [
    [3, 3],
    [2, 3],
    [1, 3],
    [0, 3],
    [0, 2],
  ]);
});

