import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { format } from 'prettier';
import { evaluationScenarios, runEvaluationSuite } from '../src/evals/harness';

const writeFormattedJson = async (path: string, value: unknown): Promise<void> => {
  await mkdir(dirname(path), { recursive: true });
  const json = await format(JSON.stringify(value), { parser: 'json' });
  await writeFile(path, json, 'utf8');
};

const outputPath = join(process.cwd(), 'outputs', 'evaluation-report.json');
const report = await runEvaluationSuite();
await writeFormattedJson(outputPath, report);

const metricLines = Object.entries(report.metrics).map(
  ([name, metric]) =>
    `${name}: ${metric.numerator}/${metric.denominator} (${(metric.rate * 100).toFixed(1)}%)`,
);

console.log(`Evaluation suite: ${report.passedScenarios}/${report.scenarioCount} scenarios passed`);
for (const line of metricLines) console.log(line);
console.log(`Report: ${outputPath}`);

const promoteIndex = process.argv.indexOf('--promote');
if (promoteIndex >= 0) {
  const scenarioId = process.argv[promoteIndex + 1];
  const result = report.scenarios.find((scenario) => scenario.id === scenarioId);
  const definition = evaluationScenarios.find((scenario) => scenario.id === scenarioId);
  if (!scenarioId || !result || !definition) {
    throw new Error('Use --promote <scenario-id> with an existing reviewed scenario.');
  }
  const regressionPath = join(process.cwd(), 'src', 'evals', 'regressions', `${scenarioId}.json`);
  await writeFormattedJson(regressionPath, {
    id: result.id,
    category: result.category,
    purpose: result.purpose,
    reviewedAt: report.generatedAt,
    expectedChecks: result.checks,
    observed: result.actual,
  });
  console.log(`Promoted reviewed scenario: ${regressionPath}`);
}

if (report.passedScenarios !== report.scenarioCount) process.exitCode = 1;
