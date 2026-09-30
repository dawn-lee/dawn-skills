# changelog 写入策略（football-betting）

- 结构校验：在 skill 目录下运行 `node scripts/check-changelog.mjs`。

## 一句话规则

**本目录只写“规则级结论”，不写“每场投注结果/盈亏明细”。**

## 投注结果默认写到哪里

- 方案、逐腿 EV、串关结构、CLV 表：追加到 `FDP_ROOT/memory/analysis-{比赛日}{-槽位}.md`。
- 价值筛选与原始数据：`FDP_ROOT/data/analysis-{比赛日}{-槽位}/`。
- `MEMORY.md` 加指针。
- 具体命名与校验见 `football-analysis/reference/data-persistence.md`。

## 什么才允许写进本目录

1. 复盘后提炼出的规则级变化：
   - 新 active 规则（如逐腿 EV 筛选）
   - observation（n<30）
   - superseded（旧口径退役）
2. 写入条目至少包含：日期、结论、证据强度、状态。

## 什么不允许写进本目录

- 单场投注方案、命中/未命中记录
- 投注盈亏流水
- CLV 表或赔率快照
- 用户个人数据

## 迁移与保留

- `superseded.md` 永久保留。
- 月度 changelog 建议保留最近 60 天；更早归档到 `FDP_ROOT/docs/postmortem/` 或 git history。
- 发布/迁移 skill 时可只带当前月 changelog，`superseded.md` 不能删。
