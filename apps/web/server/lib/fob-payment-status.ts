export type PaymentStatus = 'paid' | 'unpaid' | 'not_required';

export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  paid: '是',
  unpaid: '否',
  not_required: '无需支付',
};

export function paymentStatusLabel(status: PaymentStatus): string {
  return PAYMENT_STATUS_LABEL[status];
}

export function validatePaymentUpdate(input: {
  paymentStatus: PaymentStatus;
  remark?: string | null;
}): void {
  if (input.paymentStatus === 'not_required' && !input.remark?.trim()) {
    throw new Error('选择「无需支付」时备注必填');
  }
}
