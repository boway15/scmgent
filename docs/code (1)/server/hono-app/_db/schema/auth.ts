import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  integer,
  timestamp,
  uniqueIndex,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

export const roles = pgTable('roles', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 100 }).notNull(),
  code: varchar('code', { length: 100 }).notNull().unique(),
  description: text('description'),
  isSystem: boolean('is_system').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const menus = pgTable('menus', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 100 }).notNull(),
  code: varchar('code', { length: 100 }).notNull().unique(),
  icon: varchar('icon', { length: 100 }),
  path: varchar('path', { length: 200 }),
  parentId: uuid('parent_id').references((): AnyPgColumn => menus.id),
  sortOrder: integer('sort_order').notNull().default(0),
  isLeaf: boolean('is_leaf').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const roleMenus = pgTable(
  'role_menus',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    menuId: uuid('menu_id')
      .notNull()
      .references(() => menus.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    roleMenuUnique: uniqueIndex('role_menus_role_id_menu_id_idx').on(table.roleId, table.menuId),
  }),
);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  feishuUserId: varchar('feishu_user_id', { length: 100 }),
  name: varchar('name', { length: 100 }).notNull(),
  email: varchar('email', { length: 200 }).notNull().unique(),
  roleId: uuid('role_id')
    .notNull()
    .references(() => roles.id),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const rolesRelations = relations(roles, ({ many }) => ({
  users: many(users),
  roleMenus: many(roleMenus),
}));

export const menusRelations = relations(menus, ({ one, many }) => ({
  parent: one(menus, {
    fields: [menus.parentId],
    references: [menus.id],
    relationName: 'menuTree',
  }),
  children: many(menus, { relationName: 'menuTree' }),
  roleMenus: many(roleMenus),
}));

export const roleMenusRelations = relations(roleMenus, ({ one }) => ({
  role: one(roles, { fields: [roleMenus.roleId], references: [roles.id] }),
  menu: one(menus, { fields: [roleMenus.menuId], references: [menus.id] }),
}));

export const usersRelations = relations(users, ({ one }) => ({
  role: one(roles, { fields: [users.roleId], references: [roles.id] }),
}));
