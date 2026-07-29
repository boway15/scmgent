export function buildEtaPatch(etaAvailable: string) {
  return {
    etaAvailable,
    confirmedDeliveryDate: etaAvailable,
  };
}
