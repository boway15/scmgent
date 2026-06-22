-- One-off: rename demo products to furniture (家具)
BEGIN;

UPDATE spus SET name = '北欧布艺单人沙发', category = '客厅家具', updated_at = NOW()
WHERE code = 'SKU-HG-001';

UPDATE skus SET
  name = '北欧布艺单人沙发-深灰',
  category = '客厅家具',
  replenish_light = 'red',
  updated_at = NOW()
WHERE code = 'SKU-HG-001';

UPDATE skus SET
  name = '北欧布艺单人沙发-米白',
  category = '客厅家具',
  spu_id = (SELECT id FROM spus WHERE code = 'SKU-HG-001' LIMIT 1),
  replenish_light = 'yellow',
  updated_at = NOW()
WHERE code = 'SKU-001';

UPDATE spus SET name = '北欧布艺单人沙发', category = '客厅家具', updated_at = NOW()
WHERE code = 'SKU-001';

UPDATE spus SET name = '实木茶几', category = '客厅家具', updated_at = NOW()
WHERE code = 'SKU-HG-004';

UPDATE skus SET name = '实木茶几-橡木色', category = '客厅家具', updated_at = NOW()
WHERE code = 'SKU-HG-004';

UPDATE spus SET name = '可升降书桌', category = '书房家具', updated_at = NOW()
WHERE code = 'SKU-EL-002';

UPDATE skus SET name = '可升降书桌-白色', category = '书房家具', updated_at = NOW()
WHERE code = 'SKU-EL-002';

UPDATE spus SET name = '记忆棉床垫', category = '卧室家具', updated_at = NOW()
WHERE code = 'SKU-AP-003';

UPDATE skus SET name = '记忆棉床垫 Queen', category = '卧室家具', updated_at = NOW()
WHERE code = 'SKU-AP-003';

UPDATE spus SET name = '落地阅读灯', category = '灯饰家具', updated_at = NOW()
WHERE code = 'SKU-EL-005';

UPDATE skus SET name = '落地阅读灯-黑色', category = '灯饰家具', replenish_light = 'green', updated_at = NOW()
WHERE code = 'SKU-EL-005';

COMMIT;
