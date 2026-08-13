import type { QueryClient } from '@tanstack/react-query';

// 内容（笔记/剪藏/知识单元等）变更后需要全局失效的 queryKey 前缀：
// 列表页 + 聚合视图（pipeline/emergence/brain 统计）+ 标签体系
const CONTENT_QUERY_PREFIXES = ['notes', 'clips', 'read-later', 'knowledge', 'capsules', 'documents', 'rss-feeds', 'rss-entries', 'tags', 'tag-associations', 'pipeline', 'emergence', 'brain', 'chat'];

export function invalidateContentQueries(queryClient: QueryClient): void {
  for (const key of CONTENT_QUERY_PREFIXES) {
    queryClient.invalidateQueries({ queryKey: [key], refetchType: 'all' });
  }
}
