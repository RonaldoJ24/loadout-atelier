import type { RecommendationCandidate, RecommendationResult } from '../domain/contracts.js';
import type { ToolOutcome, ToolTrace } from '../data/types.js';

export type DeepSeekRole = 'system' | 'user' | 'assistant';

export type DeepSeekMessage = {
  role: DeepSeekRole;
  content: string;
};

export type DeepSeekCompletionRequest = {
  messages: DeepSeekMessage[];
  /** Optional request-local model override. The provider default is used otherwise. */
  model?: string;
};

export type DeepSeekProviderOptions = {
  apiKey?: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
  model?: string;
  endpoint?: string;
};

export type DeepSeekCompletion = unknown;

export type DeepSeekProvider = {
  readonly available: boolean;
  readonly model: string;
  complete(request: DeepSeekCompletionRequest | string): Promise<ToolOutcome<DeepSeekCompletion>>;
  /** Complete and parse the strict recommendation candidate contract. */
  recommend(
    request: DeepSeekCompletionRequest | string,
  ): Promise<ToolOutcome<RecommendationCandidate>>;
};

export type RecommendationExplainInput = {
  build: unknown;
  goals: unknown;
  dataset?: unknown;
  provider?: DeepSeekProvider;
  /** Optional deterministic recheck hook supplied by the engine boundary. */
  recheck?: RecommendationRecheck;
  /** Optional source cards used for citation and freshness checks. */
  sources?: unknown;
};

export type RecommendationRecheckContext = {
  build: unknown;
  /** The candidate after the boundary has applied its requested operations. */
  proposedBuild?: unknown;
  goals: unknown;
  candidate: RecommendationCandidate;
  dataset: unknown;
};

export type RecommendationRecheckResult = {
  valid: boolean;
  proposedBuild?: unknown;
  validation?: unknown;
  reasons?: string[];
  citationIds?: string[];
};

export type RecommendationRecheck = (
  context: RecommendationRecheckContext,
) => RecommendationRecheckResult | Promise<RecommendationRecheckResult>;

export type RecommendationExplainOptions = RecommendationExplainInput;

export type RecommendationOutcome = RecommendationResult;

export type ProviderTrace = ToolTrace;
