import type { ReactNode } from 'react';
import { SegmentedControl } from '@/components/SegmentedControl';
import { PRODUCT_SCOPE_HINT } from '@/lib/product-scope-copy';
import { type ProductScope, useProductScope } from '@/lib/product-scope';

const SCOPE_OPTIONS = [
  { id: 'goods' as const, label: '不含配件' },
  { id: 'accessory' as const, label: '只看配件' },
];

type ProductScopeSwitchProps = {
  extra?: ReactNode;
  /** 受控模式：不传则使用 URL 中的 productScope */
  productScope?: ProductScope;
  onProductScopeChange?: (next: ProductScope) => void;
};

export function ProductScopeSwitch({
  extra,
  productScope: controlledScope,
  onProductScopeChange,
}: ProductScopeSwitchProps) {
  const urlScope = useProductScope();
  const productScope = controlledScope ?? urlScope.productScope;
  const setProductScope = onProductScopeChange ?? urlScope.setProductScope;
  const showExtra = productScope === 'goods' && extra;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <SegmentedControl
        label="商品范围"
        aria-label="商品范围"
        value={productScope}
        options={SCOPE_OPTIONS}
        onChange={setProductScope}
      />
      {showExtra ? (
        <span className="text-xs text-text-sub">{extra}</span>
      ) : (
        <p className="max-w-xl text-xs leading-5 text-text-hint">{PRODUCT_SCOPE_HINT}</p>
      )}
    </div>
  );
}
