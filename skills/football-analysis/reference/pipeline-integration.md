# FDP 预测管线接入

> 在首次使用、数据结构变化、批量回测或用户要求验证数据质量时读取。普通单场分析无需重复加载。

## 1. 阶段门禁

管线按以下顺序推进，后一步不得掩盖前一步缺口：

1. **数据接通**：五玩法赛前赔率、比赛实体和赛果可关联；预测/票据有锁定记录。
2. **自动选池**：只从 `AnalysisResult.plays.candidates` 选取实际在售且通过红旗闸门的候选。
3. **风险校准**：按玩法、概率档、联赛/赛季阶段和快照时点校准；未经校准的 HAFU 保持 `unavailable`。
4. **历史验证**：使用 walk-forward 和当时可见赔率，按真实票面逐注结算。
5. **技能收敛**：只有 `active` 规则进入 `RULES_BASELINE.md`；`n<30` 观察项不改变正式输出。

## 2. 数据就绪度审计

在 `FDP_ROOT` 运行：

```powershell
npx tsx scripts/jobs/audit-prediction-readiness.ts
```

读取 `data/audit/prediction-readiness-latest.json`。至少检查：

- 五玩法各自的 `pre_kickoff_ready_groups` 与 `settled_matches`；
- `orphan_sporttery_odds_matches`；
- 赔率销售/过关/报价时间字段缺失；
- 历史 prediction/BetPlan 是否为可重放的锁定记录。

总行数不能替代可用样本数。风险校准和回测样本必须是：比赛已结算、预测已锁定、赔率早于开赛、玩法口径一致。

## 3. 标准赛前输入

按比赛日导出：

```powershell
npx tsx scripts/analysis/_export-analysis-input.ts --date=YYYY-MM-DD --as-of=<ISO-8601>
```

导出对象的 `schema` 必须为 `fdp.analysis-input.v1`。每个玩法快照保留：

- `odds_history_id`、`quote_update_time`、`collected_at`；
- `pool_status`、`single_allowed`、`allup_allowed`；
- `max_pass_size` 与 `max_pass_size_is_derived`；
- 该玩法完整赔率对象。

导出器只选择 `snapshot_time <= as_of` 且 `snapshot_time < kickoff` 的最新记录。历史复盘不得把赛后或更晚快照回填成赛前输入。

`max_pass_size` 当前由玩法规则映射，不是 `OddsHistory` 原生字段；出投注方案前仍须按同批次官方规则复核，不能仅信历史映射。

新预测还必须按 `analysis-evidence-pack.example.json` 准备 `fdp.analysis-evidence-pack.v1`：每场至少3条 typed 支持证据与3条 typed 反证，并逐项记录积分榜、H2H、教练、裁判、天气和亚盘为 `verified` 或带原因的 `unavailable`。不得把自然语言赛前稿直接当成 evidence pack。

唯一生产入口：

```powershell
npm run analysis:predict -- --analysis-input=<analysis-input.json> --evidence-pack=<evidence-pack.json> --output=<analysis-result.json>
```

该命令实际消费经验 v1 正式模型，冻结 v2 只写 shadow，并同时生成 `prediction-ledger-draft.json`。input、evidence pack 和冻结模型都绑定路径及 SHA-256；缺 T-75/T-45、确认首发来源、验证伤停来源、欧赔双快照或亚盘核验时保留分析但取消 `stable_eligible`。

## 4. 锁定与复盘接口

- 预测锁定时保存完整 `AnalysisResult`，不得只存自然语言摘要。
- 投注锁定时保存完整 `BetPlan`、展开注、每注成本与买入赔率。
- 复盘只能回填赛果、真实返奖和独立收盘价，不修改原预测概率、方向、候选和票型。
- 文件落盘仍遵守 `reference/data-persistence.md`；在 Prediction/BetPlan 数据表建立前，结构化 JSON 是历史重放的权威输入。

FDP 当前入口：

```powershell
npx tsx scripts/prediction-ledger/_lock-prediction-batch.ts --input=<draft.json>
npx tsx scripts/prediction-ledger/_validate-prediction-ledger.ts
npx tsx scripts/prediction-ledger/_replay-prediction-ledger.ts
```

- 正式锁定写 `data/prediction-ledger/locked/`；`locked_at` 由锁定命令执行时生成，不采信 draft 自报时间，且赔率快照不晚于锁定并严格早于开赛。
- 旧档迁移写 `data/prediction-ledger/legacy/`，状态固定为 `legacy_import`；缺锁定时间时不得进入正式校准。
- 锁定文件带 SHA-256 且同批拒绝覆盖；赛后输出写 `data/backtest/`，不修改锁定文件。
- 投注票必须保存唯一候选 ID 和逐注展开。金额或单关实际返奖未知时只能结算命中，ROI=N/A。

## 5. 数据问题处理

- 孤立赔率、缺失赛前快照或玩法载荷不完整：该场对应玩法不可进入可执行候选。
- 只有一个赛前快照：允许做静态价格分析，不宣称赔率异动。
- 无半场赛果：可验证 HAD/HHAD/TTG/CRS，但不得计入 HAFU 命中率。
- 清洗、队名映射或比赛关联修复后，重跑所有依赖样本的回测；旧指标不得沿用。
