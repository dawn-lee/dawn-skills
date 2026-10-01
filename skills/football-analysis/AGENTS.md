# AGENTS.md — football-analysis

> 本文件随 skill 一起安装/迁移。任何 AI 工具使用本 skill 时必须遵守。

## 写入边界（强制）

1. 每场预测、复盘结果、原始数据、赔率快照只能写：
   - `FDP_ROOT/memory/analysis-{比赛日}.md`
   - `FDP_ROOT/data/analysis-{比赛日}/`
   - `FDP_ROOT/memory/MEMORY.md`
2. **禁止写入 `changelog/`**，除非是规则级结论（active / observation / superseded）。
3. `changelog/` 写入策略见 `changelog/README.md`。
4. 当前规则基线见本目录 `RULES_BASELINE.md`。
5. 改完 changelog 后运行：
   ```bash
   node scripts/check-changelog.mjs
   ```

## 路径

- `FDP_ROOT` 解析顺序：环境变量 `FDP_ROOT` → 用户会话指定 → 开发机兜底 `<本机 FDP 仓库路径>`。
- 迁移机器无需改 SKILL；设置环境变量或使用前指定路径即可。
