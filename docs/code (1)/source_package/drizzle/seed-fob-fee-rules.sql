-- FOB fee rules seed: 75 rows
-- Table: fob_fee_allocation_rules
-- Prerequisite: 0012_fob_multi_allocation.sql
-- Idempotent: skips rows that already exist (same source_bill_type + fee_type or match_pattern)

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT '拖车费', 'trucking', NULL, 'by_volume', 'trucking', 10000, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'trucking' AND r.fee_type = '拖车费' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT '多地费', 'trucking', NULL, 'by_ticket', 'trucking', 9999, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'trucking' AND r.fee_type = '多地费' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT '过磅费', 'trucking', NULL, 'by_volume', 'trucking', 9998, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'trucking' AND r.fee_type = '过磅费' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT '超重费', 'trucking', NULL, 'by_volume', 'trucking', 9997, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'trucking' AND r.fee_type = '超重费' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT '提卸费', 'trucking', NULL, 'by_volume', 'trucking', 9996, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'trucking' AND r.fee_type = '提卸费' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT '堆场港杂费', 'trucking', NULL, 'by_volume', 'trucking', 9995, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'trucking' AND r.fee_type = '堆场港杂费' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT '堆存费', 'trucking', NULL, 'by_volume', 'trucking', 9994, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'trucking' AND r.fee_type = '堆存费' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT '条码费', 'trucking', NULL, 'by_ticket', 'trucking', 9993, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'trucking' AND r.fee_type = '条码费' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT '提箱费', 'trucking', NULL, 'by_ticket', 'trucking', 9992, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'trucking' AND r.fee_type = '提箱费' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT '进港费', 'trucking', NULL, 'by_volume', 'trucking', 9991, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'trucking' AND r.fee_type = '进港费' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT '待时费', 'trucking', NULL, 'by_volume', 'other', 9990, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'trucking' AND r.fee_type = '待时费' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT '预提费', 'trucking', NULL, 'by_ticket', 'trucking', 9989, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'trucking' AND r.fee_type = '预提费' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT '异提费', 'trucking', NULL, 'by_ticket', 'trucking', 9988, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'trucking' AND r.fee_type = '异提费' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT '落箱费', 'trucking', NULL, 'by_volume', 'trucking', 9987, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'trucking' AND r.fee_type = '落箱费' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT '码头费', 'trucking', NULL, 'by_volume', 'trucking', 9986, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'trucking' AND r.fee_type = '码头费' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT '超期费', 'trucking', NULL, 'by_volume', 'other', 9985, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'trucking' AND r.fee_type = '超期费' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT '场站操作包干费', 'trucking', NULL, 'by_volume', 'trucking', 9984, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'trucking' AND r.fee_type = '场站操作包干费' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT '进仓费', 'trucking', NULL, 'by_volume', 'trucking', 9983, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'trucking' AND r.fee_type = '进仓费' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT '装箱费', 'trucking', NULL, 'by_volume', 'trucking', 9982, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'trucking' AND r.fee_type = '装箱费' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT '堆场吊机费', 'trucking', NULL, 'by_volume', 'trucking', 9981, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'trucking' AND r.fee_type = '堆场吊机费' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT '高温费', 'trucking', NULL, 'by_volume', 'other', 9980, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'trucking' AND r.fee_type = '高温费' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT '高速费', 'trucking', NULL, 'by_volume', 'trucking', 9979, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'trucking' AND r.fee_type = '高速费' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT '约柜费', 'trucking', NULL, 'by_ticket', 'trucking', 9978, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'trucking' AND r.fee_type = '约柜费' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT '提空费', 'trucking', NULL, 'by_ticket', 'trucking', 9977, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'trucking' AND r.fee_type = '提空费' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT '压夜费', 'trucking', NULL, 'manual', 'other', 9976, true, '平账时指定承担主体'
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'trucking' AND r.fee_type = '压夜费' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT '场站费', 'trucking', NULL, 'by_volume', 'trucking', 9975, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'trucking' AND r.fee_type = '场站费' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT '单证费', 'trucking', NULL, 'by_ticket', 'trucking', 9974, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'trucking' AND r.fee_type = '单证费' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT '买单费', 'trucking', NULL, 'by_ticket', 'customs', 9973, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'trucking' AND r.fee_type = '买单费' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT '商检费', 'trucking', NULL, 'by_ticket', 'customs', 9972, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'trucking' AND r.fee_type = '商检费' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT '报关费', 'trucking', NULL, 'by_ticket', 'customs', 9971, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'trucking' AND r.fee_type = '报关费' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT '查验费', 'trucking', NULL, 'by_ticket', 'customs', 9970, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'trucking' AND r.fee_type = '查验费' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT '其他', 'trucking', NULL, 'manual', 'other', 9969, true, '需人工确认归属'
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'trucking' AND r.fee_type = '其他' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT 'ORC', 'freight', NULL, 'by_volume', 'freight', 5000, true, '按 USD 折算'
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'freight' AND r.fee_type = 'ORC' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT '文件费', 'freight', NULL, 'by_ticket', 'freight', 4999, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'freight' AND r.fee_type = '文件费' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT '封条费', 'freight', NULL, 'by_ticket', 'freight', 4998, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'freight' AND r.fee_type = '封条费' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT '打单费', 'freight', NULL, 'by_ticket', 'freight', 4997, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'freight' AND r.fee_type = '打单费' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT '电放费', 'freight', NULL, 'by_ticket', 'freight', 4996, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'freight' AND r.fee_type = '电放费' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT 'VGM', 'freight', NULL, 'by_ticket', 'freight', 4995, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'freight' AND r.fee_type = 'VGM' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT 'ISPS', 'freight', NULL, 'by_ticket', 'freight', 4994, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'freight' AND r.fee_type = 'ISPS' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT '订舱', 'freight', NULL, 'by_ticket', 'freight', 4993, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'freight' AND r.fee_type = '订舱' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT '转关打单', 'freight', NULL, 'by_ticket', 'customs', 4992, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'freight' AND r.fee_type = '转关打单' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT '舱单费/舱单预录费', 'freight', NULL, 'by_ticket', 'freight', 4991, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'freight' AND r.fee_type = '舱单费/舱单预录费' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT '港杂费', 'freight', NULL, 'by_volume', 'freight', 4990, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'freight' AND r.fee_type = '港杂费' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT '箱单费', 'freight', NULL, 'by_ticket', 'freight', 4989, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'freight' AND r.fee_type = '箱单费' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT '排载申报费', 'freight', NULL, 'by_ticket', 'customs', 4988, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'freight' AND r.fee_type = '排载申报费' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT '刷申报费', 'freight', NULL, 'by_ticket', 'customs', 4987, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'freight' AND r.fee_type = '刷申报费' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT '青岛港提箱费+安保+场站+港杂+提箱+综合服务费', 'freight', NULL, 'by_volume', 'freight', 4986, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'freight' AND r.fee_type = '青岛港提箱费+安保+场站+港杂+提箱+综合服务费' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT '操作费', 'freight', NULL, 'by_volume', 'freight', 4985, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'freight' AND r.fee_type = '操作费' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT 'Handing', 'freight', NULL, 'by_ticket', 'freight', 4984, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'freight' AND r.fee_type = 'Handing' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT 'EDI', 'freight', NULL, 'by_ticket', 'freight', 4983, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'freight' AND r.fee_type = 'EDI' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT 'EIR', 'freight', NULL, 'by_ticket', 'freight', 4982, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'freight' AND r.fee_type = 'EIR' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT '退载费', 'freight', NULL, 'manual', 'other', 4981, true, '需人工确认'
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'freight' AND r.fee_type = '退载费' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT '转船费', 'freight', NULL, 'manual', 'other', 4980, true, '需人工确认'
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'freight' AND r.fee_type = '转船费' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT '改单费', 'freight', NULL, 'manual', 'other', 4979, true, '需人工确认'
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'freight' AND r.fee_type = '改单费' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT '出口服务费', 'freight', NULL, 'by_volume', 'freight', 4978, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'freight' AND r.fee_type = '出口服务费' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT '多点提货费', 'trucking', NULL, 'by_ticket', 'trucking', 10, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'trucking' AND r.fee_type = '多点提货费' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT '超时等待费', 'trucking', NULL, 'by_volume', 'other', 10, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'trucking' AND r.fee_type = '超时等待费' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT '落地寄柜费', 'trucking', NULL, 'by_volume', 'trucking', 10, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'trucking' AND r.fee_type = '落地寄柜费' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT '延误费', 'trucking', NULL, 'manual', 'other', 10, true, '需人工识别归属主体'
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'trucking' AND r.fee_type = '延误费' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT '指定柜号', 'trucking', NULL, 'manual', 'other', 10, true, '平账时指定承担主体'
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'trucking' AND r.fee_type = '指定柜号' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT '其他费用', 'trucking', NULL, 'manual', 'other', 5, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'trucking' AND r.fee_type = '其他费用' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT NULL, 'freight', '海运费', 'by_volume', 'freight', 10, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'freight' AND r.match_pattern = '海运费' AND r.fee_type IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT NULL, 'freight', 'THC', 'by_volume', 'freight', 10, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'freight' AND r.match_pattern = 'THC' AND r.fee_type IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT NULL, 'freight', '码头', 'by_volume', 'freight', 10, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'freight' AND r.match_pattern = '码头' AND r.fee_type IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT NULL, 'freight', '拖车费', 'by_volume', 'trucking', 10, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'freight' AND r.match_pattern = '拖车费' AND r.fee_type IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT NULL, 'trucking', '延误', 'manual', 'other', 15, true, '需人工识别归属主体'
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'trucking' AND r.match_pattern = '延误' AND r.fee_type IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT NULL, 'freight', '延误', 'manual', 'other', 15, true, '需人工识别归属主体'
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'freight' AND r.match_pattern = '延误' AND r.fee_type IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT NULL, 'trucking', '异常', 'manual', 'other', 20, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'trucking' AND r.match_pattern = '异常' AND r.fee_type IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT NULL, 'freight', '异常', 'manual', 'other', 20, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'freight' AND r.match_pattern = '异常' AND r.fee_type IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT NULL, 'trucking', '减免', 'manual', 'other', 20, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'trucking' AND r.match_pattern = '减免' AND r.fee_type IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT NULL, 'freight', '减免', 'manual', 'other', 20, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'freight' AND r.match_pattern = '减免' AND r.fee_type IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT NULL, 'trucking', '多收', 'manual', 'other', 20, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'trucking' AND r.match_pattern = '多收' AND r.fee_type IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT NULL, 'freight', '多收', 'manual', 'other', 20, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'freight' AND r.match_pattern = '多收' AND r.fee_type IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT NULL, 'freight', '报关', 'by_ticket', 'customs', 12, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'freight' AND r.match_pattern = '报关' AND r.fee_type IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT NULL, 'freight', '查验', 'by_ticket', 'customs', 12, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'freight' AND r.match_pattern = '查验' AND r.fee_type IS NULL);
