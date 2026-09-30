#!/usr/bin/env node

import fs from 'node:fs'
import { evaluateCoverageProfit } from './coverage-profit-core.mjs'

function fail(message) {
  process.stderr.write(`${message}\n`)
  process.exit(1)
}

const inputPath = process.argv[2]
const raw = inputPath ? fs.readFileSync(inputPath, 'utf8') : fs.readFileSync(0, 'utf8')
let input
try {
  input = JSON.parse(raw)
} catch (error) {
  fail(`Invalid JSON: ${error.message}`)
}

try {
  const output = evaluateCoverageProfit({
    groups: input.groups,
    stake: input.stakePerCombination ?? 2,
    highHitThreshold: input.highHitThreshold ?? 0.65,
    minimumProfitNet: input.minimumProfitNet ?? 0,
    minimumProfitRoi: input.minimumProfitRoi ?? 0,
    probabilityBasis: input.probabilityBasis ?? 'conservative_prob',
    expectedValueProbabilityBasis: input.expectedValueProbabilityBasis ?? 'model_prob',
  })
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`)
} catch (error) {
  fail(error.message)
}
