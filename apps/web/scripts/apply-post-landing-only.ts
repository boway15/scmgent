import { config } from "dotenv";
import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import { db, salesForecastVersions } from "@scm/db";
import { applyOptimismDampAfterLanding } from "../server/lib/forecast-optimism-post-landing.js";

const ROOT = resolve(import.meta.dirname, "../../..");
config({ path: resolve(ROOT, ".env") });

const VERSION_NO = process.env.VERSION_NO || "DRAFT-1794197424316";
const [v] = await db
  .select({ id: salesForecastVersions.id, versionNo: salesForecastVersions.versionNo })
  .from(salesForecastVersions)
  .where(eq(salesForecastVersions.versionNo, VERSION_NO))
  .limit(1);
if (!v) throw new Error("version not found: " + VERSION_NO);
const post = await applyOptimismDampAfterLanding({ versionId: v.id });
console.log(JSON.stringify({ versionNo: v.versionNo, versionId: v.id, ...post }, null, 2));
process.exit(0);
