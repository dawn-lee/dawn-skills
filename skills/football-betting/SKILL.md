---
name: football-betting
description: 足球体彩玩法决策。当用户要求“出方案”、“买哪几场”、“串关怎么组”、强调命中率/覆盖盈利或要求四场过2/3关时使用。消费 football-analysis 的 AnalysisResult 与玩法概率，输出高命中、覆盖盈利、价值或小额收益池 BetPlan；不重算比赛分析。
metadata:
  version: "2.4.5"
  dependencies: "football-analysis"
---

# football-betting 投注协议

## 0. 前置条件（强制）

1. 本 skill **不独立做比赛分析**；必须消费 `football-analysis` 的 `AnalysisResult`。
2. 使用前先运行 `node scripts/preflight.mjs`；未检测到 football-analysis 时必须停止，FDP_ROOT 未确认时不得开始分析/投注。
3. 本 skill 不重算实力方向、xG、伤停、泊松比分带或玩法概率；只消费 `AnalysisResult.plays.candidates` 中 `eligible=true` 的实际在售候选。
4. 先确定目标模式：用户只强调“命中率高”时用 `hit_rate_first`；用户要求“高命中且命中后整体盈利”、接受为有效覆盖增加成本时用 `coverage_profit_first`；用户明确要求单腿价值/正 EV 时用 `value_first`；用户要求“四场过2/3关、小钱博回报”时增加 `return_pool`。未说明时默认 `hit_rate_first`。三个主目标统一通过 `scripts/generate-bet-plan.mjs` 从 AnalysisResult 生成；四场收益池继续通过确定性选择器单列，不能手工填写汇总概率。
5. **默认出票格式（两张票 v2，见 RULES_BASELINE「默认出票格式」行）**：用户未指定其他目标时，按格式 v2 出两张票。**票1＝高命中**：候选腿为每场 HAD/HHAD 最高 `conservative_prob` 腿（≥60% 入选，最多四场，关数动态 avgP≥60%→仅2串1 / 45-60%→2+3关 / <45%→仅2串1+腿弱提示 / 全单关→单关×N），并在「≥60% 腿串关／同场两选复式／单关」三种票型中**按目标函数取优**（默认 `P(兑付)`；差距 ≤2pp 时取每元期望更高者）。**票2＝收益池**：顺位为「正 EV 单关 → 覆盖型（HAD/HHAD 同场两选、TTG 相邻两桶，按 `P(盈利)` 降序）→ 每场 CRS 过闸否则 TTG 最优的价值池」；票2 **不是**高命中票。**硬闸门：同一张票内 ≥3 条窄桶腿（总进球精确档位／比分单点）直接拒绝**。**每张票必须同时披露 `P(兑付)` 与 `P(盈利)` 并显式声明本次目标函数**；票2 负期望显式披露；Top8 带不是票面交付物。权威实现入口是 `FDP_ROOT/scripts/betting/_generate-two-tickets.mjs`；**本 skill 自带副本仅作参考、可能滞后，不得据其推定规则，发现漂移必须回报而不是照跑**。用户明确要求旧四目标流程（generate-bet-plan.mjs）时以其为准。

### 依赖与路径

- 本 skill 依赖 `football-analysis`；安装时必须同时安装，详见 `DEPENDENCIES.md`。
- `FDP_ROOT` 解析顺序：① 环境变量 `FDP_ROOT`；② 用户本次会话指定；③ 开发机默认 `<FDP_ROOT>`。
- 若解析出的路径不存在，先向用户确认，不得臆测路径。

## 1. 核心纪律

- 命中优先不等于无限扩选：每张票必须报告实际组合数、成本、估计命中概率和赔率；禁止用扩大选项数制造“稳”。
- `coverage_profit_first` 的成本是结果变量而非优先淘汰项：允许为互斥结果覆盖增加注数，但每个被覆盖分支都必须按整票总成本计算净收益；单纯提高倍数不会改善命中率、EV 或 ROI，不得靠加倍制造“高收益”。
- `hit_rate_first` 方向主方案优先顺序：合法单关 > 2串1；禁止用普通 3+ 串冒充高命中方向主方案。`coverage_profit_first` 与 `return_pool` 分别按各自确定性闸门处理。
- `hit_rate_first` 方向主方案按 `conservative_prob` 排序；同概率时依次偏好 HAD/低方差 HHAD、较少组合数、较完整数据。覆盖盈利票和 `return_pool` 不沿用这个成本排序。
- `hit_rate_first` **腿级概率门槛**：正式票的每条腿必须 `conservative_prob >= 0.60`。该批次在售候选里没有任何一条 ≥0.60 时，才允许降到 ≥0.40，并必须写出 `leg_threshold_relaxed` 与该档历史 ROI（−6.3%，见 `reference/leg-probability-threshold.md`）；低于 0.40 的候选不得进入命中优先正式票，只能进娱乐票或收益池。
- 不得把模型概率当作独立于市场的 edge：历史 213 场上模型主选命中 57.7%、市场热门 57.3%、两者一致率 99.5%（`reference/leg-probability-threshold.md`）。命中率的可调旋钮是**只打高概率腿**，不是调模型或再校准。
- `hit_rate_first` 输出多个主票、备选或娱乐票时，必须给出 `recommendation_rank` 与 `estimated_hit_prob`，并按命中概率降序。若相关性或风险需要降权，必须把折扣量化为不高于原估计值的 `ranking_probability`，同时填写 `ranking_adjustment`；不得用未量化的“质量更高/更稳”调换顺序。
- 强热低赔率可以提高命中率，但竞彩抽水可能导致长期亏损；命中优先模式可以列为最高命中候选，但负期望时不得进入正式 `primary_ticket/protocol_tickets`，也不得给 `decision=BET`。
- 竞彩 1X2 超额率≈12.9%（返还率≈88.6% 恒定）；别读固定抽水源的超额率变动。
- `value_first` 要求逐腿 `EV=model_prob×odds−1` 达到 `minimum_leg_ev`（默认 3%）；`hit_rate_first` 的候选排序不以正 EV 为前置，但必须披露 `ev`，不得把同一市场反推概率包装成独立 edge。正式购买授权必须额外满足票级 `expected_net>0`；否则只能 SKIP 或在用户明确给出娱乐预算后单列娱乐票。
- gap 只作价格说明，不能给腿加命中概率、翻转方向或单独决定仓位。
- 每批必须同时给“最高命中候选”和“成本/价值说明”。`hit_rate_first` 下没有估计票命中率≥65%的方案时，必须写 `status=no_high_hit_option`、`primary_ticket=null`，只列 `best_available` 与覆盖备选；只有用户明确要求仍选中等命中/强制给一场时才能设置 override 并形成正式票。
- 用户采用四场过 2/3 关时，必须跨 HAD/HHAD/TTG/CRS/已校准 HAFU 搜索 `return_pool`；玩法名称不决定资格，组合的成本覆盖能力和盈利概率才决定。不得把 `P(至少中2场)` 称为高命中。低成本是此类以小博大结构的预算约束，不得反向压低稳健覆盖票的有效组合数。
- `return_pool` 默认使用 `selection_policy=model_aligned`：每场候选保留 `selection_rank`，四腿至少包含2个各自市场的主选锚点（`market_selection_rank=1`）。禁止把四个非主选高赔率腿静默包装成“以小博大”；确需娱乐性尾部组合时，必须用 `selection_policy=unrestricted`、写明 `override_reason`，并标记为 `user_requested_entertainment_override`。
- `return_pool` 的 `conservative_prob` 只用于覆盖概率、盈利概率和风险边界；`model_prob` 只用于期望返还/期望净收益。`model_source=experience_shadow` 只能观察，不能形成正式 `ready` 或 protocol 票。
- v2.4.5 正式腿必须携带同一批次验证过的 `probability_source_id`、`analysis_integrity_status=pass`、`stable_eligible=true`、在售/单关或过关能力和赔率时间；`conservative_prob`、EV、成本、命中率及期望净收益必须可由腿级字段重算。用户选定但未统计晋升的 v1 可作 `formal_analysis`，前提是 AnalysisResult 明确 `formal_basis=user_selected_primary` 且跨层概率校验通过；仅 v2 shadow 不可正式出票。
- 用户要“四场最稳玩法”时，输出的是 **4 个单场候选排名**，不是一张高命中四串1。若同时给出四串1，必须放在 `entertainment`，报告四腿联合概率和期望净收益，标签不得含“稳/高命中”。
- 每场方案、命中、盈亏、CLV 只写 `FDP_ROOT/memory` 与 `FDP_ROOT/data`；**禁止写入 skill 目录或 `changelog/`**。`changelog/` 只收规则级结论（写入策略见 `changelog/README.md`）。

## 2. 竞彩规则前置检查

- 单关检查（强制）：竞彩只有官方标“单关”的比赛才能单场买；命中优先模式先找可单关候选，确实没有时才用 2串1。
- 总进球只接受单个精确数字（0-7+），“1-2球”范围不可买。
- 收益覆盖池每条腿必须在赔率快照中为 `pool_status=Selling`、`allup_allowed=true`；所选最大过关数不得超过各腿 `max_pass_size` 的最小值。
- 四场池要求 4 个不同 `match_id`。即使官方混合过关允许同场跨玩法，本协议也不把同场相关选项放入同一收益池。
- 过关使用投注时固定奖金；组合注数按实际展开，理论奖金还须应用官方单注封顶：2-3场20万元、4-5场50万元、6场及以上100万元。
- 详情见 `reference/jingcai-rules.md`。

## 3. 目标排序与收益组合

### 3.1 命中优先 `hit_rate_first`

- 排序主键：`conservative_prob`；高命中候选 ≥65%，中等 55-65%，<55% 不得称高命中。
- 单关票命中概率 = 该选项或复式选项概率和。
- 串票估计命中概率 = 各独立场次 `conservative_prob` 连乘；同联赛/同类风险时再下调并说明，不假装独立。
- 同场复式可覆盖至多 2 个互斥选项，命中概率相加，同时组合数和成本按真实展开计算。
- 没有单选或复式覆盖票达到 65% 时，不得把“相对最高”自动等同正式票。显式 override 必须记录 `overridden=true`、用户请求语义和中等/低命中标签；负 EV 继续披露。
- 达到 65% 只代表命中层过线，不等于购买层过线。正式主票还必须给出可审计的票级期望净收益且 `expected_net>0`；命中达标但期望净收益≤0时写 `status=high_hit_negative_expectation`、`decision=SKIP`、`primary_ticket=null`。
- 所有单关/串1/娱乐票的 `total_odds`、`estimated_hit_prob`、`combination_count`、`cost_at_2` 和 `expected_net_cny` 必须由引用腿确定性重算；不得手填四腿票概率。

### 3.2 价值优先 `value_first`

- `EV = model_prob × odds - 1`；必须使用独立于该体彩玩法赔率的信息或经过校准的模型概率。
- EV>3% 关注，>5% 强信号；EV≤0 不进入价值主方案。
- gap 只能辅助检查价格，未经按 sharp 概率档和实际赔率 ROI 验证前，不作为独立 edge。

### 3.3 稳健覆盖盈利 `coverage_profit_first`

- 目标排序：先通过官方/红旗闸门，再满足票级覆盖概率阈值，随后最大化 `estimated_profit_prob`、覆盖分支最低净收益和 `expected_net`；成本只作预算披露与用户上限，不因绝对金额较高自动淘汰。
- 每场允许 1–2 个互斥选项；复式选项必须来自同一场、同一玩法和同一盘口线。不同场之间做完整串关，所有选项按笛卡尔积展开，`combination_count=各场选项数乘积`，`cost=combination_count×每注金额`。
- 覆盖命中概率 = 各场复式概率和的连乘；不同比赛默认独立只作估计，同联赛/同类风险要下调或压力测试。不得把赛后 `primary+hedge` 覆盖率直接当作下一批票级概率。
- 对每个覆盖结果分支计算 `payout`、`net=payout−整票总成本`、`roi=net/整票总成本`。覆盖命中和盈利概率使用 `conservative_prob`；`expected_net` 必须使用独立信息或经校准的 `model_prob`，不得使用同玩法去水上限 `conservative_prob=min(model_prob, market_prob)` 代替，否则正期望闸门在正常抽水市场中会结构性失真。正式 `ready` 必须同时满足：`coverage_hit_prob≥high_hit_threshold`、全部覆盖分支达到利润目标、`expected_net>0`、官方玩法检查全部通过。
- 默认利润目标只要求每个覆盖分支严格净盈利；用户说“高收益”时应进一步给出 `minimum_net_cny` 或 `minimum_roi`，未给数值时不得把“仅正收益”夸大成高收益。
- 若命中率达标但部分覆盖分支亏损，状态为 `conditional_coverage_profit`；若全部覆盖分支盈利但整体期望为负，状态为 `high_hit_negative_expectation`；两者都不能生成正式票。
- 单关使用浮动奖金，不能用显示赔率证明覆盖后固定盈利；本模式的确定性分支收益只用于允许过关、使用投注时固定奖金的完整串关。
- 使用 `scripts/calc-coverage-profit.mjs` 确定性展开并保存全部分支；BetPlan 锁定前由 `scripts/validate-bet-plan.mjs` 重算，禁止手填汇总数绕过闸门。

### 3.4 小额收益覆盖组合 `return_pool`

- 适用：4 个不同场次、每场 1 个实际在售选项，玩法可为 HAD/HHAD/TTG/CRS/已校准 HAFU，也可跨玩法混合；同一场只取一个选项。
- 候选必须来自 `plays.candidates`，且 `eligible=true`、`pool_allowed=true`。CRS 只能从 `score.band_top8` 取；HAFU 未校准时不可入池；不为凑四场绕过红旗。
- 计算前先核验体彩规则字段：全部在售、全部允许过关、4 场互异、所选关数不超过最严格玩法上限、使用同一锁定批次的投注时固定奖金。任一失败则 `status=official_rule_blocked`。
- 通过 `scripts/select-return-pool.mjs` 自动选池，并保存 `selection_policy`、`minimum_primary_anchors`、`model_source`、`selection_alignment`、`market_selection_rank`。默认 `model_aligned` 且至少2个主选锚点；`unrestricted` 仅可作为明确授权的娱乐覆盖。
- 比较三种结构：仅 2关=`C(4,2)=6` 注/12元；2+3关=`6+4=10` 注/20元；2+3+4关=`11` 注/22元。3关和4关只增加三中/四中的回报，不提高“至少中2”的概率，还会提高恰中2时的回本门槛。
- 这不是“高命中票”。必须报告 `P0`、`P1`、`P(至少中2)`、`P(至少中3)`、全损概率、概率口径与相关性压力测试。
- “中两个就赚钱”必须按实际两场赔率逐对验证。恰中 i、j 两场时，净收益为 `2×odds_i×odds_j−总成本`：仅2关要求赔率乘积>6，2+3关要求>10，2+3+4关要求>11。
- 逐一计算 6 组 `profit_if_exact_pair`，并枚举 16 种命中状态得到每种结构的 `estimated_profit_prob`、`expected_payout`、`expected_net`；覆盖/盈利概率用 `conservative_prob`，期望返还/净收益用独立或经校准的 `model_prob`，并标注独立性假设。用 `scripts/calc-return-pool.mjs` 做确定性计算，不得手算省略状态。
- 默认“二中覆盖”合格线：`all_exact_pairs_profitable=true`，即 6 种恰中两场的净收益全部 >0；若只有部分组合盈利，只能标“条件性覆盖”，不得写“中两个就赚”。
- `all_exact_pairs_profitable` 只证明恰中两场时能覆盖成本，不证明长期正收益。正式收益池还要求 `expected_net>0`；否则标 `pair_coverage_negative_expectation`，只能作为明确披露负期望的小额方案，不能称盈利策略。
- 选池目标按用户偏好排序：先最大化 `estimated_profit_prob`，再比较 `expected_net` 和成本；但排序前必须通过主选锚点门控。低赔胜平负若二中仍无法覆盖成本会自然淘汰；高赔率玩法也必须同时通过概率与红旗闸门。

## 4. 玩法选择表

| 条件 | 主方案处理 | 标签 |
|---|---|---|
| `eligible=true`、单关、`conservative_prob≥65%` | 优先单关；从 HAD/HHAD 中取最高者 | 高命中 |
| 单关、55-65% | 默认只列 `best_available`；用户明确接受中等命中后才可形成正式票并记录 override | 中命中 |
| 无合格单关，存在两条 ≥65% 独立腿 | 只做 2串1，报告连乘命中率 | 中命中 |
| 复式两选后 ≥70% | 可给“稳妥复式”，报告组合数和成本 | 覆盖方案 |
| 单腿或整票 <50% | 只能列“最佳可用”，不得称高命中 | 低命中 |
| 同场同玩法1–2个互斥选项，整票覆盖≥65%，全部覆盖分支达利润目标且期望净收益>0 | 按3.3展开为正式覆盖盈利票；成本如实报告，不因较高自动否决 | 覆盖盈利 |
| 任意 `eligible=true,pool_allowed=true` 候选 | 可参与 3.4 的跨玩法收益覆盖计算；只有能覆盖成本的结构才输出 | 收益覆盖池 |
| CRS 单点、精确 TTG、已校准 HAFU | 不进高命中方向主方案，但可按 3.4 入池 | 高方差候选 |
| 未校准 HAFU | 不进入任何正式方案 | 不可用 |
| 任一候选 `eligible=false` | 不进入 BetPlan | 否决 |

补充规则：

- CRS 只能从 `band_top8` 取子集；不得把完整 Top8 假装成一条腿。所有玩法进入 `return_pool` 前使用同一套成本/盈利枚举，不因赔率高直接放行。
- “主胜防平”是分析覆盖语言；投注时必须落为真实单选或复式两选，并计入组合成本。
- 同一场多个玩法高度相关，不得放进同一主票制造伪分散。
- 星级只作证据收敛参考，不能替代 `conservative_prob`。

## 5. 串关设计

### 5.1 输出层级

1. **主方案**：`hit_rate_first` 只有票级保守概率≥65%且票级期望净收益>0时生成；命中达标但负期望时为 `high_hit_negative_expectation`，`primary_ticket=null`。`coverage_profit_first` 的正式主票写入 `coverage_ticket`，只有同时通过命中、逐分支利润和正期望闸门时生成。
2. **稳妥复式**：仅当两个互斥选项覆盖能显著提高命中率时提供，必须列展开注数和成本。
3. **备选方案**：与主方案使用不同比赛，避免共享脆弱腿；不得为了“有方案”硬凑。
4. **收益覆盖组合**：用户采用四场过 2/3 关时输出正式 `return_pool`，可跨玩法，与高命中方向方案分账。
5. **娱乐玩法**：不符合 `return_pool` 成本覆盖/概率闸门的高方差玩法和任意长串单独列，不计入正式方案。

### 5.2 构建硬规则

1. 高命中单选方向主方案最多 2 场；普通 3+ 串只能列娱乐方案。`coverage_profit_first` 可使用 2–8 场完整覆盖串，但必须由确定性脚本展开且票级命中率仍达标；四场 `return_pool` 展开 2/3 关按 3.4 单列。
2. 每条腿必须来自 `plays.candidates` 且 `eligible=true`；不得绕过 analysis 红旗。
3. 深盘（主让-2+）、CRS 单点、精确 TTG 和未校准 HAFU 不作主方案锚。
4. 串关前重算真实票概率；任何一腿 <65% 时，2串1通常无法达到高命中标准，必须降级标签。
5. 同日同类信号、同联赛、同赛季首轮要检查相关风险；不可直接把概率相乘后称精确。
6. 多张票共享腿≤1；共享腿一挂导致全灭时必须重构。
7. 复式每增加一个选项都要展开组合数；默认预算口径为 2元/注，但不擅自决定用户实际金额。
8. 已知红旗、数据不完整或锁定后重大阵容变化 → 撤腿或重新调用 football-analysis，不在 betting 层修分析。

### 5.3 收益覆盖组合与娱乐边界

- 用户明确要求四场过 2/3 关时，另起 `return_pool` 区块，不改变命中优先方向方案。
- 允许跨玩法选择 4 个不同场次，分别比较仅2关、2+3关、2+3+4关；不得默认认为多买3/4关更划算。
- 若候选不足 4 场，不硬凑；可以缩为 3 场只做 3 注 2串1，或明确本批无合格收益覆盖池。
- 娱乐预算上限只有在用户给出预算后才能计算；不得从主方案仓位自动划拨。

## 6. BetPlan 输出契约

```yaml
bet_plan:
  contract_version: "2.4.5"
  objective: "hit_rate_first"  # hit_rate_first | coverage_profit_first | value_first
  status: "ready"              # ready | no_high_hit_option | high_hit_negative_expectation | no_profitable_high_hit_coverage
  decision: "BET"              # BET | SKIP
  gate:
    high_hit_threshold: 0.65
    minimum_leg_ev: 0.03       # value_first 使用
    best_conservative_prob: 0.66
    reasons: []
    overridden: false
    override_reason: null
  best_available: null          # 无高命中票时保留最高候选；不等于正式票
  legs:
    - candidate_id: "<AnalysisResult candidate_id>"
      analysis_match_id: "2040794"
      market: "HAD"
      selection: "主胜"
      odds: 1.40
      conservative_prob: 0.66
      model_prob: 0.69
      market_prob: 0.66
      ev: -0.03
      probability_source_id: "<analysis formal_probability_source_id>"
      analysis_integrity_status: "pass"
      stable_eligible: true
      hit_tier: "high"         # high | mid | low
      single_allowed: true
      veto_checks: []
  primary_ticket:
    type: "单关"
    legs: [0]
    combination_count: 1
    cost_at_2: 2
    total_odds: 1.40
    estimated_hit_prob: 0.66
    expected_net_cny: 0.08       # 正式票必须 >0；否则移入 entertainment
    label: "高命中"
  coverage_ticket: null
  return_pool:
    contract_version: "2.4.3"
    status: "ready"          # ready | pair_coverage_negative_expectation | conditional_pair_coverage | no_model_aligned_pool | experience_shadow_only | tail_override_required | official_rule_blocked
    category: "protocol_return_pool" # 或 user_requested_entertainment_override
    selection_policy: "model_aligned" # model_aligned | unrestricted
    minimum_primary_anchors: 2
    model_source: "formal_analysis" # formal_analysis | calibrated_challenger | experience_shadow
    override_reason: null
    selection_alignment:
      primary_anchor_count: 2
      non_primary_count: 2
      model_aligned: true
    selections: []           # 4个不同场次，可跨玩法；含玩法/选项/赔率/概率
    official_rule_checks:
      all_selling: true
      all_allup_allowed: true
      distinct_matches: true
      pass_size_within_cap: true
      fixed_odds_snapshot_locked: true
    passes: [2, 3]
    combination_count: 10
    cost_at_2: 20
    p0: null
    p1: null
    p_at_least_2: null
    p_at_least_3: null
    estimated_profit_prob: null
    expected_payout: null
    expected_net: null
    all_exact_pairs_profitable: null
    pair_floor_net: null
    profit_if_exact_pair: [] # 6组两两命中时的净收益
    probability_basis: "conservative_prob"
    expected_value_probability_basis: "model_prob"
  entertainment: []
  clv_tracking:
    - leg_index: 0
      buy_odds: 1.85
      close_odds: null
      clv: null
      hit: null
```

`coverage_profit_first` 的 `coverage_ticket` 最小结构：

```yaml
coverage_ticket:
  type: "full_pass_coverage"
  groups:                       # 2-8个不同比赛；每组1-2个同玩法同盘口互斥选项
    - match_id: "match-1"
      options:
        - id: "match-1/had/home"
          match_id: "match-1"
          market: "HAD"
          selection: "主胜"
          odds: 2.10
          model_prob: 0.55
          market_prob: 0.46
          conservative_prob: 0.46
          eligible: true
          pool_allowed: true
          pool_status: "Selling"
          allup_allowed: true
          max_pass_size: 8
          odds_snapshot_at: "2026-08-23T04:00:00Z"
        - id: "match-1/had/draw"
          match_id: "match-1"
          market: "HAD"
          selection: "平"
          odds: 3.10
          model_prob: 0.32
          market_prob: 0.31
          conservative_prob: 0.31
          eligible: true
          pool_allowed: true
          pool_status: "Selling"
          allup_allowed: true
          max_pass_size: 8
          odds_snapshot_at: "2026-08-23T04:00:00Z"
    - match_id: "match-2"
      options:
        - id: "match-2/had/home"
          match_id: "match-2"
          market: "HAD"
          selection: "主胜"
          odds: 1.05
          model_prob: 0.92
          market_prob: 0.86
          conservative_prob: 0.86
          eligible: true
          pool_allowed: true
          pool_status: "Selling"
          allup_allowed: true
          max_pass_size: 8
          odds_snapshot_at: "2026-08-23T04:00:00Z"
  probability_basis: "conservative_prob"
  expected_value_probability_basis: "model_prob"
  stake_per_combination: 2
  profit_target:
    minimum_net_cny: 0
    minimum_roi: 0
  combination_count: 2
  cost_cny: 4
  estimated_hit_prob: 0.6622
  estimated_profit_prob: 0.6622
  expected_net_cny: 0.15
  covered_branch_floor_net_cny: 0.41
  covered_branch_floor_roi: 0.1025
  all_covered_branches_profitable: true
  all_covered_branches_meet_target: true
```

这些汇总字段必须由脚本生成并由验证器重算。没有 `ready` 覆盖票时，`status=no_profitable_high_hit_coverage`、`decision=SKIP`、`coverage_ticket=null`、正式 protocol tickets 为空。

`status=no_high_hit_option` 且未 override 时，`decision=SKIP`、`primary_ticket=null`、正式 protocol tickets 为空。通用生成命令为 `node scripts/generate-bet-plan.mjs --analysis=<analysis-result.json> --output=<bet-plan.json> --objective=<hit_rate_first|value_first|coverage_profit_first> --batch-id=<bet-batch-id>`。写盘后、锁定前仍必须运行 `node scripts/validate-bet-plan.mjs <bet-plan.json>`；验证失败不得锁定。

`hit_rate_first` 命中率达标但票级期望净收益≤0时，必须写 `status=high_hit_negative_expectation`、`decision=SKIP`、`primary_ticket=null`、正式 protocol tickets 为空；只有用户明确请求且给出娱乐预算时，才可在 `entertainment` 中保留该结构。

`hit_rate_first` 的 `legs` 必须按 `conservative_prob` 降序；多个 `entertainment`/备选票必须按 `recommendation_rank` 连续编号，并通过上述量化排序校验。

## 7. 命中与复盘闭环

- 出票前把完整 BetPlan 写入自身投注批次的 `fdp.prediction-ledger.v1`，并用 `source_analyses` 指向已锁定的 AnalysisResult 批次：每条正式腿必须原样继承 `candidate_id`，每张票必须展开到逐注 `leg_ids + stake_cny`，并保存投注时 OddsHistory 快照。只写组合名称、不写展开注视为不可重放。
- 无高命中且未 override 的批次仍可锁定决策证据，但账本必须为 `protocol_decision=SKIP` 且 `protocol_tickets=[]`；不得为便于重放而制造一张 assumed 正式票。
- 正式批次用 `FDP_ROOT/scripts/prediction-ledger/_lock-prediction-batch.ts` 锁定；赛后用 `_replay-prediction-ledger.ts` 独立结算，禁止修改原票型、买入赔率、概率或仓位。
- `CLV = (buy_odds / closing_odds) - 1`；买入赔率下单时填，收盘/命中赛后回填。买入赔率高于收盘赔率时 CLV 为正。
- 收盘价必须独立于买入价；无近开赛收盘快照 → 标“无真收盘线，CLV 失真”。
- 比分/半全场/总进球无欧式收盘线 → CLV 标 N/A，只记命中与 `bet_pl`。
- 必报：`leg_hit_rate`、`ticket_hit_rate`、`batch_payout_rate`、`estimated_hit_prob vs actual`；单腿中但串票未兑付时，票仍记未命中。
- 复式票同时报告防平 recall、precision、组合数和成本，不能只报覆盖成功。
- `protocol_bet_pl` 与用户自主娱乐票分列；模型指标（score_band_hit / strength_dir_hit）不得混入投注命中。
- 金额/组合方式未知、金额仅为 assumed、或体彩单关没有实际返奖时，可以结算逐腿/逐票命中，但真实成本、净收益和 ROI 必须为 N/A；不得用“按 1 元假设”冒充实盘。
- `legacy_import` 只作探索性复盘；只有锁定时间、赔率时序和实际展开注可核验的正式批次才能进入概率校准与规则晋升。
- O22 等投注观察只能从同一候选集、锁定票型与结算证据生成逐样本 typed evidence：每张独立票必须有唯一 `unit_id`，绑定来源批次和现场核验的源文件 SHA-256，再通过 `npm run observations:record -- --input=<evidence.json>` 进入账本并保持 `observation_only`。缺 `selection_alignment`、实际展开注或对照池时保持 `awaiting_typed_evidence`，不得用事后重组票补齐；达到门槛仍需绑定当前账本头的独立审计运行 `observations:review`，不能由普通证据直接写 `review_required`。
- 方案与 CLV 表必须随 analysis 第 8 步落盘到 `FDP_ROOT/memory` 和 `FDP_ROOT/data`，并在 `MEMORY.md` 加指针。

## 8. 投注层 Pitfalls（只保留投注相关）

- 赔率下降≠看好，可能是散户堆的；多盘口同步性验证。
- 多源一致≠稳；“庄家陷阱”叙事慎用。
- 竞彩超额率恒定，别读其变动；验证“看盘口诀”要翻译成可计算量。
- 竞彩弱主胜：<40% 不适合命中优先；40-60% 只能标中低命中；>70% 仍需考虑实际赔率和红旗。
- 防平覆盖必须落成真实复式并计成本；“所有平局都防到”只是 recall，不代表方案命中率高。
- 杯赛冷门率翻倍，比分带扩大到 Top8（由 analysis 层统一交付）。
- 高赔率不自动等于好组合；必须与命中概率、展开成本一起枚举。低赔高命中也不自动入池，若二中无法覆盖总成本应淘汰。
- 四场池必须按当批四腿概率计算全死先验，不得固化成玩法常数。
- 方向对≠比分对；让球与比分必须显式对应；深盘陷阱不过度泛化。
- 低赔胜平负与深盘让胜不是同一命中概率；不得为了提高赔率把高命中主胜替换成低命中让胜。
- 信心超报纪律：`conservative_prob<65%` 禁止称“高命中/稳腿”。
- “最佳可用”只是排序结果，不是投注授权；无高命中时自动生成正式票属于合同错误。
- 四场池过 2/3 关具有“两中即兑付”的容错，但兑付不等于盈利；必须按实际玩法赔率、过关结构和总成本评估。
- 体彩可售状态优先于数学结果：停售、不可过关、超过玩法关数上限或赔率快照未锁定时，盈利概率再高也不得输出可执行方案。
- 数据/脚本细节：scoreOdds JSON key 用冒号格式（"2:1"）。

## 9. 数据与验证

- sharp/soft 取价与采集：见本目录 `reference/data-sources.md`；本 skill 只消费价格。
- 算 gap 的 `fair_sharp` 必须用该场次当前线。
- 回测脚本索引：见 `scripts/README.md`；核心脚本 `_backtest-poisson.ts`、`_bt-sporttery.ts`、`_bt-fdcouk.ts`。
- 候选超过 4 条时用 `scripts/select-return-pool.mjs` 自动枚举四场池和 2/3/4 关结构；只有二中全覆盖且 `expected_net>0` 才返回 `ready`。
- 高命中且覆盖后盈利使用 `scripts/calc-coverage-profit.mjs` 展开同场互斥选项的完整串关；只有票级命中达标、所有覆盖分支达到利润目标且 `expected_net>0` 才返回 `ready`。
- 竞彩规则细节：见 `reference/jingcai-rules.md`；历史复盘索引：见 `reference/postmortem-summary.md` 与 `changelog/`（写入策略见 `changelog/README.md`）。
- 规则基线：见本目录 `RULES_BASELINE.md`；AI 写入边界：见本目录 `AGENTS.md`；提交前运行 `node scripts/check-changelog.mjs`。
