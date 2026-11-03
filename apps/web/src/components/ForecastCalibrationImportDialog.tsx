import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  api,
  type ForecastCalibrationClearResult,
  type ForecastCalibrationImportResult,
} from '@/lib/api';
import { Button } from '@/components/ui/button';
import { CalibrationImportByChannelHint } from '@/components/CalibrationImportByChannelHint';

type Props = {
  open: boolean;
  versionId: string;
  onClose: () => void;
  /** 合计视图时为 true，展示须先切分平台说明 */
  showChannelHint?: boolean;
};

function formatPreview(result: ForecastCalibrationImportResult): string {
  const formatLabel = result.format === 'wide' ? '宽表' : result.format === 'detail' ? '明细' : '';
  const parts = [
    formatLabel ? `识别为${formatLabel}` : null,
    `将更新 ${result.updated} 条`,
    `跳过 ${result.skipped} 条（空校准 ${result.skipBreakdown.empty_calibration} · 未改 ${result.skipBreakdown.unchanged}）`,
  ];
  if (result.errors > 0) parts.push(`错误 ${result.errors} 条`);
  return parts.filter(Boolean).join(' · ');
}

export function ForecastCalibrationImportDialog({
  open,
  versionId,
  onClose,
  showChannelHint = true,
}: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const qc = useQueryClient();
  const [csv, setCsv] = useState('');
  const [preview, setPreview] = useState<ForecastCalibrationImportResult | null>(null);
  const [clearPreview, setClearPreview] = useState<ForecastCalibrationClearResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open) {
      if (!dialog.open) dialog.showModal();
    } else if (dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    if (!open) {
      setCsv('');
      setPreview(null);
      setClearPreview(null);
    }
  }, [open]);

  const previewMutation = useMutation({
    mutationFn: (input: { csv?: string; file?: File }) =>
      api.previewForecastCalibrationImport(versionId, input),
    onSuccess: (data) => setPreview(data),
  });

  const commitMutation = useMutation({
    mutationFn: (input: { csv?: string; file?: File }) =>
      api.commitForecastCalibrationImport(versionId, input),
    onSuccess: async (data) => {
      setPreview(data);
      setClearPreview(null);
      await qc.invalidateQueries({ queryKey: ['sales-forecast-horizon'] });
      await qc.invalidateQueries({ queryKey: ['sales-forecast-version', versionId] });
      await qc.invalidateQueries({ queryKey: ['sales-forecast-sku-detail'] });
      await qc.invalidateQueries({ queryKey: ['sales-forecast-horizon-row'] });
    },
  });

  const clearCommitMutation = useMutation({
    mutationFn: () => api.commitForecastCalibrationClear(versionId),
    onSuccess: async (data) => {
      setClearPreview(data);
      setPreview(null);
      await qc.invalidateQueries({ queryKey: ['sales-forecast-horizon'] });
      await qc.invalidateQueries({ queryKey: ['sales-forecast-version', versionId] });
      await qc.invalidateQueries({ queryKey: ['sales-forecast-sku-detail'] });
      await qc.invalidateQueries({ queryKey: ['sales-forecast-horizon-row'] });
    },
  });

  const lastInput = (): { csv?: string; file?: File } => {
    const file = fileRef.current?.files?.[0];
    if (file) return { file };
    return { csv };
  };

  return (
    <dialog
      ref={dialogRef}
      className="m-auto w-full max-w-xl rounded-lg border border-border bg-card p-0 shadow-card backdrop:bg-black/30"
      onClose={onClose}
    >
      <div className="flex flex-col gap-4 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-text-main">导入校准</h2>
            <p className="mt-1 text-sm text-text-sub">
              支持「分平台」导出的<strong>校准表/宽表</strong>（各月生效日均）或<strong>明细</strong>。宽表：与<strong>系统预测</strong>相同的单元格会跳过，有异议的改数后写入校准值并备注「导入」；空单元格跳过。
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={onClose}>
            关闭
          </Button>
        </div>

        {showChannelHint && <CalibrationImportByChannelHint variant="compact" />}

        <div className="space-y-2">
          <label className="text-sm font-medium text-text-main">上传 CSV</label>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="block w-full text-sm"
            onChange={() => {
              setPreview(null);
              previewMutation.reset();
              commitMutation.reset();
            }}
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-text-main">或粘贴 CSV 文本</label>
          <textarea
            className="min-h-[120px] w-full rounded-md border border-border bg-background p-2 text-sm"
            value={csv}
            placeholder="时段,SKU,平台,绝对月,...,校准值,调整原因"
            onChange={(e) => {
              setCsv(e.target.value);
              setPreview(null);
              previewMutation.reset();
              commitMutation.reset();
            }}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={previewMutation.isPending}
            onClick={() => {
              const input = lastInput();
              if (!input.file && !input.csv?.trim()) {
                window.alert('请先上传 CSV 或粘贴内容');
                return;
              }
              setClearPreview(null);
              previewMutation.mutate(input);
            }}
          >
            {previewMutation.isPending ? '校验中…' : '预览并校验'}
          </Button>
          <Button
            size="sm"
            disabled={
              commitMutation.isPending ||
              !preview ||
              preview.hasBlockingIssues ||
              preview.updated === 0
            }
            onClick={() => commitMutation.mutate(lastInput())}
          >
            {commitMutation.isPending ? '导入中…' : '确认导入'}
          </Button>
          <span className="hidden sm:inline text-border">|</span>
          <Button
            variant="outline"
            size="sm"
            className="text-destructive hover:text-destructive"
            disabled={clearCommitMutation.isPending || previewMutation.isPending}
            onClick={async () => {
              try {
                const stat = await api.previewForecastCalibrationClear(versionId);
                setClearPreview(stat);
                setPreview(null);
                previewMutation.reset();
                commitMutation.reset();
                if (stat.rowsWithManual === 0) {
                  window.alert('当前草稿没有已写入的分平台校准，无需撤销。');
                  return;
                }
                const ok = window.confirm(
                  `将清空本草稿内 ${stat.rowsWithManual} 条分平台校准（manual_daily_avg 与备注），生效恢复为系统预测。\n\n此操作不可从本弹窗自动恢复，请确认。`,
                );
                if (!ok) return;
                clearCommitMutation.mutate();
              } catch (err) {
                window.alert(err instanceof Error ? err.message : '统计失败');
              }
            }}
          >
            {clearCommitMutation.isPending ? '撤销中…' : '撤销全部校准'}
          </Button>
        </div>

        {preview && (
          <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
            <p className="font-medium text-text-main">{formatPreview(preview)}</p>
            {preview.hasBlockingIssues && preview.samples.errors.length > 0 && (
              <ul className="mt-2 list-disc pl-5 text-destructive">
                {preview.samples.errors.map((e) => (
                  <li key={`${e.row}-${e.message}`}>
                    第 {e.row} 行：{e.message}
                  </li>
                ))}
              </ul>
            )}
            {!preview.hasBlockingIssues && preview.samples.updated.length > 0 && (
              <p className="mt-2 text-text-sub">
                示例更新：{' '}
                {preview.samples.updated
                  .slice(0, 3)
                  .map((s) => `${s.sku}/${s.platform}/${s.month}→${s.to}`)
                  .join('；')}
              </p>
            )}
          </div>
        )}

        {(previewMutation.isError || commitMutation.isError) && (
          <p className="text-sm text-destructive">
            {previewMutation.error instanceof Error
              ? previewMutation.error.message
              : commitMutation.error instanceof Error
                ? commitMutation.error.message
                : '操作失败'}
          </p>
        )}

        {commitMutation.isSuccess && commitMutation.data?.applied != null && (
          <p className="text-sm text-primary">已写入 {commitMutation.data.applied} 条校准。</p>
        )}

        {clearPreview && clearPreview.rowsWithManual > 0 && !clearCommitMutation.isSuccess && (
          <p className="text-sm text-text-sub">
            当前草稿共有 {clearPreview.rowsWithManual} 条分平台校准可撤销（不含全平台行）。
          </p>
        )}

        {clearCommitMutation.isSuccess && clearCommitMutation.data?.cleared != null && (
          <p className="text-sm text-primary">
            已撤销 {clearCommitMutation.data.cleared} 条校准，生效已恢复为系统预测。
          </p>
        )}

        {clearCommitMutation.isError && (
          <p className="text-sm text-destructive">
            {clearCommitMutation.error instanceof Error
              ? clearCommitMutation.error.message
              : '撤销失败'}
          </p>
        )}
      </div>
    </dialog>
  );
}
