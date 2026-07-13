# dawn-skills 
> 基于Wan的AI Agent Skills —— 让你的 AI Agent 轻松调用 Wan 的 AIGC 能力。 
---
## 🌟 核心能力
**dawn-skills** 是一组面向 AI Agent 的技能包（Skills），通过调用API接口的方式赋予 AI Agent 相关 AIGC 能力。

**技能列表**

| 技能 | 描述 | 脚本 | 参考 |
|------|------|------|------|
| **wan2.7-video-skill** | 基于wan2.7视频生成模型，支持文生视频、图生视频和视频续写 | `video_generation.py` `check_video_task_status.py` `file_to_oss.py` | `common.md` `video-generation.md` `prompt-guide.md` |
| **dev-log** | 开发日志记录，跟踪 AI 辅助开发的会话改动并写入 DEVELOPMENT_LOG.md | - | - |
| **db-sync** | 在数据库之间同步表数据，读取 DataGrip 配置自动发现数据源 | `db-sync.sh` | - |

将持续更新多种技能到技能列表。

---

## 🚀 快速开始

### Step 1: 获取 API Key

**前提条件：** 需要阿里云账号

1. **注册阿里云账号**
   - 访问 https://www.aliyun.com/
   - 完成账号注册和实名认证

2. **开通百炼服务**
   - 访问 https://bailian.console.aliyun.com/
   - 开通百炼服务

3. **创建 API Key**
   - 进入百炼控制台 → API-KEY管理
   - 创建新的 API Key

### Step 2: 配置环境变量

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

### Step 3: 安装

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
    │   └── SKILL.md                            # 技能描述文件
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
