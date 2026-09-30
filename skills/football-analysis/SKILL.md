---
name: football-analysis
description: 足球比赛预测与分析方法论。当用户要求分析比赛、预测方向/比分或评估球队实力时使用。输出实力方向、市场验证、校准置信、比分带和体彩各玩法概率（AnalysisResult）；不输出 BET/SKIP/WATCH，不设计串关和仓位。
metadata:
  version: "2.4.2"
---

# football-analysis 分析协议

## 0. 职责边界（强制）

1. 本 skill 只做分析：**实力层 → 市场层 → 校准置信 → 比分带 → 体彩玩法概率**。
2. 本 skill **不输出** `BET/SKIP/WATCH`，不设计玩法、串关和仓位。
3. `football-betting` 必须消费本 skill 的 `AnalysisResult`，尤其是 `plays.candidates`；若 betting 先被触发且没有分析输出，先执行本 skill。
4. 用户要求“独立判断”时：先完成纯实力层；赔率只能随后作为冲突说明和价格校准。
5. 目标是提高**锁定预测和真实可执行玩法**的命中率；分析层不以扩大选项数、事后补防或混用 TopK 制造虚高命中率。

## 1. 项目路径

- `FDP_ROOT` 解析顺序：① 环境变量 `FDP_ROOT`；② 用户本次会话指定；③ 开发机默认 `<FDP_ROOT>`。
- 若解析出的路径不存在，先向用户确认，不得臆测路径。迁移机器不需要改 SKILL，设置 `FDP_ROOT` 或使用前指定即可。

## 2. 硬闸（不可被任何步骤覆盖）

1. 实力层禁止出现赔率、gap、亚盘数字或“市场热门”措辞。
2. `gap` 只描述 soft 与 sharp 的价格差，不能翻转或改写实力层方向；仓位由 betting 层决定。
3. 亚盘必须同时写主队让球符号、客队对应符号和两侧赔率，二次确认主客队。
4. 无当前场次真实 Pinnacle/交易所线时，`gap=null`，不得写“sharp 已校准”。
5. 伤停默认只改变置信/方差；要改大小球或方向，必须注明新增的独立证据。
6. `score.primary_score` 按带内 P(score) 最大化选取，**不绑定实力层方向**；方向和比分是两个独立决策。
7. 中熵场（实力为 `split/draw`，或所选主方向为 `home/away` 且其对应去水市场概率<60%）必须标 `confidence=low` 和候选覆盖方向；分析层仍完整输出，不写“跳过/稳胆”。
8. 点比分只能标 `guess`；默认交付完整比分带。单点不得标成高命中候选，但通过数据闸门的 CRS 可以与其他合格玩法一样标 `pool_allowed=true`，交给 betting 层计算低投入容错组合。
9. 方向必须明确“主选 + 防（次选）”，禁止无主次的“微偏主/客”；防的对象优先“平”，防平只作覆盖、不作独立单注。
10. 比分带统一为泊松 **Top8**。U2.5 去水 ≥60% 只是比分玩法的必要筛选，不是充分条件；赛季初、数据不足或高方差红旗仍令比分候选 `eligible=false`。
11. 每场预测/复盘结果、原始数据、投注盈亏只写 `FDP_ROOT/memory` 与 `FDP_ROOT/data`；**禁止写入 skill 目录或 `changelog/`**。`changelog/` 只收规则级结论（写入策略见 `changelog/README.md`）。
12. 对实际在售的 HAD/HHAD/TTG/CRS/HAFU 逐项输出概率，并保留体彩 `pool_status`、`single_allowed`、`allup_allowed`、`max_pass_size` 与赔率快照时间；无法可靠建模的玩法必须标 `unavailable`，不得用同一市场生成概率后再宣称独立 edge。
13. 主选/防选必须同时输出 model、market 与 conservative 的单选及覆盖概率；首位比分必须输出自身概率、次位比分概率、两者差值和 Top8 累计概率质量。缺少这些字段时 AnalysisResult 不完整。
14. `direction_flips>0` 时每次翻盘必须携带 `flip_basis`：typed 依据（`xg_regression`/`injury`/`market_move`/`lineup_change`/`other`）、翻盘前后方向、市场是否同意翻后方向、证据摘要；缺依据的翻盘被锁定校验器拒绝。翻盘协议只管可追溯，不预设翻盘对错；冲突下是否应翻由观察项验证。
15. v2.3.4 起，锁定前必须对完整 `fdp.analysis-result.v2` 来源运行严格校验；字段枚举、概率关系、Top8、点比分标签/资格、ensemble 票型或玩法闸门不一致时拒绝锁定。历史已锁批次不回写。
16. v2.3.5 起，`strength.direction`、`coverage.primary_outcome` 必须一致；若至少两路可用 ensemble 票全体同向而最终主方向相反，默认阻断锁定。只有提供 `strength.ensemble_conflict_override`（共识方向、最终方向、typed 依据与可核验证据）才允许保留原方向；不得自动翻到共识方向。
17. v2.3.6 起，所有新分析锁必须接入冻结的 `experience_adjusted_poisson_v1`：标准赛前输入必须含真实捕获时刻的 `experience_snapshot`，AnalysisResult 必须含可重算的 `score.experience_candidate` 和 `score.model_policy`。用户明确选用 v1 时可以是 `formal_basis=user_selected_primary`，但这不等于统计晋升；`promotion_status` 仍必须独立披露。
18. v2.4.1 起，正式比分网格是唯一模型概率源：`score`、`strength.coverage`、`plays.candidates/tables` 和 ensemble.poisson 必须同步重算并共享 `formal_probability_source_id`。任一消费层遗留旧概率即阻断锁定；不得手改 Top1/Top8 或用结果倒推比分。
19. v2.4.1 起，新分析必须输出 `data_quality`。确认首发、伤停官方/多源核验、当季/主客状态样本可靠度、支持/反对证据极性任一不合格时 `stable_eligible=false`，`confidence` 不得为 high；这不阻止分析输出，但阻止 betting 将其称为“稳”。
20. 观察项不得靠修改 Markdown 累计或自动晋升。赛果入库后运行 `npm run observations:refresh`，并用 `npm run observations:verify` 校验 hash-chain 与不可变证据；普通 typed evidence 必须逐样本提供唯一 `unit_id`、来源批次和可核验 SHA-256，只能保持 `observation_only`。达到门槛后还必须用绑定当前账本头的独立人工审计执行 `observations:review`，才可写 `review_required`；它仍不能覆盖 `RULES_BASELINE.md`。不能从旧锁定结构无歧义重建触发条件的项目保持 `awaiting_typed_evidence`，不得补造样本。
21. v2.4.2 起使用唯一生产入口 `npm run analysis:predict`。它从冻结 analysis input、结构化 evidence pack 和冻结 v2 模型一次生成最终 AnalysisResult；三者都写路径与 SHA-256。旧的按比赛日复制生成器只保留历史重放，不得再作为新预测入口。
22. v2.4.2 的“稳”资格必须实际拥有 T-75 与 T-45 两个窗口快照、11+11 首发记录、已验证伤停来源记录、至少5场双方近况、欧赔双快照和亚盘交叉核验。任一缺失保留分析，但写入 veto 并令 `stable_eligible=false`。

## 3. 数据可用性自检（Step 0）

- 本地库可用 → `cd FDP_ROOT && npx prisma generate` 通过。
- 查到比赛 `id`，确认状态：SCHEDULED→预测；FINISHED→复盘。
- 标注数据覆盖度（如“12/16 场 = 75%”），覆盖<80% 在结论旁标注。
- 赔率时间线快照数：1 次→`single_snapshot`，不能称终盘；2–3 次→`point_change`；≥5 次且跨时段→`timeline`。只有独立抓取且接近开赛的快照才可标 closing；普通单场复核必须报告基准/最新概率与百分点变化。
- 赔率时间线、积分榜、H2H、教练四项全部具备后才进入预测；否则标“数据不完整”。
- 数据源与采集纪律见 `reference/data-sources.md`。
- 首次使用、数据结构变化或批量回测前，按 `reference/pipeline-integration.md` 运行就绪度审计并导出防泄漏的标准赛前输入；普通单场无需重复跑全库审计。
- 每次使用本 skill 预测时，若 `FDP_ROOT` 可用，必须先导出标准赛前输入：`npx tsx scripts/analysis/_export-analysis-input.ts --date=YYYY-MM-DD [--as-of=<pre-kickoff-time>]`。该输入中的 `experience_snapshot` 由实际导出时刻冻结，不能用赛后时间倒填。
- 基线 AnalysisResult 生成后，必须运行 `npm run analysis:experience -- --analysis-result=<baseline-result.json> --analysis-input=<analysis-input.json> --output=<experience-result.json>`；输出同时保留 baseline reference、用户选定的 formal v1 和 shadow v2。必须分别披露 `formal_basis`、`formal_family`、`challenger_family`、`promotion_status`，不得把“实际执行”写成“已统计晋升”。

## 4. 实力层（Step 1）

### 4.1 基本面

- 联赛排名：当前积分榜，不是上赛季。排名是底线，H2H 连胜可能是历史幻觉。
- 近 5-10 场 W/D/L、进失球；主/客拆分；H2H 近 5-10 次只作参考，不做排序提权。优先用当赛季+同联赛+主客拆分样本，样本不足才用滚动历史回退；必须披露双方样本数、当季样本数、最后一场时间和 reliability tier。
- 状态加权：`weighted_form = Σ(result_i × 0.85^(n-i)) / Σ(0.85^(n-i))`。
- **状态趋势 > H2H**；“该赢了”是赌徒谬误。

### 4.2 Elo 基准

- 主场调整：通用 +65；北欧联赛 +30；巴甲 +80。
- Elo 差 → 期望胜率：>200→~75%；100-200→~65%；50-100→~58%；0-50→~52%；<0 反向。
- Elo 与排名矛盾时不作锚；Elo 与最终方向矛盾时标注分歧但不自动翻转。

### 4.3 xG / xGA / G-xG

- G-xG 累计：>+5.0 严重超发挥，重大回归风险；+2.0~+5.0 降信心；-2.0~+2.0 正常；-2.0~-5.0 欠发挥，回归上行；<-5.0 强烈逆向信号。
- `|G-xG|>3.0` 的球队标记方向/让球方差；是否进入串关由 betting 层处理。
- 单场风险：`defense_overperform_risk` → **升对手 λ**；`attack_overperform_risk` → **降本队 λ**。
- 单侧信号只调该队 λ；**押总进球必须双队都建模**。
- 揭幕战/赛季初超额发挥球队方差最大，泊松均值可能失效。
- 市场定价 2.5 盘准 ≠ 长尾盘准；4.5/7+ 长尾用泊松独立判断。
- 超额发挥 λ 修正细则（双向修正、H2H 最新口径）见 `reference/red-flags.md` 和 `reference/score-model.md`。

### 4.4 伤停/阵容

- 默认 `variance_up`；要改方向/大小球必须有独立证据。
- 优先级：**球队官网 > 体彩官方线索 > fotmob/库 Injury > 聚合站**。
- 同位置 ≥3 人伤 → 方向降档，不只降深盘；核心球星缺阵官方单查，但缺一个球星≠必败。
- 赛前采集器必须覆盖 T-75 和 T-45 复核窗口，并保留逐次不可变原始快照。11+11 首发可通过阵容闸门；完整 FotMob 伤停响应只标 `source_complete`，还需官方或 2+ 独立源才可 `verified`。“空名单”没有冻结响应证据时仍是 unavailable。
- 完整协议见 `reference/injury-protocol.md`。

### 4.5 裁判/天气/地理

- 裁判记录出牌倾向和主客偏向。
- 雨战≠必然小球；极端高温/寒冷按情境边际记录。
- 北欧主场胜率 35-36% 不加权；巴甲主场 48.5%，客胜推荐加一档不确定性；中下游球队主场优势不默认加权。

## 5. 战术意图（Step 2）

- 知道谁上场≠知道怎么踢；确认的低位防守会改变进球分布，但媒体叙事本身不足以覆盖市场与赛季数据。
- 大巴检测 5 触发、xG 修正系数、矛盾检查：见 `reference/tactical-intent.zh.md`。
- 战术证据必须有官方表态、确认阵型或稳定历史风格中的至少一项；否则只作情景分析。
- 破大巴/核心射手缺阵时，λ_home×0.6-0.7、λ_away×1.5-2.0 仅作敏感性区间，不直接替换市场校准 λ。
- λ 修正只改比分和置信，不翻方向；修正后主胜接近 50% 且平局≥30% → 标“方向置信低”。
- 杯赛淘汰赛次回合：首回合净胜≥3 球→主胜置信度降两档且不得列为高命中候选；净胜 2 球→降一档。

## 6. 确认偏误检查（Step 3，星级评定前完成）

- 每场显式列支持/反对证据，**反对至少 3 条**；列不出→调研不够，继续搜。每条必须是 typed object，至少含 `side/source/captured_at/summary`，并显式给出 `net_support_outcome`；不得把同一条文字同时放入支持和反对。
- 反对方更强→降至少 1 星；双方相等→上限 ★★★。
- 发现自己在为反对方找理由→停下来重新考虑。
- 联赛排名是 H2H 预测的强制反对检查。
- 此检查必须在最终星级评定之前完成。

## 7. 市场层（Step 4）

- 初盘和临场盘都记录；历史尚未证明哪一时点恒定更可靠。赔率下降≠看好，需多盘口同步性验证。
- 去水：`隐含概率 = 1/赔率`；`去水概率 = 隐含概率 / (1/H + 1/D + 1/A)`。
- 比分赔率最低者只写入 `market.score_baseline`，不得用市场 Top1 事后改写实力层。
- 亚盘校验：只表达让球后的价格和净胜球范围，不自动等于 1X2 方向；让球与比分必须显式对应（完整表见 `reference/handicap-rules.md`）。
- 异动判断：多盘口同方向只提高“市场一致性”，盘口间矛盾则降置信；不得仅凭发生时段认定锐钱或散户。
- 赔率“不动”只记录为 `movement=stable`，不自动给平局增加固定百分点。
- 复核不能只写“方向是否翻转”：必须同时输出 `snapshot_count`、`movement_quality`、基准/最新 H-D-A、`delta_pp` 与主选/防选覆盖概率变化。少于 5 个跨时段快照不得称“趋势”。
- 跨公司校准：sharp=Pinnacle/必发；soft=竞彩/Bet365。
  - `gap = fair_soft(fav) - fair_sharp(fav)`。
  - gap>0 → 热门被超买，**含义是“赢得不够多”（让平），不是翻转方向**。
  - gap<0 → soft 对该侧给出的去水概率低于 sharp；只记录价格差，不自动认定 edge。
  - 无真 sharp → `gap=null`；非真 sharp 置信度降 40%；近 6 周换帅 gap 降权 30%。

## 8. 七维整合与信心评级（Step 5）

- 维度：基本面+Elo / 赔率信号 / xG-EV / 伤停阵容 / 裁判 / 天气 / 地理。
- 收敛→高信心；分歧→标记对冲/降星；回归风险→避免深盘。
- 竞彩让球最低赔 <1.80 是方向校验信号：与胜平负冲突时降一档。
- 数据完整度权重：基本面 20%、赔率 20%、xG 15%、伤停 15%、裁判 10%、天气 10%、地理 10%；部分数据给半分。
- 星级只表示证据收敛程度，不对应未经校准的命中概率：
  - ★★★★★ 全维度收敛且无红旗；★★★★☆ 强收敛；★★★☆☆ 有优势但存在分歧；★★☆☆☆ 分歧明显；★☆☆☆☆ 数据不足或方向脆弱。
- 红旗命中 → 星级封顶 + 明确标注；清单与 H2H 最新口径见 `reference/red-flags.md`。
- 星级 ≥⭐⭐⭐⭐ 前必须过“主客拆分”复核：主/客战绩同档或五五时，整体战绩不得单独支撑最高档；拆分结果写入 `facts`。
- Ensemble：泊松 / xG 差值 / 市场去水三票共识；3:0 信心不变，2:1 降一档，1:1:1 降两档。

## 9. 进球与比分模型（Step 6）

- 完整计算步骤见 `reference/score-model.md`。
- 必做：λ 双源校准 → 泊松 Top8 → U2.5 预筛 → 单点与方向解耦 → 长尾不追。
- `primary_score_probability`、`runner_up_score_probability`、`primary_gap` 与 `band_probability_mass` 必须直接从同一个联合比分分布计算；不得从 CRS 赔率或事后赛果回填。
- 对正式分布生成稳定的 `formal_probability_source_id`；HAD/HHAD/TTG/CRS、coverage、玩法表、候选和 ensemble.poisson 全部由该分布重算。它们只要与 source id 或概率重算不一致，AnalysisResult 即不完整。
- 比分带是唯一权威：`score.band_top8` 一旦写入 `AnalysisResult`，实力层、输出表和 betting 消费值必须逐字一致。
- 从联合比分分布聚合 HAD/HHAD/TTG/CRS 概率；HAFU 只有在上半场模型经过校准时才输出，否则为 `unavailable`。
- 每个在售选项同时给出 `model_prob`、同玩法去水 `market_prob` 和用于命中排序的 `conservative_prob=min(model_prob, market_prob)`；数据红旗可以进一步令候选不可用，但不能提高概率。

## 10. 输出契约：AnalysisResult（Step 7）

每场输出一个结构化对象；需要给人看时，把 `match_view` 渲染成表格。

```yaml
match:
  match_id: "2040794"
  home: "主队"
  away: "客队"
  kickoff_utc: "2026-08-16T17:00:00Z"

strength:
  direction: "home"          # home | draw | away | split
  hedge: "draw"              # 防的方向；单选时为 null
  confidence: "low"          # high | mid | low
  facts: []                  # 3-5条，不含赔率
  risk_tags: []
  coverage:
    primary_outcome: "H"
    hedge_outcome: "D"
    model_primary_prob: 0.58
    model_hedge_prob: 0.24
    model_cover_prob: 0.82
    market_primary_prob: 0.54
    market_hedge_prob: 0.27
    market_cover_prob: 0.81
    conservative_primary_prob: 0.54
    conservative_hedge_prob: 0.24
    conservative_cover_prob: 0.81
  evidence:
    supporting:
      - {type: "lineup", side: "home", source: "club_official", source_id: "club-lineup-1", captured_at: "2026-08-16T10:00:00Z", summary: "确认首发结构稳定"}
      - {type: "form", side: "home", source: "frozen_results", source_id: "form-1", captured_at: "2026-08-16T10:00:00Z", summary: "近五场攻防数据占优"}
      - {type: "xg", side: "home", source: "frozen_xg", source_id: "xg-1", captured_at: "2026-08-16T10:00:00Z", summary: "冻结xG机会质量占优"}
    opposing:
      - {type: "market", side: "away", source: "sporttery", source_id: "risk-1", captured_at: "2026-08-16T10:00:00Z", summary: "平局概率仍是主要尾部风险"}
      - {type: "injury", side: "home", source: "club_official", source_id: "risk-2", captured_at: "2026-08-16T10:00:00Z", summary: "主队一名核心球员确认缺阵"}
      - {type: "weather", side: "neutral", source: "weather", source_id: "risk-3", captured_at: "2026-08-16T10:00:00Z", summary: "降雨增加比赛节奏不确定性"}
    net_support_outcome: "H"
  ensemble_conflict_override: null # 全票共识与主方向相反时必填；否则省略/null

market:
  p_home: 0.52
  p_draw: 0.27
  p_away: 0.21
  gap: null                  # 无真 sharp 时必须为 null
  sharp_source: null
  asian_handicap: {status: "verified", line: -1, home_odds: 1.90, away_odds: 1.96, source_id: "exchange-ah-1", captured_at: "2026-08-16T11:00:00Z"}
  ou: "U2.5 1.88"
  movement: "stable"
  snapshot_count: 2
  movement_quality: "verified" # verified | unavailable
  timeline:
    - {source_id: "had-1", source: "sporttery", captured_at: "2026-08-16T08:00:00Z", p_home: 0.53, p_draw: 0.264, p_away: 0.206}
    - {source_id: "had-2", source: "sporttery", captured_at: "2026-08-16T11:00:00Z", p_home: 0.522, p_draw: 0.270, p_away: 0.208}
  baseline_had: {H: 0.53, D: 0.264, A: 0.206}
  latest_had: {H: 0.522, D: 0.270, A: 0.208}
  delta_pp: {H: -0.8, D: 0.6, A: 0.2}
  score_baseline: "1:0"      # 仅市场最低赔比分
  agree_with_strength: "partial"   # agree | partial | conflict

score:
  lambda_home: 1.42
  lambda_away: 1.01
  total_lambda: 2.43
  total_source: "ou"         # ttg | ou | 1x2_fallback
  u25_prob: 0.63           # 同玩法去水市场概率，用于 60% 必要闸门
  u25_gate: "pass"           # pass | fail
  band_top8: ["1:0","1:1","2:0","2:1","0:0","1:2","3:0","0:1"]
  primary_score: "1:1"       # P(score)最大，不绑定 direction
  primary_label: "guess"      # 固定为 guess，不得包装成稳胆/主推
  primary_score_probability: 0.142
  runner_up_score: "1:0"
  runner_up_score_probability: 0.136
  primary_gap: 0.006
  primary_fragile: true       # 表达层提示，不改变排序或候选资格
  band_probability_mass: 0.74
  formal_probability_source_id: "<sha256>"
  experience_input: {}       # 真实赛前冻结；缺失特征时保留 fallback 原因
  experience_candidate: {}   # user-selected formal v1 的可重算分布/Top1/Top8/HAD/HHAD/TTG
  experience_v2_candidate: {} # shadow only；不得静默替换 formal
  baseline_reference: {}
  model_policy:
    formal_family: "experience_adjusted_poisson_v1"
    formal_basis: "user_selected_primary"
    challenger_family: "experience_adjusted_poisson_v2"
    promotion_status: "observation_only"

plays:
  candidates:
    - market: "HAD"           # HAD | HHAD | TTG | CRS | HAFU
      candidate_id: "analysis-batch/match-id/HAD/主胜"
      selection: "主胜"
      odds: 1.85
      model_prob: 0.58
      market_prob: 0.54
      conservative_prob: 0.54
      probability_source_id: "<same sha256 as score.formal_probability_source_id>"
      pool_status: "Selling"
      single_allowed: true
      allup_allowed: true
      max_pass_size: 8
      odds_snapshot_at: "2026-08-16T12:00:00+08:00"
      eligible: true
      pool_allowed: true       # 是否允许进入跨场收益覆盖组合池；不表示高命中或正EV
      variance: "mid"         # low | mid | high
      veto_reasons: []
  unavailable: []              # 如 HAFU 未校准

confidence:
  completeness: 0.82
  stars: 3
  red_flags: []
  ensemble:
    poisson: "H"             # H | D | A
    xg: null                  # H | D | A | null；不可用时显式 null
    market: "H"              # H | D | A
    vote_count: {H: 2, D: 0, A: 0, unavailable: 1}
    consensus: "H"           # H | D | A | split；并列时为 split

data_quality:
  snapshot_at_utc: "2026-08-16T12:00:00Z"
  phase: "t45"               # early | t75 | t45
  form: {status: "available", reliability: 0.82, tier: "high", homeMatches: 5, awayMatches: 5, currentSeasonHomeMatches: 4, currentSeasonAwayMatches: 4}
  provenance: {analysis_input_path: "data/.../analysis-input.json", analysis_input_sha256: "<sha256>", evidence_pack_path: "data/.../evidence-pack.json", evidence_pack_sha256: "<sha256>"}
  lineup: {status: "confirmed", homeStarters: 11, awayStarters: 11, sourceGrade: "B", sourceRecordIds: ["raw-lineup-id"]}
  injuries: {status: "verified", homeCount: 1, awayCount: 0, sources: ["club_official"], sourceRecordIds: ["raw-injury-id"]}
  prematch_capture_windows:
    t75: {status: "captured", capturedAtUtc: "2026-08-16T10:45:00Z", rawDataId: "raw-t75", contentHash: "<sha256>"}
    t45: {status: "captured", capturedAtUtc: "2026-08-16T11:15:00Z", rawDataId: "raw-t45", contentHash: "<sha256>"}
  context:
    standings: {status: "verified", source_ids: ["standings-1"]}
    h2h: {status: "verified", source_ids: ["h2h-1"]}
    coaches: {status: "verified", source_ids: ["coach-1"]}
    referee: {status: "verified", source_ids: ["referee-1"]}
    weather: {status: "verified", source_ids: ["weather-1"]}
  evidence_polarity: "verified"
  stable_eligible: true
  stable_veto_reasons: []

match_view:
  胜平负: "主胜防平"
  让球胜平负: "主-1 平/胜"
  总进球: "2-3"
  点比分: "guess 1:1（14.2%，fragile）"
  比分资格: "eligible"       # eligible | analysis_only
  比分: "1:0, 1:1, 2:0, 2:1, 0:0, 1:2, 3:0, 0:1"

audit:
  version: "2.4.2"
  integrity_status: "pass"
  locked: true
  direction_flips: 0
  flip_basis: []   # direction_flips>0 时逐次填写：basis_type/from_direction/to_direction/market_agrees_with_flip/evidence
  errata: []
```

- `match_view.比分` 必须与 `score.band_top8` 逐字一致；禁止为汇总简洁裁掉任何带内比分。
- `match_view.点比分` 必须同时出现 `guess` 与 `score.primary_score`；`match_view.比分资格` 仅为 `eligible/analysis_only`，并与 CRS 候选的实际资格一致。
- `primary_fragile` 只用于防止把接近的点比分包装成确定判断；不得手工调换 Top8。默认 `primary_gap<0.02` 时为 true，并同时展示首位、次位及概率。
- `plays.candidates` 必须覆盖当期实际在售玩法；按 `conservative_prob` 排序，但分析层不得写“主推/下注/仓位”。
- 让球结果必须与比分对应；深盘（让-2+）默认平/负，只有全部条件满足才推让胜（见 `reference/handicap-rules.md`）。
- 临场调整：T-75/T-45 重新冻结整批输入；关键球员缺阵、首发变更或赔率改变时必须重算全部概率消费层和新 source id，不在旧票上局部换腿。

## 11. 数据落盘（Step 8，锁定前必做）

- 必须完成：原始数据归档、`memory/analysis-*.md`（`status: prediction`）、`MEMORY.md` 指针、ERRATA、三处比分带一致、玩法概率与赔率快照一致。
- 同批完整 AnalysisResult 必须先写入 `fdp.analysis-result.v2` 来源文件，并运行 `npx tsx scripts/analysis/_validate-analysis-result.ts --input=<analysis-result.json>`；完整跨字段合同见 `reference/analysis-result-validation.md`。
- `fdp.prediction-ledger.v1` 保存可重放摘要及上述来源路径；v2.3.4 起 `scripts/prediction-ledger/_lock-prediction-batch.ts` 会在锁定前再次校验完整来源，再核验锁定时间、赔率时序和 SHA-256。已锁文件禁止覆盖。
- 缺少可核验 `locked_at` 的旧 Markdown 只能迁移为 `legacy_import`；可统计方向/比分命中，但不得进入正式概率校准、walk-forward 结果或规则晋升。
- 赛后只运行独立 replay 回填赛果与指标；禁止修改锁定 JSON 内的方向、概率、比分带、候选或时间。
- 复盘或规则审计时按 `reference/rule-governance.md` 维护 `FDP_ROOT/docs/execution-reminders-pool.md`；普通预测不得让 observation/candidate 覆盖 active 规则。
- 命名、CLV 收盘价口径、完成校验：见 `reference/data-persistence.md`。
- 缺此步 = 批次未完成。
- v2.4.2 新分析的最小接入顺序：
  1. `scripts/analysis/_export-analysis-input.ts` 导出含完整欧赔时间线、`experience_snapshot`、T-75/T-45 原始记录 ID/哈希的赛前输入；
  2. 按 `reference/analysis-evidence-pack.example.json` 写入 `fdp.analysis-evidence-pack.v1`，每场至少3条支持和3条反证，并显式记录积分榜/H2H/教练/裁判/天气及亚盘来源；
  3. 运行 `npm run analysis:predict -- --analysis-input=<input.json> --evidence-pack=<evidence.json> --output=<analysis-result.json>`；唯一入口会拟合基线、实际消费经验 v1、嵌入冻结 v2 shadow、绑定输入哈希并执行严格校验；
  4. 用 `analysis_skill_version: 2.4.2` 进入锁定入口。任何缺失项必须形成 veto，禁止手工删除红旗后锁定。
- 模型“正式消费”与“统计晋升”是两件事：用户可以指定 v1 为 `user_selected_primary`，同时保留 `promotion_status=observation_only`；v2 在通过至少 30 个独立北京比赛日、相对 NLL 改善≥1%、日块 Bootstrap 区间下界>0 与 TopK/MAE/Brier 守门前仍是 shadow，不得静默替换。
- 复盘涉及 O1–O22 时，按 `reference/rule-governance.md` 生成逐样本 typed evidence，再运行 `npm run observations:record -- --input=<evidence.json>`；禁止提交汇总 `n/hits` 冒充样本。达到门槛后按独立人工审计合同运行 `npm run observations:review -- --input=<audit.json>`，普通预测仍不读取观察池。机器账本、状态报告与调度细节见 `FDP_ROOT/docs/observation-lifecycle.md`。

## 12. 核心原则

1. 赔率是市场基线，不是独立实力结论；规则不得用小样本异常翻转实力方向。
2. 分析目标是给出校准概率和可比较的体彩玩法候选；是否下注由 betting 层按用户目标决定。
3. 热门方向通常有更高原始命中率，但必须按同一市场概率档和时间口径校准；不得混用旧基线数字。
4. gap 仅是价格特征；现有回测尚不足以把 gap<0 当作独立方向 edge，更不能据此翻转方向。
5. 强热主队可提高方向命中率，但竞彩低赔通常为负 EV；命中目标与价值目标由 betting 层分别处理。
6. 弱热 40-60% 不属于高命中候选；<40% 的单侧方向更不适合命中优先方案。
7. 赛季初样本 <10 场的积分榜是幻觉，市场-实力长期矛盾时优先信市场。
8. 缺阵/双线作战必须降“方向”，不只降深盘。
9. 确认偏误是预测最大杀手；反对证据列了 ≠ 处理了。
10. 预测复盘优先报告锁定命中率、Brier/log loss、概率校准；CLV 和盈亏作为投注层指标分列。
11. 复盘必须区分主选命中、防平召回/精确率、TopK 宽度、真实票命中和 `bet_pl`；n<30 只能形成执行提醒，不能新增经验硬规则。

## 13. 参考文件索引

- `reference/data-sources.md` — 数据源分层、sharp/soft 取价、采集纪律
- `reference/injury-protocol.md` — 伤停来源优先级与模型调整
- `reference/tactical-intent.zh.md` — 大巴触发、xG 修正、矛盾检查（中文执行版）
- `reference/score-model.md` — λ 双源校准、Top8、U2.5 预筛
- `reference/handicap-rules.md` — 让球-比分对应规则
- `reference/score-patterns.md` — 比分/联赛/半全场经验分布（只作参考数据）
- `reference/sporttery-official-api.md` — 体彩官方接口
- `reference/red-flags.md` — 红旗清单与双向 λ 修正
- `reference/data-persistence.md` — 第 8 步数据落盘 SOP
- `reference/rule-governance.md` — 历史口径、观察项晋升与命中率审计
- `reference/pipeline-integration.md` — FDP 数据接通、阶段门禁与标准赛前输入
- `RULES_BASELINE.md` — 本 skill 当前生效规则基线（随 skill 安装/迁移）
- `AGENTS.md` — 任何 AI 工具使用本 skill 时必须遵守的写入边界
- `scripts/check-changelog.mjs` — changelog 写入规则校验
- `changelog/` — 带日期的规则级复盘；只写规则变化，不写每场结果（写入策略见 `changelog/README.md`）
