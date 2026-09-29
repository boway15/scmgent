import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useEffect, useState } from 'react';

import { Link } from 'react-router-dom';

import { PageHeader } from '@/components/PageHeader';

import { ListPagination } from '@/components/ListPagination';

import { ListSearchBar } from '@/components/ListSearchBar';

import { Button } from '@/components/ui/button';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

import { api, type InventoryDataIssueRow } from '@/lib/api';

import { ProductScopeSwitch } from '@/components/ProductScopeSwitch';

import { useProductScope } from '@/lib/product-scope';



const TYPE_LABEL: Record<InventoryDataIssueRow['issueType'], string> = {

  missing_available_at: '可用时间缺失',

  unallocated_warehouse: '未分仓',

  share_sum_mismatch: '占比偏离',

  unmapped_warehouse: '新仓库未映射',

  position_source_mismatch: '查询/全链数量不一致',

  position_share_gap: '影子在库 vs 占比拟物',

};



const IMPACT_LABEL: Record<string, string> = {

  timeline: '库存时间轴',

  horizon: '7/15/30 预警',

  planning: '分仓规划',

};



const STATUS_LABEL: Record<InventoryDataIssueRow['status'], string> = {

  open: '待跟进',

  in_progress: '处理中',

  resolved: '已自动结案',

  dismissed: '已知悉',

};



export function InventoryDataIssuesPage() {

  const { productScope } = useProductScope();

  const qc = useQueryClient();

  const [status, setStatus] = useState('open');

  const [issueType, setIssueType] = useState('all');

  const [page, setPage] = useState(1);

  const [pageSize] = useState(20);

  const [keyword, setKeyword] = useState('');

  const [appliedKeyword, setAppliedKeyword] = useState('');



  useEffect(() => {

    setPage(1);

  }, [status, issueType, appliedKeyword, productScope]);



  const listParams = {

    status: status === 'open' ? undefined : status,

    type: issueType === 'all' ? undefined : issueType,

    page,

    pageSize,

    q: appliedKeyword || undefined,

    productScope,

  };



  const list = useQuery({

    queryKey: ['inventory-data-issues', status, issueType, page, pageSize, appliedKeyword, productScope],

    queryFn: () => api.getInventoryDataIssues(listParams),

  });

  const accessoryOpenCount = list.data?.accessoryOpenCount ?? 0;

  const total = list.data?.total ?? list.data?.count ?? 0;



  const scan = useMutation({

    mutationFn: api.scanInventoryDataIssues,

    onSuccess: () => qc.invalidateQueries({ queryKey: ['inventory-data-issues'] }),

  });



  const exportCsv = useMutation({

    mutationFn: () =>

      api.exportInventoryDataIssues({

        status: listParams.status,

        type: listParams.type,

        q: listParams.q,

        productScope: listParams.productScope,

      }),

  });



  const dismiss = useMutation({

    mutationFn: (id: string) => api.updateInventoryDataIssue(id, { status: 'dismissed' }),

    onSuccess: () => qc.invalidateQueries({ queryKey: ['inventory-data-issues'] }),

  });



  const openByType = list.data?.openByType ?? {

    missing_available_at: 0,

    unallocated_warehouse: 0,

    share_sum_mismatch: 0,

    unmapped_warehouse: 0,

    position_source_mismatch: 0,

    position_share_gap: 0,

  };

  const openTotal = (Object.keys(TYPE_LABEL) as Array<InventoryDataIssueRow['issueType']>).reduce(
    (sum, type) => sum + Number(openByType[type] ?? 0),
    0,
  );



  return (

    <div className="space-y-6">

      <PageHeader title="数据问题">

        <div className="flex flex-wrap gap-2">

          <Button

            variant="outline"

            onClick={() => exportCsv.mutate()}

            disabled={exportCsv.isPending}

          >

            {exportCsv.isPending ? '导出中...' : '导出 CSV'}

          </Button>

          <Button onClick={() => scan.mutate()} disabled={scan.isPending}>

            {scan.isPending ? '扫描中...' : '立即扫描'}

          </Button>

        </div>

      </PageHeader>



      <p className="text-sm text-text-sub">

        上架时间、销售占比、目的仓等源数据经迅捷→飞书同步。本页只提醒与导出，请在迅捷修正；同步后每日扫描会自动结案。标记「已知悉」仅用于降噪，不代表源数据已正确。

      </p>



      <ProductScopeSwitch

        extra={

          accessoryOpenCount > 0

            ? `另有 ${accessoryOpenCount} 条配件 SKU 相关问题（切换到「只看配件」查看）`

            : undefined

        }

      />



      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">

        <Card className="shadow-card">

          <CardContent className="pt-6">

            <p className="text-sm text-text-sub">待跟进合计</p>

            <p className="mt-2 font-mono text-2xl font-semibold text-text-main">{openTotal}</p>

          </CardContent>

        </Card>

        {(Object.keys(TYPE_LABEL) as Array<InventoryDataIssueRow['issueType']>).map((type) => (

          <Card key={type} className="shadow-card">

            <CardContent className="pt-6">

              <p className="text-sm text-text-sub">{TYPE_LABEL[type]}</p>

              <p className="mt-2 font-mono text-2xl font-semibold text-text-main">

                {Number(openByType[type] ?? 0)}

              </p>

            </CardContent>

          </Card>

        ))}

      </div>



      {scan.isSuccess && scan.data && (

        <p className="text-sm text-text-sub">

          本轮检出 {scan.data.detected} 条，新增 {scan.data.inserted}，刷新 {scan.data.refreshed}，自动结案{' '}

          {scan.data.autoResolved}。

        </p>

      )}



      {exportCsv.isError && (

        <p className="text-sm text-destructive">

          {exportCsv.error instanceof Error ? exportCsv.error.message : '导出失败'}

        </p>

      )}



      <div className="flex flex-wrap gap-2">

        <select

          className="h-9 rounded-md border border-border bg-white px-2 text-sm"

          value={status}

          onChange={(e) => setStatus(e.target.value)}

        >

          <option value="open">待跟进</option>

          <option value="in_progress">处理中（历史）</option>

          <option value="resolved">已自动结案</option>

          <option value="dismissed">已知悉</option>

        </select>

        <select

          className="h-9 rounded-md border border-border bg-white px-2 text-sm"

          value={issueType}

          onChange={(e) => setIssueType(e.target.value)}

        >

          <option value="all">全部类型</option>

          {(Object.keys(TYPE_LABEL) as Array<InventoryDataIssueRow['issueType']>).map((type) => (

            <option key={type} value={type}>

              {TYPE_LABEL[type]}

            </option>

          ))}

        </select>

      </div>



      <Card className="shadow-card">

        <CardHeader>

          <CardTitle>问题清单（{total}）</CardTitle>

        </CardHeader>

        <CardContent className="overflow-x-auto">

          <ListSearchBar

            keyword={keyword}

            onKeywordChange={setKeyword}

            onSearch={() => {

              setAppliedKeyword(keyword.trim());

              setPage(1);

            }}

            placeholder="SKU / 仓库 / 示例说明"

          />

          {list.isLoading ? (

            <p className="text-text-sub">加载中...</p>

          ) : (

            <table className="w-full text-sm">

              <thead>

                <tr className="border-b text-left text-text-sub">

                  <th className="py-2 pr-3">问题</th>

                  <th className="py-2 pr-3">SKU</th>

                  <th className="py-2 pr-3">仓库</th>

                  <th className="py-2 pr-3">数量</th>

                  <th className="py-2 pr-3">影响模块</th>

                  <th className="py-2 pr-3">示例</th>

                  <th className="py-2 pr-3">状态</th>

                  <th className="py-2 pr-3">操作</th>

                </tr>

              </thead>

              <tbody>

                {(list.data?.items ?? []).map((row) => (

                  <tr key={row.id} className="border-b last:border-0">

                    <td className="py-2 pr-3">{TYPE_LABEL[row.issueType]}</td>

                    <td className="py-2 pr-3">

                      <Link

                        className="text-primary hover:underline"

                        to={`/inventory/planning/${row.skuId}?warehouse=${encodeURIComponent(row.warehouseCode)}`}

                      >

                        {row.skuCode}

                      </Link>

                      {row.issueType === 'unallocated_warehouse' ? (

                        <div className="mt-1">

                          <Link

                            className="text-xs text-primary hover:underline"

                            to={`/inventory/unallocated?skuId=${encodeURIComponent(row.skuId)}`}

                          >

                            查看待分配

                          </Link>

                        </div>

                      ) : null}

                    </td>

                    <td className="py-2 pr-3 font-mono">{row.warehouseCode}</td>

                    <td className="py-2 pr-3 font-mono">{row.qty}</td>

                    <td className="py-2 pr-3">{IMPACT_LABEL[row.impactModule] ?? row.impactModule}</td>

                    <td className="py-2 pr-3 text-text-sub">{row.example}</td>

                    <td className="py-2 pr-3">{STATUS_LABEL[row.status]}</td>

                    <td className="py-2 pr-3">

                      {row.status === 'open' || row.status === 'in_progress' ? (

                        <Button

                          variant="ghost"

                          size="sm"

                          disabled={dismiss.isPending}

                          onClick={() => dismiss.mutate(row.id)}

                        >

                          已知悉

                        </Button>

                      ) : null}

                    </td>

                  </tr>

                ))}

                {!list.data?.items.length && (

                  <tr>

                    <td colSpan={8} className="py-6 text-text-sub">

                      当前筛选下没有数据问题。可点「立即扫描」从三池与占比生成队列。

                    </td>

                  </tr>

                )}

              </tbody>

            </table>

          )}

          {!list.isLoading && total > 0 ? (

            <ListPagination

              page={page}

              pageSize={pageSize}

              total={total}

              onPageChange={setPage}

            />

          ) : null}

        </CardContent>

      </Card>

    </div>

  );

}


