import { useQuery } from '@tanstack/react-query';
import { getModelCatalog } from '@/api/llm';

/**
 * 模型 id → 展示名：剥 platform: 前缀，查本地目录名，查不到回退裸 id。
 * （开源版无云端目录，仅查本地 LLM 目录）
 */
export function useModelDisplayName(modelId?: string): string {
  const bare = modelId?.startsWith('platform:') ? modelId.slice('platform:'.length) : modelId;

  const { data: catalog } = useQuery({
    queryKey: ['llmModelCatalog'],
    queryFn: getModelCatalog,
    staleTime: 5 * 60 * 1000,
  });

  if (!bare) return '';
  return catalog?.models.find((m) => m.id === bare)?.name || bare;
}
