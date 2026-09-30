# 进球与比分模型（Poisson / Top8 / U2.5 预筛）

> 主协议只保留硬闸；本文档是完整计算步骤。当前权威口径见 `RULES_BASELINE.md`。

## 1. λ 估计

1. 先用 1X2 赔率去水得到 `p_home / p_draw / p_away`，Newton 迭代反推 λ_home、λ_away。
2. **λ_total 优先用总进球盘校准**：
   - 竞彩 TTG 各档位赔率去水 → `E(total) = Σ(档位概率 × 进球数)`。
   - 或 OU2.5 去水 P(over) → 反推 λ_total 使 `P(λ_total ≥ 3) = P(over)`。
   - sharp OU（必发）优先，信息量最高。
3. **拆分 λ_home / λ_away** = `E(total) × (1X2 反推的 λ_home / λ_away 比例)`，再叠方向层修正。
4. **冲突处理**：TTG/OU 反推 E(total) 与 1X2 反推差 >0.4 球 → 以 TTG/OU 为主建立中心情景，同时保留 1X2 情景作敏感性对照；不得用赛后最新赔率改写赛前快照。
5. OU 校准对命中提升有限（+0.5~0.8pp），定位是防偏保险，不是比分提升关键。

## 2. 比分带

- **取泊松 Top8**。24,689 场 Pinnacle 回测：Top5=50.3%，Top8=68.5%。
- 3 球场 Top8=82%；4+ 球场 Top8 仅 16% = 比分预测天花板。
- **长尾比分**：泊松排名 #20+ 或概率 <1% 不可预测，不追。
- **单点比分**：带内 P(score) 最大者，**不绑定方向**；“防平”场允许且应当选 1:1 作单点。方向（W/D/L）与比分是两个独立决策。
- 单点只标 `guess`；默认交付完整比分带，单点不进入高命中玩法候选。

### 2.1 概率质量字段（强制输出）

从同一个联合比分分布排序并计算：

- `primary_score_probability`：Top1 的 P(score)。
- `runner_up_score` / `runner_up_score_probability`：Top2 及其概率。
- `primary_gap = P(Top1)-P(Top2)`。
- `primary_fragile = primary_gap < 0.02`：只表示点比分区分度低，不改变排序、方向或候选资格。
- `band_probability_mass = Σ P(score)`，求和范围严格等于 `band_top8`。

人类可读输出必须把点比分写成“猜测 + 概率”；`primary_fragile=true` 时同时展示次位比分与差值。市场最低赔比分只保留在 `market.score_baseline`，不得参与这些字段计算。

## 3. U2.5 预筛（比分候选的必要条件）

- 只碰 **U2.5 去水 ≥60%** 的场：实际≤2球占 63%，Top5 命中 59%、Top8 79%。
- **≥65% 更佳**：Top5=65%、Top8=90%。
- **避开 U2.5<55%**：60% 概率 4+ 球，Top8 仅 16%，比分不可测。
- U2.5 过闸不等于比分投注有价值；赛季初、数据不足、高方差或玩法高抽水时仍令 CRS 候选 `eligible=false`。
- 强 OU 偏大场只降低比分可预测性；是否采用 TTG 由玩法概率和 betting 层决定。

## 4. OU 信号与 λ

- 外部 OU2.5 over≥55%（或 sharp over 便宜）→ 以 OU 重新反推 λ_total；“每 +10pp → λ×~1.1”仅作敏感性检查，再核对比分带是否自然包含 3+ 球比分。
- OU 偏小 → 下调 λ_total。
- 禁止用“摆大巴/守分”叙事压低总进球。
- 若 λ 已按第 1 节 TTG/OU 校准，此规则自动满足，仅需核对比分带确实含 3+ 球。

## 5. 淘汰赛次回合

- 落后方主场（必须追分）建立 λ_total 上行情景。
- ×1.3；外部 OU over≥55% 时 ×1.5 仅作为敏感性边界，不作为已校准中心值。
- 最终中心 λ 仍由赛前市场与球队数据共同确定。

## 6. 单场超额发挥风险 → 直接调 λ

- `defense_overperform_risk`（失球远优于 xGA）→ **升对手 λ**：防守回归 → 单场失球多 → 大球方向。
- `attack_overperform_risk`（进球远优于 xG）→ **降本队 λ**：进攻回归 → 单场进球少 → 小球方向。
- 单侧信号只调该队 λ；**总进球玩法必须双队都建模才能押**，不能单侧信号直接押总进球小球。
- 揭幕战/赛季初超额发挥球队方差最大；揭幕战进球数可能双峰（7 球或 1 球）。
- 泊松均值预测在揭幕战/极端信号场可能失效，用超额发挥信号判断大小球方向。

## 7. BTTS 参考检查（软规则）

- 两队近期场均进球都≥1.0 **且** 外部 OU2.5≥50% → 优先选 BTTS 比分。
- 不是硬约束：防守型场次（OU<45%、次回合保守场）允许零封比分。

## 8. 防平风险标记

触发条件全部满足 → 标记 `draw_risk`，但比分仍按 P(score) 排序，不手工移动 1:1：
1. 确认偏误反对证据 ≥3；
2. 市场平局去水 ≥30%；
3. 主队攻击 <1 球/场。

## 9. 体彩玩法概率聚合

从同一个联合比分分布生成可比较概率，禁止不同输出各自使用不一致 λ：

正式分布必须生成稳定的 `formal_probability_source_id`。每次 λ、盘口或冻结输入改变后，必须原子性重算下列全部消费层，不得只替换 Top8：

- `score.primary_score/band_top8/概率质量字段`；
- `strength.coverage` 的 model/conservative 概率；
- `plays.candidates`、`plays.tables`和 `confidence.ensemble.poisson`。

- HAD：主胜=`Σ P(h>a)`，平=`Σ P(h=a)`，客胜=`Σ P(h<a)`。
- HHAD：先把官方让球值作用于主队比分，再按胜/平/负聚合；输出中必须保留主队让球符号。
- TTG：按 `h+a=0..6` 聚合，`7+` 聚合所有 `h+a≥7`。
- CRS：使用对应精确比分概率；“胜其他/平其他/负其他”聚合未单列比分。
- HAFU：只有独立的上半场 λ 或经历史校准的半全场模型可用时才计算；否则写 `unavailable`，不得用全场概率拍一个半场比例。

每个实际在售选项输出：

- `model_prob`：模型概率；
- `market_prob`：该玩法内部去水后的市场概率；
- `conservative_prob=min(model_prob, market_prob)`：命中优先排序值；
- `single_allowed`：官方是否允许单关；
- `pool_status`、`allup_allowed`、`max_pass_size`、`odds_snapshot_at`：来自体彩当期快照的可售与过关约束；缺任一项不得交付可执行组合；
- `pool_allowed`：是否可进入跨场收益覆盖组合池。HAD/HHAD/TTG/CRS/已校准 HAFU 均可为 true；CRS 还须通过 U2.5、数据完整度和高方差守卫。该字段不表示高命中或正 EV；
- `eligible` 与 `veto_reasons`：数据/红旗/玩法校准是否允许 betting 消费。

`conservative_prob` 只用于减少过度自信，不代表独立 edge。若模型概率本身由同一玩法赔率反推，不得再用两者差值宣称价值。
`pool_allowed=true` 还要求 `pool_status=Selling` 且 `allup_allowed=true`；玩法模型合格但体彩不可过关时仍为 false。

## 10. 高方差守卫

赛季首轮、正式赛样本不足、阵容大改、数据污染或整轮极端进球画像命中任一：

- 仍输出 Top8 供分析和复盘；
- `risk_tags` 加入对应红旗；
- CRS/HAFU 默认 `eligible=false`；
- HAD/HHAD/TTG 使用较低的 `conservative_prob`，不因叙事上调概率。
