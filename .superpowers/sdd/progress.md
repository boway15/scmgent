# SDD Progress - rule-modules-p0
Branch: feat/rule-modules-p0
Plan: docs/superpowers/plans/2026-10-26-rule-modules-phase0.md
Spec: docs/superpowers/specs/2026-10-26-rule-modules-design.md
Started: 2026-10-26
Base: b2c3edbf0282f771395e04ca9fd10c8ce484e41e


Task 1: complete (commits 48e5d6d, review pending; baseline re-exported after rebase onto main 4199068; 500 SKUs / 284 suggestions / 4500 health rows)


Task 1: complete (commits 033b4ad..48e5d6d, review Approved). Minor: compare success text includes elapsed seconds; empty skuIds array would fall through to a full run.

Task 2: complete (commit c382478, review Approved). Encoding check: param.ts and define.ts Chinese is valid UTF-8; garbled diff was a review-package artifact. Minor: same-scope param sets use the first match; paramSetIds follow scope priority insertion order.

Task 3: complete (commit 6d07ad4, review Approved). Minor: MoqPriority exported but resolveMoqByPriority takes string; isUsDeferEnabled untested; callers must not apply MOQ twice when wiring qty + warehouse candidate.

Task 4: complete (commit 66b639a, review Approved). Baseline match 119s. Minor: ruleDefaults has no caller yet (Task 6); safety-stock-z re-exports DEFAULT_SAFETY_STOCK_DAYS redundantly.

Task 5: complete (commit c9d59a0). Migrate OK; indexes one_active / version / module_scope present. Review pending quick gate.

Task 5: complete (commit c9d59a0, review Approved). Minor: Drizzle schema does not declare the SQL unique indexes; rule_eval_runs has no lookup index.

Task 6: complete (commits c9d59a0..86d46cc, review Approved). ⚠️ roles deferred to Task 8; baseline match and singleCoverDays=60 smoke are in task-6-report (not re-run). Planning page is Task 7. Minors: resolver cache key uses `|`; active rows have no ORDER BY (same-scope first match); warehouse yellowLightLinkage id can appear in a run without changing the SKU-level filter; NETWORK cover/safety uses skuParams not warehouse params (per brief); startRuleRun is after compute; forecast wiring is not unit-tested.

Task 8: complete (commits 06a79da..d4b846c, review Approved after fix). Race fix d4b846c is on main and in the local Docker release. Minors: guard 401/403 is a bare Response; PATCH can clear note; reject reviewNote survives later submit/approve; concurrent version insert can 500; tests only cover overlay/diff; submit's zero-row message always says 请重新试算.

Task 9: complete (commits d4b846c..f67bb18, review Approved after stamp fix). Page c31ab38; simulate Date binding fixed in f67bb18 and probe-stamped under prepare:false. Commits are on main; the server image updates on the next pull. Minor, plan-mandated: menu sort_order 5 places the rule center before user admin. Module/list errors and the empty-set flash match the brief sample.

Task 7: complete (commits 86d46cc..06a79da, review Approved). ⚠️ Step 5 network suggested qty is timeline raw 0 while baseline NETWORK rows use networkQtyFallback; confirmed pre-existing, this diff did not change the assignment. Stockout date is not in the baseline. tsc still only TS6305/6306/6310 per report. Minors: warehouse-scoped moqPriority on the planning page can diverge from the job's project-group MOQ; no test hits the new ruleParams branch.
