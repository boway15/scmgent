import type { PageKind } from './types.js';

const MATERIAL_KEYWORDS = [
  '板',
  '密度板',
  '颗粒板',
  '实木',
  '五金',
  '滑轨',
  '拉手',
  '封边',
  'mm',
  '插排',
  '防倾倒',
];

const hasMaterialKeyword = (text: string): boolean => {
  const normalized = text.toLowerCase();
  return MATERIAL_KEYWORDS.some((keyword) => normalized.includes(keyword.toLowerCase()));
};

const isOnlyProductAndDepartment = (text: string): boolean => {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return (
    lines.length > 0 &&
    lines.length <= 2 &&
    lines.every((line) => line.length <= 30) &&
    lines.some((line) => /部门|设计部|研发部|开发部/i.test(line))
  );
};

export function classifyPage(pageNo: number, text: string): PageKind {
  if (/物料清单|bill of materials/i.test(text)) return 'bom_list';
  if (/cmf|材质选择/i.test(text)) return 'cmf';
  if (/产品尺寸|product size|W\s*\d/i.test(text)) return 'size';
  if (/爆炸图|explosion|disassembly/i.test(text)) return 'explosion';
  if (/设计说明|产品细节|design notes/i.test(text)) return 'notes';
  if (pageNo === 1 || isOnlyProductAndDepartment(text)) return 'cover';
  return 'render';
}

export function shouldSendPageToDify(kind: PageKind, text: string): boolean {
  if (kind !== 'cover' && kind !== 'render') return true;
  return hasMaterialKeyword(text);
}
