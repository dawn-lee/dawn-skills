# dawn-skills 
> 面向 AI Agent 的技能包（Skills）集合 -- 涵盖视频生成、开发日志、数据同步等能力。 
---
## 🌟 核心能力

**dawn-skills** 是一组面向 AI Agent 的技能包（Skills），通过调用脚本或 API 接口的方式赋予 AI Agent 视频生成、开发日志记录、数据同步等能力。

**技能列表**

| 技能 | 描述 | 脚本 | 参考 |
|------|------|------|------|
| **wan2.7-video-skill** | 基于wan2.7视频生成模型，支持文生视频、图生视频和视频续写 | `video_generation.py` `check_video_task_status.py` `file_to_oss.py` | `common.md` `video-generation.md` `prompt-guide.md` |
| **dev-log** | 开发日志记录：读写双通道，写入靠 git 真值 + 脚本编号，读取靠头部主题索引，把 DEVELOPMENT_LOG.md 变成 LLM 可追溯的项目记忆库 | `dev-log.mjs` | - |
| **db-sync** | 在数据库之间同步表数据，读取 DataGrip 配置自动发现数据源 | `db-sync.sh` | - |
| **obsidian-inbox** | Obsidian 知识库沉淀：把会话中可复用的知识写进笔记库（自动 frontmatter、按 cwd 路由、写前查重），并提供检索通道；另含每日定时归档，把当天会话精炼成笔记落库 | `note.mjs` `sediment.mjs` | - |

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

> 安装 **dev-log** 或 **db-sync** 时，将上述命令/路径中的 `wan2.7-video-skill` 替换为对应技能名即可，二者无需 API Key。

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
export DASHSCOPE_API_KEY="your-access-key"
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
    ├── db-sync                                 # 数据库表同步技能
    │   └── scripts
    │       └── db-sync.sh                      # 同步脚本
    ├── dev-log                                 # 开发日志记录技能
    │   ├── SKILL.md                            # 技能描述文件
    │   └── scripts
    │       └── dev-log.mjs                     # 读写脚本（snapshot/add/index/link/query）
    ├── obsidian-inbox                          # Obsidian 知识库沉淀技能
    │   ├── SKILL.md                            # 技能描述文件（读写通道 + 定时归档说明）
    │   ├── config.json                         # 知识库路径、目录路由、摘要预算
    │   ├── run-sediment.sh                     # 定时任务入口（解析 node/nvm 后执行归档）
    │   ├── patch
    │   │   └── headless-notes-only.yml         # 归档运行时最小权限补丁（禁用全部工具）
    │   └── scripts
    │       ├── lib.mjs                         # 路由/frontmatter/原子写/检索
    │       ├── note.mjs                        # 写/查通道（new/append/search/show/route）
    │       └── sediment.mjs                    # 每日归档（会话 → 笔记）
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
