# AGENTS.md — dawn-skills 源码仓库通用约定

> 本文件是源码仓库级开发约定，不随单个 skill 安装。
> 单个 skill 的 AI 代理约束见各 skill 目录内的 `AGENTS.md` 和 `SKILL.md`。

## 仓库级约定

1. 每个 skill 必须自包含：运行时需要的规则、脚本、参考文件都放在该 skill 目录内。
2. 不要在 skill 运行时依赖仓库根目录的文件。
3. football 相关规则基线：
   - `skills/football-analysis/RULES_BASELINE.md`
   - `skills/football-betting/RULES_BASELINE.md`
4. football changelog 校验：
   - `skills/football-analysis/scripts/check-changelog.mjs`
   - `skills/football-betting/scripts/check-changelog.mjs`
5. football 共享规则同步检查（仅源码仓库开发时）：
   ```bash
   node scripts/check-rules-baseline-sync.mjs
   ```
