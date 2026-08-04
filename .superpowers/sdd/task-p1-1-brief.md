### Task 1: 鎵╁睍 `LeadTimeBreakdown`锛堢函鍑芥暟锛屽吋瀹规棫瀛楁锛?
**Files:**
- Modify: `apps/web/server/lib/replenishment-coverage.ts`
- Modify: `apps/web/server/lib/replenishment-coverage.test.ts`

**Interfaces:**
- Produces:

```ts
export type LeadTimeBreakdown = {
  productionDays: number;
  domesticDays: number;
  bookingDays: number;
  transitDays: number;
  customsDays: number;
  inboundDays: number;
  /** compat = booking + transit + customs */
  shippingDays: number;
  /** compat = inboundDays */
  inboundBufferDays: number;
  totalLeadDays: number;
  profileId?: string | null;
};

export function calcTotalLeadTime(params: {
  productionDays: number;
  domesticDays?: number;
  bookingDays?: number;
  transitDays?: number;
  customsDays?: number;
  inboundDays?: number;
  /** legacy: if provided without booking/transit/customs, treat as transitDays */
  shippingDays?: number;
  inboundBufferDays?: number;
}): LeadTimeBreakdown;
```

- [ ] **Step 1: Write failing tests**

```ts
it('sums six segments and sets compat aliases', () => {
  const lt = calcTotalLeadTime({
    productionDays: 25,
    domesticDays: 3,
    bookingDays: 7,
    transitDays: 35,
    customsDays: 5,
    inboundDays: 3,
  });
  assert.equal(lt.totalLeadDays, 78);
  assert.equal(lt.shippingDays, 47); // 7+35+5
  assert.equal(lt.inboundBufferDays, 3);
});

it('accepts legacy shippingDays + inboundBufferDays', () => {
  const lt = calcTotalLeadTime({
    productionDays: 50,
    shippingDays: 45,
    inboundBufferDays: 7,
  });
  assert.equal(lt.transitDays, 45);
  assert.equal(lt.bookingDays, 0);
  assert.equal(lt.customsDays, 0);
  assert.equal(lt.totalLeadDays, 102);
});
```

- [ ] **Step 2: Run RED**

`pnpm --filter @scm/web exec tsx --test server/lib/replenishment-coverage.test.ts`

- [ ] **Step 3: Implement `calcTotalLeadTime` 鎵╁睍**锛涙洿鏂扮幇鏈夋柇瑷€鑻ュ瓧娈靛舰鐘跺彉浜嗭紙淇濊瘉鏃ф祴璇曚粛缁匡級銆?
- [ ] **Step 4: Run GREEN + Commit**

```bash
git add apps/web/server/lib/replenishment-coverage.ts apps/web/server/lib/replenishment-coverage.test.ts
git commit -m "$(cat <<'EOF'
feat: extend lead time breakdown to six segments with compat aliases

EOF
)"
```

---
