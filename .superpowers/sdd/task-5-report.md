# Task 5 Report: 参数集数据表与迁移

## Status

**DONE**

## Commit

- SHA: `c9d59a0795f6a922bb18d6f08a78b0edbba4cd83`
- Subject: `feat(db): rule_param_sets and rule_eval_runs`
- Branch: `feat/rule-modules-p0`
- Staged only the 4 files named in the brief (not `git add -A`).

## Files Changed (4)

| File | Action |
|------|--------|
| `packages/db/src/schema/rules.ts` | Created: `ruleParamSets`, `ruleEvalRuns` |
| `packages/db/src/schema/index.ts` | Appended `export * from './rules';` |
| `packages/db/drizzle/0123_rule_param_sets.sql` | Created migration SQL (verbatim from brief) |
| `packages/db/drizzle/meta/_journal.json` | Appended idx 104 / tag `0123_rule_param_sets` |

## Migration: `pnpm db:migrate`

```text
> scm-agent@1.2.0 db:migrate D:\Docker\project\scm-agent
> pnpm --filter @scm/db migrate

> @scm/db@1.2.0 migrate D:\Docker\project\scm-agent\packages\db
> drizzle-kit migrate

drizzle-kit: v0.21.4
drizzle-orm: v0.30.10

No config path provided, using default path
Reading config file 'D:\Docker\project\scm-agent\packages\db\drizzle.config.ts'
Using 'postgres' driver for database querying
[⣷] applying migrations...{
  severity_local: 'NOTICE',
  severity: 'NOTICE',
  code: '42P06',
  message: 'schema "drizzle" already exists, skipping',
  file: 'schemacmds.c',
  line: '132',
  routine: 'CreateSchemaCommand'
}
{
  severity_local: 'NOTICE',
  severity: 'NOTICE',
  code: '42P07',
  message: 'relation "__drizzle_migrations" already exists, skipping',
  file: 'parse_utilcmd.c',
  line: '207',
  routine: 'transformCreateStmt'
}
[✓] migrations applied successfully!
```

Exit code: 0

## Index check: `\d rule_param_sets`

Command:

```text
docker exec scm-agent-postgres-1 psql -U scm -d scm_dev -c "\d rule_param_sets"
```

Output (indexes section):

```text
Indexes:
    "rule_param_sets_pkey" PRIMARY KEY, btree (id)
    "rule_param_sets_module_scope_idx" btree (module_code, scope_type, scope_value)
    "rule_param_sets_one_active_idx" UNIQUE, btree (module_code, scope_type, scope_value) WHERE status::text = 'active'::text
    "rule_param_sets_version_idx" UNIQUE, btree (module_code, scope_type, scope_value, version)
```

Partial unique index `rule_param_sets_one_active_idx` is present as specified.

## Scope

- No API routes added.
- No replenishment logic changes.
- Journal was appended at idx 104; existing entries not renumbered.

## Concerns

None.
