#!/usr/bin/env node
/**
 * 出票格式 v2 生成器：每批两张票，单张票最多四场串。
 *
 * 票1 高命中：每场取 eligible 候选（HAD/HHAD）中 conservative_prob 最高者，
 *             按概率降序动态取 ≤4 场（≥0.60 才入选，对齐技能 9-24 唯一正 ROI 档），关数按腿概率动态定。
 * 票2 价值池：每场取 eligible 且 pool_allowed 的 CRS（过闸）否则 TTG 最优者，
 *             取 ≤4 场，关数按 P(≥3) 动态定。
 *
 * 关数动态规则：
 *   票1：avgP≥0.60 → [2]；0.45≤avgP<0.60 → [2,3]；avgP<0.45 → [2]（并提示腿弱）
 *        （若 4 场全部 single_allowed → 单关×4）
 *   票2：P(≥3)≥0.15 → [2,3]；否则 → [2]
 *
 * 用法：
 *   node scripts/betting/_generate-two-tickets.mjs \
 *     --analysis=<analysis-result.json> --output=<plan.json> \
 *     [--batch-id=<id>] [--stake=2] [--results=<results.json>] [--md=<plan.md>] \
 *     [--analysis-ledger=<已锁分析账本.json> --ledger-out=<账本草稿.json>]
 * results.json 形如 {"周五011":[0,1], ...}（主-客），键为 analysis-result 的 match.code。
 * ledger-out 模式：从已锁分析账本继承 odds_snapshot（买入快照），逐腿核对赔率未变，
 *   展开两票为 entertainment tickets，产出 fdp.prediction-ledger.v1 草稿（锁定+replay 用）。
 */
import fs from 'node:fs';
import path from 'node:path';

const arg = (name, fallback) => {
  const prefix = `--${name}=`;
  const found = process.argv.slice(2).find((x) => x.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
};

const STAKE = Number(arg('stake', '2'));
const analysisFile = arg('analysis');
const outputFile = arg('output');
if (!analysisFile || !outputFile) {
  console.error('用法: node scripts/analysis/_generate-two-tickets.mjs --analysis=<json> --output=<json> [--batch-id=] [--stake=] [--results=] [--md=]');
  process.exit(1);
}

const analysis = JSON.parse(fs.readFileSync(path.resolve(analysisFile), 'utf8'));
const batchId = arg('batch-id', analysis.batch_id ?? 'two-ticket');
const resultsArg = arg('results');
const RESULTS = resultsArg ? JSON.parse(fs.readFileSync(path.resolve(resultsArg), 'utf8')) : null;
const mdOut = arg('md');
const analysisLedgerFile = arg('analysis-ledger');
const ledgerOutFile = arg('ledger-out');
const bettingSkillVersion = arg('betting-skill-version', '2.4.5');
const betPlanOutFile = arg('bet-plan-out');

// ---------- 工具 ----------
function combinations(items, size, start = 0, prefix = [], out = []) {
  if (prefix.length === size) { out.push([...prefix]); return out; }
  for (let i = start; i < items.length; i++) combinations(items, size, i + 1, [...prefix, i], out);
  return out;
}
const outcomeOf = (h, a) => (h > a ? 'H' : h < a ? 'A' : 'D');
const round = (v, d = 4) => (Number.isFinite(v) ? Number(v.toFixed(d)) : v);

function settleLeg(leg, result) {
  if (!result) return null;
  const [h, a] = result;
  const sel = leg.selection;
  if (leg.market === 'HAD') return { H: '主胜', D: '平', A: '客胜' }[outcomeOf(h, a)] === sel;
  if (leg.market === 'HHAD') {
    const diff = h - (leg.handicap ?? 0) - a;
    if (sel === '让胜') return diff > 0;
    if (sel === '让平') return diff === 0;
    if (sel === '让负') return diff < 0;
    return null;
  }
  if (leg.market === 'TTG') {
    const total = h + a;
    const target = sel.replace('球', '');
    if (target === '7+') return total >= 7;
    return total === Number(target);
  }
  if (leg.market === 'CRS') {
    const key = sel.replace(':', '-');
    if (key === '胜其他') return h > a && !['1:0','2:0','2:1','3:0','3:1','3:2','4:0','4:1','4:2','5:0','5:1','5:2'].includes(`${h}-${a}`);
    if (key === '平其他') return h === a && ![1, 2, 3, 4, 5].includes(h);
    if (key === '负其他') return h < a && !['0:1','0:2','1:2','0:3','1:3','2:3','0:4','1:4','2:4','0:5','1:5','2:5'].includes(`${h}-${a}`);
    return `${h}-${a}` === key;
  }
  return null;
}

// ---------- 概率与 EV ----------
function ticketMetrics(legs, passes) {
  const n = legs.length;
  const p = legs.map((l) => l.p);
  const q = p.map((x) => 1 - x);
  const pAtLeast = (k) => {
    let sum = 0;
    for (let take = k; take <= n; take++) {
      for (const c of combinations([...Array(n).keys()], take)) {
        let prob = 1;
        for (let i = 0; i < n; i++) prob *= c.includes(i) ? p[i] : q[i];
        sum += prob;
      }
    }
    return sum;
  };
  // 期望返还：各过关大小的组合 2×∏odds×∏p
  let expectedPayout = 0;
  let combinationCount = 0;
  for (const size of passes) {
    for (const idx of combinations([...Array(n).keys()], size)) {
      let prod = 1, prob = 1;
      for (const i of idx) { prod *= legs[i].odds; prob *= p[i]; }
      expectedPayout += STAKE * prod * prob;
      combinationCount++;
    }
  }
  const cost = combinationCount * STAKE;
  // 恰中2 对子（仅当 passes 含 2）
  let profitIfExactPair = null;
  let allPairsOk = null;
  let pairFloorNet = null;
  if (passes.includes(2)) {
    profitIfExactPair = combinations([...Array(n).keys()], 2).map((idx) =>
      round(STAKE * legs[idx[0]].odds * legs[idx[1]].odds - cost, 2));
    allPairsOk = profitIfExactPair.every((x) => x > 0);
    pairFloorNet = Math.min(...profitIfExactPair);
  }
  return {
    combination_count: combinationCount,
    cost_at_2: cost,
    p_ge_1: round(pAtLeast(1)),
    p_ge_2: round(pAtLeast(2)),
    p_ge_3: round(pAtLeast(3)),
    p_all: round(pAtLeast(n)),
    expected_payout: round(expectedPayout),
    expected_net: round(expectedPayout - cost),
    per_yuan: round(expectedPayout / cost, 3),
    profit_if_exact_pair: profitIfExactPair,
    all_exact_pairs_profitable: allPairsOk,
    pair_floor_net: pairFloorNet,
  };
}

// ---------- 动态关数 ----------
function decideTicket1(legs) {
  if (legs.length >= 2 && legs.every((l) => l.single_allowed)) {
    return { passes: [1], label: `单关×${legs.length}`, reason: `${legs.length} 场全部允许单关 → 单关×${legs.length}` };
  }
  const avgP = legs.reduce((s, l) => s + l.p, 0) / legs.length;
  if (avgP >= 0.6) return { passes: [2], label: '仅2串1', reason: `avgP=${(avgP * 100).toFixed(0)}% ≥ 60% → 仅2串1（P≥2 达高命中，加关不加命中只加成本）` };
  if (avgP >= 0.45) return { passes: [2, 3], label: '2+3关', reason: `avgP=${(avgP * 100).toFixed(0)}%（40-60%）→ 2+3关（中3有肉）` };
  return { passes: [2], label: '仅2串1', reason: `avgP=${(avgP * 100).toFixed(0)}% < 45% → 仅2串1，腿偏弱提示` };
}

function decideTicket2(legs) {
  const probe = ticketMetrics(legs, [2]);
  if (probe.p_ge_3 >= 0.15) return { passes: [2, 3], label: '2+3关', reason: `P(≥3)=${(probe.p_ge_3 * 100).toFixed(1)}% ≥ 15% → 2+3关` };
  return { passes: [2], label: '仅2关', reason: `P(≥3)=${(probe.p_ge_3 * 100).toFixed(1)}% < 15% → 仅2关（加3/4关不提高 P≥2 只加成本）` };
}

// ---------- 组票 ----------
function pickLegs(kind) {
  const legs = [];
  for (const m of analysis.matches) {
    const cands = (m.plays?.candidates ?? []).filter((c) => c.eligible);
    let best = null;
    if (kind === 'hit') {
      best = cands
        .filter((c) => c.market === 'HAD' || c.market === 'HHAD')
        .sort((a, b) => b.conservative_prob - a.conservative_prob || (a.market === 'HAD' ? -1 : 1))[0];
    } else {
      const crs = cands.filter((c) => c.market === 'CRS').sort((a, b) => b.conservative_prob - a.conservative_prob)[0];
      const ttg = cands.filter((c) => c.market === 'TTG').sort((a, b) => b.conservative_prob - a.conservative_prob)[0];
      best = crs && crs.pool_allowed ? crs : ttg;
    }
    if (!best) continue;
    const p = Number(best.conservative_prob);
    if (kind === 'hit' && p < 0.6) continue; // 票1 只收 ≥60% 腿（9-24 规则：唯一正 ROI 档 +2.9%）
    legs.push({
      code: m.match.code, match_id: m.match.match_id, label: `${m.match.home} vs ${m.match.away}`,
      market: best.market, selection: best.selection, odds: Number(best.odds), p,
      single_allowed: best.single_allowed === true, handicap: best.handicap ?? null,
      candidate_id: best.candidate_id,
    });
  }
  legs.sort((a, b) => b.p - a.p);
  return legs.slice(0, 4); // 最多四场
}

function buildTicket(kind) {
  const legs = pickLegs(kind);
  if (legs.length < 2) {
    return { ticket: kind === 'hit' ? 1 : 2, status: 'no_qualified_legs', legs: [], reason: `合格腿 ${legs.length} < 2，无法组成串关` };
  }
  const decision = kind === 'hit' ? decideTicket1(legs) : decideTicket2(legs);
  const metrics = ticketMetrics(legs, decision.passes);
  const settled = RESULTS
    ? { legs_hit: legs.map((l) => settleLeg(l, RESULTS[l.code])), ticket_hit: null }
    : null;
  if (settled) {
    if (decision.passes[0] === 1) settled.ticket_hit = settled.legs_hit.some((x) => x === true);
    else {
      // 串关票命中：存在一组过关组合全中
      let hit = false;
      for (const size of decision.passes) {
        for (const idx of combinations([...Array(legs.length).keys()], size)) {
          if (idx.every((i) => settled.legs_hit[i] === true)) { hit = true; break; }
        }
        if (hit) break;
      }
      settled.ticket_hit = hit;
    }
  }
  return {
    ticket: kind === 'hit' ? 1 : 2,
    objective: kind === 'hit' ? 'hit_rate_first' : 'value_return_pool',
    status: 'ready',
    legs: legs.map((l, i) => ({ ...l, leg_index: i })),
    structure: { passes: decision.passes, label: decision.label, combination_count: metrics.combination_count, cost_at_2: metrics.cost_at_2 },
    probabilities: metrics,
    decision_reason: decision.reason,
    settled,
  };
}

const ticket1 = buildTicket('hit');
const ticket2 = buildTicket('value');

const plan = {
  schema: 'fdp.two-ticket-plan.v1',
  batch_id: batchId,
  generated_at: new Date().toISOString(),
  source_analysis: path.relative(process.cwd(), analysisFile).replaceAll('\\', '/'),
  stake_per_combination: STAKE,
  notes: [
    '票1 命中率来源是方向腿；竞彩禁单关时仅能 2串1，票级命中=各腿连乘。',
    '票2 为价值/娱乐池：P(≥2) 才是"中票"概率，期望净为负是竞彩抽水的数学，加 3/4 关不提高 P(≥2)。',
    '关数由腿概率动态决定（见 decision_reason）；最多四场。',
  ],
  tickets: [ticket1, ticket2],
};
fs.mkdirSync(path.dirname(path.resolve(outputFile)), { recursive: true });
fs.writeFileSync(path.resolve(outputFile), `${JSON.stringify(plan, null, 2)}\n`, 'utf8');

// ---------- Markdown 渲染 ----------
function renderLeg(l, isSingleStructure) {
  const single = isSingleStructure ? ' 单关' : '';
  return `${l.code} ${l.market} ${l.selection} @${l.odds} ${(l.p * 100).toFixed(1)}%${single}`;
}
function renderTicket(t) {
  if (t.status !== 'ready') return `票${t.ticket}：${t.reason}`;
  const isSingle = t.structure.passes[0] === 1;
  const rows = t.legs.map((l) => `  - ${renderLeg(l, isSingle)}${t.settled ? ` → ${t.settled.legs_hit[l.leg_index] === true ? '✓' : t.settled.legs_hit[l.leg_index] === false ? '✗' : 'N/A'}` : ''}`).join('\n');
  const m = t.probabilities;
  let md = `### 票${t.ticket} ${t.objective}（${t.structure.label} ${t.structure.combination_count}注${t.structure.cost_at_2}元）\n${rows}\n`;
  md += `- P(≥1)=${(m.p_ge_1 * 100).toFixed(1)}% P(≥2)=${(m.p_ge_2 * 100).toFixed(1)}% P(≥3)=${(m.p_ge_3 * 100).toFixed(1)}% 全中=${(m.p_all * 100).toFixed(1)}%\n`;
  md += `- 期望返还 ${m.expected_payout.toFixed(2)}元 | 期望净 ${m.expected_net.toFixed(2)}元 | 每元 ${m.per_yuan}\n`;
  if (m.profit_if_exact_pair) md += `- 恰中2对子净收益: ${m.profit_if_exact_pair.join(', ')} | 全回本=${m.all_exact_pairs_profitable}\n`;
  md += `- 定关依据：${t.decision_reason}\n`;
  if (t.settled) md += `- 结算：${t.settled.legs_hit.filter((x) => x === true).length}/${t.legs.length} 腿中，票${t.settled.ticket_hit ? '命中 ✓' : '未中 ✗'}\n`;
  return md;
}
if (mdOut) {
  const md = `# 出票 ${batchId}（两张票，最多四场/张）\n\n${renderTicket(ticket1)}\n\n${renderTicket(ticket2)}\n`;
  fs.writeFileSync(path.resolve(mdOut), md, 'utf8');
}

// ---------- 账本模式：产出 fdp.prediction-ledger.v1 草稿（锁定 + 买入快照 + replay 结算） ----------
if (ledgerOutFile) {
  if (!analysisLedgerFile) {
    console.error('--ledger-out 需要 --analysis-ledger=<已锁分析账本路径>（候选的 odds_snapshot 只存在那里）');
    process.exit(1);
  }
  if (!betPlanOutFile) {
    console.error('--ledger-out 需要 --bet-plan-out=<fdp.bet-plan.v1 artifact 路径>（v2.4.5 锁定要求 BetPlan artifact）');
    process.exit(1);
  }
  const analysisLedger = JSON.parse(fs.readFileSync(path.resolve(analysisLedgerFile), 'utf8'));
  const sourceCandidates = (analysisLedger.analysis?.matches ?? []).flatMap((m) => m.candidates ?? []);
  const byId = new Map(sourceCandidates.map((c) => [String(c.candidate_id), c]));

  // fdp.bet-plan.v1 artifact：v2.4.5 锁定契约要求
  const betPlanArtifact = {
    schema: 'fdp.bet-plan.v1',
    batch_id: batchId,
    created_at: new Date().toISOString(),
    source_analysis_batch_id: analysis.batch_id ?? batchId,
    bet_plan: {
      contract_version: bettingSkillVersion,
      objective: 'hit_rate_first',
      status: 'no_high_hit_option',
      decision: 'SKIP',
      legs: [],
      note: 'Two-ticket format v2; protocol SKIP (negative expectation / no stable legs), tickets recorded as user entertainment with disclosure.',
    },
  };
  if (betPlanOutFile) {
    fs.mkdirSync(path.dirname(path.resolve(betPlanOutFile)), { recursive: true });
    fs.writeFileSync(path.resolve(betPlanOutFile), `${JSON.stringify(betPlanArtifact, null, 2)}\n`, 'utf8');
  }

  const entertainmentCandidates = [];
  const entertainmentTickets = [];
  for (const ticket of [ticket1, ticket2]) {
    if (ticket.status !== 'ready') continue;
    const legs = ticket.legs.map((leg) => {
      const source = byId.get(String(leg.candidate_id));
      if (!source) throw new Error(`账本缺锁定候选: ${leg.candidate_id}`);
      if (Number(source.odds) !== leg.odds) throw new Error(`买入赔率与锁定快照不一致: ${leg.candidate_id}`);
      if (source.odds_snapshot?.pool_status !== 'Selling' || source.odds_snapshot?.allup_allowed !== true) {
        throw new Error(`官方快照不允许过关: ${leg.candidate_id}`);
      }
      return {
        candidate_id: `${source.candidate_id}/entertainment`,
        match_id: source.match_id,
        market: source.market,
        selection: source.selection,
        handicap: source.handicap,
        odds: source.odds,
        model_prob: source.model_prob,
        market_prob: source.market_prob,
        conservative_prob: source.conservative_prob,
        probability_source_id: source.probability_source_id,
        analysis_integrity_status: 'pass',
        stable_eligible: source.stable_eligible,
        ev: source.ev,
        eligible: true,
        pool_allowed: true,
        origin: 'user_entertainment',
        odds_snapshot: source.odds_snapshot,
        evidence_note: 'User-requested two-ticket format v2; negative expectation disclosed. Formal stability/EV gates do not apply to entertainment.',
      };
    });
    entertainmentCandidates.push(...legs);
    const passSizes = ticket.structure.passes;
    const lines = [];
    let lineIndex = 0;
    for (const size of passSizes) {
      for (const idx of combinations([...Array(legs.length).keys()], size)) {
        lineIndex += 1;
        lines.push({
          line_id: `${ticket.ticket === 1 ? 'ticket1' : 'ticket2'}-${String(lineIndex).padStart(2, '0')}`,
          leg_ids: idx.map((i) => legs[i].candidate_id),
          stake_cny: STAKE,
        });
      }
    }
    entertainmentTickets.push({
      ticket_id: ticket.ticket === 1 ? 'hit-rate-4max' : 'value-pool-4max',
      category: 'user_entertainment',
      structure: passSizes.length > 1 ? 'separate_pass_bundle' : 'single_pass',
      pass_sizes: passSizes,
      payout_basis: 'fixed_odds',
      stake_quality: 'assumed',
      expanded_lines: lines,
      combination_count: lines.length,
      cost_cny: lines.length * STAKE,
      expected_net_cny: ticket.probabilities.expected_net,
      note: 'No purchase record. CNY per combination is an assumed calculation basis, not actual stake or ROI. Format v2 user-requested ticket.',
    });
  }

  const ledgerDraft = {
    schema: 'fdp.prediction-ledger.v1',
    batch_id: batchId,
    record_status: 'locked',
    created_at: new Date().toISOString(),
    lock: {
      locked_at: null,
      time_quality: 'verified',
      analysis_skill_version: analysisLedger.lock?.analysis_skill_version ?? '2.4.2',
      betting_skill_version: bettingSkillVersion,
      source_paths: [
        path.relative(process.cwd(), analysisLedgerFile).replaceAll('\\', '/'),
        path.relative(process.cwd(), analysisFile).replaceAll('\\', '/'),
        path.relative(process.cwd(), outputFile).replaceAll('\\', '/'),
        path.relative(process.cwd(), betPlanOutFile).replaceAll('\\', '/'),
      ],
    },
    analysis: analysisLedger.analysis,
    bet_plan: {
      contract_version: bettingSkillVersion,
      objective: 'hit_rate_first',
      status: 'no_high_hit_option',
      protocol_decision: 'SKIP',
      protocol_candidates: [],
      protocol_tickets: [],
      entertainment_candidates: entertainmentCandidates,
      entertainment_tickets: entertainmentTickets,
    },
  };
  fs.mkdirSync(path.dirname(path.resolve(ledgerOutFile)), { recursive: true });
  fs.writeFileSync(path.resolve(ledgerOutFile), `${JSON.stringify(ledgerDraft, null, 2)}\n`, 'utf8');
  console.log(`ledger_draft=${path.resolve(ledgerOutFile)} entertainment_candidates=${entertainmentCandidates.length} entertainment_tickets=${entertainmentTickets.length}`);
}

console.log(JSON.stringify({
  ok: true,
  output: path.resolve(outputFile),
  batch_id: batchId,
  ticket1: { status: ticket1.status, structure: ticket1.structure?.label, cost: ticket1.probabilities?.cost_at_2, p_ge_2: ticket1.probabilities?.p_ge_2, expected_net: ticket1.probabilities?.expected_net, settled: ticket1.settled?.ticket_hit },
  ticket2: { status: ticket2.status, structure: ticket2.structure?.label, cost: ticket2.probabilities?.cost_at_2, p_ge_2: ticket2.probabilities?.p_ge_2, expected_net: ticket2.probabilities?.expected_net, settled: ticket2.settled?.ticket_hit },
}, null, 2));
