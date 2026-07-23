import {
  ensureBitableFields,
  listBitableFields,
  type BitableFieldCreateInput,
} from '../../integrations/feishu-bitable.js';
import { getNewsBitableAppToken, getNewsBitableV2TableId } from './config.js';

function selectOptions(names: string[]) {
  return { options: names.map((name) => ({ name })) };
}

/** 跨境资讯总表字段定义（与 mapArticleToBitableFields / 设计文档第 7 节对齐） */
export const NEWS_INTEL_BITABLE_FIELDS: BitableFieldCreateInput[] = [
  { field_name: '标题（主键）', type: 1 },
  { field_name: '中文标题', type: 1 },
  { field_name: '中文摘要', type: 1 },
  { field_name: '原文标题', type: 1 },
  { field_name: '原文链接', type: 15 },
  { field_name: '信源名称', type: 1 },
  {
    field_name: '信源等级',
    type: 3,
    property: selectOptions(['一级', '二级', '三级']),
  },
  { field_name: '官方来源', type: 7 },
  {
    field_name: '原文语言',
    type: 3,
    property: selectOptions(['中文', '英文']),
  },
  {
    field_name: '发布时间',
    type: 5,
    property: { date_formatter: 'yyyy/MM/dd HH:mm' },
  },
  {
    field_name: '采集时间',
    type: 5,
    property: { date_formatter: 'yyyy/MM/dd HH:mm' },
  },
  {
    field_name: '主题分类',
    type: 3,
    property: selectOptions([
      '产品开发与家具趋势',
      'PMC与供应链',
      '采购与供应商',
      '物流海关与关税',
      '平台运营',
      '营销推广',
      '视觉设计',
      'AI前沿',
      '法规与外部环境',
    ]),
  },
  {
    field_name: '相关部门',
    type: 4,
    property: selectOptions([
      '产品开发',
      'PMC',
      '采购',
      '物流',
      '平台运营',
      '营销推广',
      '视觉设计',
      'AI',
      '法规与外部环境',
    ]),
  },
  {
    field_name: '平台标签',
    type: 4,
    property: selectOptions(['Amazon', 'TikTok Shop', 'Wayfair', 'Walmart', '独立站']),
  },
  {
    field_name: '国家/区域标签',
    type: 4,
    property: selectOptions(['美国', '英国', '德国', '法国', '意大利', '欧盟']),
  },
  {
    field_name: '业务标签',
    type: 4,
    property: selectOptions([
      '沙发',
      '桌子',
      '椅子',
      '床',
      '升降桌',
      '家具',
      '海运',
      '港口',
      '清关',
      '关税',
      '海外仓',
      '尾程',
      '头程',
    ]),
  },
  {
    field_name: '品牌标签',
    type: 4,
    property: selectOptions([
      'Tribesigns',
      'FEZIBO',
      'Vernal',
      'SONGMICS',
      'FlexiSpot',
      'Eureka Ergonomic',
      'Homary',
      'Costway',
      'POVISON',
      'IKEA',
      'Ashley Furniture',
      'Secretlab',
      'Bestier',
      'Yoobure',
      'Hernest',
    ]),
  },
  {
    field_name: '相关度评分',
    type: 2,
    property: { formatter: '0' },
  },
  {
    field_name: '重要等级',
    type: 3,
    property: selectOptions(['高', '中', '低']),
  },
  { field_name: '筛选命中依据', type: 1 },
  {
    field_name: '业务有效性',
    type: 3,
    property: selectOptions(['有效', '无效', '误分类']),
  },
  { field_name: '系统文章ID', type: 1 },
];

export function validityLabel(value?: string | null): string {
  if (value === 'invalid') return '无效';
  if (value === 'misclassified') return '误分类';
  return '有效';
}

export async function ensureNewsIntelBitableSchema(options?: {
  appToken?: string;
  tableId?: string;
}): Promise<{
  tableId: string;
  existing: string[];
  created: string[];
  skippedExisting: string[];
}> {
  const appToken = options?.appToken ?? getNewsBitableAppToken();
  const tableId = options?.tableId ?? getNewsBitableV2TableId();
  if (!appToken || !tableId) {
    throw new Error('FEISHU_BITABLE_APP_TOKEN / FEISHU_BITABLE_TABLE_NEWS_INTEL_V2 not configured');
  }

  const result = await ensureBitableFields(appToken, tableId, NEWS_INTEL_BITABLE_FIELDS);
  return { tableId, ...result };
}

export async function listNewsIntelBitableFieldNames(options?: {
  appToken?: string;
  tableId?: string;
}): Promise<string[]> {
  const appToken = options?.appToken ?? getNewsBitableAppToken();
  const tableId = options?.tableId ?? getNewsBitableV2TableId();
  if (!appToken || !tableId) return [];
  const fields = await listBitableFields(appToken, tableId);
  return fields.map((f) => f.field_name);
}
