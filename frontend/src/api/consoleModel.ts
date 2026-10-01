// 用途：所有 LLM 端点随右上角控制台联动，preferred_model 缺省回填唯一入口。
import { useSettings, defaultLLMForSelection } from '@/store/settings';

/**
 * 读控制台（右上角）当前选型，映射为 preferred_model 用的目录 id / platform:{model}。
 * 映射不到（如目录行 sys-/opencode-）或选型为空时返回 undefined——调用方保持不带该字段。
 */
export function getConsolePreferredModel(): string | undefined {
  const { activeProvider, activeModel } = useSettings.getState();
  return defaultLLMForSelection(activeProvider, activeModel) || undefined;
}
