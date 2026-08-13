import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { api, type CostingPriceBookItem } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

type DraftPrice = {
  category: string;
  materialName: string;
  spec: string;
  unit: string;
  unitPrice: string;
  notes: string;
};

const EMPTY_DRAFT: DraftPrice = {
  category: '',
  materialName: '',
  spec: '',
  unit: '',
  unitPrice: '',
  notes: '',
};

type PriceBookPanelProps = {
  projectId: string;
  readOnly: boolean;
};

export function PriceBookPanel({ projectId, readOnly }: PriceBookPanelProps) {
  const queryClient = useQueryClient();
  const importRef = useRef<HTMLInputElement>(null);
  const [collapsed, setCollapsed] = useState(true);
  const [showNewRow, setShowNewRow] = useState(false);
  const [draft, setDraft] = useState<DraftPrice>(EMPTY_DRAFT);
  const [message, setMessage] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['costing-price-book'],
    queryFn: () => api.listCostingPriceBook(),
  });
  const items = data?.items ?? [];

  const refresh = () => {
    const invalidations = [
      queryClient.invalidateQueries({ queryKey: ['costing-price-book'] }),
    ];
    if (projectId) {
      invalidations.push(
        queryClient.invalidateQueries({ queryKey: ['costing-project', projectId] }),
      );
    }
    return Promise.all(invalidations);
  };

  const createItem = useMutation({
    mutationFn: () =>
      api.createCostingPriceBookItem({
        category: draft.category,
        materialName: draft.materialName,
        spec: draft.spec,
        unit: draft.unit,
        unitPrice: Number(draft.unitPrice),
        notes: draft.notes,
      }),
    onSuccess: () => {
      setMessage('');
      setDraft(EMPTY_DRAFT);
      setShowNewRow(false);
      return refresh();
    },
    onError: (error: Error) => setMessage(error.message),
  });

  const updateItem = useMutation({
    mutationFn: ({
      id,
      patch,
    }: {
      id: string;
      patch: Parameters<typeof api.updateCostingPriceBookItem>[1];
    }) => api.updateCostingPriceBookItem(id, patch),
    onSuccess: () => {
      setMessage('');
      return refresh();
    },
    onError: (error: Error) => setMessage(error.message),
  });

  const disableItem = useMutation({
    mutationFn: api.disableCostingPriceBookItem,
    onSuccess: () => refresh(),
    onError: (error: Error) => setMessage(error.message),
  });

  const importItems = useMutation({
    mutationFn: api.importCostingPriceBook,
    onSuccess: (result) => {
      setMessage(`已导入 ${result.imported} 行${result.errors ? `，跳过 ${result.errors} 行` : ''}`);
      refresh();
    },
    onError: (error: Error) => setMessage(error.message),
  });

  const patchText = (
    item: CostingPriceBookItem,
    key: 'category' | 'materialName' | 'spec' | 'unit' | 'notes',
    value: string,
  ) => {
    const original = item[key] ?? '';
    if (value === original) return;
    updateItem.mutate({ id: item.id, patch: { [key]: value } });
  };

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <button
          type="button"
          className="flex items-center gap-2 text-left"
          onClick={() => setCollapsed((value) => !value)}
          aria-expanded={!collapsed}
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          <CardTitle>原材料价目</CardTitle>
          <span className="text-sm font-normal text-text-hint">{items.length} 项</span>
        </button>
        {!readOnly && (
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setCollapsed(false);
                setShowNewRow(true);
              }}
            >
              新增
            </Button>
            <Button variant="outline" onClick={() => importRef.current?.click()}>
              导入
            </Button>
            <input
              ref={importRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) importItems.mutate(file);
                event.target.value = '';
              }}
            />
          </div>
        )}
      </CardHeader>
      {!collapsed && (
        <CardContent>
          {message && (
            <p className="mb-3 text-sm text-text-sub" role="status">
              {message}
            </p>
          )}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-text-sub">
                  {['大类', '名称', '规格', '单位', '单价', '备注', '停用'].map((label) => (
                    <th key={label} className="p-2 font-normal">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {showNewRow && !readOnly && (
                  <tr className="border-b border-border/60 bg-muted/30">
                    {(['category', 'materialName', 'spec', 'unit'] as const).map((key) => (
                      <td key={key} className="p-1">
                        <Input
                          className="h-8"
                          value={draft[key]}
                          onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}
                        />
                      </td>
                    ))}
                    <td className="p-1">
                      <Input
                        className="h-8 font-mono"
                        type="number"
                        min="0"
                        step="0.0001"
                        value={draft.unitPrice}
                        onChange={(event) => setDraft({ ...draft, unitPrice: event.target.value })}
                      />
                    </td>
                    <td className="p-1">
                      <Input
                        className="h-8"
                        value={draft.notes}
                        onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
                      />
                    </td>
                    <td className="p-1">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={
                          !draft.category.trim() ||
                          !draft.materialName.trim() ||
                          !draft.unit.trim() ||
                          draft.unitPrice === '' ||
                          Number(draft.unitPrice) < 0 ||
                          createItem.isPending
                        }
                        onClick={() => createItem.mutate()}
                      >
                        保存
                      </Button>
                    </td>
                  </tr>
                )}
                {items.map((item) => (
                  <tr
                    key={item.id}
                    className={`border-b border-border/60 ${item.isActive ? '' : 'text-text-hint'}`}
                  >
                    {(['category', 'materialName', 'spec', 'unit'] as const).map((key) => (
                      <td key={key} className="p-1">
                        <Input
                          key={`${item.id}-${key}-${item[key]}`}
                          className="h-8 border-transparent bg-transparent px-2 focus-visible:border-input"
                          defaultValue={item[key]}
                          disabled={readOnly || !item.isActive}
                          onBlur={(event) => patchText(item, key, event.target.value)}
                        />
                      </td>
                    ))}
                    <td className="p-1">
                      <Input
                        key={`${item.id}-unitPrice-${item.unitPrice}`}
                        className="h-8 border-transparent bg-transparent px-2 font-mono focus-visible:border-input"
                        type="number"
                        min="0"
                        step="0.0001"
                        defaultValue={item.unitPrice}
                        disabled={readOnly || !item.isActive}
                        onBlur={(event) => {
                          const value = Number(event.target.value);
                          if (event.target.value !== '' && value !== Number(item.unitPrice)) {
                            updateItem.mutate({ id: item.id, patch: { unitPrice: value } });
                          }
                        }}
                      />
                    </td>
                    <td className="p-1">
                      <Input
                        key={`${item.id}-notes-${item.notes ?? ''}`}
                        className="h-8 border-transparent bg-transparent px-2 focus-visible:border-input"
                        defaultValue={item.notes ?? ''}
                        disabled={readOnly || !item.isActive}
                        onBlur={(event) => patchText(item, 'notes', event.target.value)}
                      />
                    </td>
                    <td className="p-1">
                      {item.isActive && !readOnly ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={disableItem.isPending}
                          onClick={() => disableItem.mutate(item.id)}
                        >
                          停用
                        </Button>
                      ) : item.isActive ? (
                        '已启用'
                      ) : (
                        '已停用'
                      )}
                    </td>
                  </tr>
                ))}
                {(!showNewRow || readOnly) && !items.length && !isLoading && (
                  <tr>
                    <td colSpan={7} className="p-6 text-center text-text-hint">
                      暂无价目，可新增或导入 xlsx
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
