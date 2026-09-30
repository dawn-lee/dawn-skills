import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { evaluateCoverageProfit } from './coverage-profit-core.mjs'
import { evaluateReturnPool } from './return-pool-core.mjs'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const validator = path.join(scriptDir, 'validate-bet-plan.mjs')

const option = (id, matchId, selection, odds, probability, modelProbability = probability) => ({
  id,
  match_id: matchId,
  market: 'HAD',
  selection,
  odds,
  conservative_prob: probability,
  model_prob: modelProbability,
  eligible: true,
  pool_allowed: true,
  pool_status: 'Selling',
  allup_allowed: true,
  max_pass_size: 8,
  odds_snapshot_at: '2026-08-23T04:00:00.000Z',
})

const groups = [
  { match_id: 'm1', options: [option('m1-h', 'm1', '主胜', 2.1, 0.46, 0.55), option('m1-d', 'm1', '平', 3.1, 0.31, 0.32)] },
  { match_id: 'm2', options: [option('m2-h', 'm2', '主胜', 1.05, 0.86, 0.92)] },
]

function coveragePlan(overrides = {}) {
  const metrics = evaluateCoverageProfit({
    groups: groups.map((group) => ({
      ...group,
      options: group.options.map((item) => ({ ...item, probability: item.conservative_prob })),
    })),
  })
  return {
    bet_plan: {
      objective: 'coverage_profit_first',
      status: 'ready',
      decision: 'BET',
      gate: { high_hit_threshold: 0.65 },
      coverage_ticket: {
        type: 'full_pass_coverage',
        groups,
        probability_basis: 'conservative_prob',
        expected_value_probability_basis: 'model_prob',
        stake_per_combination: 2,
        profit_target: { minimum_net_cny: 0, minimum_roi: 0 },
        combination_count: metrics.combination_count,
        cost_cny: metrics.cost,
        estimated_hit_prob: metrics.coverage_hit_prob,
        estimated_profit_prob: metrics.estimated_profit_prob,
        expected_net_cny: metrics.expected_net,
        covered_branch_floor_net_cny: metrics.covered_branch_floor_net,
        covered_branch_floor_roi: metrics.covered_branch_floor_roi,
        all_covered_branches_profitable: metrics.all_covered_branches_profitable,
        all_covered_branches_meet_target: metrics.all_covered_branches_meet_target,
        ...overrides,
      },
    },
  }
}

function run(plan) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bet-plan-validation-'))
  const file = path.join(directory, 'bet-plan.json')
  fs.writeFileSync(file, JSON.stringify(plan), 'utf8')
  return spawnSync(process.execPath, [validator, file], { encoding: 'utf8' })
}

function hitRatePlan(entertainment) {
  return {
    bet_plan: {
      objective: 'hit_rate_first',
      status: 'no_high_hit_option',
      decision: 'SKIP',
      gate: { high_hit_threshold: 0.65, best_conservative_prob: 0.6, overridden: false },
      primary_ticket: null,
      protocol_tickets: [],
      legs: [
        { id: 'leg-1', conservative_prob: 0.6 },
        { id: 'leg-2', conservative_prob: 0.55 },
      ],
      entertainment,
    },
  }
}

function readyHitRatePlan(expectedNet) {
  return {
    bet_plan: {
      objective: 'hit_rate_first',
      status: 'ready',
      decision: 'BET',
      gate: { high_hit_threshold: 0.65, best_conservative_prob: 0.72, overridden: false },
      primary_ticket: {
        estimated_hit_prob: 0.72,
        approximate_expected_net_cny: expectedNet,
        label: '高命中',
      },
      protocol_tickets: [],
      legs: [{ id: 'leg-1', conservative_prob: 0.72 }],
      entertainment: [],
    },
  }
}

const currentLeg = (index, overrides = {}) => ({
  id: `current-leg-${index}`,
  analysis_match_id: `match-${index}`,
  market: 'HAD',
  selection: '主胜',
  odds: 2,
  model_prob: 0.7,
  market_prob: 0.68,
  conservative_prob: 0.68,
  probability_source_id: 'a'.repeat(64),
  analysis_integrity_status: 'pass',
  stable_eligible: true,
  eligible: true,
  pool_status: 'Selling',
  single_allowed: true,
  allup_allowed: true,
  max_pass_size: 8,
  odds_snapshot_at: '2026-09-05T00:00:00.000Z',
  ev: 0.4,
  ...overrides,
})

function currentReadyPlan() {
  return {
    bet_plan: {
      contract_version: '2.4.5',
      objective: 'hit_rate_first',
      status: 'ready',
      decision: 'BET',
      gate: { high_hit_threshold: 0.65, best_conservative_prob: 0.68, overridden: false },
      legs: [currentLeg(1)],
      primary_ticket: {
        type: '单关',
        legs: [0],
        combination_count: 1,
        cost_at_2: 2,
        total_odds: 2,
        estimated_hit_prob: 0.68,
        expected_net_cny: 0.8,
        label: '高命中',
      },
      protocol_tickets: [],
      entertainment: [],
    },
  }
}

function returnPoolPlan(overrides = {}) {
  const selections = [1, 2, 3, 4].map((index) => currentLeg(index, {
    match_id: `match-${index}`,
    odds: 3.5,
    model_prob: 0.35,
    market_prob: 0.28,
    conservative_prob: 0.28,
    ev: 0.225,
  }))
  const metrics = evaluateReturnPool({ selections, passSizes: [2, 3], stake: 2 })
  return {
    bet_plan: {
      contract_version: '2.4.5',
      objective: 'hit_rate_first',
      status: 'no_high_hit_option',
      decision: 'SKIP',
      gate: { high_hit_threshold: 0.65, best_conservative_prob: 0.6, overridden: false },
      primary_ticket: null,
      protocol_tickets: [],
      legs: selections,
      entertainment: [],
      return_pool: {
        contract_version: '2.4.3',
        status: 'ready',
        category: 'protocol_return_pool',
        selection_policy: 'model_aligned',
        minimum_primary_anchors: 2,
        model_source: 'formal_analysis',
        override_reason: null,
        selection_alignment: { primary_anchor_count: 2, non_primary_count: 2, model_aligned: true },
        probability_basis: 'conservative_prob',
        expected_value_probability_basis: 'model_prob',
        selections,
        passes: metrics.pass_sizes,
        official_rule_checks: metrics.official_rule_checks,
        combination_count: metrics.combination_count,
        cost_at_2: metrics.cost,
        p0: metrics.p0,
        p1: metrics.p1,
        p_at_least_2: metrics.p_at_least_2,
        p_at_least_3: metrics.p_at_least_3,
        estimated_profit_prob: metrics.estimated_profit_prob,
        expected_payout: metrics.expected_payout,
        expected_net: metrics.expected_net,
        all_exact_pairs_profitable: metrics.all_exact_pairs_profitable,
        pair_floor_net: metrics.pair_floor_net,
        profit_if_exact_pair: metrics.profit_if_exact_pair,
        ...overrides,
      },
    },
  }
}

test('accepts a deterministically reproducible profitable high-hit coverage ticket', () => {
  const result = run(coveragePlan())
  assert.equal(result.status, 0, result.stderr)
})

test('rejects a reported coverage floor that does not match deterministic expansion', () => {
  const result = run(coveragePlan({ covered_branch_floor_net_cny: 999 }))
  assert.equal(result.status, 1)
  assert.match(result.stderr, /确定性重算不一致/)
})

test('accepts SKIP when no profitable high-hit coverage ticket exists', () => {
  const result = run({
    bet_plan: {
      objective: 'coverage_profit_first',
      status: 'no_profitable_high_hit_coverage',
      decision: 'SKIP',
      gate: { high_hit_threshold: 0.65 },
      coverage_ticket: null,
      protocol_tickets: [],
    },
  })
  assert.equal(result.status, 0, result.stderr)
})

test('accepts hit-rate entertainment tickets ranked by estimated hit probability', () => {
  const result = run(hitRatePlan([
    { ticket_id: 'ticket-high', recommendation_rank: 1, estimated_hit_prob: 0.24 },
    { ticket_id: 'ticket-low', recommendation_rank: 2, estimated_hit_prob: 0.19 },
  ]))
  assert.equal(result.status, 0, result.stderr)
})

test('rejects subjective quality ranking above a higher-probability entertainment ticket', () => {
  const result = run(hitRatePlan([
    { ticket_id: 'quality', recommendation_rank: 1, estimated_hit_prob: 0.19 },
    { ticket_id: 'raw-probability', recommendation_rank: 2, estimated_hit_prob: 0.24 },
  ]))
  assert.equal(result.status, 1)
  assert.match(result.stderr, /量化后的命中概率降序/)
})

test('accepts a risk-adjusted ranking only when the discount is quantified and explained', () => {
  const result = run(hitRatePlan([
    { ticket_id: 'stable', recommendation_rank: 1, estimated_hit_prob: 0.22 },
    {
      ticket_id: 'correlated',
      recommendation_rank: 2,
      estimated_hit_prob: 0.26,
      ranking_probability: 0.18,
      ranking_adjustment: '同联赛相关性压力测试后从26%下调到18%',
    },
  ]))
  assert.equal(result.status, 0, result.stderr)
})

test('accepts a positive-expectation formal hit-rate ticket', () => {
  const result = run(readyHitRatePlan(0.18))
  assert.equal(result.status, 0, result.stderr)
})

test('accepts a current formal ticket only when source, stable gate and arithmetic all reproduce', () => {
  const result = run(currentReadyPlan())
  assert.equal(result.status, 0, result.stderr)
})

test('rejects a new v2.4.5 lock that omits the BetPlan contract version', () => {
  const plan = readyHitRatePlan(0.18)
  plan.lock = { betting_skill_version: '2.4.5' }
  const result = run(plan)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /bet_plan\.contract_version/)
})

test('rejects a current formal ticket with a stale or missing probability source', () => {
  const plan = currentReadyPlan()
  plan.bet_plan.legs[0].probability_source_id = 'stale'
  const result = run(plan)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /probability_source_id/)
})

test('rejects value_first BET without a reproducible primary ticket', () => {
  const result = run({
    bet_plan: {
      contract_version: '2.4.5',
      objective: 'value_first',
      status: 'ready',
      decision: 'BET',
      gate: { minimum_leg_ev: 0.03 },
      legs: [],
      primary_ticket: null,
      protocol_tickets: [],
    },
  })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /no_value_option/)
})

test('accepts a positive-EV value_first ticket with locked inputs and reproducible arithmetic', () => {
  const plan = currentReadyPlan()
  plan.bet_plan.objective = 'value_first'
  plan.bet_plan.gate = { minimum_leg_ev: 0.03 }
  plan.bet_plan.primary_ticket.label = '价值单关'
  const result = run(plan)
  assert.equal(result.status, 0, result.stderr)
})

test('rejects value_first when a selected leg is below the EV gate', () => {
  const plan = currentReadyPlan()
  plan.bet_plan.objective = 'value_first'
  plan.bet_plan.gate = { minimum_leg_ev: 0.03 }
  Object.assign(plan.bet_plan.legs[0], {
    odds: 1.2,
    model_prob: 0.7,
    market_prob: 0.68,
    conservative_prob: 0.68,
    ev: -0.16,
  })
  plan.bet_plan.primary_ticket.total_odds = 1.2
  plan.bet_plan.primary_ticket.expected_net_cny = -0.32
  const result = run(plan)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /低于 value_first 门槛/)
})

test('accepts an explicit two-option same-match high-hit coverage ticket using summed probabilities', () => {
  const plan = currentReadyPlan()
  plan.bet_plan.gate.best_conservative_prob = 0.8
  plan.bet_plan.legs = [
    currentLeg(1, {
      selection: '主胜', odds: 2.1, model_prob: 0.54, market_prob: 0.5,
      conservative_prob: 0.5, ev: 0.134,
    }),
    currentLeg(2, {
      analysis_match_id: 'match-1', selection: '平', odds: 3.5,
      model_prob: 0.3, market_prob: 0.32, conservative_prob: 0.3, ev: 0.05,
    }),
  ]
  plan.bet_plan.primary_ticket = {
    type: 'HAD复式',
    legs: [0, 1],
    combination_count: 2,
    cost_at_2: 4,
    estimated_hit_prob: 0.8,
    expected_net_cny: 0.368,
    label: '高命中同场复式',
  }
  const result = run(plan)
  assert.equal(result.status, 0, result.stderr)
})

test('rejects a four-leg entertainment accumulator described as stable', () => {
  const plan = currentReadyPlan()
  plan.bet_plan.legs.push(
    currentLeg(2, { odds: 1.6, model_prob: 0.8, market_prob: 0.75, conservative_prob: 0.75 }),
    currentLeg(3, { odds: 1.6, model_prob: 0.8, market_prob: 0.75, conservative_prob: 0.75 }),
    currentLeg(4, { odds: 1.6, model_prob: 0.8, market_prob: 0.75, conservative_prob: 0.75 }),
    currentLeg(5, { odds: 1.6, model_prob: 0.8, market_prob: 0.75, conservative_prob: 0.75 }),
  )
  plan.bet_plan.entertainment = [{
    ticket_id: 'four-leg',
    recommendation_rank: 1,
    label: '最稳四串1',
    legs: [1, 2, 3, 4],
    combination_count: 1,
    cost_at_2: 2,
    total_odds: 6.5536,
    estimated_hit_prob: 0.31640625,
    expected_net_cny: 3.36870912,
  }]
  const result = run(plan)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /只能标为娱乐票/)
})

test('rejects hand-entered ticket probability that does not match its four legs', () => {
  const plan = currentReadyPlan()
  plan.bet_plan.legs.push(
    currentLeg(2, { odds: 1.6, model_prob: 0.8, market_prob: 0.75, conservative_prob: 0.75 }),
    currentLeg(3, { odds: 1.6, model_prob: 0.8, market_prob: 0.75, conservative_prob: 0.75 }),
    currentLeg(4, { odds: 1.6, model_prob: 0.8, market_prob: 0.75, conservative_prob: 0.75 }),
    currentLeg(5, { odds: 1.6, model_prob: 0.8, market_prob: 0.75, conservative_prob: 0.75 }),
  )
  plan.bet_plan.entertainment = [{
    ticket_id: 'four-leg',
    recommendation_rank: 1,
    label: '娱乐4串1',
    legs: [1, 2, 3, 4],
    combination_count: 1,
    cost_at_2: 2,
    total_odds: 6.5536,
    estimated_hit_prob: 0.7,
    expected_net_cny: 3.36870912,
  }]
  const result = run(plan)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /estimated_hit_prob 与确定性重算不一致/)
})

test('rejects a negative-expectation hit-rate ticket presented as a formal BET', () => {
  const result = run(readyHitRatePlan(-0.54))
  assert.equal(result.status, 1)
  assert.match(result.stderr, /high_hit_negative_expectation/)
})

test('accepts SKIP when a high-hit candidate has negative expectation and is kept out of the formal ticket', () => {
  const result = run({
    bet_plan: {
      objective: 'hit_rate_first',
      status: 'high_hit_negative_expectation',
      decision: 'SKIP',
      gate: { high_hit_threshold: 0.65, best_conservative_prob: 0.72, overridden: false },
      primary_ticket: null,
      protocol_tickets: [],
      legs: [{ id: 'leg-1', conservative_prob: 0.72 }],
      entertainment: [{
        ticket_id: 'high-hit-but-negative-ev',
        recommendation_rank: 1,
        estimated_hit_prob: 0.72,
        approximate_expected_net_cny: -0.54,
      }],
    },
  })
  assert.equal(result.status, 0, result.stderr)
})

test('rejects a formal return pool made from unrestricted tail selections', () => {
  const result = run(returnPoolPlan({
    selection_policy: 'unrestricted',
    selection_alignment: { primary_anchor_count: 0, non_primary_count: 4, model_aligned: false },
    override_reason: '高赔率娱乐',
  }))
  assert.equal(result.status, 1)
  assert.match(result.stderr, /正式 return_pool 必须使用 selection_policy=model_aligned/)
})

test('rejects an experience shadow model as a formal return pool source', () => {
  const result = run(returnPoolPlan({ model_source: 'experience_shadow' }))
  assert.equal(result.status, 1)
  assert.match(result.stderr, /experience_shadow 只能用于明确授权的娱乐票/)
})

test('accepts a formal return pool only when all deterministic economics reproduce', () => {
  const result = run(returnPoolPlan())
  assert.equal(result.status, 0, result.stderr)
})

test('rejects a formal return pool with missing official checks or tampered expected net', () => {
  const plan = returnPoolPlan({ expected_net: 999, official_rule_checks: {} })
  const result = run(plan)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /official_rule_checks|expected_net/)
})

test('accepts an explicitly authorized unrestricted entertainment pool', () => {
  const result = run(returnPoolPlan({
    status: 'tail_override_required',
    category: 'user_requested_entertainment_override',
    selection_policy: 'unrestricted',
    model_source: 'experience_shadow',
    override_reason: '用户明确给出小额小博大娱乐预算',
    selection_alignment: { primary_anchor_count: 0, non_primary_count: 4, model_aligned: false },
  }))
  assert.equal(result.status, 0, result.stderr)
})

test('rejects a legacy formal return pool without the anchored-selection contract', () => {
  const plan = returnPoolPlan()
  delete plan.bet_plan.return_pool.contract_version
  const result = run(plan)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /必须声明 contract_version=2\.4\.3/)
})
