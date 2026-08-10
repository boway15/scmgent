/** Cron / 系统触发时不写 users.id（uuid），避免 `invalid input syntax for type uuid: "cron"`。 */
export function resolveProcurementSyncActorId(
  actorId?: string | null,
): string | null {
  if (actorId == null) return null;
  const trimmed = actorId.trim();
  if (!trimmed || trimmed === 'cron') return null;
  return trimmed;
}
