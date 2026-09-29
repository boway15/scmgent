import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { PRODUCT_SCOPE_HINT } from '@/lib/product-scope-copy';
import { type ProductScope, useProductScope } from '@/lib/product-scope';

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

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-text-sub">商品范围</span>
        <Button
          type="button"
          size="sm"
          variant={productScope === 'goods' ? 'default' : 'outline'}
          onClick={() => setProductScope('goods')}
        >
          不含配件
        </Button>
        <Button
          type="button"
          size="sm"
          variant={productScope === 'accessory' ? 'default' : 'outline'}
          onClick={() => setProductScope('accessory')}
        >
          只看配件
        </Button>
        {productScope === 'goods' && extra ? (
          <span className="text-xs text-text-sub">{extra}</span>
        ) : null}
      </div>
      <p className="text-xs text-text-sub">{PRODUCT_SCOPE_HINT}</p>
    </div>
  );
}
