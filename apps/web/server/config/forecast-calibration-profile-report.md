# 分层标定报告

- CSV: `docs/samples/forecast-backtest/walkforward-2026-01-01-6m-v6.csv`
- asOf: 2026-01-01
- 行数: 17598
- v6 persisted A:core precision WMAPE: 46.8%
- 推荐 A:core precision WMAPE: 46.1%
- A:core SKU 数: 174
- 微销量误分类占比: 26.7%

## Top 10

- #1 · A:core WMAPE=46.1% · SKU=174 · micro=26.7% · cvMaxA=1 · coreCont=0.8 · coreR90=7
- #2 · A:core WMAPE=46.1% · SKU=174 · micro=26.7% · cvMaxA=1 · coreCont=0.8 · coreR90=7
- #3 · A:core WMAPE=46.2% · SKU=170 · micro=27.4% · cvMaxA=0.9 · coreCont=0.8 · coreR90=7
- #4 · A:core WMAPE=46.2% · SKU=170 · micro=27.4% · cvMaxA=0.9 · coreCont=0.8 · coreR90=7
- #5 · A:core WMAPE=46.4% · SKU=175 · micro=27.1% · cvMaxA=1.1 · coreCont=0.8 · coreR90=7
- #6 · A:core WMAPE=46.4% · SKU=175 · micro=27.1% · cvMaxA=1.1 · coreCont=0.8 · coreR90=7
- #7 · A:core WMAPE=46.7% · SKU=287 · micro=29.7% · cvMaxA=1 · coreCont=0.8 · coreR90=5
- #8 · A:core WMAPE=46.7% · SKU=287 · micro=29.7% · cvMaxA=1 · coreCont=0.8 · coreR90=5
- #9 · A:core WMAPE=46.9% · SKU=282 · micro=30.3% · cvMaxA=0.9 · coreCont=0.8 · coreR90=5
- #10 · A:core WMAPE=46.9% · SKU=282 · micro=30.3% · cvMaxA=0.9 · coreCont=0.8 · coreR90=5

## 推荐 profile JSON

```json
{
  "continuityMinA": 0.75,
  "cvMaxA": 1,
  "continuityMinB": 0.75,
  "cvMaxC": 1.5,
  "coreRecent90Min": 7,
  "coreContinuityMin": 0.8,
  "declineRecent30Ratio": 0.85
}
```
