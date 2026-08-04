import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "..", "..", "canvases", "scm-feishu-ai-blueprint.canvas.tsx");
const dest = join(root, "src", "BlueprintReport.tsx");

mkdirSync(dirname(dest), { recursive: true });

if (!existsSync(src)) {
  if (existsSync(dest)) {
    console.log("Canvas source not found; using committed src/BlueprintReport.tsx");
    process.exit(0);
  }
  console.error("Missing canvas source and src/BlueprintReport.tsx");
  process.exit(1);
}

copyFileSync(src, dest);
console.log("Synced canvas -> src/BlueprintReport.tsx");
