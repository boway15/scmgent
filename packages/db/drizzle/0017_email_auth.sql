ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "password_hash" varchar(255);

INSERT INTO "roles" ("name", "code", "description", "is_system")
SELECT '待分配', 'pending', '注册或首次飞书登录默认角色，无菜单权限', true
WHERE NOT EXISTS (SELECT 1 FROM "roles" WHERE "code" = 'pending');
