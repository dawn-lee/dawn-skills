# changelog 写入策略（football-analysis）

- 结构校验：在 skill 目录下运行 `node scripts/check-changelog.mjs`。

## 一句话规则

**本目录只写“规则级结论”，不写“每场预测结果”。**

## 复盘结果默认写到哪里

| 内容 | 落盘位置 |
|---|---|
| 每场预测记录、三层结论、星级、ERRATA | `FDP_ROOT/memory/analysis-{比赛日}{-槽位}.md` |
| 原始赔率/接口/计算输出归档 | `FDP_ROOT/data/analysis-{比赛日}{-槽位}/` |
| 批次索引 | `FDP_ROOT/memory/MEMORY.md` |
| 投注方案与 CLV 表 | 同上 memory 文件，由 football-betting 追加 |

复盘后由自动复盘流程把 `status: prediction` 翻为 `status: reviewed`，并回填命中与 CLV。

## 什么才允许写进本目录

只有复盘后提炼出的**规则级变化**：

1. `2026-08.md` 这类月度文件：新的 active 规则、n<30 observation、回测/案例证据。
2. `superseded.md`：被替代的旧口径，永久保留，防止旧规则复活。

写入条目至少包含：日期、结论、证据强度（大样本回测 / 小样本 n / 结构）、状态（active / observation / superseded）。

## 什么不允许写进本目录

- 单场预测或单场结果
- 投注盈亏明细（除非是规则证据中的一个数字）
- 用户个人数据
- 完整赔率快照或大段原始数据

## 迁移与保留

- `superseded.md` 永久保留。
- 月度 changelog 建议保留最近 60 天；更早内容归档到 `FDP_ROOT/docs/postmortem/` 或 git history。
- 发布/迁移 skill 时可只带当前月 changelog，`superseded.md` 不能删。
