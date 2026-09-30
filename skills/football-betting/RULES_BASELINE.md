# RULES_BASELINE — football-betting

> 本文件随 `football-betting` skill 一起安装和迁移，是当前生效口径的权威快照。
> 本 skill 依赖 football-analysis；若同时安装，分析层模型规则以 `football-analysis/RULES_BASELINE.md` 为权威。本文件包含投注层口径与共享口径副本。

## 1. 投注与复盘（本层权威）

| 规则 | 当前值 | 状态 | 证据 |
|---|---|---|---|
| 默认目标 | 仅强调命中率或未指定时用 `hit_rate_first`；强调高命中且覆盖后盈利时用 `coverage_profit_first`；单腿正EV用 `value_first` | active | 用户目标 + 协议 |
| 命中排序 | 单腿按 analysis 的 `conservative_prob`；多个主票/备选/娱乐票按 `estimated_hit_prob` 降序。风险降权必须写入 `ranking_probability<=estimated_hit_prob` 与 `ranking_adjustment`，不得用未量化质量叙事调换排序 | active | 校准输出契约 + BetPlan确定性校验 |
| 无高命中授权闸门 | `hit_rate_first` 无票级概率≥65%时默认 `SKIP`、`primary_ticket=null`；中等命中只有用户明确接受后才能 override 成正式票 | active | 用户授权与标签一致性结构 |
| 命中优先腿级概率门槛 | 正式票腿 `conservative_prob>=0.60`；本批无任何 ≥0.60 候选时才可降到 ≥0.40，必须标 `leg_threshold_relaxed` 并披露该档历史 ROI −6.3%；<0.40 不得进命中优先正式票 | active | 2026-09-24 腿级门槛历史证据（1116 条/213 场） |
| 模型相对市场 edge | 模型主选 57.7% ≈ 市场热门 57.3%，主选一致率 99.5%；不得把模型概率当作独立于市场的 edge，也不得指望靠再校准提升命中率 | active | 2026-09-24 同上 |
| 主方案长度 | 合法单关优先；无单关才做 2串1；3+串不得作为高命中主方案 | active | 概率乘法 + 历史串关复盘 |
| 四场最稳语义 | 返回4个单场候选排名；四串1只能放 entertainment，必须报联合概率/期望净收益，不得标“稳/高命中” | active/结构 | 2026-09-05 长串语义修复 |
| 四场收益覆盖池 | 4 个不同场次可跨 HAD/HHAD/TTG/CRS/已校准HAFU 选腿；比较仅2关、2+3关、2+3+4关，与高命中方向方案分账 | active | 用户既有执行结构 + 组合数学 |
| EV 门槛 | `value_first` 要求逐腿 EV 达到 `minimum_leg_ev`（默认3%）；`hit_rate_first` 候选可为负 EV，但正式 `BET` 仍要求票级 `expected_net>0`，否则 SKIP/娱乐分列 | active | 双目标 + 购买授权分层 |
| AnalysisResult 完整性 | v2.4.5 正式腿必须有合法 `probability_source_id`、`analysis_integrity_status=pass`、`stable_eligible=true`、在售/玩法能力和赔率时间；任一失败不得称稳或进正式票 | active/结构 | 2026-09-06 分析-投注跨层闸门 |
| 投注观察证据 | O22 等只能由锁定票型、同候选集对照和结算证据生成逐样本 observation；唯一 ID、来源批次和源文件 SHA-256 必填，普通证据不能直接发起复核，`review_required` 不等于 active | active/结构 | 2026-09-06 证据合同加固 |
| 简单票确定性重算 | 单关/串1/娱乐票的联合概率、总赔率、成本、组合数、期望净收益必须由 legs 重算；手填不一致拒绝 | active/结构 | 2026-09-05 票级审计 |
| 收益池确定性重算 | 正式 `return_pool` 必须由4条锁定腿重算官方检查、关数组合、成本、P0/P1/P>=2/P>=3、盈利概率、期望收益和6组恰中两场净收益；缺失或手填不一致拒绝 | active/结构 | 2026-09-06 收益池锁单加固 |
| gap 用途 | 只作价格说明；不加命中概率、不翻方向、不单独决定仓位 | active | 回测方法审计 |
| 竞彩 1X2 | 超额率≈12.9%，返还率≈88.6% 恒定 | active | 实测 |
| 单关 | 非官方标单关的胜平负/让球/比分必须 2 串 1 起 | active | 竞彩规则 |
| 高方差玩法 | CRS/精确TTG/已校准HAFU 不进入高命中方向主方案，但可与 HAD/HHAD 一样参加 `return_pool` 计算 | active | 用户玩法 |
| 收益池盈亏 | 必报 P0/P1/P≥2/P≥3、6组恰中两场净收益、盈利概率、期望返还和期望净收益；不得把 P≥2 当盈利概率 | active | 组合数学 |
| 二中覆盖合格线 | 6种恰中两场的净收益必须全部>0 才能称“中两个就赚”；否则仅称条件性覆盖 | active | 最差对收益审计 |
| 收益池 ready 门槛 | `all_exact_pairs_profitable=true` 且 `expected_net>0`；仅二中覆盖但负期望须单独降级 | active | 状态收益与长期期望分离 |
| 收益池选腿来源 | 默认 `selection_policy=model_aligned`，四腿至少保留2个各自市场的 `selection_rank=1` 主选锚点；尾部腿不得静默替换主选 | active | 2026-08-29 选腿审计 |
| 收益池 shadow 模型授权 | `experience_shadow` 只可评估/观察，不能生成正式 `ready` 或 protocol return_pool；娱乐覆盖必须显式授权 | active | 影子模型治理 + 选腿审计 |
| 收益池双概率 | 覆盖/盈利概率用 `conservative_prob`，期望返还/净收益用 `model_prob`；缺任一口径不得出票 | active | 2026-08-23 无泄漏回测 |
| 体彩规则闸门 | 全腿 Selling + allup_allowed；不同场次；关数≤最严格腿上限；投注时固定奖金；奖金按官方单注封顶 | active | 体彩官方规则/接口 |
| 比分票全死先验 | 按当批概率计算并披露；不得与方向主方案混报 | active | 结构 |
| CLV | `(buy_odds/close_odds)-1`；收盘价必须独立于买入价 | active | 十进制赔率口径 |
| 比分/半全场/总进球 CLV | 标 N/A，只记命中与 `bet_pl` | active | 2026-08-13 |
| 复盘两套账 | `bet_pl` 与模型指标分列，不得混报 | active | 2026-08-13 |
| 强热低赔 | 可提高命中但竞彩通常负 EV；命中模式可列，必须标低回报/负价值，不得称价值票 | active | 渠道抽水回测 |
| 弱主胜坑 | <40% 才是真坑；40-60% 按隐含对待 | active | 50,206 场 |
| 弱热 40-60% | 只能标中低命中，不能因“可作串腿”进入命中优先主方案 | active | 历史统一审计 |
| 复式覆盖 | 同场最多2个互斥选项；概率相加，组合数/成本真实展开 | active | 命中率口径 |
| 覆盖盈利成本口径 | `coverage_profit_first` 允许为有效覆盖增加注数；成本是完整展开结果而非优先淘汰项，单纯加倍不改善命中率、EV或ROI | active | 用户目标澄清 + 组合数学 |
| 覆盖盈利 ready 门槛 | 票级覆盖概率≥阈值、所有覆盖分支达到净利润/ROI目标、`expected_net>0`、官方规则全通过；任一失败不得生成正式票 | active | 确定性分支枚举 |
| 覆盖票双概率口径 | 覆盖命中/盈利概率用 `conservative_prob`；`expected_net` 用独立或经校准的 `model_prob`，不得用同玩法去水概率替代模型价值概率 | active | 2026-08-23 无泄漏回测 + EV 定义 |
| 高收益标签 | 未提供数值目标时只验证严格正净收益；只有明确 `minimum_net_cny` 或 `minimum_roi` 并通过全部分支时才称达到对应高收益目标 | active | 防止收益语义夸大 |
| 复盘指标 | leg/ticket/batch payout 分列；防平同时报 recall/precision/成本；协议票与用户娱乐票分列 | active | 历史统一审计 |
| BetPlan 锁定 | 投注前将完整 BetPlan、候选唯一 ID、展开注、每注成本与买入赔率写入 `fdp.prediction-ledger.v1`；已锁批次拒绝覆盖 | active | 可重复结算的结构约束 |
| BetPlan 唯一生成入口 | `hit_rate_first`、`value_first`、`coverage_profit_first` 统一由 `generate-bet-plan.mjs` 消费 AnalysisResult 生成；无正期望或稳定资格失败必须 SKIP | active | 2026-09-06 生产入口收敛 |
| 真实盈亏资格 | 金额/票型未知、金额仅为 assumed、或体彩单关缺实际返奖时只结算命中，真实成本、净收益和 ROI 必须为 N/A | active | 禁止用假设金额冒充实盘 |
| 历史证据分级 | `legacy_import` 只作探索性复盘；只有锁定时间和赔率时序可核验的正式批次才能进入概率校准与规则晋升 | active | walk-forward 防泄漏 |
| 默认出票格式（两张票 v2） | 用户未指定其他目标时，默认按格式 v2 出两张票。**票1＝高命中**：候选腿为每场 HAD/HHAD 最高 `conservative_prob` 腿（**≥60% 才入选**，缺腿宁缺毋滥），最多四场；在「≥60% 腿串关（关数动态：avgP≥60%→仅2串1、45-60%→2+3关、<45%→仅2串1+腿弱提示、全单关→单关×N）／同场两选复式／单关」三种票型中**按目标函数取优**（默认 `P(兑付)` 降序，差距 ≤2pp 时取每元期望更高者）。**票2＝收益池**：顺位为「正 EV 单关 → 覆盖型（HAD/HHAD 同场两选、TTG 相邻两桶，按 `P(盈利)` 降序）→ 每场 CRS 过闸否则 TTG 最优的价值池」，本身**不是高命中票**。**硬闸门：同一张票内 ≥3 条窄桶腿（总进球精确档位／比分单点）直接拒绝**（容错为 0 且共享同一比赛形态因子；HAD/HHAD 方向腿不受限）。**每张票必须同时披露 `P(兑付)` 与 `P(盈利)`，并显式声明本次目标函数**；票2 负期望必须显式披露，不得称高命中。Top8 带是校准指标不是票面交付物。权威实现只有一份：`FDP_ROOT/scripts/betting/_generate-two-tickets.mjs`；本 skill 自带的 `scripts/_generate-two-tickets.mjs` 是**薄壳转发**（不含任何实现逻辑），FDP_ROOT 解析不到时明确报错、**不得退回旧实现**；仓库侧 `check-rules-baseline-sync.mjs` 会校验薄壳未被写回实现 | active | 2026-09-27 用户出票格式定案（25批试算）＋2026-09-24 腿级门槛历史证据＋2026-09-30 复盘（生成器内部「无条件优先复式」偏离本行，导致票1 选出 P(兑付) 更低的结构；已退役并改为按目标函数取优，见 changelog 2026-09-30） |

## 2. 共享口径副本（安装单个 skill 时使用）

- 比分带 = 泊松 **Top8**；U2.5≥60% 只是 CRS 候选必要条件，不构成投注 edge。
- 单点比分 = 带内 P(score) 最大，不绑定方向，只作 `guess`。
- 伤停优先级 = 球队官网 > 体彩官方线索 > fotmob/库 Injury > 聚合站。
- H2H≤3 短克星不触发降档；H2H≥4 长期克星轻微降档（λ_home×0.9、降深度一档）。
- `gap = fair_soft(fav) - fair_sharp(fav)`；只描述价格差，不改变实力方向。
- 正式预测/票据使用不可变 `fdp.prediction-ledger.v1`；赛果只写独立 replay，旧档缺锁定时间时不得进入正式校准。
- 正式概率源必须是验证过的 AnalysisResult formal distribution；用户选定的 v1 formal 与统计晋升状态分开，v2 shadow 不得正式出票。

## 3. 已退役/被替代口径

| 旧口径 | 替代为 | 证据 |
|---|---|---|
| 投注层自行按 Top5 选比分 | 消费 analysis 的 Top8 比分带 | 24,689 场回测 |
| 弱主胜 <60% 实际 31.5% | <40% 才是真坑，40-60% 按隐含 | 50,206 场 |
| 体彩官方伤停最高优先级 | 球队官网最高，体彩为线索 | 2026-08-10 实证 |
| H2H 短克星触发降档 | H2H≤3 不触发；仅 H2H≥4 长期克星轻微降档 | 154,574 场 |
| 投注层自行跑泊松兜底 | λ 与比分带由 football-analysis 唯一负责 | 2026-08-15 协议 |
| 默认只做正 EV、无正 EV 即 0 注 | 默认按用户目标选择；命中优先可展示负 EV 的最佳候选，但无≥65%高命中票时不自动出票 | 2026-08-19 授权闸门 |
| 稳健票优先压低绝对成本 | 用户接受覆盖成本时改为 `coverage_profit_first`：先验证命中、逐分支利润和正期望，成本仅作预算上限 | 2026-08-23 用户目标澄清 |
| 3-5 条方向串作为主价值票 | 主方案单关优先、最多2串1；长串仅娱乐 | 2026-08-18 历史串关全损审计 |
| 按玩法名称决定能否做四场池 | 改为跨玩法统一枚举；是否输出由成本覆盖、盈利概率和候选质量决定 | 2026-08-18 用户玩法澄清 |
| 星级决定锚和串关集中度 | 以 `conservative_prob` 和 `eligible` 为准，星级仅辅助 | 2026-08-18 星级未校准 |
| gap<−3% 唯一可重仓 | gap 降为价格特征，待控制概率强度与 ROI 重验 | 2026-08-18 回测方法审计 |
