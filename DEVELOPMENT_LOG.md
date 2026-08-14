# Development Log

AI-assisted development change history.

> **用法（给 AI）**：排查改动历史前先读下方「索引」，按主题定位 Session 再跳读；需要精确 diff 时用条目 `commit` 行执行 `git show <hash>`。
> 说明：索引由 `dev-log index` 维护；条目编号/内容请勿手改。同号多条并列以 `#N×次数` 标注。

## 索引（脚本生成）
- dev-log: #1
- skill 开发: #1

---
## Session #1 - 2026-08-14 11:10

**需求**：
dev-log skill 全面升级：从只写流水账改造为 LLM 可追溯的项目记忆库（读写双通道）

**主题**：
dev-log, skill 开发

**改动文件**：
- `skills/dev-log/scripts/dev-log.mjs - 新增, 读写脚本(snapshot/add/index/link/query)，编号/去重/索引一致性由脚本保证`
- `skills/dev-log/SKILL.md - 修改, 重构为读写双通道：新增读取用法、记录时机改为每个有意义节点、记录流程改脚本辅助`
- `README.md - 修改, dev-log 技能描述与项目结构更新`
- `docs/dev-log-optimization-plan.md - 新增, 定稿方案留档（按用户要求已忽略不提交）`

**变更摘要**：
基于定稿 v2 方案实现：① 新增 scripts/dev-log.mjs（node 零依赖），snapshot 用 git 真值列改动、add 正则解析编号取数值 max+1、index 重建头部主题索引并保留既有语义（同号多条标 #N×次数）、link 挂 commit、query 轻量检索；② SKILL.md 重构为读写双通道，先读索引定位再跳读、不先查日志就 git log/diff 反推；③ 在 app 的 131 条旧日志上完成概念验证（0 解析失败，语义索引已写入头部）。自测中修复 4 个 bug：索引 ×N 计数丢失、link 插入位置错、link 替换正则不匹配、add 续记缩进/方向。

**遇到的问题**：
- app 日志编号历史严重重复（131 条仅 78 个不同编号，#7×15），索引需带 ×N 标记
- 语义索引由 LLM 打标但未写入条目，index 命令设计为保留既有索引只增量补充，避免重跑覆盖语义

---
