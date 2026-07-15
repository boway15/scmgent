-- Legacy DJ SPU 序号可达 6 位（如 502313），原 varchar(5) 导致 SKU 导入 500
ALTER TABLE "spus" ALTER COLUMN "spu_numeric_code" TYPE varchar(10);
ALTER TABLE "skus" ALTER COLUMN "spu_numeric_code" TYPE varchar(10);
