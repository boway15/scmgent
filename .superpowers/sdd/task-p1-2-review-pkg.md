# Review P1 Task2
BASE: 995359ccd7d31b8f6c5e67709e668880d590fddc
HEAD: 42a36a502d515d01e6dfeb18f476f4c2d415ab81
## Commits
42a36a5 feat(db): add lead_time_profiles for route lead-time config

## Stat
 packages/db/drizzle/0053_lead_time_profiles.sql | 24 ++++++++++++
 packages/db/drizzle/meta/_journal.json          |  7 ++++
 packages/db/src/schema/index.ts                 |  1 +
 packages/db/src/schema/lead-time.ts             | 49 +++++++++++++++++++++++++
 4 files changed, 81 insertions(+)

## Diff
diff --git a/packages/db/drizzle/0053_lead_time_profiles.sql b/packages/db/drizzle/0053_lead_time_profiles.sql
new file mode 100644
index 0000000..57223b8
--- /dev/null
+++ b/packages/db/drizzle/0053_lead_time_profiles.sql
@@ -0,0 +1,24 @@
+CREATE TYPE "public"."transport_mode" AS ENUM ('fcl','lcl','air','express','rail','truck_air','direct');
+--> statement-breakpoint
+CREATE TABLE IF NOT EXISTS "lead_time_profiles" (
+  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
+  "merchant_code" varchar(100),
+  "origin_location" varchar(100),
+  "destination_warehouse_code" varchar(100) NOT NULL,
+  "transport_mode" "public"."transport_mode",
+  "production_days" integer DEFAULT 0 NOT NULL,
+  "domestic_days" integer DEFAULT 0 NOT NULL,
+  "booking_days" integer DEFAULT 0 NOT NULL,
+  "transit_days" integer DEFAULT 0 NOT NULL,
+  "customs_days" integer DEFAULT 0 NOT NULL,
+  "inbound_days" integer DEFAULT 0 NOT NULL,
+  "lead_time_std_dev" integer,
+  "is_default" boolean DEFAULT false NOT NULL,
+  "source_system" varchar(50),
+  "external_id" varchar(100),
+  "created_at" timestamptz DEFAULT now() NOT NULL,
+  "updated_at" timestamptz DEFAULT now() NOT NULL
+);
+--> statement-breakpoint
+CREATE INDEX IF NOT EXISTS "lead_time_profiles_merchant_wh_idx"
+  ON "lead_time_profiles" ("merchant_code", "destination_warehouse_code");
diff --git a/packages/db/drizzle/meta/_journal.json b/packages/db/drizzle/meta/_journal.json
index ee6dd78..822fd41 100644
--- a/packages/db/drizzle/meta/_journal.json
+++ b/packages/db/drizzle/meta/_journal.json
@@ -327,9 +327,16 @@
     {
       "idx": 47,
       "version": "6",
       "when": 1785216000001,
       "tag": "0052_purchase_draft_eta_available",
       "breakpoints": true
+    },
+    {
+      "idx": 48,
+      "version": "6",
+      "when": 1785216000002,
+      "tag": "0053_lead_time_profiles",
+      "breakpoints": true
     }
   ]
 }
diff --git a/packages/db/src/schema/index.ts b/packages/db/src/schema/index.ts
index cead4dc..7a3816d 100644
--- a/packages/db/src/schema/index.ts
+++ b/packages/db/src/schema/index.ts
@@ -10,6 +10,7 @@ export * from './procurement-lists';
 export * from './pmc';
 export * from './ai';
 export * from './logistics';
 export * from './ops';
 export * from './news-intel';
 export * from './cs-reply-quality';
+export * from './lead-time';
diff --git a/packages/db/src/schema/lead-time.ts b/packages/db/src/schema/lead-time.ts
new file mode 100644
index 0000000..dca20dc
--- /dev/null
+++ b/packages/db/src/schema/lead-time.ts
@@ -0,0 +1,49 @@
+import {
+  pgTable,
+  pgEnum,
+  uuid,
+  varchar,
+  boolean,
+  integer,
+  timestamp,
+  index,
+} from 'drizzle-orm/pg-core';
+
+export const transportModeEnum = pgEnum('transport_mode', [
+  'fcl',
+  'lcl',
+  'air',
+  'express',
+  'rail',
+  'truck_air',
+  'direct',
+]);
+
+export const leadTimeProfiles = pgTable(
+  'lead_time_profiles',
+  {
+    id: uuid('id').primaryKey().defaultRandom(),
+    merchantCode: varchar('merchant_code', { length: 100 }),
+    originLocation: varchar('origin_location', { length: 100 }),
+    destinationWarehouseCode: varchar('destination_warehouse_code', { length: 100 }).notNull(),
+    transportMode: transportModeEnum('transport_mode'),
+    productionDays: integer('production_days').notNull().default(0),
+    domesticDays: integer('domestic_days').notNull().default(0),
+    bookingDays: integer('booking_days').notNull().default(0),
+    transitDays: integer('transit_days').notNull().default(0),
+    customsDays: integer('customs_days').notNull().default(0),
+    inboundDays: integer('inbound_days').notNull().default(0),
+    leadTimeStdDev: integer('lead_time_std_dev'),
+    isDefault: boolean('is_default').notNull().default(false),
+    sourceSystem: varchar('source_system', { length: 50 }),
+    externalId: varchar('external_id', { length: 100 }),
+    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
+    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
+  },
+  (table) => ({
+    merchantWhIdx: index('lead_time_profiles_merchant_wh_idx').on(
+      table.merchantCode,
+      table.destinationWarehouseCode,
+    ),
+  }),
+);

