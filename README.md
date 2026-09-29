# dawn-skills 
> 面向 AI Agent 的技能包（Skills）集合 -- 涵盖视频生成、开发日志、数据同步、网页爬取等能力。 
---
## 🌟 核心能力

**dawn-skills** 是一组面向 AI Agent 的技能包（Skills），通过调用脚本或 API 接口的方式赋予 AI Agent 视频生成、开发日志记录、数据同步、网页爬取与数据提取等能力。

**技能列表**

| 技能 | 描述 | 脚本 | 参考 |
|------|------|------|------|
| **wan2.7-video-skill** | 基于wan2.7视频生成模型，支持文生视频、图生视频和视频续写 | `video_generation.py` `check_video_task_status.py` `file_to_oss.py` | `common.md` `video-generation.md` `prompt-guide.md` |
| **dev-log** | 开发日志记录：读写双通道，写入靠 git 真值 + 脚本编号，读取靠头部主题索引，把 DEVELOPMENT_LOG.md 变成 LLM 可追溯的项目记忆库 | `dev-log.mjs` | - |
| **db-sync** | 在数据库之间同步表数据，读取 DataGrip 配置自动发现数据源 | `db-sync.sh` | - |
| **obsidian-inbox** | Obsidian 知识库沉淀：把会话中可复用的知识写进笔记库（自动 frontmatter、按 cwd 路由、写前查重），并提供检索通道；另含每日定时归档，把当天会话精炼成笔记落库。代码不含机器相关路径，换电脑跑一次 `init.mjs` + `install.mjs` 即可 | `note.mjs` `sediment.mjs` `init.mjs` `install.mjs` | - |
| **crawl4ai** | 网页爬取与数据提取：基于 Crawl4AI，支持 JS 渲染页面、批量并发爬取、Markdown 提取、schema 生成式结构化提取（免 LLM） | `basic_crawler.py` `batch_crawler.py` `extraction_pipeline.py` | `complete-sdk-reference.md` |

将持续更新多种技能到技能列表。

---

## 🚀 快速开始

### 安装技能

以安装 **wan2.7-video-skill** 为例，提供两种安装方式：

**方式一：npx 一键安装（推荐）**

```bash
npx skills add https://github.com/dawn-lee/dawn-skills --skill wan2.7-video-skill
```

**方式二：手动 clone 安装**

clone 本项目：
```bash
git clone https://github.com/dawn-lee/dawn-skills.git
```

在 AI Agent 对话框指定 skill 路径进行安装，其中`/path/to/`是用户本地真实路径地址：

```
安装这个目录下的skill  /path/to/dawn-skills/skills/wan2.7-video-skill
```

> 安装 **dev-log**、**db-sync**、**crawl4ai** 或 **obsidian-inbox** 时，将上述命令/路径中的 `wan2.7-video-skill` 替换为对应技能名即可，均无需 API Key（obsidian-inbox 另需一次本机初始化，见下）。

### 配置 crawl4ai（需要 Python 环境）

**前提条件：** 本机已安装 Python 3.10+

```bash
pip install crawl4ai
# 校验安装
crawl4ai-doctor
# 首次使用前初始化（下载浏览器内核等）
crawl4ai-setup
```

无需配置环境变量或 API Key。若使用 `extraction_pipeline.py` 的 LLM 提取模式，才需要额外配置对应的 LLM Provider Key。

### 配置 obsidian-inbox（需要一次本机初始化）

技能代码本身不含任何机器相关路径，clone 后跑两条命令即可（无需 API Key；归档精炼用你已有的 DSH 模型配置）：

```bash
cd dawn-skills/skills/obsidian-inbox
node scripts/init.mjs            # 探测 Obsidian 知识库，生成 config.json（simple 预设）
node scripts/init.mjs --preset projects   # 或镜像 ~/Documents/projects/<容器>/<项目> 结构
node scripts/install.mjs         # 接入 ~/.agents/skills + 注册每日归档（systemd/launchd/计划任务）
node scripts/install.mjs --status  # 自检
```

- **三平台通用**：`node scripts/…` 这套命令在 Linux / macOS / Windows 都一样跑（多行 `\` 续行在 Windows 写成单行）；
  环境变量写法 PowerShell `$env:NAME=值`、cmd `set NAME=值`。装完建议跑 `node scripts/selftest.mjs` 自检。
- 真实 `config.json` 含本机私有路径，**不入库**；模板见 `config.example.json`，配置里用 `${HOME}` 占位——**任何写死的 `/home/<用户名>` 都不允许**，否则换机器/换人即失效。
- 归档补丁 `patch/headless-notes-only.yml` 里的 provider/密钥/模型是示例，需改成你自己的（或用配置项 `llm.patch` 指定）。
- 其他环境变量（`OBSIDIAN_INBOX_CONFIG` / `OBSIDIAN_INBOX_STATE` / `DSH_HOME` / `DSH_BIN`）见技能内的 `SKILL.md`。

### 配置 wan2.7-video-skill（需要 API Key）

**前提条件：** 需要阿里云账号

1. **注册阿里云账号**
   - 访问 https://www.aliyun.com/
   - 完成账号注册和实名认证

2. **开通百炼服务**
   - 访问 https://bailian.console.aliyun.com/
   - 开通百炼服务

3. **创建 API Key**
   - 进入百炼控制台 -> API-KEY管理
   - 创建新的 API Key

配置环境变量：

```bash
export DASHSCOPE_API_KEY="your-access-key"      # Linux / macOS
```
```powershell
$env:DASHSCOPE_API_KEY="your-access-key"         # Windows PowerShell（cmd 用 set DASHSCOPE_API_KEY=...）
```

**地域选择**

根据所在地域选择合适的`DASHSCOPE_BASE_URL`
```bash
# 中国大陆（北京）- 默认
export DASHSCOPE_BASE_URL="https://dashscope.aliyuncs.com/api/v1/"

# 新加坡（取消注释使用）
# export DASHSCOPE_BASE_URL="https://dashscope-intl.aliyuncs.com/api/v1/"
```

## 📂 项目结构

```
dawn-skills/
├── .gitignore
├── README.md
└── skills
    ├── crawl4ai                                 # 网页爬取与数据提取技能
    │   ├── references
    │   │   └── complete-sdk-reference.md        # 完整 SDK 参考文档
    │   ├── scripts
    │   │   ├── basic_crawler.py                 # 基础爬取（Markdown + 截图）
    │   │   ├── batch_crawler.py                 # 批量 URL 并发爬取
    │   │   └── extraction_pipeline.py           # 数据提取流水线（schema 生成/复用）
    │   ├── tests                                # 测试用例
    │   └── SKILL.md                             # 技能描述文件
    ├── db-sync                                 # 数据库表同步技能
    │   └── scripts
    │       └── db-sync.sh                      # 同步脚本
    ├── dev-log                                 # 开发日志记录技能
    │   ├── SKILL.md                            # 技能描述文件
    │   └── scripts
    │       └── dev-log.mjs                     # 读写脚本（snapshot/add/index/link/query）
    ├── obsidian-inbox                          # Obsidian 知识库沉淀技能
    │   ├── SKILL.md                            # 技能描述文件（安装/配置 + 读写通道 + 定时归档）
    │   ├── config.example.json                 # 配置模板（真实 config.json 已 gitignore，不入库）
    │   ├── run-sediment.sh                     # 手动/cron 入口（自解析 node 后执行归档，Linux/macOS）
    │   ├── run-sediment.cmd                    # 同上，Windows 入口（CRLF，node 不在 PATH 时可指定 OBSIDIAN_INBOX_NODE）
    │   ├── private-lint.example.json            # 私有红线清单模板（真实 private-lint.json 已 gitignore、不入库）
    │   ├── patch
    │   │   └── headless-notes-only.yml         # 归档运行时最小权限补丁（禁用全部工具；模型段为示例）
    │   ├── templates                           # 调度模板（install.mjs 渲染）
    │   │   ├── systemd                         # linux：dsh-sediment.service/.timer
    │   │   ├── launchd                         # macOS：com.dsh.obsidian-inbox.plist
    │   │   └── windows                         # Windows：计划任务 XML
    │   └── scripts
    │       ├── lib.mjs                         # 路由/frontmatter/原子写/检索/配置解析
    │       ├── note.mjs                        # 写/查通道（new/append/search/show/route/distill/recover）
    │       ├── sediment.mjs                    # 每日归档（会话 → 笔记）
    │       ├── init.mjs                        # 生成本机配置（探测知识库/项目目录，支持 simple|projects 预设）
    │       └── selftest.mjs                    # 分发自检：Windows 路径兼容 + 分发红线（写死家目录/硬编码 node 路径）+ 私有清单扫描
    │       └── install.mjs                     # 接入 ~/.agents/skills + 注册三平台调度 + --status 自检
    └── wan2.7-video-skill                      # wan2.7视频生成技能
        ├── references
        │   ├── common.md                       # 通用配置文档
        │   ├── prompt-guide.md                 # 提示词指南
        │   └── video-generation.md             # 详细用法文档
        ├── scripts
        │   ├── check_video_task_status.py       # 异步任务查询脚本
        │   ├── file_to_oss.py                  # 文件上传脚本
        │   └── video_generation.py             # 核心生成脚本
        └── SKILL.md                            # 技能描述文件
```

---

## API 参考文档
[万相-视频生成2.7](https://bailian.console.aliyun.com/cn-beijing?tab=api#/api/?type=model&url=3026980)
