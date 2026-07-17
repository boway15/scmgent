import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { contentDispositionAttachment, csvAttachment } from './csv-export.js';

describe('csv-export Content-Disposition', () => {
  it('encodes non-ascii filename without raw unicode in header value', () => {
    const header = contentDispositionAttachment('forecast-horizon-wide-预测版-2026-07-15.csv');
    assert.match(header, /^attachment; filename="[^"]*"; filename\*=UTF-8''/);
    assert.equal(/[\u4e00-\u9fff]/.test(header.replace(/filename\*=UTF-8''[^;]*/, '')), false);
    assert.match(header, /filename\*=UTF-8''forecast-horizon-wide-%E9%A2%84%E6%B5%8B%E7%89%88-2026-07-15\.csv/);
  });

  it('csvAttachment response header is ascii-safe for Node http', () => {
    const res = csvAttachment('预测宽表.csv', 'a,b\n1,2');
    const disposition = res.headers.get('Content-Disposition') ?? '';
    for (let i = 0; i < disposition.length; i += 1) {
      assert.ok(disposition.charCodeAt(i) <= 0xff, `non-latin1 at ${i}: ${disposition}`);
    }
  });
});
