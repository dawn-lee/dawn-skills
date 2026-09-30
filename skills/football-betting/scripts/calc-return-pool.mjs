import fs from 'node:fs';
import { evaluateReturnPool } from './return-pool-core.mjs';

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

try {
  const output = evaluateReturnPool({
    selections: input.selections,
    passSizes: input.passSizes ?? [2, 3],
    stake: input.stakePerCombination ?? 2,
    probabilityBasis: input.probabilityBasis ?? 'conservative_prob',
    expectedValueProbabilityBasis: input.expectedValueProbabilityBasis ?? 'model_prob',
  });
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
} catch (error) {
  fail(error.message);
}
