export const PAYMENT_STATUS_LABEL = {
    paid: '是',
    unpaid: '否',
    not_required: '无需支付',
};
export function paymentStatusLabel(status) {
    return PAYMENT_STATUS_LABEL[status];
}
export function validatePaymentUpdate(input) {
    if (input.paymentStatus === 'not_required' && !input.remark?.trim()) {
        throw new Error('选择「无需支付」时备注必填');
    }
}
