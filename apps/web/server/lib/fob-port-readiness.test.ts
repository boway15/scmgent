import assert from 'node:assert/strict';
import {
  assessFreightBillPortReadiness,
  fillFreightVolumeOriginPorts,
  freightPortIdsWithRules,
  summarizeFreightVolumeImport,
} from './fob-port-readiness.js';

{
  const filled = fillFreightVolumeOriginPorts([
    { containerNo: 'C1', originPort: '厦门港' },
    { containerNo: 'C1', originPort: '' },
    { containerNo: 'C2', originPort: '上海' },
    { containerNo: 'C2', originPort: '宁波' },
  ]);
  assert.equal(filled[1]?.originPort, '厦门港');
  assert.equal(filled[2]?.originPort, '上海');
  assert.equal(filled[3]?.originPort, '宁波');
}

{
  const warnings = summarizeFreightVolumeImport({
    items: [
      { containerNo: 'C1', originPort: undefined },
      { containerNo: 'C2', originPort: undefined },
    ],
    originPortColumnFound: false,
    registeredPortNames: ['厦门港'],
  });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0] ?? '', /没有「起运港」列/);
}

{
  const warnings = summarizeFreightVolumeImport({
    items: [
      { containerNo: 'BILL', originPort: '上海' },
      { containerNo: 'EXTRA', originPort: '宁波' },
      { containerNo: 'EMPTY', originPort: '' },
      { containerNo: 'KNOWN', originPort: '厦门港' },
    ],
    originPortColumnFound: true,
    registeredPortNames: ['厦门港', '模板港口'],
  });
  assert.equal(warnings.length, 2);
  assert.match(warnings[0] ?? '', /宁波（1 柜）/);
  assert.match(warnings[0] ?? '', /上海（1 柜）/);
  assert.match(warnings[0] ?? '', /只有出现在本批货代账单中的柜/);
  assert.match(warnings[1] ?? '', /EMPTY/);
}

{
  const ports = new Map([
    ['厦门港', 'port-xm'],
    ['宁波', 'port-nb'],
  ]);
  const withRules = freightPortIdsWithRules([
    { sourceBillType: 'freight', portId: 'port-xm' },
    { sourceBillType: 'trucking', portId: null },
    { sourceBillType: 'freight', portId: null },
  ]);

  const readiness = assessFreightBillPortReadiness({
    shipments: [
      { containerNo: 'USED', originPort: '厦门港' },
      { containerNo: 'EXTRA', originPort: '上海' },
      { containerNo: 'EXTRA2', originPort: '青岛' },
    ],
    matchedContainers: ['USED'],
    portNameToId: ports,
    portIdsWithRules: withRules,
  });
  assert.equal(readiness.ok, true);
  assert.deepEqual(readiness.blockers, []);
}

{
  const ports = new Map([['宁波', 'port-nb']]);
  const readiness = assessFreightBillPortReadiness({
    shipments: [
      { containerNo: 'A', originPort: '上海' },
      { containerNo: 'A2', originPort: '上海' },
      { containerNo: 'B', originPort: '宁波' },
      { containerNo: 'C', originPort: '' },
      { containerNo: 'D', originPort: '盐田' },
      { containerNo: 'D', originPort: '青岛' },
      { containerNo: 'EXTRA', originPort: '深圳' },
    ],
    matchedContainers: ['A', 'A2', 'B', 'C', 'D'],
    portNameToId: ports,
    portIdsWithRules: new Set(),
  });
  assert.equal(readiness.ok, false);
  assert.deepEqual(readiness.conflictContainers, ['D']);
  assert.deepEqual(readiness.missingPortContainers, ['C']);
  assert.deepEqual(readiness.unregistered, [{ portName: '上海', containerCount: 2 }]);
  assert.deepEqual(readiness.noRules, [{ portName: '宁波', containerCount: 1 }]);
  assert.equal(readiness.blockers.length, 4);
  assert.match(readiness.blockers[2] ?? '', /体积文件里其余港口不用处理/);
  assert.ok(!readiness.blockers.some((line) => line.includes('深圳')));
}

console.log('fob-port-readiness.test.ts: all passed');
