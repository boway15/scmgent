### Task 1: 鏂揣淇绾嚱鏁?
**Files:**
- Create: `apps/web/server/lib/effective-daily-demand.ts`
- Create: `apps/web/server/lib/effective-daily-demand.test.ts`

**Interfaces:**

```ts
export type DailySale = { saleDate: string; qtySold: number };
export type DailyAvailability = { date: string; qtyAvailable: number };

export type EffectiveDailyDemandResult = {
  avgDaily: number;
  stockoutAdjusted: boolean;
  windowDays: number;
  inStockDays: number;
  soldOnInStockDays: number;
  calendarSold: number;
};

export function calcEffectiveDailyDemand(params: {
  sales: DailySale[];
  availability: DailyAvailability[]; // 鍙负绌?  windowDays?: number;
  asOf?: Date;
}): EffectiveDailyDemandResult;
```

瑙勫垯锛?
1. 鍙?`asOf` 寰€鍓?`windowDays`锛堥粯璁?90锛夋棩鍘嗘棩銆?2. 鑻?`availability` 瑕嗙洊璇ョ獥鍙ｏ紙鑷冲皯鏈?1 澶╄褰曪級锛? 
   - `inStockDays` = 绐楀彛鍐?`qtyAvailable > 0` 鐨勫ぉ鏁? 
   - `soldOnInStockDays` = 杩欎簺鏃ユ湡鐨勯攢閲忎箣鍜? 
   - `avgDaily = inStockDays > 0 ? soldOnInStockDays / inStockDays : 0`  
   - `stockoutAdjusted: true`
3. 鑻ユ棤鍙敤搴撳瓨鍘嗗彶锛歚avgDaily = calendarSold / windowDays`锛宍stockoutAdjusted: false`銆?
- [ ] **Step 1: 鍐欏け璐ユ祴璇?*锛?0 澶╃獥銆?0 澶╂柇璐с€侀攢閲?1000 鈫?鏈夋晥鏃ラ渶姹?50锛?
```ts
it('adjusts for stockout days', () => {
  const sales = /* 20 days 脳 50 */;
  const availability = /* 20 days >0, 10 days =0 */;
  const r = calcEffectiveDailyDemand({ sales, availability, windowDays: 30, asOf: new Date('2026-07-01') });
  assert.equal(r.stockoutAdjusted, true);
  assert.equal(r.inStockDays, 20);
  assert.equal(r.avgDaily, 50);
});

it('falls back to calendar average without availability', () => {
  const r = calcEffectiveDailyDemand({
    sales: [{ saleDate: '2026-06-01', qtySold: 90 }],
    availability: [],
    windowDays: 30,
    asOf: new Date('2026-07-01'),
  });
  assert.equal(r.stockoutAdjusted, false);
  assert.equal(r.avgDaily, 3); // 90/30
});
```

- [ ] **Step 2: RED 鈫?瀹炵幇 鈫?GREEN**

Run: `pnpm --filter @scm/web exec tsx --test server/lib/effective-daily-demand.test.ts`

- [ ] **Step 3: Commit**

```bash
git commit -m "feat: add stockout-adjusted effective daily demand helper"
```

---
