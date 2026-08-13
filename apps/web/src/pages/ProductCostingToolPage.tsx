import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { AiBanner } from '@/components/AiBanner';
import { AiProgressBar } from '@/components/AiProgressBar';
import { BomLinesPanel } from '@/components/costing/BomLinesPanel';
import { CostDashboard } from '@/components/costing/CostDashboard';
import { PriceBookPanel } from '@/components/costing/PriceBookPanel';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useCurrentUser } from '@/hooks/useAuth';

const CURRENT_PROJECT_KEY = 'costing.currentProjectId';
const PRODUCT_CATEGORIES = ['斗柜', '床头柜', '书桌', '梳妆台', '其他'] as const;

export function ProductCostingToolPage() {
  const queryClient = useQueryClient();
  const { data: user } = useCurrentUser();
  const uploadRef = useRef<HTMLInputElement>(null);
  const [projectId, setProjectId] = useState('');
  const [extractRunId, setExtractRunId] = useState('');
  const [message, setMessage] = useState('');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newProductName, setNewProductName] = useState('');
  const [newProductCategory, setNewProductCategory] = useState<(typeof PRODUCT_CATEGORIES)[number]>(
    '其他',
  );
  const isReadOnly = user?.role.code === 'viewer';

  const projectsQuery = useQuery({
    queryKey: ['costing-projects'],
    queryFn: api.listCostingProjects,
  });
  const projects = projectsQuery.data?.items ?? [];

  useEffect(() => {
    if (!projectsQuery.data) return;
    if (!projects.length) {
      setProjectId('');
      localStorage.removeItem(CURRENT_PROJECT_KEY);
      return;
    }
    setProjectId((current) => {
      if (projects.some((project) => project.id === current)) return current;
      const saved = localStorage.getItem(CURRENT_PROJECT_KEY);
      return projects.some((project) => project.id === saved) ? saved! : projects[0]!.id;
    });
  }, [projects, projectsQuery.data]);

  useEffect(() => {
    if (projectId) localStorage.setItem(CURRENT_PROJECT_KEY, projectId);
  }, [projectId]);

  const projectQuery = useQuery({
    queryKey: ['costing-project', projectId],
    queryFn: () => api.getCostingProject(projectId),
    enabled: Boolean(projectId),
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

  const createProject = useMutation({
    mutationFn: (input: { name: string; category: string }) =>
      api.createCostingProject(input),
    onSuccess: (project) => {
      setMessage('');
      setNewProductName('');
      setNewProductCategory('其他');
      setShowCreateForm(false);
      setProjectId(project.id);
      localStorage.setItem(CURRENT_PROJECT_KEY, project.id);
      queryClient.invalidateQueries({ queryKey: ['costing-projects'] });
    },
    onError: (error: Error) => setMessage(error.message),
  });

  const patchProject = useMutation({
    mutationFn: (category: string) => api.patchCostingProject(projectId, { category }),
    onSuccess: () => {
      setMessage('');
      queryClient.invalidateQueries({ queryKey: ['costing-project', projectId] });
      queryClient.invalidateQueries({ queryKey: ['costing-projects'] });
    },
    onError: (error: Error) => setMessage(error.message),
  });

  const uploadAttachment = useMutation({
    mutationFn: (file: File) => api.uploadCostingAttachment(projectId, file),
    onSuccess: () => {
      setMessage('设计方案已上传，可以开始 AI 解析。');
      queryClient.invalidateQueries({ queryKey: ['costing-project', projectId] });
    },
    onError: (error: Error) => setMessage(error.message),
  });

  const startExtract = useMutation({
    mutationFn: () => api.startCostingExtract(projectId),
    onSuccess: ({ runId }) => {
      setMessage('');
      setExtractRunId(runId);
      queryClient.invalidateQueries({ queryKey: ['costing-project', projectId] });
      queryClient.invalidateQueries({ queryKey: ['costing-projects'] });
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
    const run = extractRunQuery.data;
    if (run?.status === 'failed') {
      queryClient.invalidateQueries({ queryKey: ['costing-project', projectId] });
      queryClient.invalidateQueries({ queryKey: ['costing-projects'] });
      return;
    }
    if (run?.status !== 'succeeded') return;
    setMessage('AI 解析完成，材料清单已更新。');
    setExtractRunId('');
    queryClient.invalidateQueries({ queryKey: ['costing-project', projectId] });
    queryClient.invalidateQueries({ queryKey: ['costing-projects'] });
  }, [extractRunQuery.data, projectId, queryClient]);

  const project = projectQuery.data;

  return (
    <div className="min-h-full space-y-6 bg-layout">
      <PageHeader title="产品成本核算">
        <div className="flex flex-wrap items-center justify-end gap-2">
          <label htmlFor="costing-project-select" className="text-sm text-text-sub">
            产品
          </label>
          <select
            id="costing-project-select"
            className="h-10 min-w-56 rounded-md border border-input bg-card px-3 text-sm text-text-main"
            value={projectId}
            disabled={!projects.length}
            onChange={(event) => {
              setMessage('');
              setExtractRunId('');
              setProjectId(event.target.value);
            }}
          >
            {!projects.length && <option value="">暂无产品</option>}
            {projects.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          {!isReadOnly && (
            <>
              <Button
                variant="outline"
                onClick={() => setShowCreateForm((value) => !value)}
                disabled={createProject.isPending}
              >
                {showCreateForm ? '取消新建' : '新建'}
              </Button>
              <Button
                variant="outline"
                disabled={!projectId || uploadAttachment.isPending}
                onClick={() => uploadRef.current?.click()}
              >
                {uploadAttachment.isPending ? '上传中...' : '上传设计方案'}
              </Button>
              <input
                ref={uploadRef}
                type="file"
                accept=".pptx,.pdf"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file && projectId) uploadAttachment.mutate(file);
                  event.target.value = '';
                }}
              />
            </>
          )}
          <Button
            variant="outline"
            disabled={!projectId || exportProject.isPending}
            onClick={() => exportProject.mutate()}
          >
            {exportProject.isPending ? '导出中...' : '导出'}
          </Button>
          <Button
            disabled={
              isReadOnly ||
              !projectId ||
              !projectQuery.data?.hasSourceAttachment ||
              startExtract.isPending ||
              extractRunQuery.data?.status === 'pending' ||
              extractRunQuery.data?.status === 'running'
            }
            title={
              projectId && !projectQuery.data?.hasSourceAttachment
                ? '请先上传设计方案'
                : undefined
            }
            onClick={() => startExtract.mutate()}
          >
            {startExtract.isPending ||
            extractRunQuery.data?.status === 'pending' ||
            extractRunQuery.data?.status === 'running'
              ? '解析中...'
              : '解析'}
          </Button>
        </div>
      </PageHeader>

      {showCreateForm && !isReadOnly && (
        <Card>
          <CardContent className="flex flex-wrap items-end gap-3 py-4">
            <label className="min-w-64 flex-1 text-sm text-text-sub">
              产品名称
              <Input
                className="mt-1"
                value={newProductName}
                onChange={(event) => setNewProductName(event.target.value)}
              />
            </label>
            <label className="text-sm text-text-sub">
              品类
              <select
                className="mt-1 block h-10 min-w-36 rounded-md border border-input bg-card px-3 text-sm text-text-main"
                value={newProductCategory}
                onChange={(event) =>
                  setNewProductCategory(
                    event.target.value as (typeof PRODUCT_CATEGORIES)[number],
                  )
                }
              >
                {PRODUCT_CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </label>
            <Button
              variant="outline"
              disabled={!newProductName.trim() || createProject.isPending}
              onClick={() =>
                createProject.mutate({
                  name: newProductName.trim(),
                  category: newProductCategory,
                })
              }
            >
              {createProject.isPending ? '创建中...' : '确认创建'}
            </Button>
          </CardContent>
        </Card>
      )}

      {message && (
        <p className="text-sm text-text-sub" role="status">
          {message}
        </p>
      )}

      {(extractRunQuery.data?.status === 'pending' ||
        extractRunQuery.data?.status === 'running') && (
        <Card>
          <CardContent className="space-y-2 py-4">
            <p className="text-sm text-text-sub">
              正在解析第 {extractRunQuery.data.batchCurrent}/{extractRunQuery.data.batchTotal} 批
            </p>
            <AiProgressBar />
          </CardContent>
        </Card>
      )}

      {extractRunQuery.data?.status === 'failed' && (
        <AiBanner
          message={extractRunQuery.data.errorMessage || 'AI 解析失败，请重试'}
          fixLabel="重试"
          onFix={() => startExtract.mutate()}
        />
      )}

      <PriceBookPanel projectId={projectId} readOnly={isReadOnly} />

      {!projectId && !projectsQuery.isLoading ? (
        <Card>
          <CardContent className="py-12 text-center text-text-sub">
            新建产品并上传打样 PPT，或先维护价目、手工添加材料行。
          </CardContent>
        </Card>
      ) : projectQuery.isLoading ? (
        <p className="text-sm text-text-sub">正在加载产品核算数据...</p>
      ) : projectQuery.error ? (
        <Card>
          <CardContent className="py-8 text-center text-destructive">
            {projectQuery.error.message}
          </CardContent>
        </Card>
      ) : project ? (
        <>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-text-sub">
            <span>
              核算编号：<span className="font-mono text-text-main">{project.projectNo}</span>
            </span>
            <span>产品：{project.name}</span>
            <label className="flex items-center gap-2">
              品类：
              <select
                className="h-8 rounded-md border border-input bg-card px-2 text-sm text-text-main"
                value={project.category ?? '其他'}
                disabled={isReadOnly || patchProject.isPending}
                onChange={(event) => patchProject.mutate(event.target.value)}
              >
                {PRODUCT_CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </label>
            <span>状态：{project.status}</span>
          </div>
          <BomLinesPanel projectId={project.id} lines={project.lines} readOnly={isReadOnly} />
          <CostDashboard summary={project.summary} />
        </>
      ) : null}
    </div>
  );
}
