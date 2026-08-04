### Task 6: 璺熷崟 API 鈥?璇诲啓 `etaAvailable`

**Files:**
- Modify: `apps/web/server/routes/procurement.ts`
- Modify: `apps/web/src/lib/api.ts`
- Create or modify: `apps/web/server/lib/purchase-draft-eta.ts`锛堝彲閫夊皬鍑芥暟锛屼究浜庢祴锛?
**Interfaces:**
- Produces: GET 鍒楄〃鍚?`etaAvailable`锛汸ATCH 鎺ュ彈 `etaAvailable`锛屽啓鍏ユ椂鍚屾 `confirmedDeliveryDate`

- [ ] **Step 1: Failing unit test for sync helper**

```ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildEtaPatch } from './purchase-draft-eta.js';

describe('buildEtaPatch', () => {
  it('sets both etaAvailable and confirmedDeliveryDate', () => {
    assert.deepEqual(buildEtaPatch('2026-08-15'), {
      etaAvailable: '2026-08-15',
      confirmedDeliveryDate: '2026-08-15',
    });
  });
});
```

- [ ] **Step 2: Run 鈥?RED**

- [ ] **Step 3: Implement helper + route**

```ts
export function buildEtaPatch(etaAvailable: string) {
  return {
    etaAvailable,
    confirmedDeliveryDate: etaAvailable,
  };
}
```

鍦?`PATCH /purchase-drafts/:id`锛?
- body 澧炲姞 `etaAvailable?: string`
- 鑻?`body.etaAvailable` 鏈夊€?鈫?`Object.assign(patch, buildEtaPatch(body.etaAvailable))`
- 鑻ヤ粎鏈?`confirmedDeliveryDate`锛堝吋瀹规棫瀹㈡埛绔級鈫?鍚屾椂鍐欏叆 `etaAvailable`
- 纭浜ゆ湡娴佽浆锛坄confirmed`锛夋椂锛氳嫢鏃?body 鏃ユ湡涓斿瓨鍦?`expectedDate`锛屽啓鍏ヤ袱鑰?
GET 鍒楄〃 select 澧炲姞 `etaAvailable: purchaseDrafts.etaAvailable`锛屽搷搴斿瓧娈?`etaAvailable`銆?
`api.ts`锛歚getPurchaseTracking` 涓?`updatePurchaseTracking` 澧炲姞 `etaAvailable`銆?
- [ ] **Step 4: Run tests 鈥?GREEN**

```bash
pnpm --filter @scm/web exec tsx --test server/lib/purchase-draft-eta.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/server/lib/purchase-draft-eta.ts apps/web/server/lib/purchase-draft-eta.test.ts apps/web/server/routes/procurement.ts apps/web/src/lib/api.ts
git commit -m "$(cat <<'EOF'
feat: expose eta_available on purchase draft API

EOF
)"
```

---
