-- Legacy DJ 变参可达 3 位及以上（如 DJ502313_342），原 varchar(2) 导致 SKU 导入失败
ALTER TABLE "skus" ALTER COLUMN "variant_no" TYPE varchar(10);
