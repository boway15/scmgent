import { applyCostingFacts } from '../apps/web/server/lib/product-costing/service.ts';

const projectId = process.argv[2];
if (!projectId) {
  console.error('Usage: tsx scripts/reapply-costing-facts.mjs <project-id>');
  process.exit(1);
}

const result = await applyCostingFacts(projectId);
if (!result) {
  console.error('Project not found');
  process.exit(1);
}

console.log(
  JSON.stringify(
    result.lines
      .filter((line) => line.category === '五金')
      .map((line) => ({
        name: line.materialName,
        spec: line.spec,
        qty: line.qtyNet,
        notes: line.notes,
      })),
    null,
    2,
  ),
);
