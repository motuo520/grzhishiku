import { FC, useEffect, useRef } from 'react';
import * as d3 from 'd3';
import { Tag, Loader2, AlertCircle, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';
import { useGraphTagNetwork } from '@/hooks/useGraph';
import type { GraphTagNode, GraphTagEdge } from '@/api/graph';

type SimNode = GraphTagNode & d3.SimulationNodeDatum;
type SimLink = GraphTagEdge & d3.SimulationLinkDatum<SimNode>;

const GraphTagsPage: FC = () => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);

  const { data, isLoading, error } = useGraphTagNetwork();
  const isEmpty = !data || data.nodes.length === 0;

  // ── d3 力导向图：节点大小按度、边宽按共现 weight ──
  useEffect(() => {
    if (!svgRef.current || !data || data.nodes.length === 0) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const width = containerRef.current?.clientWidth || 1200;
    const height = containerRef.current?.clientHeight || 800;

    const degreeMap: Record<string, number> = {};
    data.edges.forEach((e) => {
      degreeMap[e.source] = (degreeMap[e.source] || 0) + 1;
      degreeMap[e.target] = (degreeMap[e.target] || 0) + 1;
    });

    const maxWeight = Math.max(1, ...data.edges.map((e) => e.weight || 1));
    const nodeRadius = (id: string) => Math.max(6, Math.min(20, 6 + (degreeMap[id] || 0) * 2));

    const nodes = data.nodes.map((n) => ({ ...n })) as SimNode[];
    const links = data.edges.map((e) => ({ ...e })) as SimLink[];

    const g = svg.append('g');

    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on('zoom', (event) => {
        g.attr('transform', event.transform.toString());
      });
    zoomRef.current = zoom;
    svg.call(zoom as any);

    const simulation = d3.forceSimulation(nodes as any)
      .force('link', d3.forceLink(links as any).id((d: any) => d.id).distance(70))
      .force('charge', d3.forceManyBody().strength(-100))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius(22));

    const linkSel = g.append('g').selectAll('line').data(links).join('line')
      .attr('stroke', '#8b949e')
      .attr('stroke-width', (d) => 0.8 + ((d.weight || 1) / maxWeight) * 3)
      .attr('stroke-opacity', 0.45);

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

    const drag = d3.drag<SVGCircleElement, SimNode>()
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

    const nodeSel = g.append('g').selectAll('circle').data(nodes).join('circle')
      .attr('r', (d) => nodeRadius(d.id))
      .attr('fill', (d) => d.color || '#8b949e')
      .attr('stroke', '#0d1117')
      .attr('stroke-width', 1.5)
      .attr('cursor', 'pointer')
      .call(drag as any)
      .on('mouseenter', (event, d) => {
        hovered = d;
        hoverLabel.text(`${d.name}（使用 ${d.usage_count ?? 0} 次）`).attr('opacity', 1);
        d3.select(event.currentTarget).attr('stroke', '#e6edf3');
      })
      .on('mouseleave', (event) => {
        hovered = null;
        hoverLabel.attr('opacity', 0);
        d3.select(event.currentTarget).attr('stroke', '#0d1117');
      });

    // 有连边的标签常显名称
    const labelSel = g.append('g')
      .selectAll('text')
      .data(nodes.filter((d) => (degreeMap[d.id] || 0) > 0))
      .join('text')
      .text((d) => (d.name.length > 10 ? d.name.slice(0, 10) + '…' : d.name))
      .attr('font-size', 10)
      .attr('fill', '#c9d1d9')
      .attr('text-anchor', 'middle')
      .attr('dy', (d) => -(nodeRadius(d.id) + 6))
      .attr('pointer-events', 'none')
      .attr('opacity', 0.85);

    simulation.on('tick', () => {
      linkSel
        .attr('x1', (d: any) => d.source.x)
        .attr('y1', (d: any) => d.source.y)
        .attr('x2', (d: any) => d.target.x)
        .attr('y2', (d: any) => d.target.y);

      nodeSel
        .attr('cx', (d: any) => d.x)
        .attr('cy', (d: any) => d.y);

      labelSel
        .attr('x', (d: any) => d.x)
        .attr('y', (d: any) => d.y);

      if (hovered) {
        hoverLabel
          .attr('x', hovered.x ?? 0)
          .attr('y', (hovered.y ?? 0) - nodeRadius(hovered.id) - 8);
      }
    });

    return () => {
      simulation.stop();
    };
  }, [data]);

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

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-info" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center px-6">
        <AlertCircle className="w-12 h-12 text-red-400 mb-4" />
        <div className="text-sm text-text-secondary">{(error as any)?.message || '加载失败'}</div>
      </div>
    );
  }

  if (isEmpty) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center px-6">
        <Tag className="w-12 h-12 text-text-muted mb-4" />
        <div className="text-text-primary font-semibold mb-2">还没有标签共现数据</div>
        <div className="text-sm text-text-secondary max-w-md">
          给内容打标签后，这里会显示标签之间的共现关系。
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full bg-bg-primary overflow-hidden select-none" ref={containerRef}>
      <svg ref={svgRef} className="absolute inset-0 w-full h-full" />

      {/* 顶部统计 */}
      <div className="absolute top-4 left-4 z-30 glass-card px-3 py-2 rounded-xl flex items-center gap-3 text-xs text-text-secondary pointer-events-none">
        <span>标签 <span className="text-text-primary font-semibold">{data.node_count}</span></span>
        <span>共现关系 <span className="text-text-primary font-semibold">{data.edge_count}</span></span>
      </div>

      {/* 缩放控制 */}
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
    </div>
  );
};

export default GraphTagsPage;
