### Task 4: 离线 7 月复盘 + 收尾

**Files:**
- Modify (可选): `apps/web/scripts/validate-july-t4b-relax.ts` — 在标题打印当前 `V41_T4B_*` / `T99_SYSTEM_FLOOR_DISCOUNT`
- Modify: `docs/superpowers/specs/2026-08-12-t4b-t99-optimistic-relax-design.md` — 状态改为「已实现」

**Interfaces:**
- 脚本仍不写库；T99 行若 `old_system_d>0` 可走 `computeAllCatV41BoundedDaily`；脚本现有 `tier === 'T99' return 0` 需改为调用真实 T99 分支（否则复盘看不到折扣抬升）

- [ ] **Step 1: 修脚本 T99 重算**

将 `recompute` 中：

```ts
if (tier === 'T99') return 0;
```

改为照常调用 `computeAllCatV41BoundedDaily`（与其它层相同），让 T99 走系统保底。

文件头注释改为说明「T4B+T99 方案 A 常量复盘」。

在 `main` 开头 `console.log` 打印：

```ts
import {
  V41_T4B_CONSERVATIVE_FACTOR,
  V41_T4B_NEAR_CONSERVATIVE_FACTOR,
  V41_T4B_RECENT30_CAP,
  V41_T4B_RECENT90_CAP,
} from '../server/lib/forecast-allcat-v41.js';
import { T99_SYSTEM_FLOOR_DISCOUNT } from '../server/lib/forecast-demand.js';

console.log('constants', {
  T4B_near: V41_T4B_NEAR_CONSERVATIVE_FACTOR,
  T4B_far: V41_T4B_CONSERVATIVE_FACTOR,
  T4B_r30_cap: V41_T4B_RECENT30_CAP,
  T4B_r90_cap: V41_T4B_RECENT90_CAP,
  T99_discount: T99_SYSTEM_FLOOR_DISCOUNT,
});
```

- [ ] **Step 2: 跑离线复盘（环境允许时）**

Run: `pnpm --filter @scm/web exec tsx scripts/validate-july-t4b-relax.ts`

Expected: 输出含 T4B / T99 行；相对「旧系统」偏差应向 0 靠拢（不要求一次达标 0）。若本机无 Docker/DB，记录跳过原因，不阻塞合并；单测已覆盖常量。

- [ ] **Step 3: 标记 spec 已实现**

将设计文档头部改为：

```markdown
> **状态**：已实现  
```

- [ ] **Step 4: Commit**

Also add the plan file if still untracked:
`docs/superpowers/plans/2026-08-12-t4b-t99-optimistic-relax.md`

```bash
git add apps/web/scripts/validate-july-t4b-relax.ts docs/superpowers/specs/2026-08-12-t4b-t99-optimistic-relax-design.md docs/superpowers/plans/2026-08-12-t4b-t99-optimistic-relax.md
git commit -m "chore(forecast): validate July T4B/T99 plan-A relax offline"
```
