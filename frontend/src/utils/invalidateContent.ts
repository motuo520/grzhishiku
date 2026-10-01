import type { QueryClient } from '@tanstack/react-query';

// 内容（笔记/剪藏/知识单元等）变更后需要全局失效的 queryKey 前缀：
// 列表页 + 聚合视图（pipeline/emergence/brain 统计）+ 标签体系
// 注意 queryKey 匹配是数组逐元素前缀：'graphify' 匹配不到 'graphify-status'
// 这类连字符单元素 key，graphify-*/wiki-* 必须逐条列全
const CONTENT_QUERY_PREFIXES = ['notes', 'clips', 'read-later', 'knowledge', 'capsules', 'documents', 'rss-feeds', 'rss-entries', 'tags', 'tag-associations', 'pipeline', 'emergence', 'brain', 'chat', 'folders', 'sticky-notes', 'reminders', 'embodied', 'graph-bridges', 'graph-tag-network', 'graphify-status', 'graphify-graph', 'graphify-physical-graph', 'graphify-report', 'graphify-build-estimate', 'graphify-auto-evolve', 'wiki-topics', 'wiki-entries', 'wiki-entry', 'wiki-lint', 'cognitive', 'jianghu', 'attention', 'knowledge-top-invoked', 'knowledge-recent-practiced', 'rss-auto-fetch'];

export function invalidateContentQueries(queryClient: QueryClient): void {
  for (const key of CONTENT_QUERY_PREFIXES) {
    // refetchType 默认 active（09-14 云端卡顿实捕：'all' 会把 35 路前缀的全部缓存
    // 查询——包括没挂载的页面——立刻重取，单 worker 后端被失效风暴打满，
    // 保存一次笔记列表 5 秒才刷新）。active 只重取正在挂载的查询，未挂载的
    // 标记 stale、下次进页面时才重取——失效语义不变，风暴消失。
    queryClient.invalidateQueries({ queryKey: [key] });
  }
}
