import { useSearchParams } from 'react-router-dom';

export type ProductScope = 'goods' | 'accessory';

export function parseProductScope(value: string | null | undefined): ProductScope {
  return value === 'accessory' ? 'accessory' : 'goods';
}

export function useProductScope() {
  const [searchParams, setSearchParams] = useSearchParams();
  const productScope = parseProductScope(searchParams.get('productScope'));
  const setProductScope = (next: ProductScope) => {
    const params = new URLSearchParams(searchParams);
    if (next === 'goods') params.delete('productScope');
    else params.set('productScope', 'accessory');
    setSearchParams(params);
  };
  return { productScope, setProductScope };
}

export function appendProductScopeQuery(qs: URLSearchParams, productScope?: ProductScope) {
  if (productScope === 'accessory') qs.set('productScope', 'accessory');
}
