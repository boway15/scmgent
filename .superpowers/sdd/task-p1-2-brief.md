### Task 2: Schema `lead_time_profiles` + 杩佺Щ

**Files:**
- Create: `packages/db/src/schema/lead-time.ts`
- Modify: `packages/db/src/schema/index.ts`锛坋xport锛?- Create: `packages/db/drizzle/0054_lead_time_profiles.sql`锛堣嫢 Task 3 鍏堝崰 0053锛屾湰浠诲姟鐢?0054锛?*缁熶竴锛氭湰浠诲姟 0053_lead_time_profiles锛孴ask 4 璺熷崟鐢?0054**锛?- Modify: `packages/db/drizzle/meta/_journal.json`

**Interfaces:**
- Produces table `lead_time_profiles` 瀛楁瀵归綈 spec 搂5.3锛坱ransport_mode / origin_location nullable锛?
- [ ] **Step 1: 鍐?schema**

```ts
export const transportModeEnum = pgEnum('transport_mode', [
  'fcl', 'lcl', 'air', 'express', 'rail', 'truck_air', 'direct',
]);

export const leadTimeProfiles = pgTable('lead_time_profiles', {
  id: uuid('id').primaryKey().defaultRandom(),
  merchantCode: varchar('merchant_code', { length: 100 }),
  originLocation: varchar('origin_location', { length: 100 }),
  destinationWarehouseCode: varchar('destination_warehouse_code', { length: 100 }).notNull(),
  transportMode: transportModeEnum('transport_mode'),
  productionDays: integer('production_days').notNull().default(0),
  domesticDays: integer('domestic_days').notNull().default(0),
  bookingDays: integer('booking_days').notNull().default(0),
  transitDays: integer('transit_days').notNull().default(0),
  customsDays: integer('customs_days').notNull().default(0),
  inboundDays: integer('inbound_days').notNull().default(0),
  leadTimeStdDev: integer('lead_time_std_dev'),
  isDefault: boolean('is_default').notNull().default(false),
  sourceSystem: varchar('source_system', { length: 50 }),
  externalId: varchar('external_id', { length: 100 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
```

鍞竴鎬у缓璁細閮ㄥ垎鍞竴绱㈠紩闅惧湪 PG 琛ㄨ揪鍙┖鍒椻€斺€斿簲鐢ㄥ眰淇濊瘉銆屽悓 merchant+warehouse+mode 浠呬竴鏉?is_default銆嶏紱SQL 鍙姞鏅€氱储寮?`(merchant_code, destination_warehouse_code)`銆?
- [ ] **Step 2: SQL + journal idx**

```sql
CREATE TYPE "public"."transport_mode" AS ENUM ('fcl','lcl','air','express','rail','truck_air','direct');
CREATE TABLE IF NOT EXISTS "lead_time_profiles" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "merchant_code" varchar(100),
  "origin_location" varchar(100),
  "destination_warehouse_code" varchar(100) NOT NULL,
  "transport_mode" "public"."transport_mode",
  "production_days" integer DEFAULT 0 NOT NULL,
  "domestic_days" integer DEFAULT 0 NOT NULL,
  "booking_days" integer DEFAULT 0 NOT NULL,
  "transit_days" integer DEFAULT 0 NOT NULL,
  "customs_days" integer DEFAULT 0 NOT NULL,
  "inbound_days" integer DEFAULT 0 NOT NULL,
  "lead_time_std_dev" integer,
  "is_default" boolean DEFAULT false NOT NULL,
  "source_system" varchar(50),
  "external_id" varchar(100),
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "lead_time_profiles_merchant_wh_idx"
  ON "lead_time_profiles" ("merchant_code", "destination_warehouse_code");
```

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(db): add lead_time_profiles for route lead-time config

EOF
)"
```

---
