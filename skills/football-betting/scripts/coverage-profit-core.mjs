function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function round(value, digits = 6) {
  return Number(value.toFixed(digits))
}

function cartesian(groups, index = 0, prefix = [], output = []) {
  if (index === groups.length) {
    output.push([...prefix])
    return output
  }
  for (const option of groups[index].options) {
    prefix.push(option)
    cartesian(groups, index + 1, prefix, output)
    prefix.pop()
  }
  return output
}

function sameLine(left, right) {
  return String(left ?? '') === String(right ?? '')
}

export function validateCoverageGroups(groups, stake) {
  assert(Array.isArray(groups) && groups.length >= 2 && groups.length <= 8, 'groups must contain 2-8 distinct matches')
  assert(Number.isFinite(stake) && stake > 0 && stake % 2 === 0, 'stakePerCombination must be a positive multiple of 2 yuan')

  const seenMatches = new Set()
  for (const [groupIndex, group] of groups.entries()) {
    assert(group.match_id, `groups[${groupIndex}].match_id is required`)
    assert(!seenMatches.has(group.match_id), `duplicate match_id: ${group.match_id}`)
    seenMatches.add(group.match_id)
    assert(Array.isArray(group.options) && group.options.length >= 1 && group.options.length <= 2, `groups[${groupIndex}].options must contain 1-2 mutually exclusive selections`)

    const selections = new Set()
    const first = group.options[0]
    let probabilitySum = 0
    let modelProbabilitySum = 0
    for (const [optionIndex, option] of group.options.entries()) {
      const pointer = `groups[${groupIndex}].options[${optionIndex}]`
      assert(option.id, `${pointer}.id is required`)
      assert(option.match_id === group.match_id, `${pointer}.match_id must equal its group match_id`)
      assert(option.market, `${pointer}.market is required`)
      assert(option.market === first.market, `${pointer}.market must match other options in the group`)
      assert(sameLine(option.handicap, first.handicap), `${pointer}.handicap must match other options in the group`)
      assert(option.selection, `${pointer}.selection is required`)
      assert(!selections.has(option.selection), `duplicate selection in groups[${groupIndex}]: ${option.selection}`)
      selections.add(option.selection)
      assert(option.eligible === true, `${pointer} is not eligible`)
      assert(option.pool_allowed === true, `${pointer} is not pool_allowed`)
      assert(option.pool_status === 'Selling', `${pointer} is not Selling`)
      assert(option.allup_allowed === true, `${pointer} does not allow all-up betting`)
      assert(Number.isInteger(option.max_pass_size) && option.max_pass_size >= groups.length, `${pointer}.max_pass_size is below ticket length ${groups.length}`)
      assert(option.odds_snapshot_at, `${pointer}.odds_snapshot_at is required`)
      assert(Number.isFinite(option.odds) && option.odds > 1, `${pointer}.odds is invalid`)
      assert(Number.isFinite(option.probability) && option.probability >= 0 && option.probability <= 1, `${pointer}.probability is invalid`)
      assert(Number.isFinite(option.model_prob) && option.model_prob >= 0 && option.model_prob <= 1, `${pointer}.model_prob is required for expected-value calculation`)
      probabilitySum += option.probability
      modelProbabilitySum += option.model_prob
    }
    assert(probabilitySum <= 1 + 1e-9, `groups[${groupIndex}] probability sum exceeds 1`)
    assert(modelProbabilitySum <= 1 + 1e-9, `groups[${groupIndex}] model_prob sum exceeds 1`)
  }
}

export function evaluateCoverageProfit({
  groups,
  stake = 2,
  highHitThreshold = 0.65,
  minimumProfitNet = 0,
  minimumProfitRoi = 0,
  probabilityBasis = 'conservative_prob',
  expectedValueProbabilityBasis = 'model_prob',
}) {
  validateCoverageGroups(groups, stake)
  assert(Number.isFinite(highHitThreshold) && highHitThreshold > 0 && highHitThreshold <= 1, 'highHitThreshold must be in (0, 1]')
  assert(Number.isFinite(minimumProfitNet) && minimumProfitNet >= 0, 'minimumProfitNet must be >= 0')
  assert(Number.isFinite(minimumProfitRoi) && minimumProfitRoi >= 0, 'minimumProfitRoi must be >= 0')

  const branches = cartesian(groups)
  const cost = stake * branches.length
  const passSize = groups.length
  const baseCap = passSize <= 3 ? 200000 : passSize <= 5 ? 500000 : 1000000
  const ticketCap = baseCap * (stake / 2)
  const branchRows = branches.map((branch, index) => {
    const probability = branch.reduce((product, option) => product * option.probability, 1)
    const expectedValueProbability = branch.reduce((product, option) => product * option.model_prob, 1)
    const oddsProduct = branch.reduce((product, option) => product * option.odds, 1)
    const payout = round(Math.min(stake * oddsProduct, ticketCap), 2)
    const net = round(payout - cost, 2)
    const roi = round(net / cost)
    const profitable = net > 0
    const meetsTarget = profitable && net >= minimumProfitNet && roi >= minimumProfitRoi
    return {
      branch_id: `branch-${index + 1}`,
      leg_ids: branch.map((option) => option.id),
      probability: round(probability),
      expected_value_probability: round(expectedValueProbability),
      odds_product: round(oddsProduct),
      payout,
      net,
      roi,
      profitable,
      meets_profit_target: meetsTarget,
    }
  })

  const groupCoverage = groups.map((group) => group.options.reduce((sum, option) => sum + option.probability, 0))
  const coverageHitProb = groupCoverage.reduce((product, probability) => product * probability, 1)
  const expectedPayout = branchRows.reduce((sum, branch) => sum + branch.expected_value_probability * branch.payout, 0)
  const estimatedProfitProb = branchRows.filter((branch) => branch.profitable).reduce((sum, branch) => sum + branch.probability, 0)
  const targetProfitProb = branchRows.filter((branch) => branch.meets_profit_target).reduce((sum, branch) => sum + branch.probability, 0)
  const allCoveredBranchesProfitable = branchRows.every((branch) => branch.profitable)
  const allCoveredBranchesMeetTarget = branchRows.every((branch) => branch.meets_profit_target)
  const expectedNet = expectedPayout - cost
  const highHit = coverageHitProb >= highHitThreshold
  const ready = highHit && allCoveredBranchesMeetTarget && expectedNet > 0
  const status = ready
    ? 'ready'
    : !highHit
      ? 'no_high_hit_coverage'
      : !allCoveredBranchesMeetTarget
        ? 'conditional_coverage_profit'
        : 'high_hit_negative_expectation'

  return {
    status,
    ready,
    probability_basis: probabilityBasis,
    expected_value_probability_basis: expectedValueProbabilityBasis,
    independence_assumed_across_matches: true,
    profit_target: {
      minimum_net_cny: minimumProfitNet,
      minimum_roi: minimumProfitRoi,
      strict_positive_net_required: true,
    },
    official_rule_checks: {
      all_selling: true,
      all_allup_allowed: true,
      distinct_matches: true,
      same_market_line_within_group: true,
      pass_size_within_cap: true,
      fixed_odds_snapshot_locked: true,
      ticket_cap_applied: true,
    },
    match_groups: groups.length,
    selections_per_group: groups.map((group) => group.options.length),
    pass_size: passSize,
    combination_count: branches.length,
    stake_per_combination: stake,
    cost,
    group_coverage_probabilities: groupCoverage.map((value) => round(value)),
    high_hit_threshold: highHitThreshold,
    coverage_hit_prob: round(coverageHitProb),
    estimated_profit_prob: round(estimatedProfitProb),
    target_profit_prob: round(targetProfitProb),
    expected_payout: round(expectedPayout, 2),
    expected_net: round(expectedNet, 2),
    expected_roi: round(expectedNet / cost),
    all_covered_branches_profitable: allCoveredBranchesProfitable,
    all_covered_branches_meet_target: allCoveredBranchesMeetTarget,
    covered_branch_floor_net: Math.min(...branchRows.map((branch) => branch.net)),
    covered_branch_floor_roi: Math.min(...branchRows.map((branch) => branch.roi)),
    covered_branch_ceiling_net: Math.max(...branchRows.map((branch) => branch.net)),
    profitable_covered_branches: branchRows.filter((branch) => branch.profitable).length,
    target_covered_branches: branchRows.filter((branch) => branch.meets_profit_target).length,
    covered_branches: branchRows,
  }
}
