import assert from 'node:assert/strict';
import {
  computeContainerMatch,
  buildNoAllocationMessage,
  buildNonFobHint,
  blocksCalculation,
} from './fob-container-match.js';

const match = computeContainerMatch(['TRHU7756093', 'FFAU6655749'], ['TGBU8956723', 'TRHU7756093']);
assert.equal(match.matchedCount, 1);
assert.deepEqual(match.matched, ['TRHU7756093']);
assert.equal(match.volumeOnly.length, 1);
assert.equal(match.billOnly.length, 1);
assert.equal(match.nonFobOnly.length, 0);

const nonFob = computeContainerMatch(['TRHU7756093'], ['TRHU7756093', 'NONFOB1'], {
  nonFobContainers: ['NONFOB1'],
});
assert.deepEqual(nonFob.billOnly, []);
assert.deepEqual(nonFob.nonFobOnly, ['NONFOB1']);
assert.equal(blocksCalculation(nonFob), false);
assert.match(buildNonFobHint(nonFob)!, /非 FOB/);

const noOverlap = computeContainerMatch(['A'], ['B']);
assert.equal(noOverlap.canAllocate, false);
assert.match(buildNoAllocationMessage(noOverlap), /无交集/);

console.log('fob-container-match tests passed');