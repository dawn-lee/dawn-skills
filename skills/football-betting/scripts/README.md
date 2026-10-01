# 回测与验证脚本索引

> `FDP_ROOT` 优先取环境变量，未设置时开发机兜底 `<本机 FDP 仓库路径>`。
> 回测/采集脚本位于 `FDP_ROOT/scripts/`；本地校验与组合计算脚本随 skill 迁移，直接从本目录运行。

## 本地校验（随 skill 安装）
| 脚本 | 用途 |
|---|---|
| `preflight.mjs` | 使用前依赖检查（football-analysis + FDP_ROOT） |
| `check-changelog.mjs` | 校验本 skill 的 changelog 写入规则 |
| `generate-bet-plan.mjs` | 只消费 AnalysisResult，确定性生成命中优先、价值优先或覆盖盈利 BetPlan |
| `calc-coverage-profit.mjs` | 展开2-8场、每场1-2个互斥选项的完整覆盖串，重算成本、逐分支净收益、盈利概率和期望净收益 |
| `calc-return-pool.mjs` | 枚举跨玩法组合池的全部命中状态，计算成本、二中覆盖、盈利概率和期望净收益 |
| `select-return-pool.mjs` | 从 4-20 条合格候选中自动枚举四场池及 2/3/4 关结构并排序 |
| `validate-bet-plan.mjs` | 锁单前按 v2.4.5 重算简单票、同场复式、价值票、覆盖票与收益池，并核验分析概率源和在售能力 |

正式批次的结构化锁定、校验和赛后重放由 `FDP_ROOT/scripts/prediction-ledger/` 提供：`_lock-prediction-batch.ts`、`_validate-prediction-ledger.ts`、`_replay-prediction-ledger.ts`。它们不随 skill 复制，运行前先确认 `FDP_ROOT`。

三个主目标使用统一入口，生成后再运行验证器：

```powershell
node scripts/generate-bet-plan.mjs --analysis=<analysis-result.json> --output=<bet-plan.json> --objective=hit_rate_first --batch-id=<bet-batch-id>
node scripts/validate-bet-plan.mjs <bet-plan.json>
```

四场 2/3 关的 `return_pool` 是附加收益池，仍使用 `select-return-pool.mjs` 与 `calc-return-pool.mjs` 完整枚举，不替代主目标 BetPlan。

组合计算器从参数指定的 JSON 文件读取输入；不传路径时从 stdin 读取。每条腿必须提供 `match_id`、`odds`、`conservative_prob`（旧输入也可映射 `probability`）、`model_prob`、`pool_status=Selling`、`allup_allowed=true`、`max_pass_size` 和 `odds_snapshot_at`：

```powershell
node scripts/calc-return-pool.mjs return-pool-input.json
```

候选超过 4 条时，输入 `candidates`（直接使用 `AnalysisResult.plays.candidates` 字段），运行：

```powershell
node scripts/select-return-pool.mjs return-pool-candidates.json
```

选择器先过滤 `eligible/pool_allowed/Selling/allup_allowed`，再枚举四个不同比赛。默认 `selectionPolicy=model_aligned`，至少保留2个 `selection_rank=1` 主选锚点；没有符合条件的组合返回 `no_model_aligned_pool`。`ready` 同时要求六组恰中两场都盈利且 `expected_net>0`；仅满足前者会返回 `pair_coverage_negative_expectation`。`selectionPolicy=unrestricted` 必须提供 `overrideReason`，只能作为明确的娱乐覆盖。

稳健覆盖盈利票输入 `groups`，每组代表一个不同比赛，包含1-2个来自同一玩法、同一盘口线的互斥选项：

```powershell
node scripts/calc-coverage-profit.mjs coverage-profit-input.json
```

`ready` 同时要求票级覆盖概率达到 `highHitThreshold`、所有覆盖分支达到 `minimumProfitNet/minimumProfitRoi`、整体 `expected_net>0`。选项必须同时提供用于覆盖估计的 `conservative_prob`（映射为 `probability`）和用于期望值的独立/经校准 `model_prob`；不得拿同玩法去水概率冒充价值概率。成本由笛卡尔积真实展开；提高 `stakePerCombination` 只同比放大盈亏，不改善ROI。



## 泊松 / 基础回测
| 脚本 | 用途 |
|---|---|
| `_backtest-poisson.ts` | 泊松模型 5000 场抽样回测 |
| `_bt-sporttery.ts` | 竞彩专属回测（n=139 FINISHED 场） |
| `_bt-fdcouk.ts` | fdcouk 大样本回测（n=22,435，286 CSV） |

## 深挖分析
| 脚本 | 用途 |
|---|---|
| `_bt-deep.ts` | 竞彩深挖：主/客热门分档、1:1 命中率、客受让 |
| `_bt-cross.ts` | 竞彩交叉：高置信热门赢球形态、弱主胜坑 |
| `_bt-awayhot.ts` | 客队热门深挖（n=15），兑现形态分析 |
| `_bt-nomove-gate.ts` | "赔率不动即信号"方向门回测 |

## 模式发现
| 脚本 | 用途 |
|---|---|
| `_deep-patterns.ts` | 深层比分模式挖掘 |
| `_deep-patterns2.ts` | 补充模式挖掘 |
| `_score-patterns.ts` | 比分规律统计 |

## 数据采集（每日）
| 脚本 | 用途 |
|---|---|
| `_friday-extract.ts` | 周五竞彩快照提取 |
| `_saturday-fetch-extract.ts` | 周六竞彩快照采集+归档+提取 |

## 维护
| 脚本 | 用途 |
|---|---|
| `_fotmob-cleanup.ts` | FotMob 数据清理 |
