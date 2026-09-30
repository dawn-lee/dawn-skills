# 红旗清单与分析层处理

> 命中任一红旗 → **星级封顶 + 明确标注**，并在相关 `plays.candidates` 写入 `veto_reasons`。
> 分析层不写主推/串关；投注层只消费 `eligible=true` 的候选。当前口径以本文件和 `RULES_BASELINE.md` 为准。

| 红旗 | 处理 |
|------|------|
| 赛季首轮 / 无正式赛数据 | 星级封顶 ★★☆☆☆；Elo/季前热身不能替代正式赛 |
| 闭门比赛（空场） | 主队强热降一档，CRS/HAFU 候选不可用 |
| 核心球星停赛/缺阵 | 必须官方单查；方向降档 |
| 季前热身当主要依据 | 撤（热身≠正式赛） |
| 同位置伤停 ≥3 人（后卫/中场） | 方向降档，不只降深盘；相关玩法提高方差并交投注层否决 |
| 强主队缺核心射手 + 攻击超发挥回归（G-xG>3） | 方向降级为“不败/防平”，不只降仓位 |
| H2H 长期克星（H2H≥4 场且近3场0胜） | 仅轻微降档：λ_home×0.9、降深度一档；不翻方向、不作平局上移依据 |
| H2H 短克星（H2H≤3） | **不算红旗**；按 `variance_up` 处理 |

## 红旗与 λ 敏感性分析

主胜去水 ≥65% 且命中任一 → **破大巴难（需官方表态/确认阵型/稳定历史风格）/ 核心射手缺阵** → 建立敏感性情景：
- λ_home ×0.6-0.7
- λ_away ×1.5-2.0
- 反证检查：对手纯送分弱旅无反击能力 → 只降 λ_home，不升 λ_away。
- 上述倍数不是中心预测；最终中心 λ 仍以市场/数据校准，情景只用于检查比分排序和玩法概率是否脆弱。
- 情景不得翻转实力方向；若情景间主胜概率跨越 50% 或平局达到 30%，标“方向置信低”并降低 `conservative_prob`。


## 信号词汇表（risk_tags）

> risk_tags 描述赛前状态，用于审计追溯、复盘分组和观察项统计。**标签本身不规定方向动作**；只有 `RULES_BASELINE.md` 列出的规则能改变方向、置信或候选资格。新增标签必须先补入本表（走 changelog），禁止临时造词。

| 标签 | 语义 | 挂载条件（赛前可判定） |
|---|---|---|
| `model_market_conflict` | 模型主选与市场主选不一致 | 模型 HAD 主选与去水市场主选指向不同结果 |
| `tail_market_pullback` | 某结果概率在临场从日内高点明显回吐 | 最新快照某结果去水概率较日内高点回落 ≥1.5pp |
| `single_leg_cup_penalty_risk` | 单场淘汰杯赛，90 分钟平局直接点球 | 单场淘汰制杯赛 |
| `knockout_first_leg` | 两回合淘汰赛首回合，双方倾向谨慎 | 两回合制首回合 |
| `knockout_second_leg` | 两回合淘汰赛次回合，落后方需追分 | 两回合制次回合 |
| `home_form_collapse` / `away_form_collapse` | 主/客队近期状态崩塌 | 近 5 场 ≤1 胜或连败 ≥3 |
| `injury_unverified_official` | 伤停信息来自媒体/聚合站，未经官方核实 | 缺官网或官方公告证据 |
| `*_overperform_regression` | 某队进攻/防守相对 xG/xGA 严重超发挥，回归风险 | 赛季 G-xG 或 失球-xGA 偏差 ≥+5（fotmob/库口径） |
| `altitude_home` | 高原主场 | 主场海拔 ≥1500m |
| `split_match` | 三向概率接近，无明确热门 | 去水后任一胜负端 <45% |
| `odds_single_snapshot` / `odds_2_snapshot` | 赔率快照数不足，不能称趋势 | 快照数 1 / 2（对应 movement_quality） |
| `xg_missing_both` / `home_xg_missing` | 一队或两队缺赛季 xG 数据 | 数据源无该联赛/球队 xG |

翻盘依据类型（`flip_basis.basis_type`，与 risk_tags 分开管理）：`xg_regression` / `injury` / `market_move` / `lineup_change` / `other`。
