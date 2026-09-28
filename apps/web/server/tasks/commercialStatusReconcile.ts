import {
  reconcileCommercialStatusFromAllSources,
  summarizeCommercialStatusDistribution,
} from '../lib/commercial-status-sync.js';

export async function runCommercialStatusReconcile() {
  const { results, totals } = await reconcileCommercialStatusFromAllSources();
  const distribution = await summarizeCommercialStatusDistribution();
  return { results, totals, distribution };
}
