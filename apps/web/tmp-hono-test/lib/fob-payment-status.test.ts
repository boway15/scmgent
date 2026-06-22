import assert from 'node:assert/strict';
import { test } from 'node:test';
import { paymentStatusLabel, validatePaymentUpdate } from './fob-payment-status.js';

test('paymentStatusLabel maps unpaid to 否', () => {
  assert.equal(paymentStatusLabel('unpaid'), '否');
});

test('validatePaymentUpdate requires remark for not_required', () => {
  assert.throws(
    () => validatePaymentUpdate({ paymentStatus: 'not_required', remark: '' }),
    /备注必填/,
  );
});

test('validatePaymentUpdate accepts not_required with remark', () => {
  assert.doesNotThrow(() =>
    validatePaymentUpdate({ paymentStatus: 'not_required', remark: '总部代付' }),
  );
});
