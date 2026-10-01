# 分析数据落盘规范（football-analysis 第8步展开）

> 主协议只保留“必须落盘”三行。完整 SOP 在本文档。
> `FDP_ROOT` 解析顺序：环境变量 `FDP_ROOT` → 用户会话指定 → 开发机兜底 `<本机 FDP 仓库路径>`。不存在时先确认，不臆测。

## 目的

每批分析交付前必须完成落盘，缺此步 = 批次未完成。目的：防会话丢失后混乱/幻觉，赛后复盘有权威依据。数据来源与时间戳必须记录，禁止凭记忆覆盖。

## 命名规范

- 基准名 = `analysis-{比赛日}`，`{比赛日}` = 北京时间开球日（YYYY-MM-DD，非分析日）。
- 归档目录名 = 记忆文件名（去掉 `.md`），两者必须同名。
- 同一比赛日多批次：基准名加 `-{槽位}`（如 `-am`/`-pm` 或主题短词），目录与文件同步加。
- 示例：`data/analysis-2026-08-11/` + `memory/analysis-2026-08-11.md`；同日第二批 → `analysis-2026-08-11-pm`。

## ① 原始数据归档 → `FDP_ROOT/data/analysis-{比赛日}{-槽位}/`

- 竞彩赔率时间线（各快照 JSON，含 lastUpdate 时间戳）。
- 体彩官方接口原始响应（伤停/近况/H2H/积分榜/赛程/支持率）。
- 库查询/计算输出（积分榜/近10/H2H/xG/G-xG/泊松/去水）。
- 天气 / 裁判 / 伤停清单（含来源与 Grade 等级）。
- `README.md`：文件清单 + 来源 + 重抓方法 + 数据质量备注（体彩滞后/残留、官网优先等警示）。

## ② 分析记录 → `FDP_ROOT/memory/analysis-{比赛日}{-槽位}.md`

- frontmatter 必须含 `status: prediction`（自动复盘靠它发现待复盘批次；复盘后翻为 `status: reviewed`）。
- ID 映射（DB/体彩/fotmob）+ 数据采集清单（来源+覆盖）。
- 每场数据快照 + `AnalysisResult` 结论 + 星级 + `version/locked/direction_flips`。
- ERRATA 区：数据错误更正显式记录，禁静默覆盖。
- 复盘指标占位：`strength_dir_hit / market_baseline_hit / single_1x2_hit / double_cover_rate / score_band_hit / score_top1_hit / CLV / direction_flips / locked_vs_final`。
- 关联：归档路径、脚本、reference。

## ③ 索引 → `FDP_ROOT/memory/MEMORY.md` 加一行指针

标题 + 一句话钩子。

## ④ 脚本留档

采集/计算脚本存 `FDP_ROOT/scripts/<分类>/_*.ts`（分类：collect/probe/analysis/review/daily/sporttery 等；可重跑复现，勿删）。

## ⑤ 结构化预测账本（历史重放权威输入）

- 正式批次：`FDP_ROOT/data/prediction-ledger/locked/<batch_id>.json`，schema=`fdp.prediction-ledger.v1`。
- 旧档迁移：`FDP_ROOT/data/prediction-ledger/legacy/<batch_id>.json`，必须标 `legacy_import` 和 `legacy_unverified`。
- `locked_at` 由锁定器执行时生成，不采信 draft 自报时间；同时核对 Match、OddsHistory、`locked_at < kickoff`、`quoted_at <= locked_at`、可售/过关状态、展开注和 SHA-256；同批文件不得覆盖。
- 赛后报告写 `FDP_ROOT/data/backtest/`；不得把赛果写回锁定 JSON。
- Markdown 继续作为人读记录，但与结构化 JSON 冲突时，以通过校验的锁定 JSON 为准。

## ⑥ CLV 收盘价口径

- `CLV = (买入价 / 收盘价) - 1`。买入赔率高于收盘赔率时为正；收盘价 ≠ 预测时价。
- 收盘代理 = 库内 OddsHistory 该场开赛前最后一条报价（采集器近开赛加速到 1h；`FDP_ROOT/scripts/review/_auto-review.ts` 自动取）。
- 落盘归档需含开赛前最后一次竞彩报价快照。
- 拿预测时价冒充收盘 = 虚增 CLV = 复盘造假，禁止。

## 完成校验

- `data/analysis-*/` 存在
- `memory/analysis-*.md` 存在且 `status: prediction`
- `MEMORY.md` 有指针
- ERRATA 已记录
- 完整 `fdp.analysis-result.v2` 已通过 `npx tsx scripts/analysis/_validate-analysis-result.ts --input=<analysis-result.json>`；v2.3.4 起锁定器会从 `lock.source_paths` 再校验一次
- **三处比分带逐字一致：`score.band_top8` = `match_view.比分` = betting 消费值**
- 若已投注：CLV 表买入价已填 + 终盘快照已存
