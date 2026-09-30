#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { evaluateCoverageProfit } from './coverage-profit-core.mjs'

export const BET_PLAN_CONTRACT_VERSION = '2.4.5'

function round(value, digits = 9) {
  return Number(Number(value).toFixed(digits))
}

function atLeast(version, minimum) {
  const current = String(version ?? '').split('.').slice(0, 3).map(Number)
  const floor = minimum.split('.').map(Number)
  if (current.length !== 3 || current.some(Number.isNaN)) return false
  for (let index = 0; index < 3; index += 1) {
    if (current[index] !== floor[index]) return current[index] > floor[index]
  }
  return true
}

function combinations(items, size, start = 0, prefix = [], output = []) {
  if (prefix.length === size) {
    output.push([...prefix])
    return output
  }
  for (let index = start; index <= items.length - (size - prefix.length); index += 1) {
    prefix.push(items[index])
    combinations(items, size, index + 1, prefix, output)
    prefix.pop()
  }
  return output
}

function ticketFor(legs, indexes, type, label) {
  const selected = indexes.map(index => legs[index])
  const estimatedHitProb = selected.reduce((product, leg) => product * leg.conservative_prob, 1)
  const modelHitProb = selected.reduce((product, leg) => product * leg.model_prob, 1)
  const totalOdds = selected.reduce((product, leg) => product * leg.odds, 1)
  return {
    type,
    legs: indexes,
    stake_per_combination: 2,
    combination_count: 1,
    cost_at_2: 2,
    total_odds: round(totalOdds),
    estimated_hit_prob: round(estimatedHitProb),
    expected_net_cny: round(2 * modelHitProb * totalOdds - 2, 6),
    label,
  }
}

function normalizeLegs(analysis) {
  const legs = []
  for (const match of analysis.matches ?? []) {
    const stable = match.data_quality?.stable_eligible === true
    const integrity = match.audit?.integrity_status
    for (const candidate of match.plays?.candidates ?? []) {
      const modelProb = Number(candidate.model_prob)
      const marketProb = Number(candidate.market_prob)
      const odds = Number(candidate.odds)
      if (!(modelProb > 0 && modelProb <= 1 && marketProb > 0 && marketProb <= 1 && odds > 1)) continue
      legs.push({
        candidate_id: candidate.candidate_id,
        analysis_match_id: match.match.match_id,
        match_id: match.match.match_id,
        code: match.match.code,
        match: `${match.match.home} vs ${match.match.away}`,
        market: candidate.market,
        selection: candidate.selection,
        ...(candidate.handicap != null ? { handicap: candidate.handicap } : {}),
        odds,
        model_prob: modelProb,
        market_prob: marketProb,
        conservative_prob: Math.min(modelProb, marketProb),
        ev: round(modelProb * odds - 1),
        probability_source_id: candidate.probability_source_id,
        analysis_integrity_status: integrity,
        stable_eligible: stable,
        eligible: candidate.eligible === true,
        pool_allowed: candidate.pool_allowed === true,
        pool_status: candidate.pool_status ?? null,
        single_allowed: candidate.single_allowed === true,
        allup_allowed: candidate.allup_allowed === true,
        max_pass_size: Number(candidate.max_pass_size),
        odds_snapshot_at: candidate.odds_snapshot_at,
        hit_tier: Math.min(modelProb, marketProb) >= 0.65 ? 'high' : Math.min(modelProb, marketProb) >= 0.45 ? 'mid' : 'low',
        veto_checks: [...(candidate.veto_reasons ?? [])],
      })
    }
  }
  return legs
}

function formalLeg(leg) {
  return leg.stable_eligible === true
    && leg.analysis_integrity_status === 'pass'
    && leg.eligible === true
    && leg.pool_allowed === true
    && leg.pool_status === 'Selling'
    && /^[a-f0-9]{64}$/i.test(String(leg.probability_source_id ?? ''))
    && Number.isFinite(Date.parse(String(leg.odds_snapshot_at ?? '')))
}

function simpleTicketPool(legs) {
  const tickets = []
  for (let index = 0; index < legs.length; index += 1) {
    if (formalLeg(legs[index]) && legs[index].single_allowed) {
      tickets.push(ticketFor(legs, [index], '单关', ''))
    }
  }
  const pairIndexes = combinations(legs.map((_, index) => index), 2)
  for (const indexes of pairIndexes) {
    const selected = indexes.map(index => legs[index])
    if (new Set(selected.map(leg => leg.match_id)).size !== 2) continue
    if (selected.every(leg => formalLeg(leg) && leg.allup_allowed && leg.max_pass_size >= 2)) {
      tickets.push(ticketFor(legs, indexes, '2串1', ''))
    }
  }
  return tickets
}

function sortedHitLegs(legs) {
  return [...legs].sort((left, right) =>
    right.conservative_prob - left.conservative_prob
    || Number(right.market === 'HAD') - Number(left.market === 'HAD')
    || left.candidate_id.localeCompare(right.candidate_id))
}

function hitRatePlan(legs, threshold) {
  const rankedLegs = sortedHitLegs(legs)
  const tickets = simpleTicketPool(rankedLegs)
  const bestAvailable = [...tickets].sort((left, right) =>
    right.estimated_hit_prob - left.estimated_hit_prob
    || right.expected_net_cny - left.expected_net_cny)[0] ?? null
  const formal = tickets
    .filter(ticket => ticket.estimated_hit_prob >= threshold && ticket.expected_net_cny > 0)
    .sort((left, right) => {
      const singlePreference = Number(left.type === '单关') - Number(right.type === '单关')
      return -singlePreference || right.estimated_hit_prob - left.estimated_hit_prob || right.expected_net_cny - left.expected_net_cny
    })[0] ?? null
  const status = formal
    ? 'ready'
    : (bestAvailable?.estimated_hit_prob ?? 0) < threshold
      ? 'no_high_hit_option'
      : 'high_hit_negative_expectation'
  if (formal) formal.label = '高命中'
  return {
    contract_version: BET_PLAN_CONTRACT_VERSION,
    objective: 'hit_rate_first',
    status,
    decision: formal ? 'BET' : 'SKIP',
    gate: {
      high_hit_threshold: threshold,
      minimum_leg_ev: 0.03,
      best_conservative_prob: round(bestAvailable?.estimated_hit_prob ?? 0),
      reasons: formal ? [] : [status],
      overridden: false,
      override_reason: null,
    },
    best_available: bestAvailable,
    legs: rankedLegs,
    primary_ticket: formal,
    coverage_ticket: null,
    return_pool: null,
    entertainment: [],
    clv_tracking: [],
  }
}

function valuePlan(legs, minimumLegEv) {
  const rankedLegs = [...legs].sort((left, right) => right.ev - left.ev || right.conservative_prob - left.conservative_prob)
  const tickets = simpleTicketPool(rankedLegs)
    .filter(ticket => ticket.legs.every(index => rankedLegs[index].ev >= minimumLegEv) && ticket.expected_net_cny > 0)
    .sort((left, right) => right.expected_net_cny - left.expected_net_cny || right.estimated_hit_prob - left.estimated_hit_prob)
  const formal = tickets[0] ?? null
  if (formal) formal.label = '价值'
  return {
    contract_version: BET_PLAN_CONTRACT_VERSION,
    objective: 'value_first',
    status: formal ? 'ready' : 'no_value_option',
    decision: formal ? 'BET' : 'SKIP',
    gate: {
      high_hit_threshold: 0.65,
      minimum_leg_ev: minimumLegEv,
      best_conservative_prob: round(rankedLegs[0]?.conservative_prob ?? 0),
      reasons: formal ? [] : ['no_value_option'],
      overridden: false,
      override_reason: null,
    },
    best_available: formal,
    legs: rankedLegs,
    primary_ticket: formal,
    coverage_ticket: null,
    return_pool: null,
    entertainment: [],
    clv_tracking: [],
  }
}

function coverageVariants(legs) {
  const byMatch = new Map()
  for (const leg of legs.filter(leg => formalLeg(leg) && leg.allup_allowed)) {
    byMatch.set(leg.match_id, [...(byMatch.get(leg.match_id) ?? []), leg])
  }
  return [...byMatch.entries()].map(([matchId, candidates]) => {
    const singles = [...candidates]
      .sort((left, right) => right.conservative_prob - left.conservative_prob)
      .slice(0, 3)
      .map(option => ({ match_id: matchId, options: [{ ...option, id: option.candidate_id, probability: option.conservative_prob }] }))
    const grouped = new Map()
    for (const candidate of candidates) {
      const key = `${candidate.market}|${candidate.handicap ?? ''}`
      grouped.set(key, [...(grouped.get(key) ?? []), candidate])
    }
    const covered = [...grouped.values()].flatMap(options => {
      const ranked = [...options].sort((left, right) => right.conservative_prob - left.conservative_prob).slice(0, 2)
      if (ranked.length !== 2) return []
      const conservative = ranked.reduce((sum, option) => sum + option.conservative_prob, 0)
      const model = ranked.reduce((sum, option) => sum + option.model_prob, 0)
      if (conservative > 1 + 1e-9 || model > 1 + 1e-9) return []
      return [{ match_id: matchId, options: ranked.map(option => ({
        ...option,
        id: option.candidate_id,
        probability: option.conservative_prob,
      })) }]
    })
    return { matchId, variants: [...covered, ...singles] }
  })
}

function coveragePlan(legs, threshold, minimumProfitNet, minimumProfitRoi) {
  const rankedLegs = sortedHitLegs(legs)
  const matches = coverageVariants(rankedLegs)
  const evaluated = []
  for (const matchPair of combinations(matches, 2)) {
    for (const left of matchPair[0].variants) for (const right of matchPair[1].variants) {
      try {
        const result = evaluateCoverageProfit({
          groups: [left, right],
          stake: 2,
          highHitThreshold: threshold,
          minimumProfitNet,
          minimumProfitRoi,
          probabilityBasis: 'conservative_prob',
          expectedValueProbabilityBasis: 'model_prob',
        })
        evaluated.push({ groups: [left, right], result })
      } catch {
        // A variant can fail the official pass-size cap. Other variants remain eligible.
      }
    }
  }
  const chosen = evaluated.filter(item => item.result.ready)
    .sort((left, right) => right.result.coverage_hit_prob - left.result.coverage_hit_prob
      || right.result.expected_net - left.result.expected_net
      || left.result.combination_count - right.result.combination_count)[0] ?? null
  const coverageTicket = chosen ? {
    type: 'full_pass_coverage',
    groups: chosen.groups,
    probability_basis: 'conservative_prob',
    expected_value_probability_basis: 'model_prob',
    stake_per_combination: 2,
    profit_target: chosen.result.profit_target,
    combination_count: chosen.result.combination_count,
    cost_cny: chosen.result.cost,
    estimated_hit_prob: chosen.result.coverage_hit_prob,
    estimated_profit_prob: chosen.result.estimated_profit_prob,
    expected_net_cny: chosen.result.expected_net,
    covered_branch_floor_net_cny: chosen.result.covered_branch_floor_net,
    covered_branch_floor_roi: chosen.result.covered_branch_floor_roi,
    all_covered_branches_profitable: chosen.result.all_covered_branches_profitable,
    all_covered_branches_meet_target: chosen.result.all_covered_branches_meet_target,
    covered_branches: chosen.result.covered_branches,
  } : null
  return {
    contract_version: BET_PLAN_CONTRACT_VERSION,
    objective: 'coverage_profit_first',
    status: coverageTicket ? 'ready' : 'no_profitable_high_hit_coverage',
    decision: coverageTicket ? 'BET' : 'SKIP',
    gate: {
      high_hit_threshold: threshold,
      minimum_leg_ev: 0.03,
      best_conservative_prob: round(rankedLegs[0]?.conservative_prob ?? 0),
      reasons: coverageTicket ? [] : ['no_profitable_high_hit_coverage'],
      overridden: false,
      override_reason: null,
    },
    best_available: null,
    legs: rankedLegs,
    primary_ticket: null,
    coverage_ticket: coverageTicket,
    return_pool: null,
    entertainment: [],
    clv_tracking: [],
  }
}

export function generateBetPlan(analysis, options = {}) {
  if (analysis?.schema !== 'fdp.analysis-result.v2') throw new Error('analysis schema 必须为 fdp.analysis-result.v2')
  if (!Array.isArray(analysis.matches) || analysis.matches.length === 0) throw new Error('AnalysisResult.matches 不能为空')
  if (!/^[a-z0-9][a-z0-9-]+$/.test(String(analysis.batch_id ?? ''))) throw new Error('AnalysisResult.batch_id 不能用于不可变账本')
  const candidateIds = new Set()
  for (const match of analysis.matches) {
    if (!atLeast(match.audit?.version, '2.4.2')) throw new Error(`${match.match?.code ?? match.match?.match_id}: 只接受 v2.4.2+ AnalysisResult`)
    if (match.audit?.integrity_status !== 'pass') throw new Error(`${match.match?.code ?? match.match?.match_id}: AnalysisResult integrity 未通过`)
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(match.match?.match_id ?? ''))) {
      throw new Error(`${match.match?.code ?? 'match'}: match_id 必须是数据库 UUID`)
    }
    for (const candidate of match.plays?.candidates ?? []) {
      const id = String(candidate.candidate_id ?? '').trim()
      if (!id) throw new Error(`${match.match.code}/${candidate.market}/${candidate.selection}: candidate_id 缺失`)
      if (candidateIds.has(id)) throw new Error(`candidate_id 重复: ${id}`)
      candidateIds.add(id)
    }
  }
  const objective = options.objective ?? 'hit_rate_first'
  const highHitThreshold = Number(options.highHitThreshold ?? 0.65)
  const minimumLegEv = Number(options.minimumLegEv ?? 0.03)
  const legs = normalizeLegs(analysis)
  let betPlan
  if (objective === 'hit_rate_first') betPlan = hitRatePlan(legs, highHitThreshold)
  else if (objective === 'value_first') betPlan = valuePlan(legs, minimumLegEv)
  else if (objective === 'coverage_profit_first') {
    betPlan = coveragePlan(legs, highHitThreshold, Number(options.minimumProfitNet ?? 0), Number(options.minimumProfitRoi ?? 0))
  } else throw new Error(`不支持的 objective: ${objective}`)
  return {
    schema: 'fdp.bet-plan.v1',
    batch_id: options.batchId ?? `${analysis.batch_id}-bet-${objective.replaceAll('_', '-')}`,
    created_at: options.createdAt ?? new Date().toISOString(),
    source_analysis_batch_id: analysis.batch_id,
    bet_plan: betPlan,
  }
}

function cliArgument(name) {
  const prefix = `--${name}=`
  const found = process.argv.slice(2).find(value => value.startsWith(prefix))
  return found?.slice(prefix.length)
}

function main() {
  const analysisFile = cliArgument('analysis')
  const outputFile = cliArgument('output')
  if (!analysisFile || !outputFile) {
    throw new Error('用法: node scripts/generate-bet-plan.mjs --analysis=<analysis-result.json> --output=<bet-plan.json> [--objective=hit_rate_first|value_first|coverage_profit_first] [--batch-id=<id>]')
  }
  const analysis = JSON.parse(fs.readFileSync(path.resolve(analysisFile), 'utf8'))
  const artifact = generateBetPlan(analysis, {
    objective: cliArgument('objective') ?? 'hit_rate_first',
    batchId: cliArgument('batch-id'),
    highHitThreshold: cliArgument('high-hit-threshold'),
    minimumLegEv: cliArgument('minimum-leg-ev'),
    minimumProfitNet: cliArgument('minimum-profit-net'),
    minimumProfitRoi: cliArgument('minimum-profit-roi'),
  })
  const output = path.resolve(outputFile)
  fs.mkdirSync(path.dirname(output), { recursive: true })
  fs.writeFileSync(output, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify({
    ok: true,
    output,
    batch_id: artifact.batch_id,
    objective: artifact.bet_plan.objective,
    status: artifact.bet_plan.status,
    decision: artifact.bet_plan.decision,
  }, null, 2))
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  try {
    main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  }
}
