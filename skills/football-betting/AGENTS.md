# AGENTS.md — football-betting

> 本文件随 skill 一起安装/迁移。任何 AI 工具使用本 skill 时必须遵守。

## 写入边界（强制）

1. 投注方案、逐腿 EV、盈亏、CLV 表只能写：
   - `FDP_ROOT/memory/analysis-{比赛日}.md`
   - `FDP_ROOT/data/analysis-{比赛日}/`
2. **禁止写入 `changelog/`**，除非是规则级结论（active / observation / superseded）。
3. `changelog/` 写入策略见 `changelog/README.md`。
4. 当前规则基线见本目录 `RULES_BASELINE.md`；分析模型口径以 `football-analysis` 为准。
5. 使用前运行：
   ```bash
   node scripts/preflight.mjs
   node scripts/check-changelog.mjs   # 仅在修改 changelog 后
   ```

## 路径

- `FDP_ROOT` 解析顺序：环境变量 `FDP_ROOT` → 用户会话指定 → 开发机默认 `<FDP_ROOT>`。
- 迁移机器无需改 SKILL；设置环境变量或使用前指定路径即可。
