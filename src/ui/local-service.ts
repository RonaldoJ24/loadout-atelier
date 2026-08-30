import { z } from 'zod';
import type { Build, BuildGoals, RecommendationResult } from '../domain/contracts';
import { buildSchema, naturalGoalSchema, recommendationCandidateSchema } from '../domain/schemas';

type RequestOptions = { fetcher?: typeof fetch; signal?: AbortSignal };
export type LocalServiceStatus = { mode: 'fixture' | 'live'; providerAvailable: boolean };

export const isLocalServiceAllowed = (
  hostname = typeof window === 'undefined' ? '' : window.location.hostname,
): boolean => ['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname);

const statsSchema = z.object({
  health: z.number(),
  damage: z.number(),
  healing: z.number(),
  defense: z.number(),
  mobility: z.number(),
  spellDamage: z.number(),
  meleeDamage: z.number(),
  manaRegen: z.number(),
});

const resultSchema = z
  .object({
    status: z.enum(['recommended', 'abstained']),
    origin: z.enum(['deterministic', 'ai-assisted', 'fixture-fallback']),
    candidate: recommendationCandidateSchema.optional(),
    proposedBuild: buildSchema.optional(),
    validation: z.object({
      valid: z.boolean(),
      deterministic: z.literal(true),
      issues: z
        .array(
          z.object({
            code: z.enum([
              'missing-item',
              'unavailable-item',
              'wrong-slot',
              'duplicate-item',
              'level-requirement',
              'skill-requirement',
              'class-requirement',
              'incompatible-items',
              'missing-ability-prerequisite',
              'ability-conflict',
              'ability-point-limit',
              'budget-exceeded',
              'stale-dataset',
            ]),
            severity: z.enum(['error', 'warning']),
            path: z.string().max(300),
            message: z.string().max(2000),
            sourceId: z.string().max(128).optional(),
          }),
        )
        .max(256),
      totals: statsSchema,
      skillTotals: buildSchema.shape.skillPoints,
      cost: z.number().nonnegative(),
      abilityPoints: z.number().nonnegative(),
    }),
    explanation: z.string().max(10_000),
    citationIds: z.array(z.string().max(128)).max(64),
    traces: z
      .array(
        z.object({
          id: z.string().max(128),
          tool: z.string().max(128),
          status: z.enum(['ok', 'fallback', 'error', 'abstained']),
          mode: z.enum(['live', 'cached', 'fixture', 'provider']),
          startedAt: z.string().max(64),
          durationMs: z.number().nonnegative(),
          sourceIds: z.array(z.string().max(128)).max(64),
          message: z.string().max(2000),
        }),
      )
      .max(256),
    abstentionReasons: z.array(z.string().max(2000)).max(64),
  })
  .refine(
    (result) =>
      result.status !== 'recommended' ||
      (result.validation.valid && result.candidate && result.proposedBuild),
    { message: 'A recommendation requires a validated proposal.' },
  );

async function requestJson(
  path: string,
  options: RequestOptions,
  body?: unknown,
): Promise<unknown> {
  if (!isLocalServiceAllowed())
    throw new Error('Local AI is available only on this computer, not in the public demo.');
  const timeout = AbortSignal.timeout(15_000);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  try {
    const response = await (options.fetcher ?? fetch)(path, {
      method: body === undefined ? 'GET' : 'POST',
      headers:
        body === undefined
          ? { Accept: 'application/json' }
          : {
              Accept: 'application/json',
              'Content-Type': 'application/json',
            },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal,
    });
    if (!response.ok) throw new Error('local service response failed');
    return await response.json();
  } catch {
    if (options.signal?.aborted) throw new Error('Request cancelled.');
    if (timeout.aborted)
      throw new Error('The local service timed out. Try again or use the offline recommendation.');
    throw new Error('The local service is unavailable. Start npm run dev, then reconnect.');
  }
}

export async function readLocalServiceStatus(
  options: RequestOptions = {},
): Promise<LocalServiceStatus> {
  const parsed = z
    .object({
      status: z.literal('ok'),
      service: z.literal('loadout-atelier'),
      mode: z.enum(['fixture', 'live']),
      provider: z.enum(['available', 'unavailable']),
    })
    .safeParse(await requestJson('/api/health', options));
  if (!parsed.success)
    throw new Error('The local service returned an unexpected status. Restart npm run dev.');
  return { mode: parsed.data.mode, providerAvailable: parsed.data.provider === 'available' };
}

export async function requestLocalRecommendation(
  build: Build,
  goals: BuildGoals,
  options: RequestOptions = {},
): Promise<RecommendationResult> {
  // Whitelist input fields; profile state and browser storage never enter this request.
  const cleanBuild = buildSchema.safeParse(build);
  const cleanGoals = naturalGoalSchema.safeParse(goals);
  if (!cleanBuild.success || !cleanGoals.success)
    throw new Error('Complete the build and goals before requesting a recommendation.');
  const parsed = resultSchema.safeParse(
    await requestJson('/api/recommend', options, {
      build: cleanBuild.data,
      goals: cleanGoals.data,
    }),
  );
  if (!parsed.success)
    throw new Error(
      'The local service returned an invalid recommendation. No changes were applied.',
    );
  return parsed.data;
}
