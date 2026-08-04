/**
 * Push scm-agent blueprint report sections to Feishu Bitable.
 * Usage: node --env-file=.env scripts/push-blueprint-to-feishu.mjs
 */
const FEISHU_BASE = 'https://open.feishu.cn/open-apis';
const APP_TOKEN = 'UvD5b2txjau5WksACknccdQknHh';
const TABLE_NAME = 'scm-agent 蓝图报告';

function tableMd(headers, rows) {
  const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
  const head = `| ${headers.map(esc).join(' | ')} |`;
  const sep = `| ${headers.map(() => '---').join(' | ')} |`;
  const body = rows.map((r) => `| ${r.map(esc).join(' | ')} |`).join('\n');
  return [head, sep, body].join('\n');
}

const painPoints = [
  ['数据孤岛', '迅捷 ERP、Excel、飞书表多套并存，库存与主数据口径经常不一致'],
  ['预测不准', '销量预测偏差大，备货决策缺乏可靠输入，计划与执行经常脱节'],
  ['备货效率低', '评审依赖人工导出整理，效率低、口径不统一，准确性难以保障'],
  ['调拨组柜薄弱', '调拨/组柜销量占比低，规则与标准不一，跨仓协同与组柜决策困难'],
  ['采购跟单繁琐', '逐笔查表、重复沟通、进度汇总耗时长，大件待确认与超期靠人工筛选'],
  ['流程断档', '预测、计划、跟单、到货之间缺少系统串联，进度靠人工盯人'],
  ['时效滞后', '手工导出上传，补货决策常落后 T+1 甚至更久，断货积压事后才发现'],
];

const valueProps = [
  ['定位', 'scm-agent 是平台基建：数据入湖、引擎计算、权限审计、飞书/妙搭/Dify 集成'],
  ['价值归属', '可量化收益归属各业务能力点，不把整系统当作「一笔总账」承诺收益'],
  ['战略对齐', '落实集团「数智驱动高效」——效率工程 + 数据与知识双驱动'],
  ['主轴突破', '在计划 · 采购 · 物流 · 运营四列验证「数字化 → 自动化 → 智能化」递进'],
  ['效率范式', '数据自动到位 · AI 推送待办 · 人只做确认与例外处理'],
  ['安全可控', '自建 Docker · 飞书 SSO · 敏感字段分级 · 推送脱敏'],
];

const capabilityValueMap = [
  ['销量预测及自动备货', '运营 · 计划', '资金占用 · 转投毛利 · 缺货挽回 · 备货评审工时', '已量化（能力点 A）', '主价值点 A'],
  ['库存健康 / 缺货预警', '库存 · 计划', '断货发现时效 · 红黄灯可行动 · 减少事后救火', '待采基线（响应时效）', '支撑预测备货'],
  ['PMC 履约闭环', '计划 · 采购', '计划到货周期 · 跟单可视 · 异常定位时间', '待采基线（准时到货率）', '执行层闭环'],
  ['采购跟单 / 大件催办', '采购', '降本（延期/加急等）· 提效工时 · 作业模式升级', '提效已量化；降本待跟进', '采购主价值点'],
  ['数据自动化五链路', '平台基建', '日导入工时 → 0 · 口径一致性 · T 日数据就绪', '定性 + 任务日志可证', '使能层，不独占收益'],
  ['FOB 分账', '物流', '头程费用分摊提效 · 对账工时下降', '已量化：年预计节省 480+ 工时', '主价值点 C'],
  ['客服质量评分', '客服', '质检工时 · 培训针对性', '待采基线', '局部能力点'],
  ['跨境资讯', '情报', '人工刷新闻时间 · 信息覆盖面', '定性为主', '辅助决策点'],
];

const forecastStockValueRows = [
  ['减少库存资金占用', '提升预测准确率，削减冗余备货', '预计释放资金 = 4亿元 × 冗余库存削减比例', '2025 多备货约 4 亿（大件审批备货 12 亿 − SKU 预报财务采购成本 8 亿）'],
  ['创造盈利机会', '释放资金转投高需求/高周转/高毛利商品', '预计新增毛利 = 可释放资金 × 可转投比例 × 相关商品毛利率', '新增毛利 ≠ 释放资金本身，需结合投入规模与周转测算'],
  ['减少缺货损失', '提高 SKU 级预测准确率，降低断货概率', '预计挽回毛利 = 受影响 SKU 销售额 × 缺货率降幅（结合毛利率验证）', '实际收益需按 SKU 销售额、缺货率、毛利率复盘'],
  ['提升备货决策效率', '自动趋势分析、预测结果与评审明细', '年节省工时 ≈ 有效备货次数 × 单次节省时长', '2025：有效备货 31,740 次 × 10 分钟 ≈ 0.53 万工时/年'],
];

const forecastStockScenarios = [
  ['保守', '5%', '约 0.20 亿', '按 50% 转投、毛利率 25% → 约 250 万毛利量级'],
  ['基准', '10%', '约 0.40 亿', '按 50% 转投、毛利率 25% → 约 500 万毛利量级'],
  ['进取', '20%', '约 0.80 亿', '按 50% 转投、毛利率 25% → 约 1,000 万毛利量级'],
];

const procurementValueRows = [
  ['降本', '减少人工查表、重复沟通与进度汇总；提前发现延期风险', '降低加急生产、临时调拨、改船期及缺货等成本', '需进一步跟进量化'],
  ['提效', '按系统待办/异常清单处理，替代逐笔翻表跟进', '每人每日节省约 20 分钟跟进与查询时间', '10 人+团队：年预计节省 1000+ 工时'],
  ['作业模式升级', '从「逐笔跟进全部订单」转为「待办 + 异常清单」', '订单状态统一展示，减少跨部门重复确认与交接成本', '定性为主'],
];

const procurementEffortRows = [
  ['单人日节省', '约 20 分钟', '采购跟进 + 查询'],
  ['团队规模', '10 人+', '采购跟单相关岗位'],
  ['团队日节省', '约 200 分钟（≈3.3 小时）', '10 × 20 分钟'],
  ['年预计节省', '1000+ 工时', '按工作日折算约 3.3×250 ≈ 825～1000+ 小时量级'],
];

const fobValueRows = [
  ['提效', '头程费用按工厂/柜号系统分摊，减少手工拆分与对账', '年预计节省 480+ 工时', '归属 FOB 分账能力点'],
  ['准确与可追溯', '分摊规则固化、结果可复查', '降低分摊差错与反复核对成本', '定性为主'],
];

const architectureLayers = [
  ['① 访问层', '飞书妙搭', '统一工作台 · 飞书 SSO · 菜单导航', '规划接入', 'Face'],
  ['② 协同层', '飞书多维表格 / 群 / aily', '业务台账 · 消息卡片 · 审批流', '已落地', 'Blood'],
  ['③ 智能层', 'Dify Workflow / RAG / Agent', '催办 · 评分 · 预测增强 · 知识问答', '部分落地', 'Neural'],
  ['④ 引擎层', 'scm-agent · Docker Compose', '算法 · 状态机 · Cron · REST API', '已生产', 'Brain'],
  ['⑤ 数据层', 'PostgreSQL · 日快照 · 审计', '权威口径 · 历史可追溯 · 任务日志', '已生产', 'Memory'],
];

const enginesDetail = [
  ['数据智能引擎', '数据从哪来、是否可信、何时就绪', '双跳同步 · 字段映射 · 日快照 · 主数据联动 · 任务互斥', 'Eliminate 手工导入；T 日数据就绪'],
  ['库存规划引擎', '该不该补 · 补多少 · 何时下单 · 断货/积压', '库存位置 · 覆盖天数 · 健康灯 · 提前期 · metrics', '红黄灯可行动；建议可采纳'],
  ['供应商 PMC 引擎', '计划如何下发 · 履约到哪步 · 何时可售', 'PMC 计划 · 跟单状态机 · 交期提醒 · 到货回写', '履约可追踪；到货闭环库存'],
  ['AI 增强引擎', '谁该处理 · 怎么解释 · SOP 怎查', 'Dify 催办 · 预警摘要 · 评分 · 预测 · RAG', 'AI 找人；人确认；数量本地算'],
];

const dataPipelines = [
  ['库存查询', '07:20', '分仓明细 · 约 200 列', '日快照归档', '只读，不驱动补货'],
  ['库存周转', '07:30', '周转宽表 · 5800+ SKU', '总览 + 补货输入 + 主数据', '规划主数据源'],
  ['大件备货', '08:00', '备货申请表', '全量覆盖本地', 'Dify 超期推送'],
  ['采购跟单', '08:05', '履约台账', '与 PMC 跟单对齐', 'Dify 每日催办'],
  ['商品主数据', '随周转', 'SKU 基础字段', '自动创建/增量更新', '生命周期自动算'],
];

const dailyTimeline = [
  ['07:00', '缺货预警', '规划引擎 + AI 摘要'],
  ['07:20', '库存查询拉取', '分仓明细入湖'],
  ['07:30', '库存周转拉取', '总览 + 主数据联动'],
  ['08:00', '大件备货拉取', '采购台账对齐'],
  ['08:00', '跨境资讯采集', '研究 Agent'],
  ['08:05', '采购跟单拉取', '履约台账对齐'],
  ['09:00', 'Dify 催办推送', '超期/待办 → 企微'],
  ['周一 09:00', '补货预测任务', '建议生成 · 可选文案增强'],
];

const mainLoop = [
  ['N1', '数据入湖', 'Cron 拉取飞书五类台账', '数据智能引擎', '快照发布'],
  ['N2', '主数据对齐', 'SKU 创建/更新 · 生命周期', '数据智能引擎', '无变化跳过'],
  ['N3', '需求发布', '预测版本 + 影响预览', '库存规划引擎', '人工确认'],
  ['N4', '智能规划', '补货建议 · 健康灯 · 预警', '规划 + AI 摘要', '可解释'],
  ['N5', '计划确认', 'PMC 草稿 → 确认', 'PMC 引擎', '生成跟单'],
  ['N6', '履约协同', '状态推进 · 交期 · 异常', 'PMC + AI 催办', 'Dify 推送'],
  ['N7', '到货闭环', '登记收货 · 回写库存', 'PMC 引擎', '计划完成'],
  ['N8', '经营复盘', '看板漏斗 · 驾驶舱', '全引擎汇总', '回流预测'],
];

const followUpStates = [
  ['待确认', 'draft', '计划确认后自动生成'],
  ['已确认', 'confirmed', '供应商已确认交期'],
  ['生产中', 'in_production', '工厂生产中'],
  ['待发货', 'ready_to_ship', '生产完成待发货'],
  ['在途', 'in_transit', '已发货在途'],
  ['部分到货', 'partial_received', '累计收货 < 计划量'],
  ['已收货', 'received', '全部到货 · 闭环完成'],
  ['异常 / 取消', 'exception / cancelled', '人工处理或终止'],
];

const subLoops = [
  ['库存健康闭环', '快照 → 健康计算 → 补货灯回写 → 总览 → 预警推群', '红/黄/超备灯规则', '07:00 主动发现'],
  ['采购催办闭环', '飞书 → 同步 → Dify 筛超期 → 企微 → 人处理', '大件超期 + 跟单待办', '不用翻表'],
  ['预测准确率闭环', '基线 → 发布 → 补货采用 → 回测 → 纠偏', '规则主力 + AI 补长尾', '质量可验收'],
  ['资讯情报闭环', '采集 → 审核 → 采用入飞书', '研究 Agent + Dify', '替代刷新闻'],
];

const modules = [
  ['经营看板', '漏斗 · 待办 · 趋势', '经营复盘入口', '已交付'],
  ['库存总览 / 查询', '多仓 · 日快照 · 问 AI', '规划输入与查看', '已交付'],
  ['安全库存 / 预警', '策略 · 每日巡检', '健康闭环前端', '已交付'],
  ['SKU 规划 / 交期 / 驾驶舱', '单 SKU · 提前期 · KPI', '规划引擎深化', '建设中'],
  ['销售预测', '版本 · 复核 · 准确率', '需求发布节点', '已交付'],
  ['补货建议 / PMC / 跟单', '采纳 · 计划 · 状态机', '主闭环核心', '已交付'],
  ['发运管理', '里程碑 · 预计可售日', '发货计划演进', '建设中'],
  ['大件备货 / 采购跟单', '飞书同步 · Dify 催办', '采购列主交付', '已交付'],
  ['FOB 分账', '头程按工厂/柜分摊', '物流费用数字化', '已交付'],
  ['客服质量', '导入 + Dify 评分', '客服列局部', '已交付'],
  ['跨境资讯', '研究 + 审核入飞书', '情报子闭环', '已交付'],
  ['AI 助手', 'FAQ · 待启用 RAG', '知识服务', '建设中'],
];

const digitalizationMap = [
  ['产研', '录入 / 更新', 'SKU 主数据随周转自动维护', '部分覆盖'],
  ['计划', '需求计划', 'PMC + 补货建议合并', '部分覆盖'],
  ['计划', '跟进采造', '跟单状态机 + 到货回写', '已覆盖'],
  ['计划', '发货计划', '发运里程碑演进', '建设中'],
  ['计划', '排柜调拨', 'FOB 柜号；调拨建议规划', '规划中'],
  ['采购', '跟单', '飞书同步 + Dify 催办', '已覆盖'],
  ['采购', '出货', '待发货/在途 + 大件备货', '部分覆盖'],
  ['运营', '销售预测', '工作台 + 版本 + AI 增强', '已覆盖'],
  ['运营', '规划/采购/出货协同', '影响预览 · 飞书协同', '部分覆盖'],
  ['物流', '库存盘点（展示）', '总览 / 查询快照', '部分覆盖'],
  ['物流', '费用计划与账单核对', 'FOB 头程分账', '部分覆盖'],
  ['客服', '客诉邮件管理', '回复质量评估', '部分覆盖'],
];

const aiCapabilities = [
  ['缺货预警摘要', '已交付', '本地 + Dify', '07:00', '可读摘要推群'],
  ['大件待供应商确认超期', '已交付', 'Dify Workflow', '09:00', '按供应商汇总脱敏'],
  ['大件待采购确认超期', '已交付', 'Dify Workflow', '09:00', '采购 SLA 监控'],
  ['采购跟单催办', '已交付', 'Dify Workflow', '每日', '超期待办找人'],
  ['补货文案增强', '可选启用', 'Dify Workflow', '周一', '不改数量'],
  ['客服质量评分', '已交付', 'Dify 四维', '批量', '准确/专业/共情/解决'],
  ['跨境资讯研究', '已交付', '研究 Agent', '08:00', '审核后入飞书'],
  ['AI 单 SKU 预测', '进行中', 'Dify + API', '长尾 SKU', '人工确认发布'],
  ['批量预测智能体', '规划', 'Dify Agent', '月报', 'ABCD + LLM 报告'],
  ['知识库 RAG', '进行中', 'Chat + SOP', '配 Key', '即时问答'],
  ['aily 审批', '规划', 'aily', '计划确认', '流程在飞书'],
];

const securityRows = [
  ['身份认证', '飞书 OAuth + 邮箱；可强制登录'],
  ['权限控制', '菜单级 RBAC；按岗位配置可见模块'],
  ['数据主权', 'PostgreSQL 自建 Docker，不上公有云 SaaS'],
  ['网络边界', 'Cloudflare Tunnel + HTTPS'],
  ['任务安全', 'Cron 需 X-Cron-Secret'],
  ['密钥管理', '密钥存 .env，不进仓库'],
  ['敏感隔离', '成本/供货方权限可见；推送脱敏'],
  ['AI 边界', '数量本地算；建议态人工确认'],
  ['审计追溯', '操作日志 + task_runs'],
];

const roadmap = [
  ['L1 数字化底座', '已交付', '五条数据链 · 主数据 · PMC · FOB · 预测'],
  ['L2 自动化协同', '已交付', 'Cron · Dify 催办 · 预警/补货定时 · 资讯'],
  ['L3 智能化增强', '进行中', 'AI 预测 · 知识库 RAG · 驾驶舱 · 发运'],
  ['L4 飞书原生入口', '规划中', '妙搭统一访问 · aily 审批 · 经营看板'],
  ['L5 全链路扩展', '展望', '质检/物流 Agent · 调拨 · 平台 API'],
];

const REPORT_SECTIONS = [
  {
    order: 0,
    chapter: '封面',
    title: '数智驱动 · 计划—采购—物流—运营主轴平台',
    content: [
      '跨境电商供应链 · 飞书 AI+ 效率工程 · 向领导汇报蓝图',
      '',
      '以飞书为协同底座、妙搭为统一入口、Dify 为 AI 神经、scm-agent 为业务计算引擎。',
      '在集团数字化蓝图中，率先回答并闭环：「该不该补、补多少、何时下单、能否按期到货」。',
      '',
      '标签：效率工程 · 飞书 AI+ · 四大引擎 · 八节点主闭环',
      'Canvas 源文件：canvases/scm-feishu-ai-blueprint.canvas.tsx',
      '版本日期：2026-07-30',
    ].join('\n'),
  },
  {
    order: 1,
    chapter: '一',
    title: '背景 · 现状 · 要解决的问题',
    content: [
      '## 核心痛点（7 项）',
      tableMd(['类别', '具体表现'], painPoints),
      '',
      '## 业务诉求',
      '- PMC 要可解释建议；采购要超期自动找人；管理者要看板漏斗。',
      '',
      '## IT / 飞书诉求',
      '- 统一入口、统一身份、敏感数据可控、对齐妙搭/AI+。',
      '',
      '## 不做清单',
      '- 正式 PO/付款、MES、船司 API、供应商门户、SAP 实对接。',
      '',
      '业务部门集中反馈来源：本 Base「需求与问题管理」表。',
    ].join('\n'),
  },
  {
    order: 2,
    chapter: '二',
    title: '价值模型 · 平台基建 + 能力点量化',
    content: [
      '## 价值记账原则',
      '系统侧只谈「使能与基建」：统一数据、统一引擎、统一入口、可审计。金额与工时类收益挂到具体能力点上验收，避免「整平台承诺释放 X 亿」；4 亿等多备货数字仅作「销量预测及备货」点的历史参考基线。',
      '',
      '## 2.1 平台基建价值（定性 · 不背总账）',
      tableMd(['维度', '表述'], valueProps),
      '',
      '基建三要素：数据基建（五条链路日更入湖）· 引擎基建（规划/PMC/AI 可复用）· 协同基建（飞书登录/RBAC/妙搭入口）',
      '',
      '## 2.2 各能力点价值归属总表',
      tableMd(['能力点', '所属列', '价值类型', '量化状态', '角色'], capabilityValueMap),
      '',
      '效率飞轮：数据自动到位 → AI 自动筛推 → 人在飞书确认 → 闭环回写 → 次日再驱动各能力点业务。',
      '',
      '## 2.3 能力点 A · 销量预测及自动备货',
      tableMd(['价值维度', '作用机制', '测算公式', '基线 / 约束'], forecastStockValueRows),
      '',
      '### 多备货基线构成（2025）',
      '大件审批备货约 12 亿 − SKU 预报财务采购成本约 8 亿 = 多备货差额约 4 亿（历史参考基线）',
      tableMd(['情景', '冗余削减比例', '预计释放资金', '转投毛利示意'], forecastStockScenarios),
      '',
      '### 备货决策效率（工时）',
      '- 2025 有效备货次数：31,740',
      '- 单次预计节省：10 分钟',
      '- 年节省工时：31,740 × 10 分钟 = 5,290 小时 ≈ 0.53 万工时/年',
      '',
      '## 2.4 能力点 B · 采购跟单 / 大件催办',
      tableMd(['维度', '作用机制', '价值表述', '量化状态'], procurementValueRows),
      tableMd(['项', '数值', '说明'], procurementEffortRows),
      '采购降本（加急/调拨/改船期/缺货）待业务继续采数；提效 1000+ 工时可先对外表述。',
      '',
      '## 2.5 能力点 C · FOB 分账',
      tableMd(['维度', '作用机制', '价值表述', '量化状态'], fobValueRows),
      '年预计节省 480+ 工时；所属数字化节点：物流·费用。',
      '',
      '## 2.6 其他能力点 · 量化方向（待采基线）',
      '- 库存健康/预警：预警响应时效 · 红灯 SKU 环比',
      '- PMC 履约闭环：准时到货率 · 异常关闭周期',
      '- 数据自动化：日手工导入次数 → 0（基建使能，不折算平台总收益）',
    ].join('\n'),
  },
  {
    order: 3,
    chapter: '三',
    title: '总体架构 · 飞书 AI+ 五层栈',
    content: [
      tableMd(['层级', '平台', '职责', '状态', '隐喻'], architectureLayers),
      '',
      'Face（妙搭）→ Blood（飞书）→ Neural（Dify）→ Brain（引擎）→ Memory（快照）',
      '',
      '妙搭接入路径：当前引擎 Docker 生产、Web 直连。后续妙搭应用经 REST API 调用 scm-agent——业务不重写，只换统一入口。',
    ].join('\n'),
  },
  {
    order: 4,
    chapter: '四',
    title: '四大核心引擎',
    content: [
      tableMd(['引擎', '回答的问题', '能力构成', '业务产出'], enginesDetail),
      '',
      '规划触发公式：覆盖天数 = 库存位置 / 预计日需求；若覆盖 < 提前期+安全库存，或触及 ROP → 建议。',
      'AI 边界：数量本地算；预测/资讯建议态；推送脱敏。',
    ].join('\n'),
  },
  {
    order: 5,
    chapter: '五',
    title: '数据路径 · 五条自动化链路',
    content: [
      tableMd(['链路', '时间', '飞书源', '系统产出', '说明'], dataPipelines),
      '',
      '## 每日时间表',
      tableMd(['时刻', '任务', '作用'], dailyTimeline),
      '',
      '日节奏：07:00 预警 → 07:20–08:05 入湖 → 09:00 AI 催办，集中在上午完成。',
    ].join('\n'),
  },
  {
    order: 6,
    chapter: '六',
    title: '业务闭环体系',
    content: [
      '## 主闭环节点（8 节点）',
      tableMd(['节点', '名称', '业务动作', '引擎', '控制点'], mainLoop),
      '',
      '## 跟单状态机',
      tableMd(['展示名', '状态码', '含义'], followUpStates),
      '',
      '## 子闭环',
      tableMd(['闭环', '链路', '规则', '价值'], subLoops),
    ].join('\n'),
  },
  {
    order: 7,
    chapter: '七',
    title: '分模块能力地图',
    content: tableMd(['模块', '能力', '闭环角色', '状态'], modules),
  },
  {
    order: 8,
    chapter: '八',
    title: '对齐集团数字化蓝图',
    content: [
      '主轴覆盖：计划 · 采购 · 物流 · 运营（八列职能节点对照自评，0 未覆盖 / 1 部分 / 2 较强 / 3 主轴核心）',
      '',
      tableMd(['流程列', '数字化节点', '落点', '状态'], digitalizationMap),
    ].join('\n'),
  },
  {
    order: 9,
    chapter: '九',
    title: 'AI 能力矩阵',
    content: tableMd(['场景', '状态', '形态', '触发', '价值'], aiCapabilities),
  },
  {
    order: 10,
    chapter: '十',
    title: '安全与治理',
    content: tableMd(['层级', '措施'], securityRows),
  },
  {
    order: 11,
    chapter: '十一',
    title: '成熟度路线 · 展望',
    content: [
      tableMd(['层级', '状态', '关键交付'], roadmap),
      '',
      '结语：五条数据链自动入湖、四大引擎分工清晰、八节点主闭环可验收、AI 催办已上线。下一步挂妙搭、启知识库与 AI 预测——从效率工程试点，走向数智供应链主轴平台。',
    ].join('\n'),
  },
];

async function getToken() {
  const res = await fetch(`${FEISHU_BASE}/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      app_id: process.env.FEISHU_APP_ID,
      app_secret: process.env.FEISHU_APP_SECRET,
    }),
  });
  const data = await res.json();
  if (data.code !== 0) throw new Error(`Auth failed: ${JSON.stringify(data)}`);
  return data.tenant_access_token;
}

async function api(token, path, init) {
  const res = await fetch(`${FEISHU_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  const body = await res.json();
  if (body.code !== 0) {
    throw new Error(`${path} failed: ${body.msg ?? JSON.stringify(body)}`);
  }
  return body;
}

async function listTables(token) {
  const body = await api(token, `/bitable/v1/apps/${APP_TOKEN}/tables?page_size=100`, { method: 'GET' });
  return body.data?.items ?? [];
}

async function findOrCreateTable(token) {
  const tables = await listTables(token);
  const existing = tables.find((t) => t.name === TABLE_NAME);
  if (existing) {
    console.log(`Table exists: ${TABLE_NAME} (${existing.table_id})`);
    return existing.table_id;
  }

  try {
    const body = await api(token, `/bitable/v1/apps/${APP_TOKEN}/tables`, {
      method: 'POST',
      body: JSON.stringify({
        table: {
          name: TABLE_NAME,
          default_view_name: '全部章节',
          fields: [
            { field_name: '章节序号', type: 2 },
            { field_name: '章节', type: 1 },
            { field_name: '标题', type: 1 },
            { field_name: '内容', type: 1 },
            { field_name: '更新日期', type: 5 },
          ],
        },
      }),
    });
    const tableId = body.data?.table_id;
    if (!tableId) throw new Error('Create table returned no table_id');
    console.log(`Created table: ${TABLE_NAME} (${tableId})`);
    return tableId;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('Forbidden') || msg.includes('91403') || msg.includes('RolePermNotAllow')) {
      console.error(`
[权限不足] 飞书应用对 Base ${APP_TOKEN} 无「编辑/新增表」权限（91403 Forbidden）。

请在该多维表格中：
1. 右上角「…」→「更多」→「添加文档应用 / 协作者」
2. 添加 scm-agent 使用的飞书应用（App ID: ${process.env.FEISHU_APP_ID}）
3. 授予「可编辑」权限（含新增表、新增记录）

或手动新建数据表「${TABLE_NAME}」，字段：章节序号(数字)、章节(文本)、标题(文本)、内容(文本)、更新日期(日期)，然后重跑本脚本。

Markdown 备份已生成：docs/reports/scm-feishu-ai-blueprint-report.md
`);
      process.exit(2);
    }
    throw err;
  }
}

async function listAllRecordIds(token, tableId) {
  const ids = [];
  let pageToken;
  do {
    const url = new URL(`${FEISHU_BASE}/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/records`);
    url.searchParams.set('page_size', '500');
    if (pageToken) url.searchParams.set('page_token', pageToken);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const body = await res.json();
    if (body.code !== 0) throw new Error(body.msg);
    for (const item of body.data?.items ?? []) ids.push(item.record_id);
    pageToken = body.data?.has_more ? body.data.page_token : undefined;
  } while (pageToken);
  return ids;
}

async function clearRecords(token, tableId) {
  const ids = await listAllRecordIds(token, tableId);
  if (!ids.length) return;
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    await api(token, `/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/records/batch_delete`, {
      method: 'POST',
      body: JSON.stringify({ records: chunk }),
    });
  }
  console.log(`Cleared ${ids.length} existing records`);
}

async function batchCreate(token, tableId, records) {
  const todayMs = new Date('2026-07-30T00:00:00+08:00').getTime();
  for (let i = 0; i < records.length; i += 500) {
    const chunk = records.slice(i, i + 500).map((r) => ({
      fields: {
        章节序号: r.order,
        章节: r.chapter,
        标题: r.title,
        内容: r.content,
        更新日期: todayMs,
      },
    }));
    await api(token, `/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/records/batch_create`, {
      method: 'POST',
      body: JSON.stringify({ records: chunk }),
    });
  }
}

async function addProjectRecord(token) {
  const projTableId = 'tblVu4jnB3UiScds';
  const ids = await listAllRecordIds(token, projTableId);
  // skip if project already exists
  let pageToken;
  do {
    const url = new URL(`${FEISHU_BASE}/bitable/v1/apps/${APP_TOKEN}/tables/${projTableId}/records`);
    url.searchParams.set('page_size', '500');
    if (pageToken) url.searchParams.set('page_token', pageToken);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const body = await res.json();
    for (const item of body.data?.items ?? []) {
      const name = item.fields?.['项目名称'];
      if (typeof name === 'string' && name.includes('scm-agent')) {
        console.log('Project record already exists, skip');
        return;
      }
    }
    pageToken = body.data?.has_more ? body.data.page_token : undefined;
  } while (pageToken);

  const todayMs = new Date('2026-07-30T00:00:00+08:00').getTime();
  await api(token, `/bitable/v1/apps/${APP_TOKEN}/tables/${projTableId}/records`, {
    method: 'POST',
    body: JSON.stringify({
      fields: {
        项目名称: '数智驱动 · 计划—采购—物流—运营主轴平台（scm-agent）',
        所属节点: 'PMC',
        项目类型: 'AI 数据中台',
        项目状态: '开发中',
        立项文档: '详见同 Base「scm-agent 蓝图报告」数据表（按章节拆分，2026-07-30 写入）',
        预估价值: '⭐⭐⭐⭐⭐ 极高',
        预算级别: '<5万',
        立项日期: todayMs,
        计划完成: new Date('2026-12-31T00:00:00+08:00').getTime(),
      },
    }),
  });
  console.log('Added project record in 立项及项目管理');
}

async function main() {
  const token = await getToken();
  const tableId = await findOrCreateTable(token);
  await clearRecords(token, tableId);
  await batchCreate(token, tableId, REPORT_SECTIONS);
  console.log(`Wrote ${REPORT_SECTIONS.length} sections to ${TABLE_NAME}`);
  await addProjectRecord(token);
  console.log(`Done. Open: https://chinabestwo.feishu.cn/base/${APP_TOKEN}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
