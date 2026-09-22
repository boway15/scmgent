import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { AiBanner } from '@/components/AiBanner';
import { AiProgressBar } from '@/components/AiProgressBar';
import { BomLinesPanel } from '@/components/costing/BomLinesPanel';
import { ApplyFactsProgressCard } from '@/components/costing/ApplyFactsProgressCard';
import { ReviewIssuesPanel } from '@/components/costing/ReviewIssuesPanel';
import { CostDashboard } from '@/components/costing/CostDashboard';
import { BoardSheetPanel } from '@/components/costing/BoardSheetPanel';
import { AccessoriesPackPanel } from '@/components/costing/AccessoriesPackPanel';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useCurrentUser } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';

const PRODUCT_CATEGORIES_FALLBACK = [
  '斗柜',
  '床头柜',
  '书桌',
  '桌子',
  '梳妆台',
  '床',
  '椅子',
  '其他',
] as const;
const CONSTRUCTION_TYPES = ['板式', '实木', '混合'] as const;
const STRUCTURE_FACT_PATCH_KEYS = [
  'category',
  'drawerCount',
  'defaultSubstrate',
  'carcassThicknessMm',
  'drawerBottomThicknessMm',
  'sideThicknessMm',
  'backThicknessMm',
  'bottomThicknessMm',
  'structureSummary',
  'designPrinciples',
] as const;
const SUBSTRATE_OPTIONS = ['颗粒板', '密度板', '多层实木板', '实木', '其他'] as const;
function patchTouchesStructureFacts(
  patch: Partial<Record<(typeof STRUCTURE_FACT_PATCH_KEYS)[number], unknown>>,
): boolean {
  return STRUCTURE_FACT_PATCH_KEYS.some((key) => patch[key] !== undefined);
}

const HARDWARE_FACT_NAMES = ['抽屉滑轨', '防倾倒配件'] as const;
const COSTING_STEPS = [
  { id: 1 as const, title: '产品信息与设计标准', hint: '上传方案，识别并确认结构，不含物料清单与板厚' },
  { id: 2 as const, title: '开料与物料确认', hint: '填写板厚后点「生成开料」；可选 AI 补充识别抽面/五金' },
  { id: 3 as const, title: '价格计算确认', hint: '计算材料成本并确认看板金额' },
];
type CostingStep = (typeof COSTING_STEPS)[number]['id'];

function blockerReasonLabel(reason: 'missing_price' | 'missing_qty' | 'missing_thickness') {
  if (reason === 'missing_price') return '缺价';
  if (reason === 'missing_thickness') return '未填板厚';
  return '缺用量';
}

function ThicknessMmField(props: {
  label: string;
  fieldKey: string;
  value: number | null;
  min: number;
  max: number;
  disabled: boolean;
  onInvalid: () => void;
  onCommit: (next: number | null) => void;
}) {
  return (
    <label className="flex items-center gap-2">
      {props.label}
      <Input
        className="h-8 w-20 px-2 font-mono"
        type="number"
        min={props.min}
        max={props.max}
        disabled={props.disabled}
        defaultValue={props.value ?? ''}
        key={props.fieldKey}
        onBlur={(event) => {
          const raw = event.target.value.trim();
          const next = raw === '' ? null : Number(raw);
          if (next === (props.value ?? null)) return;
          if (next !== null && (!Number.isInteger(next) || next < props.min || next > props.max)) {
            props.onInvalid();
            return;
          }
          props.onCommit(next);
        }}
      />
      mm
    </label>
  );
}

export function ProductCostingToolPage() {
  const { id: projectId = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: user } = useCurrentUser();
  const uploadRef = useRef<HTMLInputElement>(null);
  const structureSummaryRef = useRef<HTMLTextAreaElement>(null);
  const designPrinciplesRef = useRef<HTMLTextAreaElement>(null);
  const [extractRunId, setExtractRunId] = useState('');
  const [applyFactsFinished, setApplyFactsFinished] = useState(false);
  const appliedExtractRunRef = useRef('');
  const [message, setMessage] = useState('');
  const [hardwareDraft, setHardwareDraft] = useState<
    Array<{ name: string; spec: string; qty: string }>
  >(HARDWARE_FACT_NAMES.map((name) => ({ name, spec: '', qty: '' })));
  const [waitingForFacts, setWaitingForFacts] = useState(false);
  const factsAnalyzeStartedAt = useRef(0);
  const [step, setStep] = useState<CostingStep>(1);
  const [highlightLineId, setHighlightLineId] = useState<string | null>(null);
  const [reviewPendingLineId, setReviewPendingLineId] = useState<string | null>(null);
  const isReadOnly = user?.role.code === 'viewer';

  const catalogsQuery = useQuery({
    queryKey: ['costing-catalogs'],
    queryFn: async () => {
      const [regions, factories, status] = await Promise.all([
        api.listCostingRegions(true),
        api.listCostingFactories(true),
        api.getCostingStatus(),
      ]);
      return {
        regions: regions.items,
        factories: factories.items,
        productCategories:
          status.productCategories?.length > 0
            ? status.productCategories
            : [...PRODUCT_CATEGORIES_FALLBACK],
        bomLineCategories: status.bomLineCategories ?? [],
      };
    },
  });

  const projectQuery = useQuery({
    queryKey: ['costing-project', projectId],
    queryFn: () => api.getCostingProject(projectId),
    enabled: Boolean(projectId),
    refetchInterval: (query) => {
      if (query.state.data?.status === 'extracting') return 2000;
      return waitingForFacts ? 2000 : false;
    },
  });

  const extractRunQuery = useQuery({
    queryKey: ['costing-extract-run', projectId, extractRunId],
    queryFn: () => api.getCostingExtractRun(projectId, extractRunId),
    enabled: Boolean(projectId && extractRunId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'pending' || status === 'running' ? 2000 : false;
    },
  });

  const patchProject = useMutation({
    mutationFn: (patch: {
      name?: string;
      category?: string | null;
      constructionType?: string | null;
      drawerCount?: number | null;
      defaultSubstrate?: string | null;
      carcassThicknessMm?: number | null;
      drawerBottomThicknessMm?: number | null;
      sideThicknessMm?: number | null;
      backThicknessMm?: number | null;
      bottomThicknessMm?: number | null;
      structureSummary?: string | null;
      designPrinciples?: string | null;
      hardwareFacts?: Array<{ name: string; spec: string; qty: number }>;
      regionId?: string | null;
      factoryId?: string | null;
      priceAsOf?: string | null;
    }) => api.patchCostingProject(projectId, patch),
    onSuccess: (data, variables) => {
      if (data.applyFactsStale) {
        setMessage('结构参数已变更，清单与当前设计不一致，请重新点「生成开料」。');
      } else if (patchTouchesStructureFacts(variables)) {
        setMessage('结构参数已保存。');
      } else {
        setMessage('');
      }
      queryClient.invalidateQueries({ queryKey: ['costing-project', projectId] });
      queryClient.invalidateQueries({ queryKey: ['costing-projects'] });
    },
    onError: (error: Error) => setMessage(error.message),
  });

  const markLineReviewed = useMutation({
    mutationFn: (lineId: string) => {
      setReviewPendingLineId(lineId);
      return api.patchCostingBomLine(projectId, lineId, { isManual: true });
    },
    onSuccess: () => {
      setReviewPendingLineId(null);
      queryClient.invalidateQueries({ queryKey: ['costing-project', projectId] });
    },
    onError: (error: Error) => {
      setReviewPendingLineId(null);
      if (/404|清单行不存在/.test(error.message)) {
        queryClient.invalidateQueries({ queryKey: ['costing-project', projectId] });
        setMessage('清单已刷新，请重新操作');
        return;
      }
      setMessage(error.message);
    },
  });

  const uploadAttachment = useMutation({
    mutationFn: (file: File) => api.uploadCostingAttachment(projectId, file),
    onSuccess: () => {
      setMessage('设计方案已上传，开始识别产品信息与结构设计。');
      queryClient.invalidateQueries({ queryKey: ['costing-project', projectId] });
      analyzeFacts.mutate();
    },
    onError: (error: Error) => setMessage(error.message),
  });

  const analyzeFacts = useMutation({
    mutationFn: () => api.analyzeCostingFacts(projectId),
    onMutate: () => {
      factsAnalyzeStartedAt.current = Date.now();
      setWaitingForFacts(true);
    },
    onSuccess: () => {
      setStep(1);
      queryClient.invalidateQueries({ queryKey: ['costing-project', projectId] });
      queryClient.invalidateQueries({ queryKey: ['costing-projects'] });
    },
    onError: (error: Error) => {
      setWaitingForFacts(false);
      setMessage(error.message);
    },
  });

  const startExtract = useMutation({
    mutationFn: async () => {
      const current = projectQuery.data;
      await api.patchCostingProject(projectId, {
        category: current?.category ?? null,
        constructionType: current?.constructionType ?? null,
        drawerCount: current?.drawerCount ?? null,
        defaultSubstrate: current?.defaultSubstrate ?? null,
        carcassThicknessMm: current?.carcassThicknessMm ?? null,
        drawerBottomThicknessMm: current?.drawerBottomThicknessMm ?? null,
        sideThicknessMm: current?.sideThicknessMm ?? null,
        backThicknessMm: current?.backThicknessMm ?? null,
        bottomThicknessMm: current?.bottomThicknessMm ?? null,
        structureSummary: structureSummaryRef.current?.value.trim() || null,
        designPrinciples: designPrinciplesRef.current?.value.trim() || null,
      });
      return api.startCostingExtract(projectId);
    },
    onSuccess: ({ runId }) => {
      setMessage('正在 AI 补充识别抽面/五金（可选）；完成后请点「生成开料」展开结构件。');
      setExtractRunId(runId);
      setStep(2);
      queryClient.invalidateQueries({ queryKey: ['costing-project', projectId] });
      queryClient.invalidateQueries({ queryKey: ['costing-projects'] });
    },
    onError: (error: Error) => setMessage(error.message),
  });

  const confirmDesignForApply = useMutation({
    mutationFn: async () => {
      const current = projectQuery.data;
      await api.patchCostingProject(projectId, {
        category: current?.category ?? null,
        constructionType: current?.constructionType ?? null,
        drawerCount: current?.drawerCount ?? null,
        defaultSubstrate: current?.defaultSubstrate ?? null,
        carcassThicknessMm: current?.carcassThicknessMm ?? null,
        drawerBottomThicknessMm: current?.drawerBottomThicknessMm ?? null,
        sideThicknessMm: current?.sideThicknessMm ?? null,
        backThicknessMm: current?.backThicknessMm ?? null,
        bottomThicknessMm: current?.bottomThicknessMm ?? null,
        structureSummary: structureSummaryRef.current?.value.trim() || null,
        designPrinciples: designPrinciplesRef.current?.value.trim() || null,
      });
      return api.confirmCostingDesignForApply(projectId);
    },
    onSuccess: () => {
      setMessage('已进入开料步骤。请填写板厚后点「生成开料」；未匹配价目的 AI 行会归入「其他」。');
      setStep(2);
      queryClient.invalidateQueries({ queryKey: ['costing-project', projectId] });
      queryClient.invalidateQueries({ queryKey: ['costing-projects'] });
    },
    onError: (error: Error) => setMessage(error.message),
  });

  const applyFacts = useMutation({
    mutationFn: async () => {
      await api.patchCostingProject(projectId, {
        defaultSubstrate: projectQuery.data?.defaultSubstrate ?? null,
        carcassThicknessMm: projectQuery.data?.carcassThicknessMm ?? null,
        drawerBottomThicknessMm: projectQuery.data?.drawerBottomThicknessMm ?? null,
        sideThicknessMm: projectQuery.data?.sideThicknessMm ?? null,
        backThicknessMm: projectQuery.data?.backThicknessMm ?? null,
        bottomThicknessMm: projectQuery.data?.bottomThicknessMm ?? null,
        hardwareFacts: hardwareDraft.map((row) => ({
          name: row.name,
          spec: row.spec,
          qty: Number(row.qty) || 0,
        })),
      });
      return api.applyCostingFacts(projectId);
    },
    onMutate: () => setApplyFactsFinished(false),
    onSuccess: async () => {
      setApplyFactsFinished(true);
      setMessage('已清除上次开料结果，并按当前板厚重新生成清单，请核对后再点「计算成本」。');
      await queryClient.refetchQueries({ queryKey: ['costing-project', projectId] });
      setStep(2);
      window.setTimeout(() => setApplyFactsFinished(false), 2800);
    },
    onError: (error: Error) => {
      setApplyFactsFinished(false);
      setMessage(error.message);
    },
  });

  const computeCost = useMutation({
    mutationFn: async () => api.computeCostingProject(projectId),
    onSuccess: () => {
      setMessage('成本已计算，请核对看板。');
      queryClient.invalidateQueries({ queryKey: ['costing-project', projectId] });
      setStep(3);
    },
    onError: (error: Error) => setMessage(error.message),
  });

  const exportProject = useMutation({
    mutationFn: () => api.downloadCostingProject(projectId),
    onError: (error: Error) => setMessage(error.message),
  });

  useEffect(() => {
    const project = projectQuery.data;
    if (
      project?.status === 'extracting' &&
      project.latestExtractRun &&
      (project.latestExtractRun.status === 'pending' ||
        project.latestExtractRun.status === 'running')
    ) {
      setExtractRunId(project.latestExtractRun.id);
    }
  }, [projectQuery.data]);

  useEffect(() => {
    if (!waitingForFacts) return;
    if (analyzeFacts.isPending) return;
    if (projectQuery.data?.status === 'extracting') return;
    if (projectQuery.dataUpdatedAt < factsAnalyzeStartedAt.current) return;
    setWaitingForFacts(false);
  }, [
    waitingForFacts,
    analyzeFacts.isPending,
    projectQuery.data?.status,
    projectQuery.dataUpdatedAt,
  ]);

  useEffect(() => {
    const run = extractRunQuery.data;
    if (run?.status === 'failed') {
      queryClient.invalidateQueries({ queryKey: ['costing-project', projectId] });
      queryClient.invalidateQueries({ queryKey: ['costing-projects'] });
      return;
    }
    if (run?.status !== 'succeeded') return;
    if (appliedExtractRunRef.current === run.id) return;
    appliedExtractRunRef.current = run.id;
    setExtractRunId('');
    queryClient.invalidateQueries({ queryKey: ['costing-project', projectId] });
    queryClient.invalidateQueries({ queryKey: ['costing-projects'] });
    setMessage('AI 补充识别已完成。请填写板厚后点「生成开料」；未匹配价目的识别行在「其他」模块。');
    setStep(2);
  }, [extractRunQuery.data, projectId, queryClient]);

  const project = projectQuery.data;
  const regions = catalogsQuery.data?.regions ?? [];
  const factories = catalogsQuery.data?.factories ?? [];
  const productCategories = catalogsQuery.data?.productCategories ?? [...PRODUCT_CATEGORIES_FALLBACK];

  useEffect(() => {
    if (!project) return;
    setHardwareDraft(
      HARDWARE_FACT_NAMES.map((name) => {
        const current = project.hardwareFacts?.find((item) => item.name === name);
        return {
          name,
          spec: current?.spec ?? '',
          qty: current?.qty ? String(current.qty) : '',
        };
      }),
    );
  }, [project?.id, project?.hardwareFacts]);

  return (
    <div className="min-h-full space-y-6 bg-layout">
      <PageHeader title={project?.name || '产品成本核算'}>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button variant="outline" onClick={() => navigate('/procurement/costing')}>
            返回列表
          </Button>
          <Button
            variant="outline"
            disabled={!projectId || exportProject.isPending}
            onClick={() => exportProject.mutate()}
          >
            {exportProject.isPending ? '导出中...' : '导出'}
          </Button>
        </div>
      </PageHeader>

      {message && (
        <p className="text-sm text-text-sub" role="status">
          {message}
        </p>
      )}

      {(waitingForFacts || project?.status === 'extracting') &&
        extractRunQuery.data?.status !== 'pending' &&
        extractRunQuery.data?.status !== 'running' && (
        <Card>
          <CardContent className="space-y-2 py-4">
            <p className="text-sm text-text-sub">正在识别产品信息与结构设计…</p>
            <AiProgressBar />
          </CardContent>
        </Card>
      )}

      {(extractRunQuery.data?.status === 'pending' ||
        extractRunQuery.data?.status === 'running') && (
        <Card>
          <CardContent className="space-y-2 py-4">
            <p className="text-sm text-text-sub">
              正在 AI 补充识别（第 {extractRunQuery.data.batchCurrent}/
              {extractRunQuery.data.batchTotal} 批）
            </p>
            <AiProgressBar />
          </CardContent>
        </Card>
      )}

      {extractRunQuery.data?.status === 'failed' && (
        <AiBanner
          message={extractRunQuery.data.errorMessage || '物料识别失败，请重试'}
          fixLabel="重试"
          onFix={() => startExtract.mutate()}
        />
      )}

      {(applyFacts.isPending || applyFactsFinished) && project && (
        <ApplyFactsProgressCard
          active={applyFacts.isPending}
          finished={applyFactsFinished}
          context={{
            bomLineCount: project.bomLines?.length ?? 0,
            category: project.category,
            drawerCount: project.drawerCount,
            carcassThicknessMm: project.carcassThicknessMm,
            sideThicknessMm: project.sideThicknessMm,
            backThicknessMm: project.backThicknessMm,
          }}
        />
      )}

      {projectQuery.data?.status === 'extract_failed' &&
        extractRunQuery.data?.status !== 'failed' &&
        projectQuery.data.extractError && (
        <AiBanner
          message={projectQuery.data.extractError}
          fixLabel="重试"
          onFix={() => analyzeFacts.mutate()}
        />
      )}

      {projectQuery.isLoading ? (
        <p className="text-sm text-text-sub">正在加载产品核算数据...</p>
      ) : projectQuery.error ? (
        <Card>
          <CardContent className="py-8 text-center text-destructive">
            {projectQuery.error.message}
          </CardContent>
        </Card>
      ) : project ? (
        <>
          <p className="text-sm text-text-sub">
            核算编号：<span className="font-mono text-text-main">{project.projectNo}</span>
            <span className="ml-3">状态：{project.status}</span>
          </p>
          <Card>
            <CardContent className="pt-6">
              <ol className="flex flex-wrap items-center gap-y-3 text-sm">
                {COSTING_STEPS.map((item, index) => {
                  const active = step === item.id;
                  return (
                    <li key={item.id} className="flex items-center">
                      {index > 0 && <span className="mx-2 hidden text-text-hint sm:inline">→</span>}
                      <button
                        type="button"
                        onClick={() => setStep(item.id)}
                        className={cn(
                          'flex items-center gap-2 rounded-md px-2 py-1 text-left transition-colors hover:bg-muted',
                          active && 'bg-accent font-medium text-primary',
                        )}
                      >
                        <span
                          className={cn(
                            'flex h-5 w-5 items-center justify-center rounded-full text-xs',
                            active
                              ? 'bg-primary text-primary-foreground'
                              : 'border border-border text-text-hint',
                          )}
                        >
                          {item.id}
                        </span>
                        <span>
                          {item.title}
                          <span className="ml-2 hidden font-normal text-text-hint md:inline">
                            {item.hint}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </CardContent>
          </Card>

          {step === 1 && (
            <>
          <input
            ref={uploadRef}
            type="file"
            accept=".pptx,.pdf,.jpg,.jpeg,.png,.webp"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file && projectId) uploadAttachment.mutate(file);
              event.target.value = '';
            }}
          />
          <Card>
            <CardHeader>
              <CardTitle>上传设计方案</CardTitle>
              <p className="mt-1 text-sm text-text-hint">
                支持 PPT/PDF 或单张 JPG/PNG/WebP（多图请先合成 PDF）。系统识别品类、抽屉、基材与结构设计；确认后默认进入规则开料，AI 识别为可选项。
              </p>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center gap-3">
              {!isReadOnly && (
                <Button
                  disabled={uploadAttachment.isPending}
                  onClick={() => uploadRef.current?.click()}
                >
                  {uploadAttachment.isPending
                    ? '上传中...'
                    : project.hasSourceAttachment
                      ? '重新上传'
                      : '上传设计方案'}
                </Button>
              )}
              {project.hasSourceAttachment && (
                <Button
                  variant="outline"
                  disabled={
                    isReadOnly ||
                    analyzeFacts.isPending ||
                    project.status === 'extracting'
                  }
                  onClick={() => analyzeFacts.mutate()}
                >
                  {analyzeFacts.isPending ||
                  (project.status === 'extracting' &&
                    extractRunQuery.data?.status !== 'pending' &&
                    extractRunQuery.data?.status !== 'running')
                    ? '识别中...'
                    : '重新识别产品信息'}
                </Button>
              )}
              <span className="text-sm text-text-hint">
                {project.hasSourceAttachment ? '已上传方案' : '尚未上传，无法识别'}
              </span>
            </CardContent>
          </Card>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-text-sub">
            <label className="flex items-center gap-2">
              产品名称：
              <Input
                className="h-8 w-56 px-2"
                disabled={isReadOnly || patchProject.isPending}
                defaultValue={project.name}
                key={`${project.id}-name-${project.name}`}
                onBlur={(event) => {
                  const next = event.target.value.trim();
                  if (!next || next === project.name) return;
                  patchProject.mutate({ name: next });
                }}
              />
            </label>
            <label className="flex items-center gap-2">
              品类：
              <select
                className="h-8 rounded-md border border-input bg-card px-2 text-sm text-text-main"
                value={project.category ?? ''}
                disabled={isReadOnly || patchProject.isPending}
                onChange={(event) =>
                  patchProject.mutate({ category: event.target.value || null })
                }
              >
                <option value="">待识别</option>
                {productCategories.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2">
              结构：
              <select
                className="h-8 rounded-md border border-input bg-card px-2 text-sm text-text-main"
                value={project.constructionType ?? ''}
                disabled={isReadOnly || patchProject.isPending}
                onChange={(event) =>
                  patchProject.mutate({ constructionType: event.target.value || null })
                }
              >
                <option value="">未指定</option>
                {CONSTRUCTION_TYPES.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2">
              抽屉数：
              <Input
                className="h-8 w-16 px-2"
                type="number"
                min={0}
                max={30}
                disabled={isReadOnly || patchProject.isPending}
                defaultValue={project.drawerCount ?? ''}
                key={`${project.id}-drawer-${project.drawerCount ?? ''}`}
                onBlur={(event) => {
                  const raw = event.target.value.trim();
                  const next = raw === '' ? null : Number(raw);
                  if (next === (project.drawerCount ?? null)) return;
                  if (next !== null && (!Number.isInteger(next) || next < 0 || next > 30)) {
                    setMessage('抽屉数须为 0–30 的整数');
                    return;
                  }
                  patchProject.mutate({ drawerCount: next });
                }}
              />
            </label>
            <label className="flex items-center gap-2">
              基材：
              <select
                className="h-8 rounded-md border border-input bg-card px-2 text-sm text-text-main"
                value={project.defaultSubstrate ?? ''}
                disabled={isReadOnly || patchProject.isPending}
                onChange={(event) =>
                  patchProject.mutate({ defaultSubstrate: event.target.value || null })
                }
              >
                <option value="">未指定</option>
                {SUBSTRATE_OPTIONS.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="text-xs text-text-hint">
            模型会判断品类、大致结构与拆料原则。识别结果均可修改。标准斗柜/床头柜推荐<strong className="font-medium text-text-sub">规则优先</strong>：确认后直接进入开料，由系统按结构公式展开板件；需要时再 AI 补充抽面/五金。
          </p>
          <Card>
            <CardHeader>
              <div>
                <CardTitle>{project.structureBrief?.title || '结构设计'}</CardTitle>
                <p className="mt-1 text-sm text-text-hint">{project.structureBrief?.summary}</p>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <label className="block space-y-1 text-sm">
                <span className="text-text-sub">模型识别的结构说明（可改）</span>
                <textarea
                  ref={structureSummaryRef}
                  className="min-h-[88px] w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-text-main"
                  disabled={isReadOnly || patchProject.isPending}
                  defaultValue={project.structureSummary ?? ''}
                  key={`${project.id}-summary-${project.structureSummary ?? ''}`}
                  onBlur={(event) => {
                    const next = event.target.value.trim() || null;
                    if (next === (project.structureSummary ?? null)) return;
                    patchProject.mutate({ structureSummary: next });
                  }}
                />
              </label>
              <label className="block space-y-1 text-sm">
                <span className="text-text-sub">后续拆物料的设计原则（可改）</span>
                <textarea
                  ref={designPrinciplesRef}
                  className="min-h-[88px] w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-text-main"
                  disabled={isReadOnly || patchProject.isPending}
                  defaultValue={project.designPrinciples ?? ''}
                  key={`${project.id}-principles-${project.designPrinciples ?? ''}`}
                  onBlur={(event) => {
                    const next = event.target.value.trim() || null;
                    if (next === (project.designPrinciples ?? null)) return;
                    patchProject.mutate({ designPrinciples: next });
                  }}
                />
              </label>
              {project.structureBrief?.slots?.length ? (
                <p className="text-sm text-text-sub">
                  必核结构件：{project.structureBrief.slots.join('、')}
                </p>
              ) : null}
              {project.structureBrief?.items?.length ? (
                <ul className="list-disc space-y-1 pl-5 text-sm text-text-sub">
                  {project.structureBrief.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              ) : null}
              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  onClick={() => confirmDesignForApply.mutate()}
                  disabled={
                    isReadOnly ||
                    confirmDesignForApply.isPending ||
                    !project.hasSourceAttachment ||
                    project.status === 'extracting' ||
                    waitingForFacts ||
                    !project.category
                  }
                >
                  {confirmDesignForApply.isPending ? '进入开料...' : '确认设计标准，进入开料'}
                </Button>
                {catalogsQuery.data?.difyEnabled ? (
                  <Button
                    variant="outline"
                    onClick={() => startExtract.mutate()}
                    disabled={
                      isReadOnly ||
                      startExtract.isPending ||
                      !project.hasSourceAttachment ||
                      project.status === 'extracting' ||
                      waitingForFacts ||
                      !project.category
                    }
                  >
                    {startExtract.isPending ? 'AI 识别中...' : 'AI 补充识别（可选）'}
                  </Button>
                ) : null}
              </div>
            </CardContent>
          </Card>
            </>
          )}

          {step === 2 && (
            <>
              <p className="text-sm text-text-hint">
                本步以<strong className="font-medium text-text-sub">规则开料</strong>为主：填写板厚后点「生成开料」展开结构件与包装。AI 补充识别的行若未匹配价目，会归入「其他」模块；规则生成的板材仍在「板材」模块。
              </p>
              {(project.computeBlockers?.length ?? 0) > 0 && (
                <AiBanner
                  message={`还有 ${project.computeBlockers.length} 处待补全（板厚、单价或用量）。缺用量行请按尺寸图抽面开料补规格（宽×高 mm）。封面「事业部/十七部」不是物料，可删除。`}
                />
              )}
              {(project.structureSummary || project.designPrinciples) && (
                <Card>
                  <CardHeader>
                    <CardTitle>已应用的第一步确认</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm text-text-sub">
                    {project.category && <p>品类：{project.category}{project.drawerCount != null ? ` · 抽屉 ${project.drawerCount}` : ''}</p>}
                    {project.structureSummary && <p>结构：{project.structureSummary}</p>}
                    {project.designPrinciples && <p>拆料原则：{project.designPrinciples}</p>}
                  </CardContent>
                </Card>
              )}
          {step === 2 && project.applyFactsStale && (
            <AiBanner
              message="抽屉数、板厚或设计说明已变更，当前开料结果可能过期。请重新生成开料后再计算成本。"
              fixLabel="重新生成开料"
              onFix={() => applyFacts.mutate()}
            />
          )}
          <BomLinesPanel
            projectId={project.id}
            lines={project.lines}
            readOnly={isReadOnly}
            patchDisabled={applyFacts.isPending || project.status === 'extracting'}
            blockers={project.computeBlockers}
            defaultSubstrate={project.defaultSubstrate}
            highlightLineId={highlightLineId}
            projectRegionId={project.regionId}
            projectFactoryId={project.factoryId}
            bomLineCategories={catalogsQuery.data?.bomLineCategories}
            boardSectionHeader={
              <div className="mb-4 space-y-2 rounded-md border border-border bg-muted/30 p-3">
                <div className="flex flex-wrap gap-4 text-sm">
                  <label className="flex items-center gap-2">
                    基材
                    <select
                      className="h-8 rounded-md border border-input bg-card px-2 text-sm text-text-main"
                      value={project.defaultSubstrate ?? ''}
                      disabled={isReadOnly || patchProject.isPending}
                      onChange={(event) =>
                        patchProject.mutate({ defaultSubstrate: event.target.value || null })
                      }
                    >
                      <option value="">未指定</option>
                      {SUBSTRATE_OPTIONS.map((item) => (
                        <option key={item} value={item}>
                          {item}
                        </option>
                      ))}
                    </select>
                  </label>
                  <ThicknessMmField
                    label="箱体默认厚度"
                    fieldKey={`${project.id}-carcass-${project.carcassThicknessMm ?? ''}`}
                    value={project.carcassThicknessMm}
                    min={8}
                    max={40}
                    disabled={isReadOnly || patchProject.isPending}
                    onInvalid={() => setMessage('箱体默认厚度须为 8–40 的整数')}
                    onCommit={(next) => patchProject.mutate({ carcassThicknessMm: next })}
                  />
                  <ThicknessMmField
                    label="侧板默认厚度"
                    fieldKey={`${project.id}-side-${project.sideThicknessMm ?? ''}`}
                    value={project.sideThicknessMm}
                    min={8}
                    max={40}
                    disabled={isReadOnly || patchProject.isPending}
                    onInvalid={() => setMessage('侧板默认厚度须为 8–40 的整数')}
                    onCommit={(next) => patchProject.mutate({ sideThicknessMm: next })}
                  />
                  <ThicknessMmField
                    label="背板默认厚度"
                    fieldKey={`${project.id}-back-${project.backThicknessMm ?? ''}`}
                    value={project.backThicknessMm}
                    min={2}
                    max={18}
                    disabled={isReadOnly || patchProject.isPending}
                    onInvalid={() => setMessage('背板默认厚度须为 2–18 的整数')}
                    onCommit={(next) => patchProject.mutate({ backThicknessMm: next })}
                  />
                  <ThicknessMmField
                    label="底板默认厚度"
                    fieldKey={`${project.id}-cabinet-bottom-${project.bottomThicknessMm ?? ''}`}
                    value={project.bottomThicknessMm}
                    min={3}
                    max={40}
                    disabled={isReadOnly || patchProject.isPending}
                    onInvalid={() => setMessage('底板默认厚度须为 3–40 的整数')}
                    onCommit={(next) => patchProject.mutate({ bottomThicknessMm: next })}
                  />
                  <ThicknessMmField
                    label="抽底默认厚度"
                    fieldKey={`${project.id}-drawer-bottom-${project.drawerBottomThicknessMm ?? ''}`}
                    value={project.drawerBottomThicknessMm}
                    min={3}
                    max={18}
                    disabled={isReadOnly || patchProject.isPending}
                    onInvalid={() => setMessage('抽底默认厚度须为 3–18 的整数')}
                    onCommit={(next) => patchProject.mutate({ drawerBottomThicknessMm: next })}
                  />
                </div>
                <p className="text-xs text-text-hint">
                  基材用于板材计价（结构件按此匹配价目）。底板指柜体底板（可填 3mm），抽底指抽屉底板（未填时生成按 9mm）。每次点「生成开料」会清除上次开料/包装结果（保留手工行），再按当前板厚重新展开。
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    disabled={isReadOnly || applyFacts.isPending}
                    className={cn(project.applyFactsStale && 'ring-2 ring-amber-400 ring-offset-1')}
                    onClick={() => applyFacts.mutate()}
                  >
                    {applyFacts.isPending ? '生成中...' : project.applyFactsStale ? '重新生成开料' : '生成开料'}
                  </Button>
                  <Button
                    variant="outline"
                    disabled={
                      isReadOnly ||
                      computeCost.isPending ||
                      project.applyFactsStale ||
                      (project.computeBlockers?.length ?? 1) > 0
                    }
                    title={
                      project.applyFactsStale
                        ? '请先重新生成开料'
                        : project.computeBlockers?.length
                        ? project.computeBlockers
                            .map(
                              (item) =>
                                `${item.materialName}（${blockerReasonLabel(item.reason)}）`,
                            )
                            .join('；')
                        : undefined
                    }
                    onClick={() => computeCost.mutate()}
                  >
                    {computeCost.isPending ? '计算中...' : '计算成本'}
                  </Button>
                </div>
              </div>
            }
          />
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setStep(1)}>
                  返回产品信息
                </Button>
                <Button variant="outline" onClick={() => setStep(3)}>
                  进入计价看板
                </Button>
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <ReviewIssuesPanel
                issues={project.reviewIssues ?? []}
                readOnly={isReadOnly}
                pendingLineId={reviewPendingLineId}
                onJumpToLine={(lineId) => {
                  setHighlightLineId(lineId);
                  setStep(2);
                }}
                onMarkReviewed={(lineId) => markLineReviewed.mutate(lineId)}
              />
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-text-sub">
                <label className="flex items-center gap-2">
                  计价日：
                  <Input
                    type="date"
                    className="h-8 w-40"
                    value={project.priceAsOf ?? ''}
                    disabled={isReadOnly || patchProject.isPending}
                    onChange={(event) =>
                      patchProject.mutate({ priceAsOf: event.target.value || null })
                    }
                  />
                </label>
                <label className="flex items-center gap-2">
                  区域：
                  <select
                    className="h-8 rounded-md border border-input bg-card px-2 text-sm text-text-main"
                    value={project.regionId ?? ''}
                    disabled={isReadOnly || patchProject.isPending}
                    onChange={(event) =>
                      patchProject.mutate({ regionId: event.target.value || null })
                    }
                  >
                    <option value="">未指定（用通用价）</option>
                    {regions
                      .filter((region) => region.code !== 'generic')
                      .map((region) => (
                        <option key={region.id} value={region.id}>
                          {region.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="flex items-center gap-2">
                  工厂：
                  <select
                    className="h-8 rounded-md border border-input bg-card px-2 text-sm text-text-main"
                    value={project.factoryId ?? ''}
                    disabled={isReadOnly || patchProject.isPending}
                    onChange={(event) =>
                      patchProject.mutate({ factoryId: event.target.value || null })
                    }
                  >
                    <option value="">未指定（用通用价）</option>
                    {factories
                      .filter((factory) => factory.code !== 'generic')
                      .map((factory) => (
                        <option key={factory.id} value={factory.id}>
                          {factory.name}
                        </option>
                      ))}
                  </select>
                </label>
                <p className="text-xs text-text-hint">
                  计价日、区域和工厂只影响价目匹配（工厂专用 → 区域通用 → 全局通用）。
                </p>
              </div>
              {!isReadOnly && (
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    disabled={computeCost.isPending || (project.computeBlockers?.length ?? 1) > 0}
                    title={
                      project.computeBlockers?.length
                        ? project.computeBlockers
                            .map(
                              (item) =>
                                `${item.materialName}（${blockerReasonLabel(item.reason)}）`,
                            )
                            .join('；')
                        : undefined
                    }
                    onClick={() => computeCost.mutate()}
                  >
                    {computeCost.isPending ? '计算中...' : '计算成本'}
                  </Button>
                  {(project.computeBlockers?.length ?? 0) > 0 && (
                    <Button variant="outline" onClick={() => setStep(2)}>
                      回第二步补全（{project.computeBlockers.length}）
                    </Button>
                  )}
                  {(project.reviewIssues?.filter((item) => item.severity === 'warn').length ?? 0) >
                    0 && (
                    <Button variant="outline" onClick={() => setStep(2)}>
                      查看提醒项
                    </Button>
                  )}
                </div>
              )}
          <BoardSheetPanel
            projectId={project.id}
            rows={project.summary.boardSheet ?? []}
            lines={project.lines}
            costStale={project.costStale}
            readOnly={isReadOnly}
          />
          <AccessoriesPackPanel lines={project.lines} costStale={project.costStale} />
              <CostDashboard summary={project.summary} costStale={project.costStale} />
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  disabled={exportProject.isPending}
                  onClick={() => exportProject.mutate()}
                >
                  {exportProject.isPending ? '导出中...' : '导出成本确认表'}
                </Button>
                <Button variant="outline" onClick={() => setStep(2)}>
                  返回物料确认
                </Button>
              </div>
            </>
          )}
        </>
      ) : null}
    </div>
  );
}
