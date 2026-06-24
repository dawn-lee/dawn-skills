# Common Configuration (通用配置)

本文档包含所有 Skill 共享的基础配置和环境变量。

---

## Quick Setup (快速配置)

### Step 1: 获取 API Key

**前提条件:** 需要阿里云账号

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

**Region Selection (地域选择):**

```bash
# 中国大陆（北京）- 默认
export DASHSCOPE_BASE_URL="https://dashscope.aliyuncs.com/api/v1/"

# 新加坡（取消注释使用）
# export DASHSCOPE_BASE_URL="https://dashscope-intl.aliyuncs.com/api/v1/"
```

**API Key 配置:**

```bash
# Linux/macOS
export DASHSCOPE_API_KEY="sk-xxxxxxxxxxxxxxxx"

# Windows PowerShell
$env:DASHSCOPE_API_KEY="sk-xxxxxxxxxxxxxxxx"

# Windows CMD
set DASHSCOPE_API_KEY=sk-xxxxxxxxxxxxxxxx
```

---

## Important Notes (重要说明)

1. **地域一致性**: 确保模型、Endpoint URL 和 API Key 均属于同一地域，跨地域调用将会失败。

2. **API Key 安全**: 不要在代码中硬编码 API Key，始终使用环境变量。

3. **计费说明**: 视频生成按秒计费，`duration` 参数直接影响费用。请在调用前确认模型价格。

---

## Related Documents

- 📖 [SKILL.md](../SKILL.md) - 整体工作流和技能列表
- 📖 [video-generation.md](video-generation.md) - 文生视频/图生视频的细节和例子的说明文档
- 📦 [file_to_oss.py](../scripts/file_to_oss.py) - 本地文件上传脚本
- 📦 [video_generation.py](../scripts/video_generation.py) - 视频生成主脚本
- 📦 [check_video_task_status.py](../scripts/check_video_task_status.py) - 异步任务状态查询脚本