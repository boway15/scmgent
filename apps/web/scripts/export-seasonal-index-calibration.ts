/**
 * 【已停用校准路径】季节指数应写入系统预测，不要走「导入校准」。
 * 请改用：
 *   pnpm --filter @scm/web exec tsx scripts/apply-seasonal-index-to-system.ts --version-id <uuid> --from-shadow
 * 若历史上误把季节指数写进了 manual_daily_avg：
 *   pnpm --filter @scm/web exec tsx scripts/apply-seasonal-index-to-system.ts --version-id <uuid> --promote-mistaken-calibration
 */
console.error(
  '季节指数请写入系统预测（forecast_daily_avg），不要导出/导入为校准值。\n' +
    '请使用 scripts/apply-seasonal-index-to-system.ts',
);
process.exit(1);
