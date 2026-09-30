# Development Log

AI-assisted development change history.

> **用法（给 AI）**：排查改动历史前先读下方「索引」，按主题定位 Session 再跳读；需要精确 diff 时用条目 `commit` 行执行 `git show <hash>`。
> 说明：索引由 `dev-log index` 维护；条目编号/内容请勿手改。同号多条并列以 `#N×次数` 标注。

## 索引（脚本生成）
- 跨平台: #3×8
- 知识库: #2×30, #3×8
- dev-log: #1×31
- obsidian-inbox: #2×30, #3×8
- skill 开发: #1×31, #2×30, #3×8

---
## Session #3 - 2026-09-29 16:35

**需求**：
把 obsidian-inbox 从「本机私有」改造成可分发的通用技能：换电脑 clone 后跑 init + install 即可用

**主题**：
obsidian-inbox, skill 开发, 知识库, 跨平台

**改动文件**：
- `skills/obsidian-inbox/scripts/lib.mjs - 修改, 配置查找解耦（OBSIDIAN_INBOX_CONFIG/技能目录/XDG）+ ${HOME} 展开（vault/catalogSources/routes/excludeCwdPrefixes，路由正则只转义替换进去的家目录）+ 跨平台路径归一 + 提取 whichSync/resolveDshBin/dshHome/dshProjcacheRoot`
- `skills/obsidian-inbox/scripts/init.mjs - 新增, 探测知识库与项目目录生成本机配置（simple|projects 预设、--print/--force/--no-dir），路径一律写 ${HOME}`
- `skills/obsidian-inbox/scripts/install.mjs - 新增, 软链或复制接入 ~/.agents/skills + 自动 init + 三平台调度注册（systemd/launchd/schtasks）+ --status/--uninstall/--dry-run`
- `skills/obsidian-inbox/templates - 新增, systemd service/timer、launchd plist、Windows 计划任务 XML 三套调度模板`
- `skills/obsidian-inbox/config.example.json - 新增, 配置模板与逐字段说明`
- `skills/obsidian-inbox/config.json - 删除, 含私有家目录与业务域清单，移出版本库并 gitignore（本机文件保留）`
- `skills/obsidian-inbox/scripts/sediment.mjs - 修改, llm.patch 可配 + 补丁缺失告警、去掉写死的 dawn/work/opensource 措辞、复用 resolveDshBin、DSH_HOME 可覆盖、配置错误可读化`
- `skills/obsidian-inbox/scripts/note.mjs - 修改, 配置缺失给可读提示（exit 2）而非 ESM 堆栈、无子命令先打印用法、USAGE 补 init/install`
- `skills/obsidian-inbox/run-sediment.sh - 修改, node 定位扩到 nvm/asdf/fnm/volta/mise/Homebrew/opt，支持 OBSIDIAN_INBOX_NODE`
- `skills/obsidian-inbox/patch/headless-notes-only.yml - 修改, 头部说明 provider/密钥/模型为示例、换机须改或另存后用 llm.patch 指定`
- `skills/obsidian-inbox/SKILL.md - 修改, 新增「0. 安装与本机配置」节与环境变量表，容器目录表标注为 projects 预设的本机实例，定时归档改三平台表述`
- `README.md - 修改, 技能表与目录树补 init/install/templates，新增 obsidian-inbox 配置章节`
- `.gitignore - 修改, 忽略 skills/obsidian-inbox/config.json`

**变更摘要**：
技能代码层本就零依赖、已用 homedir()/XDG，真正的移植障碍在配置与调度：config.json 里全是家目录绝对路径、还被 git 跟踪（当时以为已推送，后核实从未推送），目录体系（dawn/work/opensource + 业务域）是本机私有，定时归档是 systemd-only 且 unit 不在仓库里，补丁绑定本机 provider/密钥。本次把三块都拆开：① 配置与代码分离——config.json 移出版本库（git rm --cached + gitignore），新增 config.example.json；配置查找顺序为 OBSIDIAN_INBOX_CONFIG → 技能目录 config.json → XDG，缺失时报错直接给出 init 命令；所有路径用 ${HOME} 占位，路由正则只对替换进去的家目录做正则转义（保留用户写的捕获组）。② 新增 init.mjs——探测含 .obsidian 的知识库与 ~/Documents/projects 下的容器，生成配置并建好容器/默认目录；simple 预设（notes/ 自由分层）与 projects 预设（镜像 <projectsRoot>/<容器>/<项目>，自动生成 domainRoots/catalogSources/strictCatalog/routes），本机现有三容器语义可用 --preset projects --soft dawn --default-dir dawn 完整复现。③ 新增 install.mjs——软链（Windows 无权限时 --copy 复制）接入 ~/.agents/skills，配置缺失时自动跑 init（透传 --preset/--vault/--projects-root），按平台注册调度：systemd user timer、launchd LaunchAgent、Windows 计划任务 XML，并把 node 绝对路径与 DSH_BIN 写进 unit/plist（非登录环境 PATH 极简）；无 systemd 的 Linux 打印 cron 行不擅自改 crontab；另有 --status 自检与 --uninstall。安全侧保持：归档仍走 no-tools 补丁，补丁可被 llm.patch 覆盖，缺失时显式告警。已在临时目录端到端验证：新机 init（simple/projects 两预设）、${HOME} 占位展开、严格容器拦截、容器根拦截、缺配置提示、复制安装自带配置可独立运行；本机 systemd unit 已由新模板重写并通过 systemd-analyze verify、is-enabled/is-active 与最小环境 dry-run。

**遇到的问题**：
- config.json 已被 git 跟踪并推送，等于把家目录路径与业务域清单分发给别人：git rm --cached + .gitignore 处理，本机文件保留、旧格式（写死绝对路径）仍兼容
- 新机器上缺配置时，note.mjs/sediment.mjs 会在模块顶层抛 loadConfig 异常、甩出 ESM 堆栈：改为 try 内加载并给可读提示（exit 2），无子命令时先打印用法不要求配置
- systemd 用户实例的 PATH 里没有 nvm，直接用 node 会找不到：install 把 node 绝对路径与 DSH_BIN 写进 unit，已用 env -i 最小环境跑 dry-run 验证
- Windows 建软链需开发者模式/管理员：symlink 抛 EPERM 时自动退回复制（cpSync，filter 排除 .git/node_modules/.trash）
- 安装位置已存在真实目录（npx skills add 的副本）时，调度若指向克隆的源码会造成「改了不生效」：改为沿用该副本并把 skillDir 指向它
- macOS/Windows 分支只能按各平台接口实现，当前 Linux 环境无法实测，已在文档注明

---


### （续）续记：init.mjs 增加 --from-config，把旧机器配置一键迁移成 ${HOME} 占位格式（面向同一个人的第二台机器）。只改写确实含路径的字段 vault/catalogSources/routes/excludeCwdPrefixes，domainNotes 等说明文字原样保留，因此手写调过的主题目录登记与 agentscope-java→work/arch 这类路由例外都不会丢。过程中修掉两个真 bug：① 迁移路由 pattern 时误用 resolve()，把正则当成相对路径拼上了 cwd（pattern 变成 <技能目录>/^~/...），改为对家目录的三种写法（/ 分隔、Windows 原样、Windows 正则双反斜杠）做纯字符串替换；② 写盘前校验知识库是否存在时只调了 expandHome（不认 ${HOME}），迁移出的配置被判成 vault 不存在，改用 expandVars。已用本机真实配置验证：迁移后 vault/catalogSources/excludeCwdPrefixes/9 条路由 pattern 全部正确，work/arch/app、dawn/dawn-skills、opensource/mcp、agentscope-java→work/arch 四条落位与原配置一致。另：测试中 init 的自动探测曾在真实知识库里建出空的 notes/、opensource/ 目录，确认无内容后已删除复原。

**改动文件**：
- `skills/obsidian-inbox/scripts/init.mjs - 修改, 新增 --from-config 配置迁移 + toHomeToken（正则文本用字符串替换、不走 resolve）+ 写盘前用 expandVars 解析 ${HOME} 校验知识库存在`
- `skills/obsidian-inbox/scripts/install.mjs - 修改, init 参数透传补 from-config`
- `skills/obsidian-inbox/SKILL.md - 修改, 安装章节补 --from-config 用法与适用场景`
**commit**：885ff3d

### （续）续记：用 git filter-branch 改写整条历史做私有信息脱敏（39 个提交全部换 SHA），并重映射日志里的 22 个 hash 引用。起因：仓库要公开，而 config.json（家目录、私有目录名）与 db-sync 示例里的内部 RDS 实例名/库表名会被 git log 或 GitHub 旧提交翻出来。做法：① 先在当前工作树按两级规则脱敏（Tier1 定点替换私有标识，所有行都改；Tier2 措辞泛化，只改文档与代码注释），把 note.mjs 提示、strictCatalog 默认值、companyDomains() 等硬编码改成配置驱动；② 在临时克隆上演练 filter-branch --tree-filter（提交数守恒、tip 树哈希一致、只改预期 8 个文件）后才对真仓库执行；③ 用 refs/original 与 main 的位置配对生成新旧 SHA 映射，替换 DEVELOPMENT_LOG.md 里 22 个引用并逐条 git show 验证；④ 删除 refs/original、过期 reflog、gc --prune=now，确认旧 blob 已不可读取。执行中发现远端 main 实际在 4e2226a（本地 remote-tracking 引用是旧的，未 fetch），比本地多一个 crawl4ai 提交，已 cherry-pick 并入（README/.gitignore 冲突按两边都保留解决，crawl4ai 文件与远端逐字一致），避免 force-push 把它冲掉。改写前的整条历史已备份为 ~/dawn-skills-pre-scrub-<时间戳>.bundle 并附新旧 SHA 映射表；同步远端需 git push --force origin main（尚未执行）。

**改动文件**：
- `DEVELOPMENT_LOG.md - 修改, 22 个 commit hash 重映射到新 SHA + 索引重建`
- `skills/obsidian-inbox/scripts/note.mjs - 修改, 归档区报错提示改为按 cfg.domainRoots 生成容器名`
- `skills/obsidian-inbox/scripts/lib.mjs - 修改, strictCatalog 默认改为空数组（不再写死容器名）、删除未被调用的 companyDomains()`
- `skills/db-sync/SKILL.md - 修改, 内部 RDS 实例名/库表名改为泛化示例`
- `skills/db-sync/scripts/db-sync.sh - 修改, 用法注释里的实例名/库表名泛化`
- `skills/obsidian-inbox/SKILL.md - 修改, 私有目录名与路径改为泛化示例并注明真值以 config.json 为准`
- `README.md - 修改, 合并远端 crawl4ai 条目与配置章节 + 安装说明补全`
- `.gitignore - 修改, 合并远端 .history 规则`
- `skills/crawl4ai/** - 新增, 并入远端 crawl4ai 技能（13 个文件，与远端逐字一致）`

### （续）续记：第二轮历史脱敏——补上提交信息过滤与中文业务系统名。复核时发现首轮的两个盲区：① 首轮只用 --tree-filter，**提交信息**（git log --format 的 subject/body）完全没处理，历史信息里仍有目录名与措辞；② 中文业务系统名与内部工具名不在拉丁 token 覆盖内——文档里的示例笔记名、dev-log 关键词分类规则都命中了，而且当时「代码只改注释」的限制让模板字面量里的中文词（lib.mjs 报错提示）漏改。修正：所有规则改为对全部文本行统一应用（规则本身就是私有标识与中文词，不会与代码语法冲突；已核验历史中家目录绝对路径只出现在注释与字符串示例，无语义性路径判断），脚本新增 --msg 模式供 --msg-filter 使用（stdin 读、stdout 写）。流程照旧：先克隆演练（44 提交守恒、tip 树哈希一致、树与提交信息 0 残留）再对真仓库执行。改写后 23 个 hash 再次重映射并逐条 git show 验证；顺带修正日志里已被

**改动文件**：
- `DEVELOPMENT_LOG.md - 修改, 23 个 commit hash 第二次重映射 + 早期条目里失效表述修正`

### （续）续记：跨平台兼容（Linux/macOS/Windows）与分发自检。动机：技能要能 clone 到别人的机器上直接跑，可分发文件里写死家目录路径是硬伤（换用户名/换系统即失效），公司标识也要防止被重新写进文档。改动：① 平台默认值——状态目录与共享配置目录按 platform 分支（Windows 走 %LOCALAPPDATA%/%APPDATA%，其余保持 XDG 不变），调度器 PATH 构造同样按平台（Windows 用 ; 与 system32），计划任务/launchd 模板变量统一 xmlEscape（路径含 & 不再生成坏 XML）；② 新增 Windows 手动入口 run-sediment.cmd（纯 ASCII + CRLF，批处理在 GBK 代码页下中文注释会乱码、LF-only 会解析 label 出错）；③ 修真 bug：vaultRoot() 用未归一的反斜杠路径与正斜杠比较，Windows 上库内绝对路径会被误判成库外（写测试时才发现）；④ 依赖可选化：zstd 缺失时 recover 直接报可执行提示、归档降级并告警（Windows 默认不带 zstd）；⑤ 文档与错误提示里 ./run-sediment.sh、--cwd $PWD、python3 一律改为三平台通用写法，db-sync 的解释器改为 python3 → python → py -3 顺序查找（Windows Git Bash 里通常没有 python3），并补平台要求说明；⑥ 新增 scripts/selftest.mjs：P1 用 Windows 输入喂路径逻辑、P2 子进程伪造 win32 环境验证目录解析、P3 模板与 XML 转义、L1 分发红线扫描（git 跟踪文件里出现写死家目录路径或硬编码 node 路径即失败）、L2 入口体检，14 项全过。关键取舍：自有标识清单不能直接写进入库的自检脚本（等于把脱敏掉的词重新放进公开仓库），改为外置 private-lint.json（gitignore、不入库，模板 private-lint.example.json 入库），无该文件时自动跳过该项。

**改动文件**：
- `skills/obsidian-inbox/scripts/lib.mjs - 修改, 平台化 STATE_DIR/共享配置默认值、新增 renderTemplate/xmlEscape/schedulerEnvPath、vaultRoot 反斜杠归一、zstdAvailable+ZSTD_HINT`
- `skills/obsidian-inbox/scripts/install.mjs - 修改, 改用 lib 的渲染/转义/环境 PATH，计划任务与 plist 变量 XML 转义`
- `skills/obsidian-inbox/scripts/note.mjs - 修改, 归档区报错提示改为三平台通用命令`
- `skills/obsidian-inbox/scripts/sediment.mjs - 修改, 缺 zstd 时告警一次后降级`
- `skills/obsidian-inbox/scripts/selftest.mjs - 新增, 14 项分发自检（平台兼容 + 分发红线 + 入口体检）`
- `skills/obsidian-inbox/run-sediment.cmd - 新增, Windows 手动入口（ASCII+CRLF）`
- `skills/obsidian-inbox/private-lint.example.json - 新增, 私有红线清单模板`
- `skills/obsidian-inbox/SKILL.md - 修改, 平台差异表、手动用法改 node 形式、状态目录补 Windows 路径、私有清单说明`
- `skills/db-sync/scripts/db-sync.sh - 修改, 解释器按 python3/python/py -3 查找`
- `skills/db-sync/SKILL.md - 修改, 平台要求与 DataGrip 目录按平台说明`
- `skills/dev-log/SKILL.md - 修改, 多行续行示例改单行`
- `README.md - 修改, 结构树补新文件、Windows 环境变量写法、平台说明`
- `.gitignore - 修改, 忽略 private-lint.json`

### （续）续记：清理可分发文档里的 ~，并把「命令里用 ~」纳入红线。把 ~ 按展开方分成三类处理：① 交给 shell/第三方工具的路径（git clone 目标、cd、python 的入参等）在 Windows 的 cmd/PowerShell 下不展开——安装与迁移命令改为 clone 到当前目录、相对路径或 <占位符>，脚本自身的用法/报错提示也统一成 <占位符>；② 传给自家脚本的参数不用改，内部 expandHome 同时支持 ~ 与 ~\；③ 正文里的路径插图在 §0 统一定义「~ = 用户主目录」，技能目录与 DSH 数据根补 Windows 对照（%USERPROFILE% 形式）。加固项：expandVars 支持 Windows 风格 %VAR%（仅替换已定义且形如 %NAME% 的变量，不误伤百分号文本），并加了对应测试；selftest 的 L1 新增 shell-tilde 红线，把「第三方/ shell 命令里出现 ~」判为失败——为验证红线不是摆设，用注入方式在 README 临时加了两条违规命令，确认按条报出 2 处违规后还原。过程中还修了 L1 自身的实现缺陷：String.prototype.matchAll 要求正则带 g 标志，规则定义没加会直接抛错，抽成 allMatches 辅助函数统一补全。自检 14 → 15 项全过。

**改动文件**：
- `skills/obsidian-inbox/SKILL.md - 修改, 安装命令去 shell 展开的 ~、新增路径写法约定、技能目录/数据根补 Windows 对照`
- `skills/obsidian-inbox/scripts/lib.mjs - 修改, expandVars 支持 %VAR% 展开`
- `skills/obsidian-inbox/scripts/selftest.mjs - 修改, 新增 P1-7（%VAR%）与 L1 shell-tilde 红线、allMatches 辅助`
- `skills/obsidian-inbox/scripts/init.mjs - 修改, 用法注释改占位符`
- `skills/obsidian-inbox/scripts/install.mjs - 修改, 报错提示改占位符`
- `skills/obsidian-inbox/scripts/note.mjs - 修改, 用法提示改占位符`
- `README.md - 修改, 命令注释去 ~`

### （续）续记：全量复检（27 项）+ 修掉安装副本失步问题

**改动文件**：
- `skills/dev-log/SKILL.md - 修改, 三方合并 9/7 只存在于安装目录的本地改写（收紧触发、持续授权措辞）`
- `skills/db-sync/SKILL.md - 修改, 三方合并 9/7 安全条款（实际目标核实、非本地目标不交本脚本、授权范围超出先确认）`
- `DEVELOPMENT_LOG.md - 修改, 索引重建`

**变更摘要**：
按七组（git 完整性/私有信息/跨平台/功能回归/分发完整性/远端/遗留副本）全量复检，27 项全过。过程中修掉四个真问题：① 两轮 amend 留下的 5 个不可达对象（其中一个是被我替换掉的个人路径旧版本）——已 gc 回收，改写前后的旧提交均不可读取；② ~/.agents/skills/ 下 dev-log、db-sync 是 8/14 的旧副本且含私有词、缺 --continue 与 python3 两处修复，而我整轮会话用的就是旧副本（导致此前续记少写变更摘要）；③ 两个 SKILL.md 的 9/7 本地改写从未进 git（比仓库更新，是刻意的触发收紧与安全加固），按用户选择做了三方合并：基准取本地编辑前的 git 版，两侧为本地改写与仓库后续改进，1 处冲突（dev-log 示例）取仓库侧（单行跨平台 + 脱敏），0 处丢弃仓库改进；合并结果整体跑脱敏，私有词清零；④ 四个安装副本全部换成软链，三技能单一真源，后续不再漂移。另修正三处审计方法学缺陷：crawl4ai 与远端比对误报通过（比对的旧 SHA 已被回收、stderr 未进判断）、shell-tilde 红线的 matchAll 需要 g 标志、外部词表里把公开开源项目名当成了内部标识。

**遇到的问题**：
- amend 会留下不可达对象且可能携带被替换前的内容（本次就抓到一个）——每次改写或 amend 后必须 gc --prune=now；技能安装目录若用复制方式而非软链，会与仓库失步：本次四个副本全部过期，其中两个 SKILL.md 的本地改写从未入库；审计脚本的两个坑——git diff 失败时 stderr 不进空判断会假通过、matchAll 要求正则带 g；外部词表交叉核对要区分公开开源项目名与真正的内部标识（避免误报）；用旧版脚本写的三条早期续记缺变更摘要两节（脚本已在 1e6caf4 修复，本次起生效）

### （续）续记：多 agent 归档改造（qoder/claude/codex 接入）

**改动文件**：
- `skills/obsidian-inbox/scripts/adapters - 新增, contract/dsh/qoder/claude/codex/index 六个模块（统一 session 契约 + 四家格式映射）`
- `skills/obsidian-inbox/scripts/sediment.mjs - 修改, collectSessions 改分发 adapter、transcript 兜底走 adapter、source/tags 用 _agent`
- `skills/obsidian-inbox/scripts/lib.mjs - 修改, loadConfig 加 agentAdapter 字段`
- `skills/obsidian-inbox/config.example.json - 修改, 加 agentAdapter`
- `skills/obsidian-inbox/scripts/selftest.mjs - 修改, 加 P4 adapter 契约测试、check 支持 async`
- `skills/obsidian-inbox/SKILL.md - 修改, 多 agent 归档小节与支持矩阵`

**变更摘要**：
把归档通道从硬编码 DSH 抽成 adapter 层。核心是 adapters/contract.mjs 定义的统一 session 对象（id/cwd/turns[{turn,prompt,response}]），collectSessions 按 cfg.agentAdapter 分发，每个 adapter 把各家会话格式映射进来，归档的查重/精炼/索引逻辑零改动。新增 dsh（抽出原逻辑作回归基准）、qoder、claude、codex 四个 adapter，全部在本机真实数据上验证：qoder 14 会话/125 轮、codex 6/19、dsh 84/337 不变、claude 180（本机 projects 为空，走 history.jsonl 回退只有 prompt 无回复，归档判 trivial 跳过符合预期，已加一次性提示说明原因）。多 agent 支持逗号分隔合并（dsh+qoder+codex 实测 104 = 84+14+6），单 adapter 失败不阻断。contract 层统一 textOf（跳过 thinking/tool_use）与 isNoisePrompt（slash-command、<recommended_plugins> 等噪音不产生空轮次）。归档 frontmatter 的 source/tags 改为 agent-aware（source: qoder、qoder/归档），domain 仍由 cwd 路由。实测完整链路：qoder 会话 → 17KB 笔记、26 轮、domain 正确路由到 opensource/forks。cursor（SQLite 依赖）与 workbuddy（未定位到对话流）暂未实现，见支持矩阵。selftest 15→17（P4 契约测试）。

**遇到的问题**：
- 本机 ~/.claude/projects 下会话 jsonl 全为空（会话可能在别处或已清理），Claude adapter 只能走 history.jsonl 回退——数据只有 prompt 没有 assistant 回复，归档必然判 trivial；已加一次性 stderr 提示避免用户困惑地看到 scanned=180 却 0 创建。check() 原本是同步的，async 测试的返回值会被 string 成 [object Promise] 且失败变成未处理拒绝，改为收集 Promise 统一 await（注入错误验证能被抓住）。Qoder/Codex 首条 user 常带 <command-message>/<recommended_plugins> 等注入，不当滤会成为空轮次或污染标题。未来接入 cursor 需引入 SQLite 依赖（与零依赖原则冲突，需权衡用 sqlite3 命令行而非 node 模块）。

### （续）续记：挖清 workbuddy 存储并接入 adapter

**改动文件**：
- `skills/obsidian-inbox/scripts/adapters/workbuddy.mjs - 新增, 读 ~/.workbuddy/workbuddy.db 的 sessions 表（Python sqlite3 只读，零 npm 依赖）`
- `skills/obsidian-inbox/scripts/adapters/index.mjs - 修改, 登记 workbuddy`
- `skills/obsidian-inbox/scripts/selftest.mjs - 修改, P4-1 断言 5 个 adapter 全执行、L2-3 加 workbuddy.mjs`
- `skills/obsidian-inbox/SKILL.md - 修改, 支持矩阵 workbuddy 状态`

**变更摘要**：
把 workbuddy 的存储挖到底：唯一权威数据源是 ~/.workbuddy/workbuddy.db（Drizzle/SQLite）的 sessions 表，30 列字段齐全（cwd/title/model/created_at/last_activity_at/status）。排除了其他可能：config 里 legacy_history_migration 指的 codebuddy-sessions.vscdb 不存在、expert-history.json 是空对象、无独立消息表（sessions 表无 message/turn 列）、logs/startup 的 jsonl 是启动日志（[timestamp] {"_type":"mark"} 非对话）、Local Storage/leveldb 只命中渲染层 sessionId、其余 db（edge-sync/threat-database）无关。adapter 实现保持零 npm 依赖：spawnSync 调 Python 标准库 sqlite3 只读打开（与 db-sync.sh 内联 Python 同模式，python3→python→py -3 探测，三平台自带），过滤 deleted_at IS NULL AND is_playground=0。消息部分诚实处理：sessions 表无消息列、本机无消息表 → turns 为空，归档端 substanceOf=0 判 trivial 跳过（不报错），消息一旦落地自动接入。验证：按真实 schema 造 fixture（3 行含软删除+沙盒）→ 正确返回 1 条、cwd/title/model/lastActivityAt 全部提取；本机真实表 0 行 → 返回 0 优雅降级。五 adapter 合计 284 会话。

**遇到的问题**：
- 本机 workbuddy sessions 表 0 行（还没建过会话），无法用真实数据端到端验证，只能用按真实 schema 造的 fixture 验证解析逻辑——这是本次最大的局限，adapter 要等真有会话才能实测全链路。消息在云端/未迁移（sessions 表 30 列里无 message 列），adapter 当前只取元数据，turns 恒为空，意味着即使会话有数据、归档也会判 trivial——需要等 workbuddy 落地消息表才能真正归档。没引入 better-sqlite3 之类 node sqlite 模块（会破坏零依赖原则），改用 Python 标准库 sqlite3（系统自带，与 db-sync 既有模式一致）。已核实 codebuddy-sessions.vscdb 等 legacy 路径都不存在，避免了在错误位置找数据。

### （续）续记：归档区 dsh-sessions 改名 sessions + 标签泛化 archive/

**改动文件**：
- `skills/obsidian-inbox/config.json - 修改, archiveDir → sessions`
- `skills/obsidian-inbox/config.example.json - 修改, archiveDir → sessions + 字段说明`
- `skills/obsidian-inbox/scripts/lib.mjs - 修改, archiveDir 默认值 → sessions`
- `skills/obsidian-inbox/scripts/init.mjs - 修改, archiveDir 默认值 → sessions`
- `skills/obsidian-inbox/scripts/sediment.mjs - 修改, 标签前缀 → archive/归档、索引 source → archive、注释去 DSH 专有措辞`
- `skills/obsidian-inbox/scripts/note.mjs - 修改, 用法提示 dsh-sessions → sessions`
- `skills/obsidian-inbox/SKILL.md - 修改, 12 处路径与标签描述同步 + 多 agent 小节标签说明修正`

**变更摘要**：
接入多 agent 后 dsh-sessions/ 目录名与 dsh/归档 标签已名不符实（可归档 qoder/claude/codex/workbuddy）。按三个决策（目录改 sessions/、标签全泛化 archive/xxx、10+ 篇交叉引用全改）执行：配置层 archiveDir 四处默认值改 sessions；代码层标签前缀从 agent 派生的 ${_agent}/归档 改为统一 archive/归档（索引 source 改 archive，归档笔记的 source 保留 agent 因为这才是来源字段的职责）；vault 侧 tar 备份后整体改名 dsh-sessions → sessions（24 篇含索引页，23 个 wikilink 因是 [[笔记名]] 形式不受目录移动影响），25 篇 frontmatter 标签、11 篇正文+frontmatter 交叉引用（含 8 处 'source: 提炼自 dsh-sessions 会话归档'）全改。SKILL.md 12 处同步，并修正多 agent 小节里标签描述与实现不一致处（原写 qoder/归档，实际是 archive/归档）。校验全绿：全库 0 残留 dsh-sessions、0 残留旧标签、sessions/ 24 篇索引页 23 wikilink 完好、dry-run 计划落 sessions/、selftest 17/17。DEVELOPMENT_LOG.md 保留旧名不改（历史事实）。

**遇到的问题**：
- 标签比目录更需要泛化：24 篇旧笔记的 source: dsh 保留（历史事实——这些确实来自 DSH，区分来源本就是 source 字段职责，改它等于篡改历史），但 tags 从 dsh/ 归档 改 archive/归档 让 Dataview 能统一按 archive/ 检索多 agent 归档。改名前必须备份 vault（5.1M tar），因为 vault 不在 git、改错无法回滚。交叉引用有三种形态要全覆盖：dsh-sessions/（带斜杠路径）、`dsh-sessions`（反引号独立词）、'提炼自 dsh-sessions'（frontmatter 值不带斜杠）——第一版只处理了前两种，第三种 8 处残留靠二次扫描补齐。wikilink 用 [[笔记名]] 形式而非 [[dsh-sessions/名字]] 所以目录移动不产生断链（若当初用了带路径的 wikilink 改名会全断）。SKILL.md 多 agent 小节的标签描述一度与实现不一致（文档说 qoder/归档、实现已改 archive/归档），靠文档-实现一致性校验发现。

### （续）续记：归档索引加「来源」列

**改动文件**：
- `skills/obsidian-inbox/scripts/sediment.mjs - 修改, buildArchiveIndex 提取 source、表头/行加来源列、加按来源分布统计、索引标题去 DSH`

**变更摘要**：
sessions/ 汇聚多 agent 后，索引表缺「来源」列看不出每条来自哪个 harness。buildArchiveIndex 的 entries 提取 frontmatter source（缺失回退 dsh 兼容旧笔记），表头在日期后加来源列、每行插入 e.source，统计区加「按来源分布」行与领域分布并列，索引标题 DSH→去掉。验证两步：--reindex 对现有 23 篇得到 6 列一致表、来源全 dsh；再用 codex adapter 隔离 state 归档一篇 → 索引显示 dsh 23、codex 1，该行日期/来源/领域/会话 id 全正确（codex 的 domain 由 cwd 路由、source=codex）。期间一个误判：ls -t 首篇是索引.md 而非 codex 笔记，导致一度以为 source 被标签泛化误伤，精确定位后确认代码 source: s._agent || 'dsh' 正确。测试笔记已清理、reindex 回到 23 篇。

**遇到的问题**：
- 标签泛化时要特别小心别误伤 source：tags 从 dsh/ 归档 改 archive/ 归档，但 source 必须保留 agent（qoder/dsh/codex）——两者都带前缀斜杠，正则容易一起替换。验证多 agent 列显示时，归档会话会同时重建索引使索引.md 时间戳最新，ls -t 取首篇会拿到索引而非目标笔记，需排除索引文件。列数校验用 awk -F'|' '{NF-1}' 会把行首尾空段多数一个，正确做法是 split 后取 [1:-1]。

### （续）续记：归档按来源 agent 分层（sessions/<agent>/）

**改动文件**：
- `skills/obsidian-inbox/scripts/sediment.mjs - 修改, writeNote/dry-run 写入落 sessions/<agent>/、新增 walkMd 递归扫子目录、索引 entries 加 source/name/relPath`
- `skills/obsidian-inbox/scripts/note.mjs - 修改, 归档区拦截移到 assertDirReady 之前（修顺序 bug）`
- `skills/obsidian-inbox/SKILL.md - 修改, 7 处分层描述`

**变更摘要**：
平铺 sessions/ 在多 agent 后混杂，改按来源分层 sessions/<agent>/（仅 agent 一层，不按领域再分，索引留根）。写入侧 writeNote 与 dry-run 路径加 <agent> 段（s._agent，--dir 显式指定时跳过）；23 篇旧笔记迁入 sessions/dsh/。索引侧是关键：原 readdirSync 只读一层，分层后会漏读子目录，新增 walkMd 递归收集；entries 加 source（子目录名优先、根下回退 frontmatter）、name（wikilink 纯笔记名跨子目录不冲突）、relPath。wikilink 保持 [[笔记名]] 不带路径所以移动不断链。顺带修一个真 bug：归档区拦截在 assertDirReady 之后，--dir sessions/<agent> 会因目录不存在报新建分类而非归档区禁写，把检查移到前面后 sessions 全系列（含不存在的子目录）都正确拦截。验证：selftest 17/17、reindex 递归 count=23、wikilink 0 子目录前缀、dry-run 写入 sessions/dsh/、四个 --dir 全拦。

**遇到的问题**：
- readdirSync 只读一层是分层的隐形坑——改目录结构时不改扫描逻辑，索引会静默漏读子目录（count 变 0 不报错），必须递归 + 断言 count。归档区拦截与 assertDirReady 的顺序是既有 bug、分层后暴露：目录存在性检查先跑会把'这是禁写区'误导成'目录不存在需 --mkdir'，应先判禁写再判存在。show --path 需带 .md 后缀（历史如此，测试时漏带误以为是分层 bug）。wikilink 用纯笔记名是当初的正确设计，分层移动零断链——若当初用了 [[sessions/名]] 带路径形式，这次改名会全断。

### （续）续记：复检发现并修复 4 个真问题（含会导致 84 篇重复归档的严重回归）

**改动文件**：
- `skills/obsidian-inbox/scripts/adapters/dsh.mjs - 修改, 会话 id 恢复保留 session- 前缀（原剥前缀致账本全不匹配）`
- `skills/obsidian-inbox/scripts/sediment.mjs - 修改, 新增 findArchivedNoteBySession（路径失效按 id 找回，防重复建档）`
- `skills/obsidian-inbox/scripts/note.mjs - 修改, distill 校验收炼目标存在且非归档区（原先无条件写标记）`
- `skills/obsidian-inbox/scripts/selftest.mjs - 修改, 加 P4-3（锁 dsh id 契约）与 P5-1（distill 三态）`
- `DEVELOPMENT_LOG.md - 修改, 修 1 处历史改写漏映射的 hash`
- `~/.local/state/obsidian-inbox/archived.json - 数据修复, 23 条 notePath 从 dsh-sessions/ 迁到 sessions/dsh/`

**变更摘要**：
复检抓到 4 个真问题并修复。①最严重：dsh adapter 把会话 id 的 session- 前缀剥掉了（原 normalizeSession 用 basename(file,'.json') 保留前缀，抽 adapter 时写成 file.replace(/^session-/,'')），导致 adapter id 与 archived.json 的键完全对不上（实测 0/84 命中）——当天 23:00 的 cron 会把 84 个已归档会话全部当新会话重复建档；修复后 25/84 命中（= 仍在 projcache 的会话）、dry-run 的 unchanged 从 0 变 22。② 归档区两轮改名（dsh-sessions→sessions→分层）后 state 里 23 条 notePath 全部失效，而 writeNote 只靠'重算文件名恰好撞上现有文件'判定重复，改名或手动重命名就会重复建档；新增 findArchivedNoteBySession 按会话 id 在归档区递归找回并自愈状态，端到端验证通过（追加而非新建、原内容保留）。③ distill 用 if (hit && ...) 找目标，目标不存在时只跳过 domain 校准却仍无条件写 distilled:true —— 会把归档错误地从'待提炼'队列移除并留悬空引用；改为目标不存在即 fail、目标是归档区笔记也 fail。④ DEVELOPMENT_LOG 里 1 个 hash 是历史改写漏映射的旧 SHA（5a9680b），经备份 bundle 内容比对确认真身是 1e6caf4。回归测试：P4-3 锁 dsh id 契约（剥前缀时失败）、P5-1 distill 三态（不存在/归档目标失败、合法成功），均已验证能抓住回归。另外复检时我自己的测试污染了一篇真实归档（传假目标名把 distilled_into 覆盖），已从 .smart-env 缓存恢复原值 2026-09-28 16:26。自检 17→19 项。

**遇到的问题**：
- 最该记的教训：test 传的参数本身含'不存在'三字，成功消息里出现该字样，我的 grep 断言就'通过'了——自欺型测试，和之前'git diff 失败 stderr 没进判断'是同一类。抽 adapter 重构时没有对照原实现的语义细节（id 用 basename 保留前缀），是纯行为差异却没有任何测试覆盖，靠复检时拿 adapter id 与真实账本键对撞才发现；重构'等价性'必须用真实数据对撞而不是只跑通。归档区两次改名都没同步 state（那是运行时状态、不在 git 里，容易被漏），说明'改名'要连带检查所有引用该路径的持久化数据。我还在上一轮误删了 vault 备份（本想检查是否存在却执行了 rm），已重建 ~/obsidian-vault-backup-20260930-1442.tar.gz。distill 的 bug 也说明：写标记类命令必须在变更前完成全部校验（fail-fast），否则校验失败也留下副作用。

### （续）续记：收尾修复全局指令与知识库笔记的旧结构

**改动文件**：
- `~/.dsh/AGENTS.md - 修改, 归档路径改 sessions/<agent>/、标签改 archive/待归类、补多 agent 与 distill 前置条件`
- `Obsidian 库 dawn/dawn-skills/会话知识自动沉淀到 Obsidian 的方案.md - 改名+改内容, 去掉 DSH 前缀（方案已覆盖多 agent）、路径/状态目录/索引列/distill 前置/commit 真身全部更新`
- `库内 6 个文件 11 处引用 - 修改, 同步改名后的 wikilink 与 distilled_into`

**变更摘要**：
复检报告里①②两项的收尾。① 全局指令 ~/.dsh/AGENTS.md 第 15 行仍写归档到 dsh-sessions/、带 dsh/待归类 标签（两轮改名后已失效），改为 sessions/<agent>/ 分层说明 + archive/待归类，并补上已支持 dsh/qoder/claude/codex 由 agentAdapter 决定与 distill 要求目标已存在的提示。② 知识库笔记 'DSH 会话知识自动沉淀到 Obsidian 的方案' 内容已过时（写 sessions/YYYY-MM-DD、state/archived.json、索引无来源列、commit hash 是历史改写前的死链），且标题带 DSH 前缀而方案已覆盖多 agent——更新内容后改名为 '会话知识自动沉淀到 Obsidian 的方案'（同步 H1），更新全库 11 处引用（含 3 篇归档的 distilled_into 标记），并修掉归档笔记里一处缺日期前缀的自引用断链（第 92 行 [[DSH 知识库沉淀技能与目录路由规则]] → 带日期，与同笔记第 120 行写法一致）。两个死 hash 按备份 bundle 内容比对解出真身：c256e7b→3e6e8f8、e298d0c→3694770。验证：AGENTS.md 旧结构 0 残留、笔记旧路径/旧标题/死 hash 全 0、全库真断链 0（仅剩 26 处文档占位符示例）、distilled_into 悬空 0、自检 19/19。

**遇到的问题**：
- 断链检查器有两处误报要记：①只索引 .md 当解析目标，把 ![[图片.png]] 的附件嵌入判成断链——实际图片在知识库的 attachments 目录里好好的，Obsidian 按 basename 全库解析；②用 Path.stem 当目标名会剥掉扩展名，而图片链接带扩展名，必须同时收 f.stem 与 f.name。差点据此误报'两个图片断链'并去'修'一个本来没问题的引用。改名类操作的成本：一个笔记改名牵动 3 篇归档的 distilled_into、2 处索引、4 篇主题笔记的 wikilink，共 11 处，必须全库同步并复查悬空引用——这也是当初 wikilink 用 [[纯笔记名]] 而非带路径的好处（改路径不断链，但改名仍要同步）。.smart-env 里 6252 处旧路径是插件索引缓存，会自动重建，手工删反而丢嵌入向量，属不处理项。

### （续）续记：实测归档 codex 会话（真实 LLM 链路）+ codex 模型名提取修复

**改动文件**：
- `skills/obsidian-inbox/scripts/adapters/codex.mjs - 修改, 从 turn_context.payload.model 取模型名（session_meta 只有 model_provider）`
- `知识库 sessions/codex/ - 新增 1 篇真实归档笔记（首个非 dsh 来源的归档）`

**变更摘要**：
按用户要求实测归档 codex 会话，走真实 LLM 精炼链路（非 --no-llm）：用临时配置（仅把 agentAdapter 改成 codex，其余字段与真实配置逐字一致）+ 真实账本，定点归档 rollout-2026-09-10T16-23-12 会话。结果：6 轮 / 10644 字摘要 → 精炼成 121 行笔记，落 sessions/codex/，领域按 cwd 路由到公司域 arch，索引显示「按来源分布：dsh 23、codex 1」，账本正确记录分层后的 notePath。内容质量核对：结论节抓到真实根因（前端依赖锁文件里 286 个内网源地址固化、npm 11 只替换官方域名不替换内网域名、Go 版本要求与 apt 源不匹配、某端口被容器占用并给出仓库提交号、总路由漏注册函数导致接口恒 404），命令逐字保留（npm_config_replace_registry_host 等）。过程中发现并修一个瑕疵：codex 的 session_meta 只有 model_provider=custom，模型名在 type=turn_context 的 payload.model（实测 gpt-5.6-sol），adapter 补上后 6 个 codex 会话模型全部取到；对已归档那篇跑 --force 原地重写，摘要行显示真实模型且笔记数不变（验证了改名后按 id 找回、force 不重复建档的链路）。自检 19/19。

**遇到的问题**：
- adapter 抽取字段要对着真实数据逐类行核实：codex rollout 有 session_meta / event_msg / response_item / turn_context 四类行，模型名不在最像的 session_meta 里而在 turn_context，只看 session_meta 就会一直显示未知模型。真实 LLM 归档的价值在于它能暴露 --no-llm 看不到的环节（精炼质量、模型取值、领域路由、frontmatter 完整度）；这次的笔记质量说明提示词里'代码/命令/SQL 逐字复制'的要求生效了。另一个待决：真实 config.json 未设 agentAdapter（默认只有 dsh），所以每日 cron 不会归档 codex 会话——要不要改成多 agent 需用户定。

### （续）续记：agentAdapter 多值配置生效（dsh,qoder,claude,codex）+ 别名规范化

**改动文件**：
- `skills/obsidian-inbox/scripts/adapters/index.mjs - 修改, 加 ALIASES 别名表并单向规范化（qoder-cn→qoder、claude-code→claude、codex-cli→codex，大小写不敏感，重复去重）`
- `skills/obsidian-inbox/config.example.json - 修改, agentAdapter 字段说明补别名`
- `skills/obsidian-inbox/SKILL.md - 修改, 支持矩阵与示例补别名`
- `skills/obsidian-inbox/scripts/selftest.mjs - 修改, P4-2 扩展别名断言（规范化/大小写/去重）`
- `skills/obsidian-inbox/config.json（gitignore 不入库）- 运行时配置, agentAdapter 设为 dsh,qoder,claude,codex`

**变更摘要**：
按用户要求把 agentAdapter 改成四个 agent，但用户写的是产品名 qoder-cn（目录 ~/.qoder-cn），而登记名是 qoder——直接用会报『未登记』。加了别名表并**单向规范化**为登记名，核心理由是避免同一 agent 出现两个归档子目录（否则 qoder-cn 和 qoder 两种写法会分叉成 sessions/qoder-cn/ 与 sessions/qoder/）。规范化含大小写不敏感、同键去重；未知名仍报错列可用项。配置写入真实 config.json（gitignore，不入库）：dsh,qoder,claude,codex。实测真实归档（非 dry-run、走完整 LLM 链路）7 个候选：4 created（3 dsh + 首个 qoder 看板缺数据排查会话）、2 appended（补记轮次，原 distilled* 标记与追加节均正确保留）、1 trivial 跳过、0 失败；索引 28 篇，来源分布 dsh 26 / qoder 1 / codex 1，新结构 sessions/{dsh 26, qoder 1, codex 1}。4 agent 在窗口内分布：dsh 6、qoder 1、claude 0、codex 0（老会话已出窗口，不会被自动归档，需回填）。selftest 19/19。

**遇到的问题**：
- 别名规范化必须单向：规范名是 id 也是归档子目录名，若别名不折回规范名，同一 agent 的归档会分叉到两个目录，后续索引/账本按目录判定来源会分裂。4 个 claude 候选在当前窗口为 0（全量 180 都是老会话），所以本次真实归档没覆盖 claude 的写入路径——它和 codex/qoder 共用 adapter+writeNote 主干（已分别验证），但『4-agent 同时真跑』这个具体组合仍缺一次实测，下次 cron 或手动 --since-hours 回填时可补验。旧会话回填要用户决定：--since-hours 值拉大虽能吃进老会话，但 window 同时决定『补记已有会话』的范围，需先确认 archived.json 的现有记账能对齐（已有 25 条 dsh 记账在，回填 4 agent 时 --session 过滤最安全）。

### （续）续记：复检发现并修复 git 历史里残留的公司私有词（提交内容维度）

**改动文件**：
- `DEVELOPMENT_LOG.md - 修改, filter-branch 定点改写 0861003~1..HEAD 共 5 个提交的该文件, 私有词替换为泛化词`
- `refs/original - 删除, filter-branch 备份引用`
- `reflog/gc - 过期并回收旧历史对象`

**变更摘要**：
用户问『git 提交记录问题修复了吗，不要暴露我的公司信息』，全维度复扫抓到一处此前漏网的：某公司产品名藏在 0861003 提交的内容里（该条是 agentAdapter 别名的 dev-log 记录，我写条目时把产品名带进去了）；其后 adfc86c 泛化独立容器名时漏了这个词。根因是此前的 L1 红线只扫工作区文件，不扫提交历史内容——git log -S 才能暴露。修复：先建备份 bundle（~/dawn-skills-pre-fix-20260930-1735.bundle），再 filter-branch 限定 0861003~1..HEAD 对 DEVELOPMENT_LOG.md 做文本替换（只动这 1 个文件 1 个词，其余 71 个提交零改动），最后删 refs/original、reflog expire、gc --prune=now 让旧历史物理不可读。验证 5 维度全绿：提交信息 0 命中、全历史文件内容 git log -S/-G 逐词 0、引用名/stash 0、作者身份全为个人身份（可保留）、不可达对象 0。提交数仍 76（改写只动内容不动结构），HEAD 变为 cecd305。

**遇到的问题**：
- 盲区：私有信息扫描此前只覆盖工作区（selftest L1），没覆盖提交历史内容——git log -S 是必须补的一环，本次靠用户追问才暴露；今后红线扫描应加一条『全历史 log -S/-G 逐词』。改写前必须建 bundle 备份（本次 321K，验证 OK 后待删）。filter-branch 范围用 0861003~1..HEAD 是位置配对，改写后 SHA 全变，验证时要分清『当前 main』与 refs/original 备份——初次 log --all 扫到的 2 个命中其实是 filter-branch 的旧备份引用，删掉 original 后归零。用户已自行推送（远端从 4e2226a 更新），本机 pending 为备份 bundle 待删。

## Session #2 - 2026-09-28 11:04

**需求**：
新增 obsidian-inbox 技能：把会话中可复用的知识沉淀进 Obsidian 知识库，含写入通道、检索通道与每日定时归档兜底

**主题**：
skill 开发, obsidian-inbox, 知识库

**改动文件**：
- `skills/obsidian-inbox/SKILL.md - 新增, 技能定义（读写通道、笔记格式、定时归档说明、源码与安装约定）`
- `skills/obsidian-inbox/config.json - 新增, 知识库路径/目录路由/排除规则/摘要预算`
- `skills/obsidian-inbox/scripts/lib.mjs - 新增, 共享库（vault 路由、frontmatter、原子写、检索、追加）`
- `skills/obsidian-inbox/scripts/note.mjs - 新增, 写/查通道 CLI（new/append/search/show/route，含查重与退出码约定）`
- `skills/obsidian-inbox/scripts/sediment.mjs - 新增, 每日归档（扫 projcache → headless 精炼 → 落笔记，按轮次记账追加补记）`
- `skills/obsidian-inbox/run-sediment.sh - 新增, 定时任务入口（自解析 nvm/node，-P 解析真实源码路径）`
- `skills/obsidian-inbox/patch/headless-notes-only.yml - 新增, 归档运行时最小权限补丁（禁用全部工具 + 指定模型）`
- `README.md - 修改, 技能表与项目结构树补充 obsidian-inbox`

**变更摘要**：
面向会话的知识沉淀技能，双通道 + 定时兜底。① note.mjs 提供写/查通道：new 自动生成 frontmatter、按 cwd 正则路由到知识库的 dawn/ 或 work/ 领域目录、写前按标题归一化查重（命中返回退出码 3 与 similar 列表），append 可按二级标题定位插入，写入统一走同目录 tmp + rename 原子写；search 为子串匹配（对中文友好），按标题/路径/正文加权，用于动手前检索历史笔记。② sediment.mjs 由 systemd user timer 每天 23:00 触发：从 ~/.dsh/storages/session_projcache/sessions/*.json 读 turnOutline（含每轮 prompt/response 预览，无需解压 transcript）拼摘要，交给 dsh headless 精炼成结构化笔记，落到 <领域>/dsh-sessions/；模型判定无价值则输出 SKIP 跳过；archived.json 按会话记录已归档轮次，同一会话新增轮次追加补记而非重复建档。安全设计：归档运行时挂 patch/headless-notes-only.yml 禁用全部工具、子代理与交互插件，防止摘要夹带的外部内容触发提示注入，并把 headless 默认的 deepseek-official 换成方舟 coding-plan。运行期状态写在 XDG 的 ~/.local/state/obsidian-inbox，源码留在仓库、~/.agents/skills/obsidian-inbox 以软链接入。

**遇到的问题**：
- headless 默认 provider 是 deepseek-official，本机无该 route 的 key，报 MISSING_CREDENTIAL；补丁注入 volcengine provider 与 agent-default-model 后解决
- headless 默认带 bash/fs 工具且本机策略是 danger-full-access，而摘要含外部网页内容，存在提示注入风险；禁用全部工具使其退化为纯文本进文本出
- 归档任务自身的 headless 会话会被持久化并进入下次扫描范围，形成自我归档；禁用 session-persistence-jsonl 并在 config 排除状态目录前缀，同时清理测试期产生的 8 条会话记录
- 技能以软链接入 ~/.agents/skills 后运行期状态会落进 git 工作区；改到 ~/.local/state/obsidian-inbox 并更新 excludeCwdPrefixes
- 自测修复三处：JSDoc 注释里含 */ 的 glob 导致 ESM 解析失败、ESM 中误用 require、解析模型输出时 tags 注释漏进笔记正文

**commit**：3e6e8f8

---

### （续）续记：修复归档笔记引用路径错误，并防止 Obsidian 因死链凭空建出嵌套空文件

**改动文件**：
- `skills/obsidian-inbox/scripts/lib.mjs - 修改, 新增 toVaultRel/safeDecode 路径解析防护、listNoteIndex 笔记清单、sanitizeBodyLinks 链接降级；vaultAbs/routeDir 拒绝库外绝对路径`
- `skills/obsidian-inbox/scripts/sediment.mjs - 修改, 摘要附「知识库现有笔记」清单、引用规范写进 prompt、写入前统一 sanitizeBodyLinks`
- `skills/obsidian-inbox/SKILL.md - 修改, 新增「引用与链接规范」小节与自动兜底说明`

**commit**：b0c11fa

### （续）续记：按用户定义的知识库目录语义细化路由，并禁止把笔记直接写进领域容器根

**改动文件**：
- `skills/obsidian-inbox/config.json - 修改, 新增 domainRoots/domainNotes 语义表，细化路由（work/arch 单独映射、opensource/forks → dawn），删除被覆盖的死规则`
- `skills/obsidian-inbox/scripts/lib.mjs - 修改, 新增 assertNoteDir（领域容器根拦截）与 listSubdirs，loadConfig 解析 domainRoots/domainNotes`
- `skills/obsidian-inbox/scripts/note.mjs - 修改, new 校验落点、route 输目录含义与容器告警、stdout EPIPE 兜底`
- `skills/obsidian-inbox/scripts/sediment.mjs - 修改, stdout EPIPE 兜底`
- `skills/obsidian-inbox/SKILL.md - 修改, 新增「目录约定」小节（dawn/work 为容器 + 各子目录含义 + 判定顺序）`

**commit**：faf7d1d

### （续）续记：归档迁到知识库顶层 dsh-sessions，业务域按 projects/work 动态划分

**改动文件**：
- `skills/obsidian-inbox/config.json - 修改, 新增 archiveDir（顶层归档区）与 companyDomainSource；work 路由改为捕获组动态落位 work/{1}，补全各业务域说明`
- `skills/obsidian-inbox/scripts/lib.mjs - 修改, routeDir 支持 {n} 捕获组、新增 companyDomains()（实时读 projects/work）与 assertKnownCompanyDomain()、assertNoteDir 提示改为业务域清单`
- `skills/obsidian-inbox/scripts/note.mjs - 修改, route 输出目录含义/业务域清单/容器告警`
- `skills/obsidian-inbox/scripts/sediment.mjs - 修改, 归档路径改为顶层 archiveDir，领域写进 frontmatter 的 domain 字段与 callout`

**commit**：c68159f

### （续）续记：域不确定时改为主动询问用户；无人值守归档打「待归类」标记

**改动文件**：
- `skills/obsidian-inbox/SKILL.md - 修改, 新增「拿不准就问，不要猜」小节（含 ask_user_question 用法与待归类标签说明）`
- `skills/obsidian-inbox/scripts/sediment.mjs - 修改, 域只落到容器根时写 unclassified: true 与 dsh/待归类 标签，callout 标注待归类`
- `skills/obsidian-inbox/scripts/lib.mjs - 修改, buildFrontmatter 支持布尔值（此前被引号包成字符串，Obsidian 属性变文本）`

**commit**：2910b94

### （续）续记：把「拿不准就问」从 work 扩展到所有落位决策，新建分类目录需用户确认（--mkdir）

**改动文件**：
- `skills/obsidian-inbox/scripts/lib.mjs - 修改, 新增 assertDirReady()：落位目录必须已存在，或显式 --mkdir；work/<已知业务域> 例外放行`
- `skills/obsidian-inbox/scripts/note.mjs - 修改, new 接入 assertDirReady、route 输出了目录是否存在与「需 --mkdir」告警、用法补充该参数`
- `skills/obsidian-inbox/SKILL.md - 修改, 「拿不准就问，不许乱放」改为通用规则（三种必须问的情形 + 候选问法 + 四类代码拦截表）`

**commit**：13676b4

### （续）续记：为下载的调研源码补路由（agentscope-java → work/arch），并支持 --min-chars 放宽归档门槛

**改动文件**：
- `skills/obsidian-inbox/config.json - 修改, 新增 projects/opensource/agentscope-java → work/arch 路由（置于通用 opensource 规则之前），work/arch 说明补充调研类归属`
- `skills/obsidian-inbox/scripts/sediment.mjs - 修改, 新增 --min-chars 覆盖有效内容量门槛`
- `skills/obsidian-inbox/SKILL.md - 修改, 路由说明补充"下载源码归属跟随调研主题"与 --min-chars 用法及门槛口径说明`

**commit**：e2760b0

### （续）续记：新增 opensource 第三容器（第三方开源项目既非工作也非个人），普通化分类清单配置

**改动文件**：
- `skills/obsidian-inbox/config.json - 修改, domainRoots 增加 opensource；companyDomainSource 泛化为 catalogSources{work,opensource}；新增 opensource 路由（捕获仓库名）与 agentscope-java → work/arch 例外；domainNotes 补 opensource 各仓库说明`
- `skills/obsidian-inbox/scripts/lib.mjs - 修改, companyDomains 泛化为 catalogEntries(cfg,domain)、unknown 校验与放行规则随之通用化；容器报错提示改为按容器列既定分类`
- `skills/obsidian-inbox/scripts/note.mjs - 修改, route 输出改为通用 catalogEntries`
- `skills/obsidian-inbox/SKILL.md - 修改, 目录约定改为三容器结构 + cwd 路由表 + 例外说明`

**commit**：c8e0a06

### （续）续记：为归档区加自动索引页，回填 5 篇缺失的 domain

**改动文件**：
- `skills/obsidian-inbox/scripts/sediment.mjs - 修改, 新增 buildArchiveIndex()/writeArchiveIndex()：每次归档后重建 dsh-sessions/索引.md（日期/领域/链接/会话 id + 领域分布统计），并新增 --reindex 只重建索引`
- `skills/obsidian-inbox/SKILL.md - 修改, 说明索引页与 --reindex，明确归档区不是索引/成品区`

**commit**：69eeb8f

### （续）续记：补上「提炼」环节（归档 → 主题笔记）并首次全量执行

**改动文件**：
- `skills/obsidian-inbox/scripts/lib.mjs - 修改, 新增 markDistilled()：把 distilled/distilled_into/distilled_note/distilled_at 写进归档 frontmatter，幂等且只动 frontmatter`
- `skills/obsidian-inbox/scripts/note.mjs - 修改, 新增 distill 子命令（--path/--into/--note）`
- `skills/obsidian-inbox/scripts/sediment.mjs - 修改, 索引页新增「提炼」列与已提炼/待提炼统计`
- `skills/obsidian-inbox/SKILL.md - 修改, 新增 D 节「提炼：把归档变成主题笔记」（三种归宿 + 命令 + 可删条件）`

**commit**：e0c2139

### （续）续记：arch 域下新增子项目层级；归档器支持读原始 transcript 兜底，救回老会话

**改动文件**：
- `skills/obsidian-inbox/config.json - 修改, catalogSources 增加 work/arch → projects/work/arch（子项目清单），routes 增加 projects/work/arch/<子项目> → work/arch/{1}，domainNotes 补 work/arch/app`
- `skills/obsidian-inbox/scripts/lib.mjs - 修改, 分类校验升级为嵌套（isKnownNested / assertKnownCatalogEntry 逐级校验），assertDirReady 自动放行嵌套既定分类`
- `skills/obsidian-inbox/scripts/sediment.mjs - 修改, 新增 transcript 兜底：turnOutline 为空或预览过薄时解压 session.jsonl.zstd 抽 user/assistant text 重建摘要（跳过 reasoning）`
- `skills/obsidian-inbox/SKILL.md - 修改, 路由表加子项目层，归档流程说明 transcript 兜底`

**commit**：6d3a3a3

### （续）续记：修复 transcript 兜底只认 session.jsonl.zstd 的缺陷；为内部业务平台笔记补回原始 SQL

**改动文件**：
- `skills/obsidian-inbox/scripts/sediment.mjs - 修改, findTranscript 改为匹配目录内所有 *.jsonl.zstd 并按 mtime 取最新（修复带版本号 session.v3/v4.jsonl.zstd 认不出的缺陷）`

**commit**：80e67d3

### （续）续记：修复代码块被截断丢失的管道缺陷，并回源补全 8 篇历史归档缺失的代码块

**改动文件**：
- `skills/obsidian-inbox/scripts/sediment.mjs - 修改, transcriptDigest 代码围栏整段保留不截断（clipSmart）、turnOutline 摘要围栏不成对时自动回退 transcript、LLM 提示词新增第 8 条代码块必须逐字完整保留`
- `skills/obsidian-inbox/SKILL.md - 修改, 归档流程补代码块保留规则与踩坑说明`

**commit**：4fa1268

### （续）续记：归档支持 --force 整篇覆盖重写；修复 dev-log 空壳归档并回源核 transcript

**改动文件**：
- `skills/obsidian-inbox/scripts/sediment.mjs - 修改, writeNote：--force 时整篇覆盖重写（原来文件存在就无条件追加，force 也留下旧内容）`
- `skills/obsidian-inbox/SKILL.md - 修改, 补充 --force=整篇覆盖重写语义`

**commit**：4aada30

### （续）续记：文档一致性整理——SKILL.md 修正重复 D 标题、全局 AGENTS.md 与方案文档同步当前实现

**改动文件**：
- `skills/obsidian-inbox/SKILL.md - 修改, 修正第二个 ## D. 为 ## E.（边界），归档流程第 5 步 --force 说明括号错位清理`
- `知识库 dawn/知识库/DSH 会话知识自动沉淀到 Obsidian 的方案.md - 重写, 同步当前实现（work/arch/<子项目> 嵌套、transcript 兜底、代码块整段保留、--force 覆盖、提炼三归宿、DEVELOPMENT_LOG 续记数 6→13），移除过时历史代码转储`
- `全局 ~/.dsh/AGENTS.md - 修改, 落位规则补 work/arch/<子项目> 嵌套，会话归档段补提炼循环（三种归宿）`

**commit**：3694770

### （续）续记：补全段结构规范化与围栏感知复核（知识库内容，仓库无代码改动）

**改动文件**：
- `知识库 Obsidian Vault（不在本仓库）- 修改, work/arch/app/内部业务系统接口与提交查询.md 整篇重写（多轮补 SQL 把精炼 SQL 弄到代码块补全标题下，重写为干净的精炼版并吸收独有内容、删迭代重复转储）；work/arch/app/上线监控报错排查.md 补全块重编号 1-14（两轮补全各自从 1 编号）；其余 4 篇（DSH 预设/AgentScope/Jar/输入法）经围栏感知复核确认结构正常`

**commit**：2f27032

### （续）续记：dawn 容器按项目分目录（dawn/<项目> 镜像 projects/dawn），dawn/知识库不再堆项目知识

**改动文件**：
- `skills/obsidian-inbox/config.json - 修改, routes 增加 projects/dawn/<项目> → dawn/{1}（置于容器兜底之前），domainNotes 补 dawn/dawn-skills 并改写 dawn/知识库 说明`
- `skills/obsidian-inbox/SKILL.md - 修改, 目录约定加项目目录概念（dawn/<项目> 镜像 projects/dawn）与 dawn/dawn-skills 行，路由表拆分 projects/dawn/<项目> 与容器兜底`
- `全局 ~/.dsh/AGENTS.md - 修改, 落位规则补 dawn 下一级=主题目录或项目目录`

**commit**：f81d790

### （续）续记：修复 sediment 三个隐患（import 误触全量、force 丢提炼标记、运行无留痕）；审计定位到一次无法归因的运行

**改动文件**：
- `skills/obsidian-inbox/scripts/sediment.mjs - 修改, ①主流程包进 main() + isMain 守卫（被 import 只加载定义不执行，此前误 import 触发过全量归档）`
- `②writeNote force 覆写时保留 distilled_* 提炼标记与既有 H1 标题（防止重写即丢/标题漂移）`
- `③真实运行前写 [run] pid/cwd/argv/window 留痕到 sediment.log（--reindex 不留）`
- `skills/obsidian-inbox/SKILL.md - 修改, 归档流程补 force 保留语义、[run] 留痕与 import 守卫说明`

**commit**：83ad456

### （续）续记：修复并发竞态与"重写即丢"状态家族（互斥锁、distill domain 校准、force 保留 domain、markDistilled 空参不抹旧值）

**改动文件**：
- `scripts/lib.mjs - 修改, 新增 acquireLock/release（STATE_DIR/sediment.lock，stale 30min 接管、waitMs 可配）；markDistilled 空 into/note 时保留旧值`
- `scripts/sediment.mjs - 修改, main() 开头接互斥锁（等60s 失败退出1、SIGINT/SIGTERM 退出前释放）；writeNote force 覆写追加保留已校准 domain`
- `scripts/note.mjs - 修改, cmdDistill 接锁（waitMs=0 拿不到立即失败）+ 自动校准 domain（domain = 提炼目标所在目录，输出校准前后）`
- `skills/obsidian-inbox/SKILL.md - 修改, 归档节补互斥锁说明，提炼节补 domain 自动校准与 force 保留语义`

**commit**：4ef391c


### （续）续记：为 dawn 容器接入 projects/dawn 项目清单校验（catalogSources 加 dawn），主题目录以 domainNotes 豁免不误伤

**改动文件**：
- `skills/obsidian-inbox/scripts/lib.mjs - 修改, 新增 themeDirs 辅助函数；assertKnownCatalogEntry 对 domainNotes 登记的主题目录放行、报错清单合并主题目录；assertNoteDir 容器根提示合并主题目录`
- `skills/obsidian-inbox/config.json - 修改, catalogSources 新增 dawn → ~/Documents/projects/dawn`
- `skills/obsidian-inbox/SKILL.md - 修改, 代码会拦截段补 dawn 目录校验规则与 domainNotes 豁免说明`

**commit**：c7dd91f

### （续）续记：修复 dev-log 两处缺陷——add --continue 静默丢弃可选参数、link 在多段会话上挂错段

**改动文件**：
- `skills/dev-log/scripts/dev-log.mjs - 修改, add --continue 补齐 --theme/--summary/--issues/--commit 写入（原先只拼标题+改动文件、参数静默丢弃）；link 改为按 ### 切段、默认挂 Session 内最新一段，新增 --section 按标题片段唯一匹配回填历史段；HELP 与头部注释同步`
- `skills/dev-log/SKILL.md - 修改, 记录流程补「续记参数同样生效」与 link 三种用法/唯一匹配约束`

**变更摘要**：
缺陷一：cmdAdd 的 --continue 分支只拼「标题 + 改动文件」，传 --summary/--issues/--commit/--theme 会被静默丢弃（本会话实录：一条续记的变更摘要没进日志），现与新建模式同构补齐这些字段。缺陷二：cmdLink 假设「一条 Session 只有一个 commit」，在 Session 正文里找第一条 commit 行并替换，多段会话（如 Session #2 有 19 段）会误改最老的段——实测会把 3e6e8f8 覆盖掉；现按 ### 标题切段，默认挂最新一段，新增 --section 唯一匹配指定段（回填历史用），0 段或 ≥2 段报错并列出候选。

**遇到的问题**：
- 9 项临时副本测试全过：续记含摘要/问题/commit、默认挂最新段不动旧段、--section 精确替换、Session #1 单段回归、新建条目回归、index、--section 0 段与 13 段均报错退出1
- 此前为 20 个历史段手工插入 commit 行属临时手段，脚本修好后不再需要

**commit**：1e6caf4



### （续）续记：check 后修复 5 个问题——dry-run 假实现（note）、dry-run 写账本（sediment）、dawn --mkdir 回归、show 不带正文、归档区可手写

**改动文件**：
- `scripts/note.mjs - 修改, 实现 --dry-run（new 含 --append 分支、append：只校验输出 planned 不落盘）；show --json 增加 body 正文字段；new 拦截写入归档区`
- `scripts/sediment.mjs - 修改, dry-run 不再写账本（state.runs+saveState 加 !dryRun 守卫）`
- `scripts/lib.mjs - 修改, assertNoteDir 引入 strictCatalog 门控：仅 work/opensource 做"必须对应真实目录"硬校验，dawn 走软校验（已知目录放行、新主题需 --mkdir）`
- `config.json - 修改, 新增 strictCatalog: [work, opensource]`
- `SKILL.md - 修改, 补 --dry-run 用法、7 类落点拦截表、严格/软校验说明`

### （续）续记：新增 recover 命令（代码块回源补全）并把 transcript 工具函数收敛到 lib；sediment JSON 拆出 rewritten 字段

**改动文件**：
- `scripts/lib.mjs - 修改, 新增 DSH_SESSIONS_ROOT/findTranscript/transcriptCodeBlocks（共享给两个脚本，消除重复实现）`
- `scripts/sediment.mjs - 修改, 删除本地 findTranscript 改用 lib 版；result 新增 rewritten 数组并在 JSON/账本 runs 中独立输出（原先把 rewritten 混进 appended）`
- `scripts/note.mjs - 修改, 新增 recover 子命令（--session/--into/--min-len/--limit/--dry-run）：解压 transcript 抽正文代码块、与目标笔记比对、缺失的追加到固定小节「代码块回补」，带锁与 dry-run`
- `SKILL.md - 修改, D 节补 recover 用法与"精炼过的笔记会被判缺失"的注意事项`

### （续）补记：recover 与 --dry-run 补进 note.mjs 的 USAGE 输出（此前只改了文件头注释）

**改动文件**：
- `scripts/note.mjs - 修改, USAGE 常量补 recover 行与 new/append 的 --dry-run`
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

**commit**：dfacc19

---
