export {
  createDeepSeekProvider,
  DEEPSEEK_ENDPOINT,
  DEFAULT_DEEPSEEK_MODEL,
  DEFAULT_DEEPSEEK_TIMEOUT_MS,
  MAX_DEEPSEEK_TIMEOUT_MS,
} from './deepseek.js';
export { explainRecommendation } from './recommendation.js';
export type {
  DeepSeekCompletion,
  DeepSeekCompletionRequest,
  DeepSeekMessage,
  DeepSeekProvider,
  DeepSeekProviderOptions,
  DeepSeekRole,
  RecommendationExplainInput,
  RecommendationExplainOptions,
  RecommendationOutcome,
  RecommendationRecheck,
  RecommendationRecheckContext,
  RecommendationRecheckResult,
} from './types.js';
