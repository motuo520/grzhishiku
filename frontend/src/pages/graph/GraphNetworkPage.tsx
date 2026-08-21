import { FC, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as d3 from 'd3';
import { useQueryClient, useQuery, useMutation } from '@tanstack/react-query';
import {
  Network, RefreshCw, Loader2, X, ExternalLink, Sparkles,
  AlertTriangle, ZoomIn, ZoomOut, RotateCcw, Database, Link2, Users, Search,
  Maximize2, Minimize2, Sprout,
} from 'lucide-react';
import { useGraphifyStatus, useGraphifyGraph, useGraphifyBuild, useGraphifyExplain } from '@/hooks/useGraphify';
import ModelSelector from '@/components/llm/ModelSelector';
import { graphifyApi } from '@/api/graphify';
import type { GraphifyNode, GraphifyLink, GraphifyTextResult } from '@/api/graphify';

/** 自进化开关 chip：开启后新增内容自动触发图谱重建；开关旁 ⚠ 提示余额消耗 */
const AutoEvolveChip: FC<{ modelId: string }> = ({ modelId }) => {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ['graphify-auto-evolve'],
    queryFn: () => graphifyApi.getAutoEvolve().then(r => r.data),
  });
  const mutation = useMutation({
    mutationFn: (cfg: { enabled: boolean; model?: string | null }) =>
      graphifyApi.setAutoEvolve(cfg),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['graphify-auto-evolve'] }),
  });

  const enabled = data?.enabled ?? false;

  const save = (nextEnabled: boolean) => {
    mutation.mutate({ enabled: nextEnabled, model: modelId || data?.model || null });
  };

  return (
    <div className="pointer-events-auto glass-card px-3 py-2 rounded-xl flex items-center gap-2 text-xs">
      <span className="flex items-center gap-1 text-text-secondary" title="开启后，新增笔记/剪藏/知识单元会自动重建知识图谱">
        <Sprout className="w-3.5 h-3.5 text-[#98c379]" />
        自进化
      </span>
      <button
        onClick={() => save(!enabled)}
        disabled={mutation.isPending}
        className={`relative w-8 h-5 rounded-full transition-colors ${enabled ? 'bg-[#98c379]' : 'bg-bg-tertiary'}`}
        title={enabled ? '已开启，点击关闭' : '已关闭，点击开启'}
      >
        <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${enabled ? 'translate-x-3' : ''}`} />
      </button>
      <span title="自进化会在每次新增内容时调用模型重建图谱，消耗云端余额（平台模型）或厂商额度（BYOK）">
        <AlertTriangle className="w-3.5 h-3.5 text-amber-300" />
      </span>
    </div>
  );
};

type SimNode = GraphifyNode & d3.SimulationNodeDatum;
type SimLink = GraphifyLink & d3.SimulationLinkDatum<SimNode>;

const COMMUNITY_PALETTE = [
  '#e06c75', '#98c379', '#d19a66', '#61afef', '#c678dd',
  '#56b6c2', '#ff6b6b', '#4ecdc4', '#ffe66d', '#a371f7',
];

const SOURCE_TYPE_LABELS: Record<string, string> = {
  note: '笔记',
  clip: '剪藏',
  knowledge: '知识单元',
  concept: '概念/主题',
};

const BRAIN_SIDE_LABELS: Record<string, string> = {
  personal: '个人脑',
  network: '网络脑',
  both: '双脑',
};

const getSourceRoute = (type: string, id?: string): string | undefined => {
  switch (type) {
    case 'note':
      return id ? `/ingest/notes/${encodeURIComponent(id)}` : '/ingest/notes';
    case 'clip':
      return id ? `/ingest/clipper?highlight=${encodeURIComponent(id)}` : '/ingest/clipper';
    case 'knowledge':
      return id ? `/knowledge/${encodeURIComponent(id)}` : '/knowledge/network';
    default:
      return undefined;
  }
};

const communityColor = (community: number | null | undefined) =>
  community == null ? '#8b949e' : COMMUNITY_PALETTE[community % COMMUNITY_PALETTE.length];

const nodeRadius = (degree: number) => Math.max(6, Math.min(20, 6 + degree * 1.6));

const formatTime = (s: string) => new Date(s).toLocaleString('zh-CN', { hour12: false });

const GraphNetworkPage: FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);

  const { data: status, isLoading: statusLoading } = useGraphifyStatus();
  const { data: graphData, isLoading: graphLoading } = useGraphifyGraph(Boolean(status?.has_graph));
  const build = useGraphifyBuild();
  const explain = useGraphifyExplain();

  const [selectedNode, setSelectedNode] = useState<GraphifyNode | null>(null);
  const [explainResult, setExplainResult] = useState<GraphifyTextResult | null>(null);
  const [modelId, setModelId] = useState<string>('');
  // 真全屏（Fullscreen API）；API 不可用时退化为 CSS overlay
  const [apiFullscreen, setApiFullscreen] = useState(false);
  const [cssFullscreen, setCssFullscreen] = useState(false);
  const isFullscreen = apiFullscreen || cssFullscreen;

  // 自进化配置（与 AutoEvolveChip 共享同一 queryKey，缓存去重）
  const { data: autoEvolve } = useQuery({
    queryKey: ['graphify-auto-evolve'],
    queryFn: () => graphifyApi.getAutoEvolve().then(r => r.data),
  });

  useEffect(() => {
    const onChange = () => setApiFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggleFullscreen = () => {
    if (cssFullscreen) {
      setCssFullscreen(false);
    } else if (document.fullscreenElement) {
      document.exitFullscreen();
    } else if (containerRef.current?.requestFullscreen) {
      containerRef.current.requestFullscreen().then(() => setCssFullscreen(false)).catch(() => setCssFullscreen(true));
    } else {
      setCssFullscreen(true);
    }
  };

  // ESC 退出 CSS 退化模式（API 模式由浏览器原生处理）
  useEffect(() => {
    if (!cssFullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setCssFullscreen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cssFullscreen]);

  const isBuilding = build.isPending || status?.state === 'exporting' || status?.state === 'building';
  const hasGraph = Boolean(status?.has_graph);

  // 构建完成后（last_built_at 变化）刷新图数据与报告缓存
  const lastBuiltRef = useRef<string | null>(null);
  useEffect(() => {
    const builtAt = status?.last_built_at ?? null;
    if (builtAt && lastBuiltRef.current && builtAt !== lastBuiltRef.current && status?.state === 'done') {
      queryClient.invalidateQueries({ queryKey: ['graphify-graph'] });
      queryClient.invalidateQueries({ queryKey: ['graphify-report'] });
    }
    if (builtAt) lastBuiltRef.current = builtAt;
  }, [status?.last_built_at, status?.state, queryClient]);

  const communityCount = useMemo(() => {
    if (!graphData) return 0;
    return new Set(graphData.nodes.map((n) => n.community).filter((c) => c != null)).size;
  }, [graphData]);

  // ── d3 力导向图：直接操作 SVG，React 只管容器和数据 ──
  useEffect(() => {
    if (!svgRef.current || !graphData || graphData.nodes.length === 0) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const width = containerRef.current?.clientWidth || 1200;
    const height = containerRef.current?.clientHeight || 800;

    const degreeMap: Record<string, number> = {};
    graphData.links.forEach((l) => {
      degreeMap[l.source] = (degreeMap[l.source] || 0) + 1;
      degreeMap[l.target] = (degreeMap[l.target] || 0) + 1;
    });

    // 高度节点常显 label（取度数前 15 名）
    const topLabelIds = new Set(
      Object.entries(degreeMap).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([id]) => id)
    );

    const nodes = graphData.nodes.map((n) => ({ ...n })) as SimNode[];
    // 过滤 source/target 不存在的脏边，避免 d3.forceLink 抛错白屏
    const nodeIdSet = new Set(nodes.map((n) => n.id));
    const links = graphData.links
      .filter((l) => nodeIdSet.has(l.source) && nodeIdSet.has(l.target))
      .map((l) => ({ ...l })) as SimLink[];

    const g = svg.append('g');

    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on('zoom', (event) => {
        g.attr('transform', event.transform.toString());
      });
    zoomRef.current = zoom;
    svg.call(zoom as any);

    const simulation = d3.forceSimulation(nodes as any)
      .force('link', d3.forceLink(links as any).id((d: any) => d.id).distance(80))
      .force('charge', d3.forceManyBody().strength(-120))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius(24));

    // ── 玻璃星球风格：每社区一个径向渐变（亮核→饱和边），节点=光晕+渐变球+高光 ──
    const brighter = (hex: string, k = 1) => d3.color(hex)?.brighter(k).formatHex() ?? hex;
    const darker = (hex: string, k = 1) => d3.color(hex)?.darker(k).formatHex() ?? hex;
    const gradId = (c: number | null | undefined) => `orb-grad-${c ?? 'none'}`;
    const defs = svg.append('defs');
    Array.from(new Set(nodes.map((n) => n.community))).forEach((c) => {
      const base = communityColor(c);
      const grad = defs.append('radialGradient')
        .attr('id', gradId(c))
        .attr('cx', '35%').attr('cy', '30%').attr('r', '80%');
      grad.append('stop').attr('offset', '0%').attr('stop-color', brighter(base, 1.6));
      grad.append('stop').attr('offset', '55%').attr('stop-color', base);
      grad.append('stop').attr('offset', '100%').attr('stop-color', darker(base, 1.2));
    });

    // hover 邻居高亮用的邻接表
    const neighborMap = new Map<string, Set<string>>();
    links.forEach((l: any) => {
      const s = typeof l.source === 'object' ? l.source.id : l.source;
      const t = typeof l.target === 'object' ? l.target.id : l.target;
      if (!neighborMap.has(s)) neighborMap.set(s, new Set());
      if (!neighborMap.has(t)) neighborMap.set(t, new Set());
      neighborMap.get(s)!.add(t);
      neighborMap.get(t)!.add(s);
    });
    const resetEmphasis = () => {
      nodeSel.selectAll('.orb').attr('opacity', 1).attr('stroke-width', 1);
      nodeSel.selectAll('.halo').attr('opacity', 0.12);
      nodeSel.selectAll('.spec').attr('opacity', 0.5);
      linkSel.attr('stroke-opacity', (d: any) => (d.confidence === 'AMBIGUOUS' ? 0.22 : 0.5));
    };

    // 边样式：EXTRACTED 实线 / INFERRED 虚线 / AMBIGUOUS 淡点线
    const linkSel = g.append('g').selectAll('line').data(links).join('line')
      .attr('stroke', '#8b949e')
      .attr('stroke-width', 1.2)
      .attr('stroke-opacity', (d) => (d.confidence === 'AMBIGUOUS' ? 0.22 : 0.5))
      .attr('stroke-dasharray', (d) =>
        d.confidence === 'EXTRACTED' ? 'none' : d.confidence === 'INFERRED' ? '6,4' : '1,4'
      );

    // hover 时跟随节点的浮动 label
    let hovered: SimNode | null = null;
    const hoverLabel = g.append('text')
      .attr('font-size', 12)
      .attr('fill', '#e6edf3')
      .attr('text-anchor', 'middle')
      .attr('pointer-events', 'none')
      .attr('paint-order', 'stroke')
      .attr('stroke', '#0d1117')
      .attr('stroke-width', 3)
      .attr('opacity', 0);

    const drag = d3.drag<SVGGElement, SimNode>()
      .on('start', (event, d) => {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on('drag', (event, d) => {
        d.fx = event.x;
        d.fy = event.y;
      })
      .on('end', (event, d) => {
        if (!event.active) simulation.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      });

    const nodeSel = g.append('g').selectAll('g').data(nodes).join('g')
      .attr('cursor', 'pointer')
      .call(drag as any);

    // 光晕（廉价的辉光，不用 SVG filter 保性能）
    nodeSel.append('circle')
      .attr('class', 'halo')
      .attr('r', (d) => nodeRadius(degreeMap[d.id] || 0) * 1.9)
      .attr('fill', (d) => communityColor(d.community))
      .attr('opacity', 0.12)
      .attr('pointer-events', 'none');
    // 渐变球体
    nodeSel.append('circle')
      .attr('class', 'orb')
      .attr('r', (d) => nodeRadius(degreeMap[d.id] || 0))
      .attr('fill', (d) => `url(#${gradId(d.community)})`)
      .attr('stroke', (d) => brighter(communityColor(d.community), 1.2))
      .attr('stroke-width', 1)
      .attr('stroke-opacity', 0.75);
    // 高光点（玻璃质感）
    nodeSel.append('circle')
      .attr('class', 'spec')
      .attr('r', (d) => nodeRadius(degreeMap[d.id] || 0) * 0.26)
      .attr('cx', (d) => -nodeRadius(degreeMap[d.id] || 0) * 0.3)
      .attr('cy', (d) => -nodeRadius(degreeMap[d.id] || 0) * 0.36)
      .attr('fill', '#ffffff')
      .attr('opacity', 0.5)
      .attr('pointer-events', 'none');

    nodeSel
      .on('mouseenter', (event, d) => {
        hovered = d;
        // 力导向停止后 tick 不再触发，mouseenter 时立即同步坐标
        hoverLabel
          .text(d.label)
          .attr('opacity', 1)
          .attr('x', d.x ?? 0)
          .attr('y', (d.y ?? 0) - nodeRadius(degreeMap[d.id] || 0) - 8);
        // 邻居保持，其余淡出
        const keep = new Set([d.id, ...(neighborMap.get(d.id) ?? [])]);
        nodeSel.selectAll('.orb').attr('opacity', (n: any) => (keep.has(n.id) ? 1 : 0.2));
        nodeSel.selectAll('.halo').attr('opacity', (n: any) => (keep.has(n.id) ? 0.22 : 0.03));
        nodeSel.selectAll('.spec').attr('opacity', (n: any) => (keep.has(n.id) ? 0.6 : 0.06));
        linkSel.attr('stroke-opacity', (l: any) => {
          const s = typeof l.source === 'object' ? l.source.id : l.source;
          const t = typeof l.target === 'object' ? l.target.id : l.target;
          return s === d.id || t === d.id ? 0.85 : 0.05;
        });
        d3.select(event.currentTarget).select('.orb').attr('stroke-width', 2);
      })
      .on('mouseleave', () => {
        hovered = null;
        hoverLabel.attr('opacity', 0);
        resetEmphasis();
      })
      .on('click', (event, d) => {
        event.stopPropagation();
        setSelectedNode(d);
        setExplainResult(null);
        explain.reset();
      });

    // 高度节点常显 label
    const labelSel = g.append('g')
      .selectAll('text')
      .data(nodes.filter((d) => topLabelIds.has(d.id)))
      .join('text')
      .text((d) => (d.label.length > 14 ? d.label.slice(0, 14) + '…' : d.label))
      .attr('font-size', 10)
      .attr('fill', '#c9d1d9')
      .attr('text-anchor', 'middle')
      .attr('dy', (d) => -(nodeRadius(degreeMap[d.id] || 0) + 6))
      .attr('pointer-events', 'none')
      .attr('opacity', 0.85);

    simulation.on('tick', () => {
      linkSel
        .attr('x1', (d: any) => d.source.x)
        .attr('y1', (d: any) => d.source.y)
        .attr('x2', (d: any) => d.target.x)
        .attr('y2', (d: any) => d.target.y);

      nodeSel.attr('transform', (d: any) => `translate(${d.x},${d.y})`);

      labelSel
        .attr('x', (d: any) => d.x)
        .attr('y', (d: any) => d.y);

      if (hovered) {
        hoverLabel
          .attr('x', hovered.x ?? 0)
          .attr('y', (hovered.y ?? 0) - nodeRadius(degreeMap[hovered.id] || 0) - 8);
      }
    });

    svg.on('click', () => {
      setSelectedNode(null);
      setExplainResult(null);
      explain.reset();
    });

    return () => {
      simulation.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphData, isFullscreen]);

  const zoomIn = () => {
    if (zoomRef.current && svgRef.current) {
      d3.select(svgRef.current).transition().duration(250).call(zoomRef.current.scaleBy as any, 1.3);
    }
  };

  const zoomOut = () => {
    if (zoomRef.current && svgRef.current) {
      d3.select(svgRef.current).transition().duration(250).call(zoomRef.current.scaleBy as any, 1 / 1.3);
    }
  };

  const resetView = () => {
    if (zoomRef.current && svgRef.current) {
      d3.select(svgRef.current).transition().duration(500).call(zoomRef.current.transform as any, d3.zoomIdentity);
    }
  };

  const handleBuild = () => {
    build.mutate(modelId || undefined);
  };

  const handleExplain = () => {
    if (!selectedNode) return;
    const nodeId = selectedNode.id;
    explain.mutate(nodeId, {
      // 请求返回时校验当前选中节点，避免张冠李戴
      onSuccess: (data) => {
        setSelectedNode((current) => {
          if (current?.id === nodeId) setExplainResult(data);
          return current;
        });
      },
    });
  };

  const selectedCommunityName = useMemo(() => {
    if (!selectedNode || selectedNode.community == null) return '未分组';
    return graphData?.community_labels?.[String(selectedNode.community)] ?? `社区 ${selectedNode.community}`;
  }, [selectedNode, graphData]);

  // ── 空态 / 失败态 ──
  const renderCenterState = () => {
    if (statusLoading) {
      return (
        <div className="absolute inset-0 flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-info" />
        </div>
      );
    }
    if (status?.state === 'failed' && !hasGraph) {
      return (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6">
          <AlertTriangle className="w-12 h-12 text-red-400 mb-4" />
          <div className="text-text-primary font-semibold mb-2">图谱构建失败</div>
          <div className="text-sm text-text-secondary mb-6 max-w-md">{status.error || '未知错误'}</div>
          <div className="flex items-center gap-3">
            <ModelSelector value={modelId} onChange={setModelId} taskType="analysis" className="w-44" />
            <button onClick={handleBuild} disabled={isBuilding} className="btn-primary flex items-center gap-2 disabled:opacity-50">
              {isBuilding ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              重新构建
            </button>
          </div>
        </div>
      );
    }
    if (!hasGraph && !isBuilding) {
      return (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6">
          <Network className="w-12 h-12 text-text-muted mb-4" />
          <div className="text-text-primary font-semibold mb-2">知识图谱尚未构建</div>
          <div className="text-sm text-text-secondary mb-6 max-w-md">
            基于你的笔记、剪藏和知识单元构建一张可交互的知识网络，发现内容之间的隐藏关联。
          </div>
          <div className="flex items-center gap-3">
            <ModelSelector value={modelId} onChange={setModelId} taskType="analysis" className="w-44" />
            <button onClick={handleBuild} className="btn-primary flex items-center gap-2">
              <Sparkles className="w-4 h-4" />
              构建知识图谱
            </button>
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <div
      className={`bg-bg-primary overflow-hidden select-none ${
        isFullscreen ? 'fixed inset-0 z-[100]' : 'relative w-full h-full'
      }`}
      ref={containerRef}
    >
      {hasGraph && <svg ref={svgRef} className="absolute inset-0 w-full h-full" />}

      {renderCenterState()}

      {hasGraph && graphLoading && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-bg-primary/60">
          <Loader2 className="w-8 h-8 animate-spin text-info" />
        </div>
      )}

      {/* 构建进度：顶部进度条 + 文案，旧图保持可读 */}
      {isBuilding && (
        <>
          <div className="absolute top-0 left-0 right-0 h-0.5 z-40 bg-info/20 overflow-hidden">
            <div className="h-full w-full bg-info animate-pulse" />
          </div>
          <div className="absolute top-16 left-1/2 -translate-x-1/2 z-40 glass-card px-4 py-2 rounded-xl flex items-center gap-2 text-xs text-info pointer-events-none">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            {status?.progress || '正在构建图谱...'}
          </div>
        </>
      )}

      {/* 顶部工具栏（全屏时隐藏，只留右上角退出按钮） */}
      {!isFullscreen && (
      <div className="absolute top-4 left-4 right-4 z-30 flex flex-wrap items-center gap-2 pointer-events-none">
        <div className="pointer-events-auto glass-card px-3 py-2 rounded-xl flex items-center gap-3 text-xs text-text-secondary">
          <span className="flex items-center gap-1">
            <Database className="w-3 h-3 text-info" />
            节点 {status?.node_count ?? graphData?.nodes.length ?? 0}
          </span>
          <span className="flex items-center gap-1">
            <Link2 className="w-3 h-3 text-[#a371f7]" />
            边 {status?.edge_count ?? graphData?.links.length ?? 0}
          </span>
          <span className="flex items-center gap-1">
            <Users className="w-3 h-3 text-[#98c379]" />
            社区 {communityCount}
          </span>
          {status?.last_built_at && (
            <span className="text-text-muted hidden md:inline">构建于 {formatTime(status.last_built_at)}</span>
          )}
        </div>

        {hasGraph && (
          <div className="pointer-events-auto glass-card px-2 py-1 rounded-xl">
            <ModelSelector value={modelId} onChange={setModelId} taskType="analysis" className="w-44" />
          </div>
        )}

        <button
          onClick={handleBuild}
          disabled={isBuilding}
          className="pointer-events-auto glass-card px-3 py-2 rounded-xl flex items-center gap-1.5 text-xs text-info hover:bg-info/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isBuilding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          重建图谱
        </button>

        <AutoEvolveChip modelId={modelId} />

        <button
          onClick={toggleFullscreen}
          className="pointer-events-auto glass-card px-3 py-2 rounded-xl flex items-center gap-1.5 text-xs text-text-secondary hover:text-text-primary transition-colors"
          title="全屏展示"
        >
          <Maximize2 className="w-3.5 h-3.5" />
          全屏
        </button>
      </div>
      )}

      {/* 全屏时唯一常驻控件：退出全屏 */}
      {isFullscreen && (
        <button
          onClick={toggleFullscreen}
          className="absolute top-4 right-4 z-[110] glass-card px-3 py-2 rounded-xl flex items-center gap-1.5 text-xs text-text-secondary hover:text-text-primary transition-colors"
          title="退出全屏（ESC）"
        >
          <Minimize2 className="w-3.5 h-3.5" />
          退出全屏
        </button>
      )}

      {/* 自进化开启提示：新增内容自动重建消耗模型余额/厂商额度（全屏隐藏） */}
      {autoEvolve?.enabled && !isFullscreen && (
        <div className="absolute top-16 left-4 z-30 glass-card px-3 py-1.5 rounded-xl flex items-center gap-1.5 text-[11px] text-amber-300 border border-amber-400/30 pointer-events-none">
          <AlertTriangle className="w-3 h-3" />
          自进化已开启：每次新增内容都会自动调用模型重建图谱，消耗云端余额（平台模型）或厂商额度（BYOK），请注意费用。
        </div>
      )}

      {/* 图例（全屏隐藏） */}
      {hasGraph && !isFullscreen && (
        <div className="absolute bottom-20 left-4 z-30 glass-card px-3 py-2 rounded-xl flex items-center gap-4 text-[10px] text-text-muted pointer-events-none">
          <span className="flex items-center gap-1.5">
            <span className="w-5 border-t border-[#8b949e]" />
            抽取
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-5 border-t border-dashed border-[#8b949e]" />
            推断
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-5 border-t border-dotted border-[#8b949e] opacity-50" />
            模糊
          </span>
        </div>
      )}

      {/* 缩放控制（全屏隐藏） */}
      {hasGraph && !isFullscreen && (
        <div className="absolute bottom-4 right-4 z-30 flex flex-col gap-1">
          <button onClick={zoomIn} className="glass-card p-2 rounded-lg text-text-secondary hover:text-text-primary transition-colors" title="放大">
            <ZoomIn className="w-4 h-4" />
          </button>
          <button onClick={zoomOut} className="glass-card p-2 rounded-lg text-text-secondary hover:text-text-primary transition-colors" title="缩小">
            <ZoomOut className="w-4 h-4" />
          </button>
          <button onClick={resetView} className="glass-card p-2 rounded-lg text-text-secondary hover:text-text-primary transition-colors" title="重置视图">
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* 节点详情侧栏 */}
      {selectedNode && (
        <div className="absolute top-16 right-4 bottom-4 z-30 glass-card w-80 rounded-xl p-4 flex flex-col overflow-hidden">
          <div className="flex items-center justify-between mb-3 shrink-0">
            <span className="text-xs font-semibold uppercase tracking-wider text-info">
              {SOURCE_TYPE_LABELS[selectedNode.file_type] || selectedNode.file_type}
            </span>
            <button
              onClick={() => { setSelectedNode(null); setExplainResult(null); explain.reset(); }}
              className="text-text-secondary hover:text-text-primary"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto min-h-0 pr-1" style={{ overscrollBehavior: 'contain' }}>
            <h3 className="text-sm font-bold text-text-primary mb-3">{selectedNode.label}</h3>

            <div className="text-xs text-text-secondary mb-1.5 flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: communityColor(selectedNode.community) }} />
              社区：<span className="text-text-primary">{selectedCommunityName}</span>
            </div>
            <div className="text-xs text-text-secondary mb-4">
              类型：<span className="text-text-primary">{SOURCE_TYPE_LABELS[selectedNode.file_type] || selectedNode.file_type}</span>
            </div>

            {selectedNode.source ? (
              <div className="mb-4 p-3 rounded-lg bg-white/[0.03] border border-white/[0.06]">
                <div className="text-[10px] text-text-muted uppercase tracking-wider mb-1.5">来源</div>
                <div className="text-xs text-text-primary mb-1">
                  {SOURCE_TYPE_LABELS[selectedNode.source.type] || selectedNode.source.type}
                  {selectedNode.source.brain_side && (
                    <span className="text-text-muted ml-2">
                      {BRAIN_SIDE_LABELS[selectedNode.source.brain_side] || selectedNode.source.brain_side}
                    </span>
                  )}
                </div>
                {selectedNode.source.title && (
                  <div className="text-xs text-text-secondary truncate">{selectedNode.source.title}</div>
                )}
              </div>
            ) : (
              <div className="mb-4 p-3 rounded-lg bg-white/[0.03] border border-white/[0.06] text-xs text-text-secondary">
                该节点为自动提取的概念/主题，未关联到单条内容。
                {/* hub 概念 grounding：直达最相关的原文，不再只有搜索 */}
                {selectedNode.grounded && selectedNode.grounded.length > 0 && (
                  <div className="mt-2 space-y-1.5">
                    <div className="text-[10px] text-text-muted uppercase tracking-wider">相关内容</div>
                    {selectedNode.grounded.map((g) => (
                      <button
                        key={g.id}
                        onClick={() => {
                          const route = getSourceRoute(g.type, g.id);
                          if (route) navigate(route);
                        }}
                        className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs text-info bg-info/5 border border-info/20 hover:bg-info/15 transition-colors text-left"
                      >
                        <ExternalLink className="w-3 h-3 shrink-0" />
                        <span className="truncate">{g.title || g.id}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="flex gap-2 mb-4">
              {selectedNode.source?.type && getSourceRoute(selectedNode.source.type, selectedNode.source.id) && (
                <button
                  onClick={() => {
                    const route = getSourceRoute(selectedNode.source!.type, selectedNode.source!.id);
                    if (route) navigate(route);
                  }}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-white/[0.04] text-text-secondary border border-white/[0.08] hover:bg-white/[0.08] hover:text-text-primary transition-colors"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  查看来源
                </button>
              )}
              {!selectedNode.source && (
                <button
                  onClick={() => navigate(`/graph/query?q=${encodeURIComponent(selectedNode.label)}`)}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-white/[0.04] text-text-secondary border border-white/[0.08] hover:bg-white/[0.08] hover:text-text-primary transition-colors"
                >
                  <Search className="w-3.5 h-3.5" />
                  搜索该概念
                </button>
              )}
              <button
                onClick={handleExplain}
                disabled={explain.isPending}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-info/15 text-info border border-info/30 hover:bg-info/25 transition-colors disabled:opacity-50"
              >
                {explain.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                解释节点
              </button>
            </div>

            {explainResult && (
              <div className="p-3 rounded-lg bg-white/[0.03] border border-white/[0.06]">
                <div className="text-[10px] text-text-muted uppercase tracking-wider mb-1.5">节点解释</div>
                {explainResult.ok ? (
                  <div className="text-xs text-text-secondary leading-relaxed whitespace-pre-wrap">{explainResult.result}</div>
                ) : (
                  <div className="text-xs text-red-400">{explainResult.error || '解释失败'}</div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default GraphNetworkPage;
