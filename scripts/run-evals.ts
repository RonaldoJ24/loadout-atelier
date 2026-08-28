import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { evaluationScenarios, runEvaluationSuite } from '../src/evals/harness';

const outputPath = join(process.cwd(), 'outputs', 'evaluation-report.json');
const report = await runEvaluationSuite();
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

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
  await mkdir(dirname(regressionPath), { recursive: true });
  await writeFile(
    regressionPath,
    `${JSON.stringify(
      {
        id: result.id,
        category: result.category,
        purpose: result.purpose,
        reviewedAt: report.generatedAt,
        expectedChecks: result.checks,
        observed: result.actual,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  console.log(`Promoted reviewed scenario: ${regressionPath}`);
}

if (report.passedScenarios !== report.scenarioCount) process.exitCode = 1;
