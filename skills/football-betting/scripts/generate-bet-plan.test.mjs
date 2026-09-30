import assert from 'node:assert/strict'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { generateBetPlan } from './generate-bet-plan.mjs'

const scriptRoot = path.dirname(fileURLToPath(import.meta.url))
const validator = path.join(scriptRoot, 'validate-bet-plan.mjs')
const capturedAt = '2026-09-05T00:00:00.000Z'
const sourceId = 'a'.repeat(64)
const match1 = '00000000-0000-4000-8000-000000000001'
const match2 = '00000000-0000-4000-8000-000000000002'

function candidate(matchId, market, selection, modelProb, marketProb, odds) {
  return {
    candidate_id: `${matchId}/${market}/${selection}`,
    market,
    selection,
    odds,
    model_prob: modelProb,
    market_prob: marketProb,
    conservative_prob: Math.min(modelProb, marketProb),
    probability_source_id: sourceId,
    pool_status: 'Selling',
    single_allowed: true,
    allup_allowed: true,
    max_pass_size: 8,
    odds_snapshot_at: capturedAt,
    eligible: true,
    pool_allowed: true,
    variance: 'low',
    veto_reasons: [],
  }
}

function match(matchId, code, candidates) {
  return {
    match: { match_id: matchId, code, home: `H${code}`, away: `A${code}`, kickoff_utc: '2026-09-06T12:00:00.000Z' },
    data_quality: { stable_eligible: true },
    audit: { version: '2.4.2', integrity_status: 'pass' },
    plays: { candidates },
  }
}

function analysis(matches) {
  return { schema: 'fdp.analysis-result.v2', batch_id: 'analysis-generator-test', matches }
}

function validate(artifact) {
  const result = spawnSync(process.execPath, [validator, '-'], {
    encoding: 'utf8',
    input: JSON.stringify(artifact),
  })
  assert.equal(result.status, 0, result.stderr || result.stdout)
}

test('generates a positive-EV high-hit single and passes the current validator', () => {
  const artifact = generateBetPlan(analysis([
    match(match1, '001', [candidate(match1, 'HAD', '主胜', 0.72, 0.70, 1.50)]),
    match(match2, '002', [candidate(match2, 'HAD', '主胜', 0.55, 0.52, 1.80)]),
  ]), { batchId: 'bet-generator-hit-test', objective: 'hit_rate_first', createdAt: capturedAt })
  assert.equal(artifact.bet_plan.status, 'ready')
  assert.equal(artifact.bet_plan.decision, 'BET')
  assert.equal(artifact.bet_plan.primary_ticket.type, '单关')
  assert.equal(artifact.bet_plan.primary_ticket.estimated_hit_prob, 0.70)
  validate(artifact)
})

test('fails closed when the only high-hit option has negative expectation', () => {
  const artifact = generateBetPlan(analysis([
    match(match1, '001', [candidate(match1, 'HAD', '主胜', 0.68, 0.66, 1.40)]),
  ]), { batchId: 'bet-generator-negative-test', objective: 'hit_rate_first', createdAt: capturedAt })
  assert.equal(artifact.bet_plan.status, 'high_hit_negative_expectation')
  assert.equal(artifact.bet_plan.decision, 'SKIP')
  assert.equal(artifact.bet_plan.primary_ticket, null)
  validate(artifact)
})

test('deterministically generates a profitable two-match full coverage ticket', () => {
  const coverageMatch = (matchId, code) => match(matchId, code, [
    candidate(matchId, 'HAD', '主胜', 0.52, 0.50, 2.40),
    candidate(matchId, 'HAD', '平', 0.42, 0.40, 3.00),
  ])
  const artifact = generateBetPlan(analysis([
    coverageMatch(match1, '001'),
    coverageMatch(match2, '002'),
  ]), { batchId: 'bet-generator-coverage-test', objective: 'coverage_profit_first', createdAt: capturedAt })
  assert.equal(artifact.bet_plan.status, 'ready')
  assert.equal(artifact.bet_plan.decision, 'BET')
  assert.equal(artifact.bet_plan.coverage_ticket.estimated_hit_prob, 0.81)
  assert.equal(artifact.bet_plan.coverage_ticket.combination_count, 4)
  validate(artifact)
})

test('refuses legacy analysis output even when it contains superficially usable odds', () => {
  const source = analysis([
    match(match1, '001', [candidate(match1, 'HAD', '主胜', 0.72, 0.70, 1.50)]),
  ])
  source.matches[0].audit.version = '2.3.7'
  assert.throws(
    () => generateBetPlan(source, { batchId: 'bet-generator-legacy-test' }),
    /只接受 v2\.4\.2\+ AnalysisResult/,
  )
})
