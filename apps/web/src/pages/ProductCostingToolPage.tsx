import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { BomLinesPanel } from '@/components/costing/BomLinesPanel';
import { CostDashboard } from '@/components/costing/CostDashboard';
import { PriceBookPanel } from '@/components/costing/PriceBookPanel';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

const CURRENT_PROJECT_KEY = 'costing.currentProjectId';

export function ProductCostingToolPage() {
  const queryClient = useQueryClient();
  const uploadRef = useRef<HTMLInputElement>(null);
  const [projectId, setProjectId] = useState('');
  const [message, setMessage] = useState('');

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

  const createProject = useMutation({
    mutationFn: (name: string) => api.createCostingProject({ name }),
    onSuccess: (project) => {
      setMessage('');
      setProjectId(project.id);
      localStorage.setItem(CURRENT_PROJECT_KEY, project.id);
      queryClient.invalidateQueries({ queryKey: ['costing-projects'] });
    },
    onError: (error: Error) => setMessage(error.message),
  });

  const uploadAttachment = useMutation({
    mutationFn: (file: File) => api.uploadCostingAttachment(projectId, file),
    onSuccess: () => {
      setMessage('设计方案已上传，可先手工维护材料清单。');
      queryClient.invalidateQueries({ queryKey: ['costing-project', projectId] });
    },
    onError: (error: Error) => setMessage(error.message),
  });

  const handleCreate = () => {
    const name = window.prompt('请输入产品名称');
    if (name?.trim()) createProject.mutate(name.trim());
  };

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
          <Button variant="outline" onClick={handleCreate} disabled={createProject.isPending}>
            新建
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
          <Button disabled title="AI 解析将在下一阶段开放">
            解析
          </Button>
        </div>
      </PageHeader>

      {message && (
        <p className="text-sm text-text-sub" role="status">
          {message}
        </p>
      )}

      <PriceBookPanel />

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
            <span>状态：{project.status}</span>
          </div>
          <BomLinesPanel projectId={project.id} lines={project.lines} />
          <CostDashboard summary={project.summary} />
        </>
      ) : null}
    </div>
  );
}
