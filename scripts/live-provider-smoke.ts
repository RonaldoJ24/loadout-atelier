import { createDeepSeekProvider } from '../src/ai/deepseek';

const apiKey = process.env.DEEPSEEK_API_KEY;
if (!apiKey) {
  console.error('Live provider smoke skipped: DEEPSEEK_API_KEY is unavailable to this process.');
  process.exitCode = 2;
} else {
  const provider = createDeepSeekProvider({
    apiKey,
    model: process.env.DEEPSEEK_MODEL,
    timeoutMs: 12_000,
  });
  const result = await provider.recommend({
    messages: [
      {
        role: 'system',
        content:
          'Return JSON only. Produce one conservative structured build rationale using exactly the supplied IDs.',
      },
      {
        role: 'user',
        content:
          'Return exactly this JSON object with no extra keys: {"summary":"Keep the verified fixture build unchanged.","equipmentChanges":[],"abilityChanges":{"add":[],"remove":[]},"tradeoffs":["No equipment or ability changes are proposed."],"citationIds":["fixture-method"]}',
      },
    ],
  });

  const sanitized = {
    ok: result.ok,
    model: provider.model,
    schemaValid: result.ok,
    trace: {
      status: result.trace.status,
      tool: result.trace.tool,
      durationMs: result.trace.durationMs,
      message: result.trace.message,
    },
  };
  console.log(JSON.stringify(sanitized));
  if (!result.ok) process.exitCode = 1;
}
