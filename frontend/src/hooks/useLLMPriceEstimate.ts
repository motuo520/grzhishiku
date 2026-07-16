import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getModelCatalog, LLMModelCatalogItem } from '@/api/llm';

/** Rough token estimator: 1 token ≈ 4 characters for mixed CJK/English text. */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  // CJK characters are roughly 1 token per character; Latin words ~ 0.75 tokens per word.
  // Use a blended heuristic that tends to slightly over-estimate for safety.
  let tokens = 0;
  for (const ch of text) {
    tokens += ch.charCodeAt(0) > 127 ? 1 : 0.25;
  }
  return Math.max(1, Math.ceil(tokens));
}

export interface PriceEstimate {
  model: LLMModelCatalogItem | null;
  inputTokens: number;
  outputTokens: number;
  inputCost: number;
  outputCost: number;
  totalCost: number;
  currency: string;
}

export function useLLMPriceEstimate(
  modelId: string | undefined,
  inputText: string,
  outputTokenEstimate: number = 150,
): PriceEstimate {
  const { data: catalog } = useQuery({
    queryKey: ['llmModelCatalog'],
    queryFn: getModelCatalog,
    staleTime: 5 * 60 * 1000,
  });

  return useMemo(() => {
    const models = catalog?.models || [];
    const model = modelId ? models.find((m) => m.id === modelId) || null : null;
    const inputTokens = estimateTokens(inputText);
    const outputTokens = Math.max(0, outputTokenEstimate);

    if (!model) {
      return {
        model: null,
        inputTokens,
        outputTokens,
        inputCost: 0,
        outputCost: 0,
        totalCost: 0,
        currency: 'CNY',
      };
    }

    const inputPricePer1k = model.price_input_per_1k || 0;
    const outputPricePer1k = model.price_output_per_1k || 0;
    const inputCost = (inputTokens / 1000) * inputPricePer1k;
    const outputCost = (outputTokens / 1000) * outputPricePer1k;

    return {
      model,
      inputTokens,
      outputTokens,
      inputCost,
      outputCost,
      totalCost: inputCost + outputCost,
      currency: model.currency || 'CNY',
    };
  }, [catalog, modelId, inputText, outputTokenEstimate]);
}

export function formatCost(cost: number, currency: string = 'CNY'): string {
  const symbol = currency === 'USD' ? '$' : '¥';
  if (cost === 0) return `${symbol}0.00`;
  if (cost < 0.01) return `${symbol}<0.01`;
  return `${symbol}${cost.toFixed(2)}`;
}
