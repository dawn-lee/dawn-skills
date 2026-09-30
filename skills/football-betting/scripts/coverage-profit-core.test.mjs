import assert from 'node:assert/strict'
import test from 'node:test'
import { evaluateCoverageProfit } from './coverage-profit-core.mjs'

const option = (id, matchId, selection, odds, probability, modelProbability = probability) => ({
  id,
  match_id: matchId,
  market: 'HAD',
  selection,
  odds,
  probability,
  model_prob: modelProbability,
  eligible: true,
  pool_allowed: true,
  pool_status: 'Selling',
  allup_allowed: true,
  max_pass_size: 8,
  odds_snapshot_at: '2026-08-23T04:00:00.000Z',
})

test('ready requires high coverage, profitable every covered branch, and positive expectation', () => {
  const result = evaluateCoverageProfit({
    groups: [
      { match_id: 'm1', options: [option('m1-h', 'm1', '主胜', 2.1, 0.46, 0.55), option('m1-d', 'm1', '平', 3.1, 0.31, 0.32)] },
      { match_id: 'm2', options: [option('m2-h', 'm2', '主胜', 1.05, 0.86, 0.92)] },
    ],
  })
  assert.equal(result.status, 'ready')
  assert.equal(result.combination_count, 2)
  assert.equal(result.cost, 4)
  assert.equal(result.coverage_hit_prob, 0.6622)
  assert.equal(result.all_covered_branches_profitable, true)
  assert.ok(result.covered_branch_floor_net > 0)
  assert.ok(result.expected_net > 0)
})

test('high coverage with losing covered branches is conditional, not ready', () => {
  const result = evaluateCoverageProfit({
    groups: [
      { match_id: 'm1', options: [option('m1-h', 'm1', '主胜', 1.4, 0.57), option('m1-d', 'm1', '平', 4, 0.25)] },
      { match_id: 'm2', options: [option('m2-h', 'm2', '主胜', 1.4, 0.57), option('m2-d', 'm2', '平', 4, 0.25)] },
    ],
  })
  assert.equal(result.status, 'conditional_coverage_profit')
  assert.equal(result.ready, false)
  assert.equal(result.all_covered_branches_profitable, false)
  assert.ok(result.covered_branch_floor_net < 0)
})

test('high-hit coverage with positive payout branches but negative expectation is rejected', () => {
  const result = evaluateCoverageProfit({
    groups: [
      { match_id: 'm1', options: [option('m1-h', 'm1', '主胜', 2.01, 0.57), option('m1-d', 'm1', '平', 2.01, 0.25)] },
      { match_id: 'm2', options: [option('m2-h', 'm2', '主胜', 2.01, 0.57), option('m2-d', 'm2', '平', 2.01, 0.25)] },
    ],
  })
  assert.equal(result.status, 'high_hit_negative_expectation')
  assert.equal(result.all_covered_branches_profitable, true)
  assert.ok(result.expected_net < 0)
})

test('coverage confidence and expected value use separate probability bases', () => {
  const result = evaluateCoverageProfit({
    groups: [
      { match_id: 'm1', options: [option('m1-h', 'm1', '主胜', 2.1, 0.45, 0.57), option('m1-d', 'm1', '平', 3.4, 0.28, 0.25)] },
      { match_id: 'm2', options: [option('m2-h', 'm2', '主胜', 2.1, 0.45, 0.57), option('m2-d', 'm2', '平', 3.4, 0.28, 0.25)] },
    ],
    highHitThreshold: 0.5,
  })
  assert.equal(result.coverage_hit_prob, 0.5329)
  assert.equal(result.expected_value_probability_basis, 'model_prob')
  assert.ok(result.expected_net > 0)
})

test('profit target is enforced independently of merely positive net', () => {
  const result = evaluateCoverageProfit({
    groups: [
      { match_id: 'm1', options: [option('m1-h', 'm1', '主胜', 2.1, 0.57), option('m1-d', 'm1', '平', 3.4, 0.25)] },
      { match_id: 'm2', options: [option('m2-h', 'm2', '主胜', 2.1, 0.57), option('m2-d', 'm2', '平', 3.4, 0.25)] },
    ],
    minimumProfitNet: 2,
  })
  assert.equal(result.status, 'conditional_coverage_profit')
  assert.equal(result.all_covered_branches_profitable, true)
  assert.equal(result.all_covered_branches_meet_target, false)
})

test('rejects options from different markets inside one mutually exclusive group', () => {
  const second = { ...option('m1-ttg', 'm1', '2', 3.2, 0.2), market: 'TTG' }
  assert.throws(() => evaluateCoverageProfit({
    groups: [
      { match_id: 'm1', options: [option('m1-h', 'm1', '主胜', 2.1, 0.57), second] },
      { match_id: 'm2', options: [option('m2-h', 'm2', '主胜', 2.1, 0.7)] },
    ],
  }), /market must match/)
})
