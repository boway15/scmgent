import { runNewsIngest } from '../lib/news-intel/ingest-pipeline.js';
import { isNewsBitableConfigured, isNewsIntelEnabled } from '../lib/news-intel/config.js';

export async function runNewsIngestTask(taskRunId?: string) {
  const result = await runNewsIngest({ taskRunId });
  return {
    ...result,
    enabled: isNewsIntelEnabled(),
    bitableConfigured: isNewsBitableConfigured(),
  };
}
