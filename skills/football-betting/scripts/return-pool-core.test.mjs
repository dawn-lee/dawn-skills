import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { evaluateReturnPool } from './return-pool-core.mjs'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const selector = path.join(scriptDir, 'select-return-pool.mjs')

const leg = (index, overrides = {}) => ({
  id: `leg-${index}`,
  match_id: `match-${index}`,
  market: 'HAD',
  selection: '主胜',
  odds: 3,
  conservative_prob: 0.4,
  model_prob: 0.8,
  eligible: true,
  pool_allowed: true,
  pool_status: 'Selling',
  allup_allowed: true,
  max_pass_size: 8,
  odds_snapshot_at: '2026-08-29T00:00:00.000Z',
  ...overrides,
})

test('return pool uses conservative probability for coverage and model probability for EV', () => {
  const result = evaluateReturnPool({
    selections: [1, 2, 3, 4].map((index) => leg(index)),
    passSizes: [2],
    stake: 2,
  })

  assert.equal(result.probability_basis, 'conservative_prob')
  assert.equal(result.expected_value_probability_basis, 'model_prob')
  assert.ok(Math.abs(result.p0 - 0.1296) < 1e-12)
  assert.ok(Math.abs(result.p_at_least_2 - 0.5248) < 1e-12)
  assert.ok(Math.abs(result.expected_net - 57.12) < 1e-12)
})

test('return pool rejects a leg without an independent model probability', () => {
  const selections = [1, 2, 3, 4].map((index) => leg(index))
  delete selections[0].model_prob

  assert.throws(
    () => evaluateReturnPool({ selections, passSizes: [2], stake: 2 }),
    /invalid model_prob at selections\[0\]/,
  )
})

function candidate(index, rank, overrides = {}) {
  return {
    ...leg(index, {
      id: `match-${index}-${rank}`,
      odds: 4,
      conservative_prob: rank === 1 ? 0.6 : 0.2,
      model_prob: rank === 1 ? 0.65 : 0.25,
      selection: rank === 1 ? '主胜' : '平',
      selection_rank: rank,
    }),
    ...overrides,
  }
}

function runSelector(input) {
  return spawnSync(process.execPath, [selector], {
    input: JSON.stringify(input),
    encoding: 'utf8',
  })
}

test('selector defaults to model-aligned pools and reports primary anchors', () => {
  const result = runSelector({
    candidates: [1, 2, 3, 4].flatMap((index) => [candidate(index, 1), candidate(index, 2)]),
    passOptions: [[2]],
  })

  assert.equal(result.status, 0, result.stderr)
  const output = JSON.parse(result.stdout)
  assert.equal(output.contract_version, '2.4.3')
  assert.equal(output.selection_policy, 'model_aligned')
  assert.equal(output.best.selection_alignment.primary_anchor_count, 4)
  assert.equal(output.best.selections.every((item) => item.is_market_primary), true)
})

test('selector returns no_model_aligned_pool for all-tail candidates', () => {
  const result = runSelector({
    candidates: [1, 2, 3, 4].map((index) => candidate(index, 2)),
    passOptions: [[2]],
  })

  assert.equal(result.status, 0, result.stderr)
  const output = JSON.parse(result.stdout)
  assert.equal(output.status, 'no_model_aligned_pool')
  assert.equal(output.best, null)
})

test('unrestricted tail selection requires an explicit override reason', () => {
  const result = runSelector({
    selectionPolicy: 'unrestricted',
    candidates: [1, 2, 3, 4].map((index) => candidate(index, 2)),
    passOptions: [[2]],
  })

  assert.equal(result.status, 1)
  assert.match(result.stderr, /requires an explicit overrideReason/)
})

test('selector rejects duplicated explicit market ranks', () => {
  const duplicate = candidate(1, 1, { id: 'match-1-duplicate', selection: '平' })
  const result = runSelector({
    candidates: [duplicate, candidate(1, 1), candidate(2, 1), candidate(3, 1), candidate(4, 1)],
    passOptions: [[2]],
  })

  assert.equal(result.status, 1)
  assert.match(result.stderr, /selection_rank must be unique/)
})
