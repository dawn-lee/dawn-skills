---
name: dev-log
description: 开发日志记录。跟踪 AI 辅助开发的会话改动，写入项目根 DEVELOPMENT_LOG.md。当用户说"记一下"、"记录"、"记录本次改动"、"记一笔"、"记录一下"、"record"、"log changes"、"写一下改动记录"、"dev-log"、"$dev-log"时触发。当本会话已产生文件变更且到达有意义节点（完成一个改动或一次提交）时，主动询问一次是否记录。排查历史改动、想了解某模块/功能怎么做的时也可触发（读取侧）。
---

# Dev Log Skill

将编码会话的改动记录到项目的 `DEVELOPMENT_LOG.md`，并把该文件维护为 **LLM 可追溯的项目记忆库**：排查历史改动时先读它，通过头部索引快速定位，不再扫仓库。

本 skill 同时具备**读**与**写**两条通道：
- **写**：记录本会话改动（脚本辅助，编号/去重/索引一致性由 `scripts/dev-log.mjs` 保证）
- **读**：排查历史改动时先读头部索引，按主题定位 Session 再跳读

---

## A. 读取用法（排查历史改动时）

涉及某模块/功能、或想弄清"之前是怎么做的"时：

1. **先读** `DEVELOPMENT_LOG.md` 头部「索引」（`## 索引（脚本生成）`），按主题找到相关 Session 号；
2. **跳读**对应 `## Session #N` 条目的 需求/变更摘要；
3. 需要精确差异时，用条目 `commit` 行执行 `git show <hash>` 看提交级 diff；
4. 索引内同号多条以 `#N×次数` 标注（旧数据历史编号有重复，属正常）。

> ⚠️ **不要未查日志就直接 `git log`/`git diff` 反推意图**——日志记录了每个改动的需求与原因，比 diff 更直接。

**检索命令**（日志较长时不用通读全文）：
```bash
# 按关键词轻量检索，只打印匹配条目的 Session 号 + 需求首句 + 文件列表
node scripts/dev-log.mjs query callgraph
node scripts/dev-log.mjs query 线程池
```

---

## B. 记录时机

**手动触发**：用户明确要求记录时立即执行（触发词见技能描述）。

**主动询问**：本会话已产生文件变更，且到达**有意义节点**（完成一个改动、一次提交、或用户表示「做完了」「就这样」）时，主动询问一次：
> 「改了挺多了，要不要记录一下这次的改动？」

用户确认（「好」「记」「yes」「record」等）后执行；拒绝则跳过，同一次会话不再重复询问。若用户已手动触发过记录，不再主动询问。
同一会话可多次记录（每次到达有意义节点即轻量记一笔），新记录通过脚本追加为独立条目或续记段落，不覆盖已有条目。

---

## C. 记录格式

每条记录使用以下结构（最新在前）。新建文件时，脚本会生成文件头（标题、说明、用法、`---` 分隔线）。

```markdown
## Session #N - YYYY-MM-DD HH:MM

**需求**：
{本次会话/本次改动目的，一两句话}

**主题**：{可选，逗号分隔标签，如 "callgraph, 线程池"；用于索引聚合}

**改动文件**：
- `path/to/file` - {新增|修改|删除}, {改动简述}

**变更摘要**：
{本次改动的整体说明}

**遇到的问题**：
- {问题及解决方式}

**commit**：{可选，本次改动对应 commit hash；用 link 命令挂载}
```

---

## D. 记录流程（脚本辅助，零手工编号）

> 脚本位于本 skill 目录 `scripts/dev-log.mjs`，node 运行，零第三方依赖。
> 调用时使用完整路径或相对本 skill 目录的路径均可。

1. **列改动真值**（不要凭记忆）：
   ```bash
   node scripts/dev-log.mjs snapshot
   ```
   输出 `git status --porcelain` + `git diff --stat` 的解析结果（路径 + 新增/修改/删除），据实填写「改动文件」。

2. **确认需求描述**：上下文已明确则直接使用，否则向用户确认。

3. **插入条目**（脚本自动算编号 = 现有数值 max +1，自动插入文件头部）：
   ```bash
   node scripts/dev-log.mjs add \
     --req "修复 xxx 问题" \
     --files "src/a.java - 修改, 简述; src/b.java - 新增" \
     --summary "整体说明" \
     --issues "问题1; 问题2" \
     --theme "callgraph, 线程池" \
     --commit abc1234
   ```
   - `--files` 用分号 `;` 分隔多个文件；`--issues` 同理。
   - 若本次会话**已记录过**，用 `--continue <N>` 在 Session #N 下追加「（续）」段落，不新建编号：
     ```bash
     node scripts/dev-log.mjs add --req "续记：..." --files "..." --continue 80
     ```

4. **重建头部索引**：
   ```bash
   node scripts/dev-log.mjs index
   ```
   索引由脚本解析条目自动生成（按 `**主题**：` 标签聚合，缺标签按改动文件推断），无需手工维护。

5. **（可选）补挂 commit**：改动已提交后可随时挂到条目：
   ```bash
   node scripts/dev-log.mjs link <hash>            # 挂到最新一条
   node scripts/dev-log.mjs link <hash> --session 80
   ```

---

## E. 文件位置

按以下顺序查找 `DEVELOPMENT_LOG.md`：
1. 当前项目根目录
2. 当前工作目录（`cwd`）
3. 无法确定时询问用户

脚本缺省从 cwd 向上查找；也可用 `--file <path>` 显式指定。
