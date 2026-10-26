### Task 5: 参数集数据表与迁移

**Files:**
- Create: `packages/db/src/schema/rules.ts`
- Modify: `packages/db/src/schema/index.ts`
- Create: `packages/db/drizzle/0123_rule_param_sets.sql`
- Modify: `packages/db/drizzle/meta/_journal.json`

**Interfaces:**
- Produces: drizzle 表对象 `ruleParamSets`、`ruleEvalRuns`（从 `@scm/db` 导出）

- [ ] **Step 1: 写 schema**

`packages/db/src/schema/rules.ts`：

```ts
import { pgTable, uuid, varchar, text, integer, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { users } from './auth';

/** 规则参数集。params 只存该作用范围覆盖的键，未出现的键向上继承。 */
export const ruleParamSets = pgTable(
  'rule_param_sets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    moduleCode: varchar('module_code', { length: 50 }).notNull(),
    scopeType: varchar('scope_type', { length: 20 }).notNull(),
    scopeValue: varchar('scope_value', { length: 100 }).notNull(),
    params: jsonb('params').notNull(),
    version: integer('version').notNull(),
    /** draft / pending_approval / active / archived */
    status: varchar('status', { length: 20 }).notNull().default('draft'),
    note: text('note'),
    reviewNote: text('review_note'),
    simulatedAt: timestamp('simulated_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id),
    approvedBy: uuid('approved_by').references(() => users.id),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    activatedAt: timestamp('activated_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    moduleScopeIdx: index('rule_param_sets_module_scope_idx').on(
      table.moduleCode,
      table.scopeType,
      table.scopeValue,
    ),
  }),
);

/** 每次规则评估一行；建议 / 预警只存 run id。 */
export const ruleEvalRuns = pgTable('rule_eval_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  moduleCode: varchar('module_code', { length: 50 }).notNull(),
  /** task / simulation / page */
  trigger: varchar('trigger', { length: 20 }).notNull(),
  moduleVersion: integer('module_version').notNull(),
  paramSetIds: jsonb('param_set_ids').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
});
```

`packages/db/src/schema/index.ts` 末尾加 `export * from './rules';`

- [ ] **Step 2: 写迁移 SQL**

`packages/db/drizzle/0123_rule_param_sets.sql`：

```sql
CREATE TABLE IF NOT EXISTS "rule_param_sets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "module_code" varchar(50) NOT NULL,
  "scope_type" varchar(20) NOT NULL,
  "scope_value" varchar(100) NOT NULL,
  "params" jsonb NOT NULL,
  "version" integer NOT NULL,
  "status" varchar(20) DEFAULT 'draft' NOT NULL,
  "note" text,
  "review_note" text,
  "simulated_at" timestamptz,
  "created_by" uuid REFERENCES "users"("id"),
  "approved_by" uuid REFERENCES "users"("id"),
  "approved_at" timestamptz,
  "activated_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "rule_param_sets_module_scope_idx"
  ON "rule_param_sets" ("module_code", "scope_type", "scope_value");

CREATE UNIQUE INDEX IF NOT EXISTS "rule_param_sets_one_active_idx"
  ON "rule_param_sets" ("module_code", "scope_type", "scope_value")
  WHERE "status" = 'active';

CREATE UNIQUE INDEX IF NOT EXISTS "rule_param_sets_version_idx"
  ON "rule_param_sets" ("module_code", "scope_type", "scope_value", "version");

CREATE TABLE IF NOT EXISTS "rule_eval_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "module_code" varchar(50) NOT NULL,
  "trigger" varchar(20) NOT NULL,
  "module_version" integer NOT NULL,
  "param_set_ids" jsonb NOT NULL,
  "started_at" timestamptz DEFAULT now() NOT NULL,
  "finished_at" timestamptz
);
```

- [ ] **Step 3: 登记 journal**

在 `packages/db/drizzle/meta/_journal.json` 的 `entries` 数组末尾（`0122_drop_procurement_costing_menu` 之后）追加：

```json
    {
      "idx": 104,
      "version": "6",
      "when": 1787573600000,
      "tag": "0123_rule_param_sets",
      "breakpoints": true
    }
```

- [ ] **Step 4: 本地迁移验证**

Run: `pnpm db:migrate`
Expected: 成功；`psql` 中 `\d rule_param_sets` 可见部分唯一索引 `rule_param_sets_one_active_idx`。

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/schema/rules.ts packages/db/src/schema/index.ts packages/db/drizzle/0123_rule_param_sets.sql packages/db/drizzle/meta/_journal.json
git commit -m "feat(db): rule_param_sets and rule_eval_runs"
```

---

