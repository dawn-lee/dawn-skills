# 规则治理与命中率审计

> 本文件用于复盘、修改规则和读取 `FDP_ROOT/docs/execution-reminders-pool.md` 时。普通单场分析不需要加载整个提醒池。

## 1. 目标口径

本项目的首要目标是：锁定赛前预测后，从体彩实际在售玩法中给出命中率优先的可执行方案。

“命中率高”必须指真实票命中，不能用以下方式虚增：

- 赛后改方向或补防；
- 把 WATCH 子集与完整批次混算；
- Top4、Top5、Top8 不分宽度直接汇总；
- 只报告“平局都被防平覆盖”，不报告所有防平场中实际平局比例；
- 扩大复式选项却不报告注数和成本；
- 单腿命中但整张串票未兑付，仍记作投注命中。

## 2. 必报指标

分析层：

- `strength_dir_hit`：锁定主选命中；`split` 单独统计，不回填原方向。
- Brier score / log loss：用赛前锁定概率计算，并与同场去水市场基线比较。
- 概率校准：按 `conservative_prob` 分档比较预测概率与实际兑现。
- 比分：按 TopK 分层报告覆盖率、K 值和累计概率质量；单点独立统计。
- 防平：同时报告 recall（平局覆盖）与 precision（防平场实际出平），以及复式成本。

投注层：

- `leg_hit_rate`、`ticket_hit_rate`、`batch_payout_rate` 分列。
- 复式票报告组合数、总成本、票命中概率和实际是否兑付。
- `protocol_bet_pl` 与用户自主娱乐票分列。
- CLV 仅在有独立真实收盘线时计算。

## 3. 观察项晋升

- 经验规律：先冻结触发条件、排除条件和样本单位，再做前瞻验证；原则上独立样本 `n≥30`。
- 轮次效应必须以“轮”为样本，并与同期非触发轮或历史同轮次对照。
- 结构规则（例如串关全损概率乘法、同一市场去水）可不受 n≥30 限制，但必须给出数学依据。
- 大样本回测优先于近期案例；发生冲突时近期案例不得升级。
- 禁止赛后追加排除条件来解释全部反例。
- 同一批既发现又验证的结果只能标 observation。

状态只用：

- `observation`：仅记录和前瞻验证，不改变方向/λ/候选资格；
- `candidate`：触发条件已冻结，等待独立验证；
- `active`：已进入 `RULES_BASELINE.md`；
- `rejected`：证伪或与更强证据冲突。

## 4. 回测最低要求

- 一场比赛每个公司/玩法/时点只保留一条明确记录；声明是初盘、分析快照还是收盘。
- 按赛季时间切分或 walk-forward，不能全样本发现后仍用全样本验证。
- gap 必须在相同 sharp 概率档内比较，并报告 `actual-sharp_prob` 与按目标渠道赔率计算的 ROI；原始命中率差不等于 edge。
- U2.5 只能证明大小球校准；若要支持比分玩法，必须另报 TopK 覆盖和目标赔率 ROI。
- 数据清洗、队名映射或查询 bug 修复后，所有依赖该数据的历史回测必须重跑。

## 5. 提醒池使用边界

- 预测时：只读取已 `active` 项；observation/candidate 最多写入审计备注，不能覆盖正式规则。
- 复盘时：按冻结条件回填触发与结果，不能修改赛前记录。
- 晋升时：先更新 `RULES_BASELINE.md`，再同步 `SKILL.md`/reference，最后写规则级 changelog。
- 自动化边界：赛果入库后可自动刷新冻结模型、重放账本和追加 `observation_only` 证据；普通证据即使达到门槛也不能写 `review_required`。只有绑定当前账本头、完整覆盖证据序列的独立人工审计才可发起复核，且禁止自动进入 `active`。

提醒池位于 `FDP_ROOT/docs/execution-reminders-pool.md`，不是普通预测的第二套规则库。每个活跃条目必须使用固定字段：

- `status`：`observation` 或 `candidate`；active/rejected 进入单独归档区。
- `sample_unit`：独立比赛、独立轮次或其他预先声明的单位。
- `frozen_condition`：赛前即可判定的触发条件，验证期间不得追加排除条件。
- `n / hits`：由逐样本 `unit_id` 和 `hit` 推导，不接受调用方提交汇总数字；每个样本必须绑定已声明来源批次，源文件路径和 SHA-256 必须现场核验并按内容归档。约数、重复 ID 或相关候选不得用于晋升。
- `source_batch_ids`：锁定批次或可审计历史批次。
- `promotion_gate`：默认独立样本 n≥30，并通过前瞻或 walk-forward 验证。

机器闭环位于 `FDP_ROOT/config/observation-registry.json` 与 `FDP_ROOT/data/observation-ledger/`：

- `npm run observations:refresh`：按已结算赛果 fingerprint 幂等刷新自动 evaluator；不训练或覆盖冻结模型。
- `npm run observations:record -- --input=<typed-evidence.json>`：把不能由锁定合同自动推导的观察逐样本追加为 typed evidence；仅接受 `fdp.typed-observation-evidence.v1`，并拒绝自动 evaluator 的手工覆盖。
- `npm run observations:review -- --input=<audit.json>`：验证 `fdp.observation-review-audit.v1` 与当前 ledger head、全部 typed evidence sequence、样本门槛和人工审计检查后，才写 `review_required`。
- `npm run observations:verify`：验证事件序号、前序 hash、事件 hash 和归档证据 hash。
- 旧记录缺 typed 触发条件时显示 `awaiting_typed_evidence`；不得从自然语言结果倒填成合格前瞻样本。
- `review_required` 表示上述独立审计已登记，但仍需按规则治理审查同一候选集、独立样本、时间切分、对照组和 Bootstrap/校准指标，再决定 active 或 rejected；它本身不影响预测。

复盘发现结构性合同错误（例如无授权却生成正式票、Top8 与 Top1 混报）应直接修合同/校验器，不进入提醒池等待样本。只有预测规律假设才进入提醒池。
