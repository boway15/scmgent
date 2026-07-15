# A:core 算法标定报告

- CSV: `docs/samples/forecast-backtest/walkforward-2026-01-01-6m-v6.csv`
- asOf: 2026-01-01
- v6 默认 precision WMAPE: 52.0%
- 推荐 precision WMAPE: 51.0%
- 回归集 precision WMAPE: 65.0%

## Top 10

- #1 · precision=51.0% · regression=65.0% · k0=0.75 · k1=0.5 · head0=1.04 · decline=0.8
- #2 · precision=51.0% · regression=65.0% · k0=0.75 · k1=0.5 · head0=1.04 · decline=0.85
- #3 · precision=51.0% · regression=65.0% · k0=0.75 · k1=0.5 · head0=1.04 · decline=0.9
- #4 · precision=51.0% · regression=65.0% · k0=0.7 · k1=0.5 · head0=1.04 · decline=0.8
- #5 · precision=51.0% · regression=65.0% · k0=0.7 · k1=0.5 · head0=1.04 · decline=0.85
- #6 · precision=51.0% · regression=65.0% · k0=0.7 · k1=0.5 · head0=1.04 · decline=0.9
- #7 · precision=51.0% · regression=65.0% · k0=0.65 · k1=0.5 · head0=1.04 · decline=0.8
- #8 · precision=51.0% · regression=65.0% · k0=0.65 · k1=0.5 · head0=1.04 · decline=0.85
- #9 · precision=51.0% · regression=65.0% · k0=0.65 · k1=0.5 · head0=1.04 · decline=0.9
- #10 · precision=51.0% · regression=65.2% · k0=0.75 · k1=0.55 · head0=1.04 · decline=0.8

## DJ502530_2 明细

- 2026-01: actual=75.00 forecast=129.18 F/A=1.72
- 2026-02: actual=81.71 forecast=130.72 F/A=1.60
- 2026-03: actual=77.23 forecast=129.42 F/A=1.68
- 2026-04: actual=61.87 forecast=124.21 F/A=2.01
- 2026-05: actual=64.90 forecast=124.21 F/A=1.91
- 2026-06: actual=47.73 forecast=124.21 F/A=2.60

## 推荐 aCore JSON

```json
{
  "k0Recent30Weight": 0.75,
  "k1Recent30Weight": 0.5,
  "upperHeadroom": [
    1.04,
    1.06,
    1.08,
    1.1,
    1.13,
    1.16
  ],
  "declineRecent30Ratio": 0.8
}
```
