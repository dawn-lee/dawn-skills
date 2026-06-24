# Wan 2.7 Video Generation (视频生成)

## Overview

wan2.7 视频生成模型，支持 **文生视频** 和 **图生视频**。

使用新的 `video-synthesis` 端点（仅支持 wan2.7 模型）。

**Models:**
- `wan2.7-t2v`: 文生视频
- `wan2.7-i2v`: 图生视频

### Core Features

- **文生视频**: 纯文本生成视频，支持多镜头叙事、音频输入、自动配音
- **图生视频**: 基于参考图片生成动态视频
- **多镜头叙事**: 通过 prompt 自然语言控制镜头结构
- **智能改写**: 自动优化短 prompt 的生成效果
- **反向提示词**: 排除不想要的元素

---

## Mode 1: 文生视频 (Text-to-Video)

**用途:** 纯文本生成视频

### 基础示例

```bash
python3 scripts/video_generation.py \
    --mode t2v \
    --prompt "一只小猫在月光下奔跑" \
    --resolution 1080P \
    --ratio 16:9 \
    --duration 5
```

### 多镜头叙事示例

通过 prompt 自然语言控制镜头结构，无需配置 `shot_type` 参数:

```bash
python3 scripts/video_generation.py \
    --mode t2v \
    --prompt "一段紧张刺激的侦探追查故事。第1个镜头[0-3秒] 全景：雨夜的纽约街头，霓虹灯闪烁。第2个镜头[3-6秒] 中景：侦探进入一栋老旧建筑。第3个镜头[6-9秒] 特写：侦探的眼神坚毅专注。" \
    --resolution 720P \
    --ratio 16:9 \
    --duration 9 \
    --no-prompt-extend
```

**要点:**
- 单镜头: 输入"生成单镜头视频"
- 多镜头: 输入"生成多镜头视频" 或使用时间戳描述分镜（如 "第1个镜头[0-3秒] 全景：雨夜的纽约街头"）
- 默认: 未指定时，模型根据 prompt 内容自行理解

### 带音频示例

```bash
python3 scripts/video_generation.py \
    --mode t2v \
    --prompt "一只卡通小猫将军站在悬崖上，骑着战马朗诵古诗" \
    --audio-url "https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20250923/hbiayh/从军行.mp3" \
    --resolution 720P \
    --duration 10
```

**音频限制:**
- 格式: wav, mp3
- 时长: 1~30s
- 文件大小: 不超过 15MB
- 若音频长度超过 `duration` 值，自动截取前 N 秒
- 若音频长度不足，超出部分为无声视频

### 自动配音

不提供 `--audio-url` 时，模型将根据视频内容自动生成匹配的背景音乐或音效。

### 反向提示词示例

```bash
python3 scripts/video_generation.py \
    --mode t2v \
    --prompt "一只小猫在月光下奔跑" \
    --negative-prompt "花朵, 低分辨率, 模糊"
```

### 参数说明

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `--mode` | string | 否 | t2v | 生成模式: t2v 或 i2v |
| `--prompt` | string | 是(t2v) | - | 文本提示词，不超过 5000 字符 |
| `--resolution` | string | 否 | 1080P | 分辨率档位: 720P 或 1080P |
| `--ratio` | string | 否 | 16:9 | 宽高比: 16:9/9:16/1:1/4:3/3:4 |
| `--duration` | int | 否 | 5 | 时长(秒), 范围 [2, 15] |
| `--negative-prompt` | string | 否 | "" | 反向提示词，不超过 500 字符 |
| `--no-prompt-extend` | flag | 否 | 开启 | 关闭 prompt 智能改写 |
| `--watermark` | flag | 否 | 关闭 | 添加"AI生成"水印 |
| `--seed` | int | 否 | 随机 | 随机种子 [0, 2147483647] |
| `--audio-url` | string | 否 | "" | 音频文件 URL |
| `--output-dir` | string | 否 | . | 输出目录 |

### 分辨率与宽高比对照表

| 分辨率档位 | 宽高比 | 输出视频分辨率 (宽*高) |
|-----------|--------|----------------------|
| 720P | 16:9 | 1280*720 |
| 720P | 9:16 | 720*1280 |
| 720P | 1:1 | 960*960 |
| 720P | 4:3 | 1104*832 |
| 720P | 3:4 | 832*1104 |
| 1080P | 16:9 | 1920*1080 |
| 1080P | 9:16 | 1080*1920 |
| 1080P | 1:1 | 1440*1440 |
| 1080P | 4:3 | 1648*1248 |
| 1080P | 3:4 | 1248*1648 |

---

## Mode 2: 图生视频 (Image-to-Video)

**用途:** 基于图片生成视频

**模型:** `wan2.7-i2v-2026-04-25`

### 支持的素材组合

| 组合 | 说明 |
|------|------|
| 首帧 | 基于一张图片生成视频 |
| 首帧 + 音频 | 基于一张图片和音频生成视频（口型同步/动作卡点） |
| 首帧 + 尾帧 | 基于首尾两张图片生成过渡视频 |
| 首帧 + 尾帧 + 音频 | 首尾帧 + 音频驱动 |

### 首帧生视频

```bash
python3 scripts/video_generation.py \
    --mode i2v \
    --first-frame "https://example.com/image.jpg" \
    --prompt "镜头缓慢推进，背景树叶随风飘动" \
    --resolution 720P \
    --duration 5
```

### 首帧 + 音频（音频驱动）

```bash
python3 scripts/video_generation.py \
    --mode i2v \
    --first-frame "https://example.com/character.png" \
    --audio-url "https://example.com/rap.mp3" \
    --prompt "角色随着音乐说唱" \
    --resolution 720P \
    --duration 10
```

### 首尾帧生视频

```bash
python3 scripts/video_generation.py \
    --mode i2v \
    --first-frame "https://example.com/first.png" \
    --last-frame "https://example.com/last.png" \
    --prompt "写实风格，一只小黑猫好奇地仰望天空" \
    --resolution 720P \
    --duration 10 \
    --no-prompt-extend
```

### 使用本地图片

```bash
# Step 1: 上传本地文件到 OSS
oss_url=$(python scripts/file_to_oss.py --file /path/to/image.jpg --model wan2.7-i2v-2026-04-25)

# Step 2: 使用 oss:// URL 生成视频
python3 scripts/video_generation.py \
    --mode i2v \
    --first-frame "$oss_url" \
    --prompt "镜头缓慢推进"
```

### 参数说明

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `--mode` | string | - | t2v | 固定 `i2v` |
| `--first-frame` | string | 是 | - | 首帧图片 URL |
| `--last-frame` | string | 否 | - | 尾帧图片 URL |
| `--audio-url` | string | 否 | 自动配音 | 驱动音频 URL |
| `--prompt` | string | 否 | - | 文本提示词（≤5000字符） |
| `--negative-prompt` | string | 否 | - | 反向提示词（≤500字符） |
| `--resolution` | string | 否 | 720P | 分辨率档位 720P/1080P |
| `--duration` | int | 否 | 5 | 时长 2~15 秒 |
| `--no-prompt-extend` | flag | 否 | 开启 | 关闭智能改写 |
| `--watermark` | flag | 否 | 关闭 | 添加"AI生成"水印 |
| `--seed` | int | 否 | 随机 | 随机种子 |
| `--output-dir` | string | 否 | . | 输出目录 |

**注意:** i2v 模式下宽高比跟随输入图片，不支持 `--ratio` 参数。

### 图片输入限制

- 格式: JPEG, JPG, PNG(不支持透明通道), BMP, WEBP
- 分辨率: [240, 8000] 像素
- 大小: ≤ 20MB
- 宽高比: 1:8 ~ 8:1

### 音频输入限制

- 格式: wav, mp3
- 时长: 2~30s
- 大小: ≤ 15MB
- 截断: 音频超过 duration 自动截取前 N 秒；不足部分为无声

---

## Mode 3: 视频续写 (Video Continuation)

**用途:** 基于已有视频片段生成后续内容

**模型:** `wan2.7-i2v-2026-04-25`

### 支持的素材组合

| 组合 | 说明 |
|------|------|
| 首段视频 | 基于一段视频续写后续 |
| 首段视频 + 尾帧 | 续写并在指定画面结束 |

### 视频续写

```bash
python3 scripts/video_generation.py \
    --mode r2v \
    --first-clip "https://example.com/video.mp4" \
    --prompt "女孩对镜自拍，自拍结束后背着书包出门" \
    --resolution 720P \
    --duration 10
```

**续写逻辑:** 输入视频 3 秒 + duration=10 → 模型续写生成 7 秒，输出总时长 10 秒，按 10 秒计费。

### 视频续写 + 尾帧控制

```bash
python3 scripts/video_generation.py \
    --mode r2v \
    --first-clip "https://example.com/clip.mp4" \
    --last-frame "https://example.com/end.png" \
    --prompt "续写到角色到达终点画面" \
    --resolution 720P \
    --duration 15
```

### 参数说明

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `--mode` | string | - | t2v | 固定 `r2v` |
| `--first-clip` | string | 是 | - | 首段视频 URL（mp4/mov） |
| `--last-frame` | string | 否 | - | 尾帧图片 URL（控制终点画面） |
| `--prompt` | string | 否 | - | 续写方向的文本提示词 |
| `--resolution` | string | 否 | 720P | 分辨率档位 |
| `--duration` | int | 否 | 10 | 输出总时长 2~15 秒 |
| `--no-prompt-extend` | flag | 否 | 开启 | 关闭智能改写 |
| `--watermark` | flag | 否 | 关闭 | 添加水印 |
| `--seed` | int | 否 | 随机 | 随机种子 |
| `--output-dir` | string | 否 | . | 输出目录 |

### 视频输入限制

- 格式: mp4, mov
- 时长: 2~10s
- 分辨率: [240, 4096] 像素
- 宽高比: 1:8 ~ 8:1
- 大小: ≤ 100MB

---

## Common Use Cases

### Case 1: 简单文生视频

```bash
python3 scripts/video_generation.py \
    --mode t2v \
    --prompt "一只小猫在月光下奔跑" \
    --duration 5
```

### Case 2: 高质量长视频

```bash
python3 scripts/video_generation.py \
    --mode t2v \
    --prompt "一段史诗级的战斗场景，古代将军骑马冲锋" \
    --resolution 1080P \
    --ratio 16:9 \
    --duration 15 \
    --seed 12345
```

### Case 3: 竖屏短视频

```bash
python3 scripts/video_generation.py \
    --mode t2v \
    --prompt "一杯咖啡从冲泡到完成的过程" \
    --resolution 720P \
    --ratio 9:16 \
    --duration 10
```

### Case 4: 图生视频 (首帧 + 本地图片)

```bash
oss_url=$(python scripts/file_to_oss.py --file photo.jpg --model wan2.7-i2v-2026-04-25)

python3 scripts/video_generation.py \
    --mode i2v \
    --first-frame "$oss_url" \
    --prompt "镜头缓慢推进，光线逐渐变亮"
```

### Case 5: 图生视频 (首尾帧过渡)

```bash
python3 scripts/video_generation.py \
    --mode i2v \
    --first-frame "https://example.com/start.png" \
    --last-frame "https://example.com/end.png" \
    --prompt "从小猫仰望天空到猫咪奔跑" \
    --duration 8
```

### Case 6: 图生视频 (音频驱动)

```bash
python3 scripts/video_generation.py \
    --mode i2v \
    --first-frame "https://example.com/character.png" \
    --audio-url "https://example.com/song.mp3" \
    --prompt "角色随着音乐唱歌" \
    --duration 10
```

### Case 7: 视频续写

```bash
python3 scripts/video_generation.py \
    --mode r2v \
    --first-clip "https://example.com/clip.mp4" \
    --prompt "女孩转身走出画面" \
    --duration 15
```