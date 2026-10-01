import { FC, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  GitCommit, Globe, Search, ExternalLink, ShieldCheck,
  AlertTriangle, HelpCircle, ChevronDown, Info
} from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSourceAggregates } from '@/hooks/useKnowledge';
import { knowledgeApi } from '@/api/knowledge';
import { settingsApi } from '@/api/settings';
import ErrorState from '@/components/ErrorState';
import type { KnowledgeSourceAggregate } from '@/types';

// 信誉档的人话映射（看一眼就懂，不用猜 high/medium 是什么）
const TIER = {
  trusted: { label: '可信', cls: 'text-success', dot: 'bg-success', desc: '人工信誉表里的高信誉站点' },
  normal: { label: '一般', cls: 'text-warning', dot: 'bg-warning', desc: '信誉中等的站点' },
  review: { label: '待核实', cls: 'text-text-muted', dot: 'bg-text-muted', desc: '信誉表未收录或低信誉站点——其内容建议人工留意' },
} as const;

type TierKey = keyof typeof TIER;

const tierOf = (reputation: string): TierKey => {
  if (reputation === 'high') return 'trusted';
  if (reputation === 'medium') return 'normal';
  return 'review'; // low / very low / unknown 都归「待核实」
};

// 生效档：后端下发的 tier（含手动覆盖）优先，缺省回落信誉表判定
const effTier = (s: KnowledgeSourceAggregate): TierKey => {
  const t = s.tier as TierKey | undefined;
  return t && TIER[t] ? t : tierOf(s.reputation);
};

const extractDomain = (url: string | null | undefined): string => {
  if (!url) return '';
  try {
    let d = new URL(url).hostname.toLowerCase();
    if (d.startsWith('www.')) d = d.slice(4);
    return d;
  } catch {
    return '';
  }
};

// 信誉表 factors 中文化（后端 DOMAIN_REPUTATION 的英文短语库；未收录的原样透传）
const FACTOR_ZH: Record<string, string> = {
  'unknown domain': '未收录域名',
  'no editorial track record': '无编辑记录',
  'unverified': '未验证',
  'peer-reviewed preprints': '同行评审预印本',
  'peer-reviewed': '同行评审',
  'academic institution': '学术机构',
  'open access': '开放获取',
  'nih database': 'NIH 数据库',
  'medical research': '医学研究',
  'top-tier journal': '顶级期刊',
  'springer nature': 'Springer Nature 出版',
  'aaas': 'AAAS 出版',
  'professional organization': '专业组织',
  'engineering standard': '工程标准',
  'computer science': '计算机科学',
  'crowdsourced': '众包内容',
  'editable': '人人可编辑',
  'general reference': '通用参考',
  'open source': '开源',
  'version controlled': '版本可控',
  'community reviewed': '社区评审',
  'user-generated': '用户生成内容',
  'user-generated content': '用户生成内容',
  'mixed editorial': '编辑质量参差',
  'blog platform': '博客平台',
  'anonymous': '匿名发布',
  'no editorial control': '无编辑审核',
  'social media': '社交媒体',
  'ephemeral': '内容易逝',
  'user-generated video': '用户生成视频',
  'algorithm-driven': '算法驱动',
  'mixed quality': '质量参差',
  'tech community': '技术社区',
  'discussion-driven': '讨论驱动',
  'unverified claims': '断言未核实',
  'tech journalism': '科技媒体',
  'editorial review': '有编辑审核',
  'opinion-heavy': '观点偏重',
  'established newspaper': '老牌报纸',
  'independent': '独立媒体',
  'fact-checking': '有事实核查',
  'news agency': '通讯社',
  'editorial standards': '编辑规范',
  'global coverage': '全球覆盖',
  'financial news': '财经媒体',
  'data-driven': '数据驱动',
  'business journalism': '商业媒体',
  'contributor model': '撰稿人模式',
  'mainstream media': '主流媒体',
  'sensationalism risk': '有煽情倾向',
  'editorial bias': '有编辑立场偏向',
  'political lean': '有政治倾向',
  'partisan outlet': '党派媒体',
  'questionable sourcing': '信源存疑',
  'conspiracy content': '含阴谋论内容',
  'conspiracy theories': '阴谋论',
  'disinformation': '虚假信息记录',
  'legal issues': '有法律纠纷记录',
};
const factorZh = (f: string) => FACTOR_ZH[f.toLowerCase()] ?? f;

const SourceTraceabilityPage: FC = () => {
  const { sources, isLoading, error, refetch } = useSourceAggregates();
  const [searchQuery, setSearchQuery] = useState('');
  const [tierFilter, setTierFilter] = useState<TierKey | null>(null);
  const [expandedDomain, setExpandedDomain] = useState<string | null>(null);
  const queryClient = useQueryClient();

  // 信誉档三档开关：写 settings.source_tiers（后端 dict 浅合并；'auto' 哨兵=恢复自动判定）
  const setTier = async (domain: string, tier: TierKey | 'auto') => {
    try {
      await settingsApi.updateSettings({ source_tiers: { [domain]: tier } });
      queryClient.invalidateQueries({ queryKey: ['knowledge', 'sources'] });
    } catch {
      // 失败静默——下次展开/刷新重试（设置写入失败不阻断浏览）
    }
  };

  // 展开时才拉全量知识单元（客户端按域名过滤；个人库量级客户端扛得住）
  const { data: allUnits, isLoading: unitsLoading } = useQuery({
    queryKey: ['knowledge', 'all-for-source-trace'],
    queryFn: () => knowledgeApi.list().then((r) => r.data),
    enabled: expandedDomain !== null,
    staleTime: 5 * 60 * 1000,
  });

  const filtered = useMemo(() => {
    if (!sources) return [];
    let list = sources;
    if (tierFilter) list = list.filter((s) => effTier(s) === tierFilter);
    const q = searchQuery.trim().toLowerCase();
    if (q) list = list.filter((s) => s.domain.toLowerCase().includes(q));
    return list;
  }, [sources, searchQuery, tierFilter]);

  const stats = useMemo(() => {
    if (!sources) return null;
    const byTier: Record<TierKey, number> = { trusted: 0, normal: 0, review: 0 };
    let units = 0;
    for (const s of sources) {
      byTier[effTier(s)] += 1;
      units += s.count;
    }
    return { byTier, units, domains: sources.length };
  }, [sources]);

  const expandedUnits = useMemo(() => {
    if (!expandedDomain || !allUnits) return [];
    return allUnits
      .filter((u) => extractDomain(u.source_url) === expandedDomain)
      .map((u) => ({
        id: u.id,
        title: u.source_title || (u.content_raw || '').slice(0, 40),
        verification_status: u.verification_status,
      }));
  }, [expandedDomain, allUnits]);

  if (isLoading) {
    return (
      <div className="max-w-5xl mx-auto p-6 flex items-center justify-center h-96">
        <div className="animate-spin w-10 h-10 border-2 border-info border-t-transparent rounded-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-5xl mx-auto p-6">
        <ErrorState title="来源追溯加载失败" message={error?.message || '无法获取来源数据'} onRetry={refetch} />
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      {/* 页头：一句话说清这页是干什么的 */}
      <div>
        <h1 className="text-2xl font-bold text-text-primary flex items-center gap-2">
          <GitCommit className="w-6 h-6 text-info" /> 来源追溯
        </h1>
        <p className="text-sm text-text-secondary mt-1">
          你的知识都来自哪些网站？哪些可信、哪些该留个心眼——一眼看明白。
        </p>
      </div>

      {/* 三档总览：可信/一般/待核实，点击即过滤 */}
      {stats && (
        <div className="grid grid-cols-3 gap-3">
          {(Object.keys(TIER) as TierKey[]).map((key) => {
            const t = TIER[key];
            const active = tierFilter === key;
            return (
              <button
                key={key}
                onClick={() => setTierFilter(active ? null : key)}
                className={`glass-card px-4 py-3 text-left transition-all ${
                  active ? 'border-info/50 ring-1 ring-info/30' : 'hover:border-info/20'
                }`}
                title={t.desc}
              >
                <div className="flex items-center gap-2">
                  <span className={`w-2.5 h-2.5 rounded-full ${t.dot}`} />
                  <span className={`text-lg font-bold ${t.cls}`}>{stats.byTier[key]}</span>
                  <span className="text-xs text-text-muted ml-auto">家</span>
                </div>
                <div className="text-xs text-text-secondary mt-1">{t.label}来源</div>
              </button>
            );
          })}
        </div>
      )}

      {/* 指标人话说明（两个数字到底是什么） */}
      <div className="glass-card px-4 py-2.5 flex items-start gap-2 text-xs text-text-muted">
        <Info className="w-3.5 h-3.5 mt-0.5 shrink-0 text-info/70" />
        <p>
          <span className="text-text-secondary">信誉档</span>来自人工维护的域名信誉表；
          <span className="text-text-secondary">验证共识</span>是该来源的知识通过 AI 验证的平均程度（越高越经得起查）。
          点任意一行可展开看「这个来源都收了哪些内容」。
        </p>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="搜索来源域名..."
          className="w-full bg-white/[0.03] border border-white/[0.08] rounded-xl pl-10 pr-4 py-2 text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-info/40 transition-colors"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="glass-card flex flex-col items-center justify-center py-20">
          <Globe className="w-12 h-12 text-text-muted/40 mb-3" />
          <p className="text-text-secondary text-sm">
            {sources?.length ? '没有匹配的来源' : '暂无来源数据'}
          </p>
          <p className="text-text-muted text-xs mt-1">
            {sources?.length ? '换个关键词或清除档位过滤' : '剪藏/导入带链接的内容后，这里会自动聚合来源'}
          </p>
        </div>
      ) : (
        <div className="glass-card overflow-hidden">
          {/* 表头（列含义一眼可见） */}
          <div className="hidden sm:grid grid-cols-[1fr_88px_130px_96px_32px] gap-3 px-4 py-2.5 border-b border-white/[0.06] text-[11px] text-text-muted">
            <span>来源网站</span>
            <span className="text-right">收录条数</span>
            <span>验证共识</span>
            <span>信誉档</span>
            <span />
          </div>
          <div className="divide-y divide-white/[0.04]">
            {filtered.map((source, index) => (
              <SourceRow
                key={source.domain}
                source={source}
                index={index}
                expanded={expandedDomain === source.domain}
                units={expandedDomain === source.domain ? expandedUnits : []}
                unitsLoading={expandedDomain === source.domain && unitsLoading}
                onToggle={() => setExpandedDomain(expandedDomain === source.domain ? null : source.domain)}
                onSetTier={setTier}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

const SourceRow: FC<{
  source: KnowledgeSourceAggregate;
  index: number;
  expanded: boolean;
  units: Array<{ id: string; title: string; verification_status?: string | null }>;
  unitsLoading: boolean;
  onToggle: () => void;
  onSetTier: (domain: string, tier: TierKey | 'auto') => void;
}> = ({ source, index, expanded, units, unitsLoading, onToggle, onSetTier }) => {
  const tier = TIER[effTier(source)];
  const consensus = Math.min(Math.max(source.avg_verification_consensus, 0), 100);
  const consensusColor = consensus >= 70 ? 'bg-success' : consensus >= 40 ? 'bg-warning' : 'bg-danger';

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: Math.min(index * 0.03, 0.3) }}
    >
      <button
        onClick={onToggle}
        className="w-full grid grid-cols-[1fr_auto] sm:grid-cols-[1fr_88px_130px_96px_32px] items-center gap-3 px-4 py-3 text-left hover:bg-white/[0.02] transition-colors"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className={`w-2 h-2 rounded-full shrink-0 ${tier.dot}`} />
          <span className="text-sm font-medium text-text-primary truncate">{source.domain}</span>
          <a
            href={`https://${source.domain}`}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="text-text-muted hover:text-info transition-colors shrink-0"
            title="打开来源网站"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
        <span className="text-sm text-text-primary text-right font-semibold">{source.count}</span>
        <div className="hidden sm:flex items-center gap-2">
          <div className="h-1.5 flex-1 bg-bg-tertiary rounded-full overflow-hidden">
            <div className={`h-full rounded-full ${consensusColor}`} style={{ width: `${consensus}%` }} />
          </div>
          <span className="text-xs text-text-secondary w-9 text-right">{consensus.toFixed(0)}%</span>
        </div>
        <span className={`hidden sm:inline-flex items-center gap-1 text-xs ${tier.cls}`}>
          {effTier(source) === 'trusted' ? <ShieldCheck className="w-3.5 h-3.5" />
            : effTier(source) === 'normal' ? <AlertTriangle className="w-3.5 h-3.5" />
            : <HelpCircle className="w-3.5 h-3.5" />}
          {tier.label}
          {source.tier_source === 'manual' && <span className="text-text-muted">·手动</span>}
        </span>
        <ChevronDown className={`w-4 h-4 text-text-muted transition-transform justify-self-end ${expanded ? 'rotate-180' : ''}`} />
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-3 pl-8 space-y-1.5 border-l-2 border-info/20 ml-4 mb-2">
              {/* 信誉档三档开关（用户策展：覆盖信誉表自动判定；'auto' 哨兵=恢复自动） */}
              <div className="flex items-center gap-2 pb-1.5 flex-wrap">
                <span className="text-[11px] text-text-muted">信誉档：</span>
                <div className="inline-flex rounded-[2px] border border-white/[0.08] overflow-hidden">
                  {(Object.keys(TIER) as TierKey[]).map((key) => (
                    <button
                      key={key}
                      onClick={() => onSetTier(source.domain, key)}
                      className={`px-2.5 py-1 text-[11px] transition-colors ${
                        effTier(source) === key && source.tier_source === 'manual'
                          ? 'bg-info/20 text-info'
                          : effTier(source) === key
                            ? 'bg-white/[0.06] text-text-secondary'
                            : 'text-text-muted hover:bg-white/[0.04]'
                      }`}
                    >
                      {TIER[key].label}
                    </button>
                  ))}
                </div>
                {source.tier_source === 'manual' && (
                  <button
                    onClick={() => onSetTier(source.domain, 'auto')}
                    className="text-[11px] text-text-muted hover:text-info transition-colors"
                    title="清除手动设置，回到信誉表自动判定"
                  >
                    恢复自动
                  </button>
                )}
              </div>
              {source.factors.length > 0 && (
                <div className="flex flex-wrap gap-1 pb-1">
                  {source.factors.map((f, i) => (
                    <span key={i} className="px-1.5 py-0.5 rounded bg-white/[0.05] text-text-muted text-[10px] border border-white/[0.06]">
                      {factorZh(f)}
                    </span>
                  ))}
                </div>
              )}
              {unitsLoading ? (
                <div className="text-xs text-text-muted py-2">加载内容清单…</div>
              ) : units.length === 0 ? (
                <div className="text-xs text-text-muted py-2">没有读到该来源的内容（可能已删除）</div>
              ) : (
                units.map((u) => (
                  <div key={u.id} className="flex items-center gap-2 text-xs text-text-secondary py-0.5">
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                      u.verification_status === 'confirmed' ? 'bg-success'
                        : u.verification_status === 'disputed' ? 'bg-warning'
                        : u.verification_status === 'debunked' ? 'bg-danger' : 'bg-text-muted'
                    }`} />
                    <span className="truncate">{u.title || '(无标题)'}</span>
                  </div>
                ))
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

export default SourceTraceabilityPage;
