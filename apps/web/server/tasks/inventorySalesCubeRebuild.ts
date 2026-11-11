import { rebuildInventorySalesCube } from '../lib/inventory-sales-cube.js';

export async function runInventorySalesCubeRebuild(actorId?: string | null) {
  return rebuildInventorySalesCube({ actorId: actorId ?? null });
}
