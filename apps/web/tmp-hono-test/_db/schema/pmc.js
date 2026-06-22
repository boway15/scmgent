import { pgTable, pgEnum, uuid, varchar, text, integer, timestamp, index, } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { users } from './auth.js';
import { skus } from './inventory.js';
export const pmcStatusEnum = pgEnum('pmc_status', [
    'draft',
    'confirmed',
    'in_progress',
    'completed',
    'cancelled',
]);
export const materialRequirementStatusEnum = pgEnum('material_requirement_status', [
    'sufficient',
    'shortage',
    'ordered',
]);
export const pmcPlans = pgTable('pmc_plans', {
    id: uuid('id').primaryKey().defaultRandom(),
    planNo: varchar('plan_no', { length: 100 }).notNull().unique(),
    name: varchar('name', { length: 200 }).notNull(),
    merchantCode: varchar('merchant_code', { length: 100 }).notNull(),
    merchantName: varchar('merchant_name', { length: 200 }),
    planDate: timestamp('plan_date', { withTimezone: true }).notNull(),
    deliveryDate: timestamp('delivery_date', { withTimezone: true }).notNull(),
    status: pmcStatusEnum('status').notNull().default('draft'),
    /** 本计划目标入库仓（一计划一商家一仓） */
    targetWarehouseCode: varchar('target_warehouse_code', { length: 100 }),
    remark: text('remark'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
    statusDateIdx: index('pmc_plans_status_plan_date_idx').on(table.status, table.planDate),
}));
export const pmcPlanItems = pgTable('pmc_plan_items', {
    id: uuid('id').primaryKey().defaultRandom(),
    planId: uuid('plan_id')
        .notNull()
        .references(() => pmcPlans.id, { onDelete: 'cascade' }),
    skuId: uuid('sku_id')
        .notNull()
        .references(() => skus.id),
    plannedQty: integer('planned_qty').notNull(),
    warehouseCode: varchar('warehouse_code', { length: 100 }),
    completedQty: integer('completed_qty').default(0),
    unit: varchar('unit', { length: 20 }).notNull(),
    sortOrder: integer('sort_order').default(0),
});
export const materialRequirements = pgTable('material_requirements', {
    id: uuid('id').primaryKey().defaultRandom(),
    planId: uuid('plan_id')
        .notNull()
        .references(() => pmcPlans.id, { onDelete: 'cascade' }),
    materialSkuId: uuid('material_sku_id')
        .notNull()
        .references(() => skus.id),
    requiredQty: integer('required_qty').notNull(),
    availableQty: integer('available_qty'),
    gapQty: integer('gap_qty'),
    status: materialRequirementStatusEnum('status').notNull().default('sufficient'),
    calcAt: timestamp('calc_at', { withTimezone: true }).notNull().defaultNow(),
});
export const pmcPlansRelations = relations(pmcPlans, ({ one, many }) => ({
    creator: one(users, { fields: [pmcPlans.createdBy], references: [users.id] }),
    items: many(pmcPlanItems),
    materialRequirements: many(materialRequirements),
}));
export const pmcPlanItemsRelations = relations(pmcPlanItems, ({ one }) => ({
    plan: one(pmcPlans, { fields: [pmcPlanItems.planId], references: [pmcPlans.id] }),
    sku: one(skus, { fields: [pmcPlanItems.skuId], references: [skus.id] }),
}));
export const materialRequirementsRelations = relations(materialRequirements, ({ one }) => ({
    plan: one(pmcPlans, {
        fields: [materialRequirements.planId],
        references: [pmcPlans.id],
    }),
    materialSku: one(skus, {
        fields: [materialRequirements.materialSkuId],
        references: [skus.id],
    }),
}));
