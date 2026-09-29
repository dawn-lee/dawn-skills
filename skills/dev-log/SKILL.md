---
name: dev-log
description: 读取和维护项目 DEVELOPMENT_LOG.md。用户明确要求记录开发改动、调用 dev-log，或项目规则及本轮持续授权要求记录时写入；调查项目历史时可读取。普通的“记录”“记一下”需结合上下文，不自动视为开发日志请求，也不在每次改动后主动询问。
---

# Dev Log Skill

将编码会话的改动记录到项目的 `DEVELOPMENT_LOG.md`，并通过头部索引帮助定位历史需求与变更。日志是检索线索，涉及当前状态或精确差异时仍需核对代码与 Git。

本 skill 同时具备**读**与**写**两条通道：
- **写**：记录本会话改动（脚本辅助，编号/去重/索引一致性由 `scripts/dev-log.mjs` 保证）
- **读**：排查历史改动时可读头部索引，按主题定位 Session 再跳读

---

## A. 读取用法（排查历史改动时）

涉及某模块/功能、或想弄清"之前是怎么做的"时：

1. 若项目存在 `DEVELOPMENT_LOG.md`，可读头部「索引」（`## 索引（脚本生成）`），按主题找到相关 Session 号；
2. **跳读**对应 `## Session #N` 条目的 需求/变更摘要；
3. 需要精确差异时，用条目 `commit` 行执行 `git show <hash>` 看提交级 diff；
4. 索引内同号多条以 `#N×次数` 标注（旧数据历史编号有重复，属正常）。

日志可帮助理解意图，但不限制 `git log`、`git diff` 或代码检索的顺序。日志缺失、过时或没有相关条目时，直接使用现有证据继续调查；不要为读取历史而新建日志。

**检索命令**（日志较长时不用通读全文）：
```bash
# 按关键词轻量检索，只打印匹配条目的 Session 号 + 需求首句 + 文件列表
node scripts/dev-log.mjs query callgraph
node scripts/dev-log.mjs query 线程池
```

---

## B. 记录时机

**明确请求**：用户要求记录本次开发改动或调用本技能时，依据已有上下文执行。普通“记一下”若明确指向其它内容，应完成其实际请求。

**持续授权**：项目规则或本轮用户指示已要求持续维护开发日志时，在完成一个改动或一次提交等有意义节点记录，无需重复确认。没有此类要求时，不因为发生文件变更而主动询问或自动写日志。

同一会话可在授权范围内多次记录；通过脚本追加独立条目或续记段落，不覆盖已有条目。用户停止或拒绝记录后，尊重其最新指示。

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
> 从项目目录调用时，使用本 skill 脚本的完整路径；下方简写 `scripts/dev-log.mjs` 指本 skill 内的脚本。不要为了定位脚本改变项目 cwd；必要时用 `--file` 指定日志。

1. **列改动真值**（不要凭记忆）：
   ```bash
   node scripts/dev-log.mjs snapshot
   ```
   输出 `git status --porcelain` + `git diff --stat` 的解析结果（路径 + 新增/修改/删除），据实填写「改动文件」。

2. **确定需求描述**：结合本轮请求和实际改动填写；只有缺失信息会导致误记且无法合理推定时才询问。

3. **插入条目**（脚本自动算编号 = 现有数值 max +1，自动插入文件头部）：
   ```bash
   # 单行写法，三平台（bash / PowerShell / cmd）都能直接粘贴执行
   node scripts/dev-log.mjs add --req "修复 xxx 问题" --files "src/a.java - 修改, 简述; src/b.java - 新增" --summary "整体说明" --issues "问题1; 问题2" --theme "callgraph, 线程池" --commit abc1234
   ```
   - `--files` 用分号 `;` 分隔多个文件；`--issues` 同理。
   - 若本次会话**已记录过**，用 `--continue <N>` 在 Session #N 下追加「（续）」段落，不新建编号：
     ```bash
     node scripts/dev-log.mjs add --req "续记：..." --files "..." --continue 80
     ```
   - `--theme` / `--summary` / `--issues` / `--commit` 在**新建与续记两种模式下都生效**（续记段落同样写入这些字段）。

4. **重建头部索引**：
   ```bash
   node scripts/dev-log.mjs index
   ```
   索引由脚本解析条目自动生成（按 `**主题**：` 标签聚合，缺标签按改动文件推断），无需手工维护。

5. **（可选）补挂 commit**：改动已提交后可随时挂到条目：
   ```bash
   node scripts/dev-log.mjs link <hash>                       # 挂到该 Session 最新一段（含续记）
   node scripts/dev-log.mjs link <hash> --session 80          # 指定 Session（同样挂最新一段）
   node scripts/dev-log.mjs link <hash> --session 80 --section "dawn 容器按项目分目录"   # 按标题片段唯一匹配某一段
   ```
   - 多段会话里，一条 Session 下每个「（续）」段落各有一个 `commit` 行；默认挂**最新一段**（文件靠下 = 最新），回填历史段用 `--section`。
   - `--section` 要求片段在目标 Session 内**唯一匹配**，0 段或 ≥2 段会报错并列出候选标题。

---

## E. 文件位置

按以下顺序查找 `DEVELOPMENT_LOG.md`：
1. 当前项目根目录
2. 当前工作目录（`cwd`）
3. 新建时优先使用已明确的项目根目录；只有多个项目归属无法判定时才询问用户

脚本缺省从 cwd 向上查找；也可用 `--file <path>` 显式指定。
