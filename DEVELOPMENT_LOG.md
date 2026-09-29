# Development Log

AI-assisted development change history.

> **用法（给 AI）**：排查改动历史前先读下方「索引」，按主题定位 Session 再跳读；需要精确 diff 时用条目 `commit` 行执行 `git show <hash>`。
> 说明：索引由 `dev-log index` 维护；条目编号/内容请勿手改。同号多条并列以 `#N×次数` 标注。

## 索引（脚本生成）
- 跨平台: #3×4
- 知识库: #2×26, #3×4
- dev-log: #1×27
- obsidian-inbox: #2×26, #3×4
- skill 开发: #1×27, #2×26, #3×4

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
技能代码层本就零依赖、已用 homedir()/XDG，真正的移植障碍在配置与调度：config.json 全是 ~ 绝对路径且被 git 跟踪推送，目录体系（dawn/work/opensource + 业务域）是本机私有，定时归档是 systemd-only 且 unit 不在仓库里，补丁绑定本机 provider/密钥。本次把三块都拆开：① 配置与代码分离——config.json 移出版本库（git rm --cached + gitignore），新增 config.example.json；配置查找顺序为 OBSIDIAN_INBOX_CONFIG → 技能目录 config.json → XDG，缺失时报错直接给出 init 命令；所有路径用 ${HOME} 占位，路由正则只对替换进去的家目录做正则转义（保留用户写的捕获组）。② 新增 init.mjs——探测含 .obsidian 的知识库与 ~/Documents/projects 下的容器，生成配置并建好容器/默认目录；simple 预设（notes/ 自由分层）与 projects 预设（镜像 <projectsRoot>/<容器>/<项目>，自动生成 domainRoots/catalogSources/strictCatalog/routes），本机现有三容器语义可用 --preset projects --soft dawn --default-dir dawn 完整复现。③ 新增 install.mjs——软链（Windows 无权限时 --copy 复制）接入 ~/.agents/skills，配置缺失时自动跑 init（透传 --preset/--vault/--projects-root），按平台注册调度：systemd user timer、launchd LaunchAgent、Windows 计划任务 XML，并把 node 绝对路径与 DSH_BIN 写进 unit/plist（非登录环境 PATH 极简）；无 systemd 的 Linux 打印 cron 行不擅自改 crontab；另有 --status 自检与 --uninstall。安全侧保持：归档仍走 no-tools 补丁，补丁可被 llm.patch 覆盖，缺失时显式告警。已在临时目录端到端验证：新机 init（simple/projects 两预设）、${HOME} 占位展开、严格容器拦截、容器根拦截、缺配置提示、复制安装自带配置可独立运行；本机 systemd unit 已由新模板重写并通过 systemd-analyze verify、is-enabled/is-active 与最小环境 dry-run。

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
**commit**：acb33c6

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

**commit**：4867875

---

### （续）续记：修复归档笔记引用路径错误，并防止 Obsidian 因死链凭空建出嵌套空文件

**改动文件**：
- `skills/obsidian-inbox/scripts/lib.mjs - 修改, 新增 toVaultRel/safeDecode 路径解析防护、listNoteIndex 笔记清单、sanitizeBodyLinks 链接降级；vaultAbs/routeDir 拒绝库外绝对路径`
- `skills/obsidian-inbox/scripts/sediment.mjs - 修改, 摘要附「知识库现有笔记」清单、引用规范写进 prompt、写入前统一 sanitizeBodyLinks`
- `skills/obsidian-inbox/SKILL.md - 修改, 新增「引用与链接规范」小节与自动兜底说明`

**commit**：607dddd

### （续）续记：按用户定义的知识库目录语义细化路由，并禁止把笔记直接写进领域容器根

**改动文件**：
- `skills/obsidian-inbox/config.json - 修改, 新增 domainRoots/domainNotes 语义表，细化路由（work/arch 单独映射、opensource/forks → dawn），删除被覆盖的死规则`
- `skills/obsidian-inbox/scripts/lib.mjs - 修改, 新增 assertNoteDir（领域容器根拦截）与 listSubdirs，loadConfig 解析 domainRoots/domainNotes`
- `skills/obsidian-inbox/scripts/note.mjs - 修改, new 校验落点、route 输目录含义与容器告警、stdout EPIPE 兜底`
- `skills/obsidian-inbox/scripts/sediment.mjs - 修改, stdout EPIPE 兜底`
- `skills/obsidian-inbox/SKILL.md - 修改, 新增「目录约定」小节（dawn/work 为容器 + 各子目录含义 + 判定顺序）`

**commit**：d89113b

### （续）续记：归档迁到知识库顶层 dsh-sessions，业务域按 projects/work 动态划分

**改动文件**：
- `skills/obsidian-inbox/config.json - 修改, 新增 archiveDir（顶层归档区）与 companyDomainSource；work 路由改为捕获组动态落位 work/{1}，补全各业务域说明`
- `skills/obsidian-inbox/scripts/lib.mjs - 修改, routeDir 支持 {n} 捕获组、新增 companyDomains()（实时读 projects/work）与 assertKnownCompanyDomain()、assertNoteDir 提示改为业务域清单`
- `skills/obsidian-inbox/scripts/note.mjs - 修改, route 输出目录含义/业务域清单/容器告警`
- `skills/obsidian-inbox/scripts/sediment.mjs - 修改, 归档路径改为顶层 archiveDir，领域写进 frontmatter 的 domain 字段与 callout`

**commit**：01eb117

### （续）续记：域不确定时改为主动询问用户；无人值守归档打「待归类」标记

**改动文件**：
- `skills/obsidian-inbox/SKILL.md - 修改, 新增「拿不准就问，不要猜」小节（含 ask_user_question 用法与待归类标签说明）`
- `skills/obsidian-inbox/scripts/sediment.mjs - 修改, 域只落到容器根时写 unclassified: true 与 dsh/待归类 标签，callout 标注待归类`
- `skills/obsidian-inbox/scripts/lib.mjs - 修改, buildFrontmatter 支持布尔值（此前被引号包成字符串，Obsidian 属性变文本）`

**commit**：b9d601a

### （续）续记：把「拿不准就问」从 work 扩展到所有落位决策，新建分类目录需用户确认（--mkdir）

**改动文件**：
- `skills/obsidian-inbox/scripts/lib.mjs - 修改, 新增 assertDirReady()：落位目录必须已存在，或显式 --mkdir；work/<已知业务域> 例外放行`
- `skills/obsidian-inbox/scripts/note.mjs - 修改, new 接入 assertDirReady、route 输出了目录是否存在与「需 --mkdir」告警、用法补充该参数`
- `skills/obsidian-inbox/SKILL.md - 修改, 「拿不准就问，不许乱放」改为通用规则（三种必须问的情形 + 候选问法 + 四类代码拦截表）`

**commit**：0cf2d01

### （续）续记：为下载的调研源码补路由（agentscope-java → work/arch），并支持 --min-chars 放宽归档门槛

**改动文件**：
- `skills/obsidian-inbox/config.json - 修改, 新增 projects/opensource/agentscope-java → work/arch 路由（置于通用 opensource 规则之前），work/arch 说明补充调研类归属`
- `skills/obsidian-inbox/scripts/sediment.mjs - 修改, 新增 --min-chars 覆盖有效内容量门槛`
- `skills/obsidian-inbox/SKILL.md - 修改, 路由说明补充"下载源码归属跟随调研主题"与 --min-chars 用法及门槛口径说明`

**commit**：a6e8aeb

### （续）续记：新增 opensource 第三容器（第三方开源项目既非工作也非个人），普通化分类清单配置

**改动文件**：
- `skills/obsidian-inbox/config.json - 修改, domainRoots 增加 opensource；companyDomainSource 泛化为 catalogSources{work,opensource}；新增 opensource 路由（捕获仓库名）与 agentscope-java → work/arch 例外；domainNotes 补 opensource 各仓库说明`
- `skills/obsidian-inbox/scripts/lib.mjs - 修改, companyDomains 泛化为 catalogEntries(cfg,domain)、unknown 校验与放行规则随之通用化；容器报错提示改为按容器列既定分类`
- `skills/obsidian-inbox/scripts/note.mjs - 修改, route 输出改为通用 catalogEntries`
- `skills/obsidian-inbox/SKILL.md - 修改, 目录约定改为三容器结构 + cwd 路由表 + 例外说明`

**commit**：dd1d3a4

### （续）续记：为归档区加自动索引页，回填 5 篇缺失的 domain

**改动文件**：
- `skills/obsidian-inbox/scripts/sediment.mjs - 修改, 新增 buildArchiveIndex()/writeArchiveIndex()：每次归档后重建 dsh-sessions/索引.md（日期/领域/链接/会话 id + 领域分布统计），并新增 --reindex 只重建索引`
- `skills/obsidian-inbox/SKILL.md - 修改, 说明索引页与 --reindex，明确归档区不是索引/成品区`

**commit**：8770089

### （续）续记：补上「提炼」环节（归档 → 主题笔记）并首次全量执行

**改动文件**：
- `skills/obsidian-inbox/scripts/lib.mjs - 修改, 新增 markDistilled()：把 distilled/distilled_into/distilled_note/distilled_at 写进归档 frontmatter，幂等且只动 frontmatter`
- `skills/obsidian-inbox/scripts/note.mjs - 修改, 新增 distill 子命令（--path/--into/--note）`
- `skills/obsidian-inbox/scripts/sediment.mjs - 修改, 索引页新增「提炼」列与已提炼/待提炼统计`
- `skills/obsidian-inbox/SKILL.md - 修改, 新增 D 节「提炼：把归档变成主题笔记」（三种归宿 + 命令 + 可删条件）`

**commit**：e8a06e8

### （续）续记：arch 域下新增子项目层级；归档器支持读原始 transcript 兜底，救回老会话

**改动文件**：
- `skills/obsidian-inbox/config.json - 修改, catalogSources 增加 work/arch → projects/work/arch（子项目清单），routes 增加 projects/work/arch/<子项目> → work/arch/{1}，domainNotes 补 work/arch/app`
- `skills/obsidian-inbox/scripts/lib.mjs - 修改, 分类校验升级为嵌套（isKnownNested / assertKnownCatalogEntry 逐级校验），assertDirReady 自动放行嵌套既定分类`
- `skills/obsidian-inbox/scripts/sediment.mjs - 修改, 新增 transcript 兜底：turnOutline 为空或预览过薄时解压 session.jsonl.zstd 抽 user/assistant text 重建摘要（跳过 reasoning）`
- `skills/obsidian-inbox/SKILL.md - 修改, 路由表加子项目层，归档流程说明 transcript 兜底`

**commit**：bff3459

### （续）续记：修复 transcript 兜底只认 session.jsonl.zstd 的缺陷；为内部业务平台笔记补回原始 SQL

**改动文件**：
- `skills/obsidian-inbox/scripts/sediment.mjs - 修改, findTranscript 改为匹配目录内所有 *.jsonl.zstd 并按 mtime 取最新（修复带版本号 session.v3/v4.jsonl.zstd 认不出的缺陷）`

**commit**：a840566

### （续）续记：修复代码块被截断丢失的管道缺陷，并回源补全 8 篇历史归档缺失的代码块

**改动文件**：
- `skills/obsidian-inbox/scripts/sediment.mjs - 修改, transcriptDigest 代码围栏整段保留不截断（clipSmart）、turnOutline 摘要围栏不成对时自动回退 transcript、LLM 提示词新增第 8 条代码块必须逐字完整保留`
- `skills/obsidian-inbox/SKILL.md - 修改, 归档流程补代码块保留规则与踩坑说明`

**commit**：a0e5f86

### （续）续记：归档支持 --force 整篇覆盖重写；修复 dev-log 空壳归档并回源核 transcript

**改动文件**：
- `skills/obsidian-inbox/scripts/sediment.mjs - 修改, writeNote：--force 时整篇覆盖重写（原来文件存在就无条件追加，force 也留下旧内容）`
- `skills/obsidian-inbox/SKILL.md - 修改, 补充 --force=整篇覆盖重写语义`

**commit**：9ba13a9

### （续）续记：文档一致性整理——SKILL.md 修正重复 D 标题、全局 AGENTS.md 与方案文档同步当前实现

**改动文件**：
- `skills/obsidian-inbox/SKILL.md - 修改, 修正第二个 ## D. 为 ## E.（边界），归档流程第 5 步 --force 说明括号错位清理`
- `知识库 dawn/知识库/DSH 会话知识自动沉淀到 Obsidian 的方案.md - 重写, 同步当前实现（work/arch/<子项目> 嵌套、transcript 兜底、代码块整段保留、--force 覆盖、提炼三归宿、DEVELOPMENT_LOG 续记数 6→13），移除过时历史代码转储`
- `全局 ~/.dsh/AGENTS.md - 修改, 落位规则补 work/arch/<子项目> 嵌套，会话归档段补提炼循环（三种归宿）`

**commit**：520f3c4

### （续）续记：补全段结构规范化与围栏感知复核（知识库内容，仓库无代码改动）

**改动文件**：
- `知识库 Obsidian Vault（不在本仓库）- 修改, work/arch/app/内部业务系统接口与提交查询.md 整篇重写（多轮补 SQL 把精炼 SQL 弄到代码块补全标题下，重写为干净的精炼版并吸收独有内容、删迭代重复转储）；work/arch/app/上线监控报错排查.md 补全块重编号 1-14（两轮补全各自从 1 编号）；其余 4 篇（DSH 预设/AgentScope/Jar/输入法）经围栏感知复核确认结构正常`

**commit**：f966f82

### （续）续记：dawn 容器按项目分目录（dawn/<项目> 镜像 projects/dawn），dawn/知识库不再堆项目知识

**改动文件**：
- `skills/obsidian-inbox/config.json - 修改, routes 增加 projects/dawn/<项目> → dawn/{1}（置于容器兜底之前），domainNotes 补 dawn/dawn-skills 并改写 dawn/知识库 说明`
- `skills/obsidian-inbox/SKILL.md - 修改, 目录约定加项目目录概念（dawn/<项目> 镜像 projects/dawn）与 dawn/dawn-skills 行，路由表拆分 projects/dawn/<项目> 与容器兜底`
- `全局 ~/.dsh/AGENTS.md - 修改, 落位规则补 dawn 下一级=主题目录或项目目录`

**commit**：3cead37

### （续）续记：修复 sediment 三个隐患（import 误触全量、force 丢提炼标记、运行无留痕）；审计定位到一次无法归因的运行

**改动文件**：
- `skills/obsidian-inbox/scripts/sediment.mjs - 修改, ①主流程包进 main() + isMain 守卫（被 import 只加载定义不执行，此前误 import 触发过全量归档）`
- `②writeNote force 覆写时保留 distilled_* 提炼标记与既有 H1 标题（防止重写即丢/标题漂移）`
- `③真实运行前写 [run] pid/cwd/argv/window 留痕到 sediment.log（--reindex 不留）`
- `skills/obsidian-inbox/SKILL.md - 修改, 归档流程补 force 保留语义、[run] 留痕与 import 守卫说明`

**commit**：48e8783

### （续）续记：修复并发竞态与"重写即丢"状态家族（互斥锁、distill domain 校准、force 保留 domain、markDistilled 空参不抹旧值）

**改动文件**：
- `scripts/lib.mjs - 修改, 新增 acquireLock/release（STATE_DIR/sediment.lock，stale 30min 接管、waitMs 可配）；markDistilled 空 into/note 时保留旧值`
- `scripts/sediment.mjs - 修改, main() 开头接互斥锁（等60s 失败退出1、SIGINT/SIGTERM 退出前释放）；writeNote force 覆写追加保留已校准 domain`
- `scripts/note.mjs - 修改, cmdDistill 接锁（waitMs=0 拿不到立即失败）+ 自动校准 domain（domain = 提炼目标所在目录，输出校准前后）`
- `skills/obsidian-inbox/SKILL.md - 修改, 归档节补互斥锁说明，提炼节补 domain 自动校准与 force 保留语义`

**commit**：5ce40cb


### （续）续记：为 dawn 容器接入 projects/dawn 项目清单校验（catalogSources 加 dawn），主题目录以 domainNotes 豁免不误伤

**改动文件**：
- `skills/obsidian-inbox/scripts/lib.mjs - 修改, 新增 themeDirs 辅助函数；assertKnownCatalogEntry 对 domainNotes 登记的主题目录放行、报错清单合并主题目录；assertNoteDir 容器根提示合并主题目录`
- `skills/obsidian-inbox/config.json - 修改, catalogSources 新增 dawn → ~/Documents/projects/dawn`
- `skills/obsidian-inbox/SKILL.md - 修改, 代码会拦截段补 dawn 目录校验规则与 domainNotes 豁免说明`

**commit**：1824bc5

### （续）续记：修复 dev-log 两处缺陷——add --continue 静默丢弃可选参数、link 在多段会话上挂错段

**改动文件**：
- `skills/dev-log/scripts/dev-log.mjs - 修改, add --continue 补齐 --theme/--summary/--issues/--commit 写入（原先只拼标题+改动文件、参数静默丢弃）；link 改为按 ### 切段、默认挂 Session 内最新一段，新增 --section 按标题片段唯一匹配回填历史段；HELP 与头部注释同步`
- `skills/dev-log/SKILL.md - 修改, 记录流程补「续记参数同样生效」与 link 三种用法/唯一匹配约束`

**变更摘要**：
缺陷一：cmdAdd 的 --continue 分支只拼「标题 + 改动文件」，传 --summary/--issues/--commit/--theme 会被静默丢弃（本会话实录：一条续记的变更摘要没进日志），现与新建模式同构补齐这些字段。缺陷二：cmdLink 假设「一条 Session 只有一个 commit」，在 Session 正文里找第一条 commit 行并替换，多段会话（如 Session #2 有 19 段）会误改最老的段——实测会把 4867875 覆盖掉；现按 ### 标题切段，默认挂最新一段，新增 --section 唯一匹配指定段（回填历史用），0 段或 ≥2 段报错并列出候选。

**遇到的问题**：
- 9 项临时副本测试全过：续记含摘要/问题/commit、默认挂最新段不动旧段、--section 精确替换、Session #1 单段回归、新建条目回归、index、--section 0 段与 13 段均报错退出1
- 此前为 20 个历史段手工插入 commit 行属临时手段，脚本修好后不再需要

**commit**：89f526f



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

**commit**：c502879

---
