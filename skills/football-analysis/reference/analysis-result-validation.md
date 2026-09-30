# AnalysisResult v2.4.2 严格校验

本页定义 `fdp.analysis-result.v2` 的锁定前跨字段合同。它是输出结构治理，不是赛果经验规则；只对 `analysis_skill_version >= 2.3.4` 的新锁定批次强制，历史锁定文件保持不可变。

## 执行入口

```powershell
cd $env:FDP_ROOT
npx tsx scripts/analysis/_validate-analysis-result.ts --input=<analysis-result.json>
```

锁定器会从 `lock.source_paths` 中寻找 `schema=fdp.analysis-result.v2` 的 JSON 并再次执行同一校验。v2.3.4 起找不到完整来源或校验失败时，不得生成锁定账本。

来源文件顶层结构为：

```yaml
schema: fdp.analysis-result.v2
batch_id: analysis-YYYY-MM-DD-slot
matches:
  - <每场 AnalysisResult>
```

## 字段与跨字段合同

- `strength.direction` 仅为 `home/draw/away/split`，`strength.confidence` 仅为 `high/mid/low`。
- `market.p_home/p_draw/p_away` 均在 `[0,1]`，合计允许误差 `0.002`。
- `direction=split/draw` 时必须低置信；方向为 home/away 时，只检查该主方向对应的去水市场概率，低于 `0.60` 必须低置信。
- `market.agree_with_strength` 仅为 `agree/partial/conflict`。
- `score.band_top8` 必须恰好含 8 个不重复合法比分，首项必须等于 `primary_score`；首位、次位、差值和带概率质量必须齐全，`primary_gap` 与两概率之差允许误差 `0.0015`，`primary_fragile` 必须等于 `primary_gap<0.02`。
- 点比分必须有 `score.primary_label=guess`；`match_view.点比分` 同时包含 `guess` 和首位比分。
- `score.u25_prob` 必须是同玩法去水市场概率；`score.u25_gate` 仅为 `pass/fail`，并与 `u25_prob>=0.60` 一致。闸门失败时全部 CRS 候选必须 `eligible=false` 且 `pool_allowed=false`。
- `match_view.比分` 必须等于 `score.band_top8.join(', ')`；`match_view.比分资格` 仅为 `eligible/analysis_only`，并与是否存在合格 CRS 候选一致。
- `pool_allowed=true` 必须同时满足 `eligible=true`、`pool_status=Selling`、`allup_allowed=true`。
- `strength.coverage` 的主选、防选和覆盖 model/market/conservative 概率必须齐全；每组覆盖概率必须等于主选与防选之和，允许误差 `0.002`。
- `confidence.ensemble` 必须是结构化三路票：`poisson/xg/market`、`vote_count`、`consensus`。`xg` 不可用时显式为 null；计数必须和三路票一致，计数总和为 3；最高票并列时 consensus 为 split。
- v2.3.5 起，`strength.direction=home/draw/away` 必须分别对应 `coverage.primary_outcome=H/D/A`。
- v2.3.5 起，至少两路可用 ensemble 票全体同向且与最终主方向相反时，必须提供 `strength.ensemble_conflict_override`：`from_outcome` 等于全票共识、`to_outcome` 等于最终主方向，并填写 typed `basis_type` 与不少于 10 字的可核验证据。该字段只授权保留有证据的差异，不授权按赛果回填，也不要求自动翻向 ensemble。
- v2.3.7 或 v2.4.1+ 新分析必须将 `score.experience_candidate` 完整比分网格作为正式概率唯一来源。`score.formal_probability_source_id`、`strength.coverage.probability_source_id`、`plays.probability_source_id` 和每个可聚合候选的 source id 必须一致；HAD/HHAD/TTG/CRS、coverage 和 ensemble.poisson 必须通过该网格确定性重算。
- v2.4.1+ 必须含 `data_quality`。`stable_eligible` 必须与 `stable_veto_reasons` 是否为空一致；首发未确认、状态样本低可靠、伤停未验证或证据极性未验证都必须留下对应 veto 与 `strength.risk_tags`；闸门未过时 `confidence` 不得为 high。
- v2.4.2 起 `strength.facts` 必须有3-5条；`strength.evidence.supporting/opposing` 各至少3条，每条含 `type/side/source/source_id/captured_at/summary`。`net_support_outcome` 必须与 `coverage.primary_outcome` 一致，支持/反对不得重复同一摘要，缺证据不得补造。
- v2.4.2 起 `batch_id` 必须可作为账本标识，`match.match_id` 必须是数据库 UUID，赛事代码以3位编号结尾，每个候选必须有批内唯一 `candidate_id`。`data_quality.provenance` 必须绑定 analysis input 与 evidence pack 的路径/SHA-256；确认首发和 verified 伤停必须带来源记录 ID。T-75/T-45 任一实际窗口、欧赔双快照或亚盘交叉核验缺失时必须写对应 veto，`stable_eligible=false`。
- v2.4.2 起积分榜、H2H、教练、裁判、天气必须逐项记录 `verified/unavailable`、来源 ID；unavailable 必须有原因。正式 HAFU 还必须绑定至少30个独立样本的校准 artifact 路径与 SHA-256，否则保持 unavailable。

## 错误处理

校验器一次列出全部问题并带比赛编号，便于修正生成端。失败只阻止新锁定，不得据此修改历史锁定预测、赛后结果或 replay。
