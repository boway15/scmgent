# Review Package Task 5
BASE: b97c26cd54f6cabe004fcf6ad03a28f55a14894e
HEAD: 563102073c0d27391c44c0ad2ef070cbed184c32

## Commits
5631020 feat(db): add purchase_drafts.eta_available for sellable ETA


## Stat
 packages/db/drizzle/0052_purchase_draft_eta_available.sql |  4 ++++
 packages/db/drizzle/meta/_journal.json                    | 14 ++++++++++++++
 packages/db/src/schema/procurement.ts                     |  2 ++
 3 files changed, 20 insertions(+)


## Diff
diff --git a/packages/db/drizzle/0052_purchase_draft_eta_available.sql b/packages/db/drizzle/0052_purchase_draft_eta_available.sql
new file mode 100644
index 0000000..2a213ad
--- /dev/null
+++ b/packages/db/drizzle/0052_purchase_draft_eta_available.sql
@@ -0,0 +1,4 @@
+ALTER TABLE "purchase_drafts" ADD COLUMN IF NOT EXISTS "eta_available" date;
+UPDATE "purchase_drafts"
+SET "eta_available" = "confirmed_delivery_date"
+WHERE "eta_available" IS NULL AND "confirmed_delivery_date" IS NOT NULL;
diff --git a/packages/db/drizzle/meta/_journal.json b/packages/db/drizzle/meta/_journal.json
index ce7f17a..ee6dd78 100644
--- a/packages/db/drizzle/meta/_journal.json
+++ b/packages/db/drizzle/meta/_journal.json
@@ -309,13 +309,27 @@
       "when": 1780717058184,
       "tag": "0045_news_intel_v2",
       "breakpoints": true
     },
     {
       "idx": 45,
       "version": "6",
       "when": 1780717058185,
       "tag": "0046_news_intel_menu",
       "breakpoints": true
+    },
+    {
+      "idx": 46,
+      "version": "6",
+      "when": 1785216000000,
+      "tag": "0047_drop_creator_ops_menu",
+      "breakpoints": true
+    },
+    {
+      "idx": 47,
+      "version": "6",
+      "when": 1785216000001,
+      "tag": "0052_purchase_draft_eta_available",
+      "breakpoints": true
     }
   ]
 }
diff --git a/packages/db/src/schema/procurement.ts b/packages/db/src/schema/procurement.ts
index 8fa6ae2..76e8e4c 100644
--- a/packages/db/src/schema/procurement.ts
+++ b/packages/db/src/schema/procurement.ts
@@ -43,20 +43,22 @@ export const purchaseDrafts = pgTable(
       .notNull()
       .references(() => skus.id),
     qty: integer('qty').notNull(),
     expectedDate: date('expected_date'),
     source: purchaseDraftSourceEnum('source').notNull().default('manual'),
     sourceRefId: uuid('source_ref_id'),
     planItemId: uuid('plan_item_id').references(() => pmcPlanItems.id),
     status: purchaseDraftStatusEnum('status').notNull().default('draft'),
     supplierConfirmedAt: timestamp('supplier_confirmed_at', { withTimezone: true }),
     confirmedDeliveryDate: date('confirmed_delivery_date'),
+    /** 棰勮鍙敭鏃ワ紙琛ヨ揣/寤惰涓诲瓧娈碉紱鍐欏叆鏃跺悓姝?confirmedDeliveryDate锛?*/
+    etaAvailable: date('eta_available'),
     actualShipDate: date('actual_ship_date'),
     actualReceivedDate: date('actual_received_date'),
     receivedQty: integer('received_qty').notNull().default(0),
     exceptionReason: text('exception_reason'),
     ownerUserId: uuid('owner_user_id').references(() => users.id),
     remark: text('remark'),
     createdBy: uuid('created_by').references(() => users.id),
     createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
     updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
   },

