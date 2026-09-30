import fs from 'node:fs';
import { combinations, evaluateReturnPool } from './return-pool-core.mjs';

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

const inputPath = process.argv[2];
const raw = inputPath ? fs.readFileSync(inputPath, 'utf8') : fs.readFileSync(0, 'utf8');
let input;
try {
  input = JSON.parse(raw);
} catch (error) {
  fail(`Invalid JSON: ${error.message}`);
}

if (!Array.isArray(input.candidates) || input.candidates.length < 4 || input.candidates.length > 20) {
  fail('candidates must contain 4-20 AnalysisResult candidates');
}

const selectionPolicy = input.selectionPolicy ?? 'model_aligned';
const minimumPrimaryAnchors = input.minimumPrimaryAnchors ?? 2;
const modelSource = input.modelSource ?? 'formal_analysis';
const overrideReason = String(input.overrideReason ?? '').trim();
const contractVersion = '2.4.3';
if (!['model_aligned', 'unrestricted'].includes(selectionPolicy)) {
  fail('selectionPolicy must be model_aligned or unrestricted');
}
if (!Number.isInteger(minimumPrimaryAnchors) || minimumPrimaryAnchors < 0 || minimumPrimaryAnchors > 4) {
  fail('minimumPrimaryAnchors must be an integer between 0 and 4');
}
if (!['formal_analysis', 'calibrated_challenger', 'experience_shadow'].includes(modelSource)) {
  fail('modelSource must be formal_analysis, calibrated_challenger, or experience_shadow');
}
if (selectionPolicy === 'unrestricted' && !overrideReason) {
  fail('unrestricted selectionPolicy requires an explicit overrideReason');
}

const rejected = [];
const candidates = [];
for (const candidate of input.candidates) {
  const reasons = [];
  if (candidate.eligible !== true) reasons.push('eligible=false');
  if (candidate.pool_allowed !== true) reasons.push('pool_allowed=false');
  if (candidate.pool_status !== 'Selling') reasons.push('not_selling');
  if (candidate.allup_allowed !== true) reasons.push('allup_not_allowed');
  if (!candidate.match_id) reasons.push('missing_match_id');
  if (!(Number.isFinite(candidate.odds) && candidate.odds > 1)) reasons.push('invalid_odds');
  const probability = candidate.conservative_prob ?? candidate.probability;
  if (!(Number.isFinite(probability) && probability >= 0 && probability <= 1)) reasons.push('invalid_conservative_prob');
  if (!(Number.isFinite(candidate.model_prob) && candidate.model_prob >= 0 && candidate.model_prob <= 1)) reasons.push('invalid_model_prob');
  if (candidate.selection_rank != null && (!Number.isInteger(candidate.selection_rank) || candidate.selection_rank < 1)) {
    reasons.push('invalid_selection_rank');
  }
  if (!(Number.isInteger(candidate.max_pass_size) && candidate.max_pass_size >= 1)) reasons.push('invalid_max_pass_size');
  if (!candidate.odds_snapshot_at) reasons.push('missing_odds_snapshot_at');

  if (reasons.length) {
    rejected.push({ id: candidate.id ?? null, match_id: candidate.match_id ?? null, reasons });
    continue;
  }
  candidates.push({
    ...candidate,
    probability,
    conservative_prob: candidate.conservative_prob ?? probability,
  });
}

if (new Set(candidates.map((candidate) => candidate.match_id)).size < 4) {
  fail('fewer than four distinct eligible matches remain after official/data gates');
}

const marketGroups = new Map();
for (const candidate of candidates) {
  const key = `${candidate.match_id}|${candidate.market}|${candidate.handicap ?? ''}`;
  const group = marketGroups.get(key) ?? [];
  group.push(candidate);
  marketGroups.set(key, group);
}
for (const group of marketGroups.values()) {
  const explicitRanks = group.map((candidate) => candidate.selection_rank).filter((rank) => rank != null);
  if (explicitRanks.length > 0 && explicitRanks.length !== group.length) {
    fail('selection_rank must be present for every candidate in a market group or for none');
  }
  if (new Set(explicitRanks).size !== explicitRanks.length) {
    fail('selection_rank must be unique within a market group');
  }
  const ranked = [...group].sort((left, right) => {
    if (explicitRanks.length > 0) return left.selection_rank - right.selection_rank;
    return right.probability - left.probability || String(left.id ?? '').localeCompare(String(right.id ?? ''));
  });
  ranked.forEach((candidate, index) => {
    candidate.market_selection_rank = explicitRanks.length > 0 ? candidate.selection_rank : index + 1;
    candidate.market_selection_rank_source = explicitRanks.length > 0 ? 'analysis' : 'selector_probability';
    candidate.is_market_primary = candidate.market_selection_rank === 1;
  });
}

function selectionAlignment(selected) {
  const primaryAnchorCount = selected.filter((candidate) => candidate.is_market_primary).length;
  return {
    primary_anchor_count: primaryAnchorCount,
    non_primary_count: selected.length - primaryAnchorCount,
    minimum_primary_anchors: minimumPrimaryAnchors,
    model_aligned: primaryAnchorCount >= minimumPrimaryAnchors,
  };
}

const passOptions = input.passOptions ?? [[2], [2, 3], [2, 3, 4]];
const stake = input.stakePerCombination ?? 2;
const results = [];
for (const selected of combinations(candidates, 4)) {
  if (new Set(selected.map((candidate) => candidate.match_id)).size !== 4) continue;
  const alignment = selectionAlignment(selected);
  if (selectionPolicy === 'model_aligned' && !alignment.model_aligned) continue;
  for (const passSizes of passOptions) {
    try {
      const metrics = evaluateReturnPool({
        selections: selected,
        passSizes,
        stake,
        probabilityBasis: input.probabilityBasis ?? 'conservative_prob',
        expectedValueProbabilityBasis: input.expectedValueProbabilityBasis ?? 'model_prob',
      });
      results.push({
        selections: selected,
        selection_alignment: alignment,
        ...metrics,
      });
    } catch (error) {
      if (!String(error.message).includes('pass size exceeds')) throw error;
    }
  }
}

if (!results.length) {
  if (selectionPolicy === 'model_aligned') {
    process.stdout.write(`${JSON.stringify({
      contract_version: contractVersion,
      status: 'no_model_aligned_pool',
      selection_policy: selectionPolicy,
      minimum_primary_anchors: minimumPrimaryAnchors,
      model_source: modelSource,
      override_reason: null,
      ready_requires: [
        'selection_policy=model_aligned',
        `selection_alignment.primary_anchor_count>=${minimumPrimaryAnchors}`,
        'model_source!=experience_shadow',
        'all_exact_pairs_profitable=true',
        'expected_net>0',
      ],
      candidate_count: input.candidates.length,
      eligible_candidate_count: candidates.length,
      rejected_candidates: rejected,
      evaluated_pool_structures: 0,
      best: null,
      alternatives: [],
    }, null, 2)}\n`);
    process.exit(0);
  }
  fail('no legal four-match pool could be evaluated');
}
results.sort((left, right) =>
  Number(right.all_exact_pairs_profitable) - Number(left.all_exact_pairs_profitable)
  || right.estimated_profit_prob - left.estimated_profit_prob
  || right.expected_net - left.expected_net
  || right.p_at_least_2 - left.p_at_least_2,
);

const best = results[0];
const profitabilityStatus = best.all_exact_pairs_profitable && best.expected_net > 0
  ? 'ready'
  : best.all_exact_pairs_profitable
    ? 'pair_coverage_negative_expectation'
  : best.estimated_profit_prob > 0
    ? 'conditional_pair_coverage'
    : 'no_profitable_pool';
const status = modelSource === 'experience_shadow'
  ? 'experience_shadow_only'
  : selectionPolicy === 'unrestricted' && !best.selection_alignment.model_aligned
    ? 'tail_override_required'
    : profitabilityStatus;
const topN = Number.isInteger(input.topN) && input.topN > 0 ? Math.min(input.topN, 20) : 5;
const compact = (result) => ({
  selections: result.selections,
  pass_sizes: result.pass_sizes,
  combination_count: result.combination_count,
  cost: result.cost,
  p0: result.p0,
  p1: result.p1,
  p_at_least_2: result.p_at_least_2,
  p_at_least_3: result.p_at_least_3,
  estimated_profit_prob: result.estimated_profit_prob,
  expected_payout: result.expected_payout,
  expected_net: result.expected_net,
  all_exact_pairs_profitable: result.all_exact_pairs_profitable,
  pair_floor_net: result.pair_floor_net,
  profit_if_exact_pair: result.profit_if_exact_pair,
  official_rule_checks: result.official_rule_checks,
  probability_basis: result.probability_basis,
  expected_value_probability_basis: result.expected_value_probability_basis,
  independence_assumed: result.independence_assumed,
  selection_alignment: result.selection_alignment,
});

process.stdout.write(`${JSON.stringify({
  contract_version: contractVersion,
  status,
  selection_policy: selectionPolicy,
  minimum_primary_anchors: minimumPrimaryAnchors,
  model_source: modelSource,
  override_reason: selectionPolicy === 'unrestricted' ? overrideReason : null,
  objective_order: ['all_exact_pairs_profitable', 'estimated_profit_prob', 'expected_net', 'p_at_least_2'],
  ready_requires: [
    'selection_policy=model_aligned',
    `selection_alignment.primary_anchor_count>=${minimumPrimaryAnchors}`,
    'model_source!=experience_shadow',
    'all_exact_pairs_profitable=true',
    'expected_net>0',
  ],
  candidate_count: input.candidates.length,
  eligible_candidate_count: candidates.length,
  rejected_candidates: rejected,
  evaluated_pool_structures: results.length,
  best: compact(best),
  alternatives: results.slice(1, topN).map(compact),
}, null, 2)}\n`);
