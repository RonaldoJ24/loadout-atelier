import { describe, expect, it } from 'vitest';
import { EVALUATION_METRICS, evaluationScenarios, runEvaluationSuite } from '../../src/evals';

describe('curated evaluation harness', () => {
  it('contains all 40 uniquely named scenarios covering required failure classes', () => {
    expect(evaluationScenarios.length).toBe(40);
    expect(new Set(evaluationScenarios.map((scenario) => scenario.id)).size).toBe(
      evaluationScenarios.length,
    );
    const categories = new Set(evaluationScenarios.map((scenario) => scenario.category));
    for (const category of [
      'invalid-build',
      'requirements',
      'compatibility',
      'ability-tree',
      'goal-conflict',
      'evidence',
      'tool-contract',
      'provider-failure',
      'provider-schema',
      'grounding',
      'retrieval-safety',
      'patch-regression',
    ]) {
      expect(categories.has(category)).toBe(true);
    }
  });

  it('replays every scenario and reports exact, non-empty denominators', async () => {
    const report = await runEvaluationSuite();
    expect(report.scenarioCount).toBe(evaluationScenarios.length);
    expect(report.passedScenarios).toBe(report.scenarioCount);
    for (const metric of EVALUATION_METRICS) {
      expect(report.metrics[metric].denominator).toBeGreaterThan(0);
      expect(report.metrics[metric].numerator).toBe(report.metrics[metric].denominator);
    }
  });

  it('does not treat an empty observation as a passing scenario', async () => {
    const report = await runEvaluationSuite([
      {
        id: 'empty-observation',
        category: 'harness',
        purpose: 'Exercise empty-check handling.',
        run: () => ({ checks: {}, summary: 'no checks', actual: {} }),
      },
    ]);
    expect(report.passedScenarios).toBe(0);
    expect(report.scenarioCount).toBe(1);
    expect(report.metrics.constraintSatisfaction).toEqual({
      numerator: 0,
      denominator: 0,
      rate: 0,
    });
  });
});
