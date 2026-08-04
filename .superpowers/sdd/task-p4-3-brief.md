### Task 3: Transport + mapping 纯函�?
**Files:**
- `apps/web/server/lib/sap-mirror/types.ts`
- `apps/web/server/lib/sap-mirror/map-merchant.ts` + test
- `apps/web/server/lib/sap-mirror/map-sku.ts` + test
- `apps/web/server/lib/sap-mirror/map-po.ts` + test
- `apps/web/server/lib/sap-mirror/fixture-transport.ts`

```ts
export function mapSapVendorToMerchant(item: {
  vendorId: string;
  name: string;
  code?: string;
}): { sourceSystem: 'sap'; externalId: string; code: string; name: string };

export function mapSapMaterialToSku(item: {
  materialId: string;
  name: string;
  unit?: string;
}): { sourceSystem: 'sap'; externalId: string; code: string; name: string; unit: string };
```

- [ ] TDD maps  
- [ ] Commit: `feat: add SAP mirror mapping helpers and fixture transport`

---
