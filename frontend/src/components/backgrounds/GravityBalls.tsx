import { useRef, useEffect } from 'react';
import * as d3 from 'd3';

interface GNode {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  fx: number | null;
  fy: number | null;
  r: number;
  color: string;
  label: string;
}

const COLORS = [
  '#58a6ff','#a371f7','#3fb950','#f778ba','#d29922',
  '#79c0ff','#d2a8ff','#56d364','#ffa198','#e3b341',
];

const LABELS = [
  '采集','浏览器剪藏','浏览器书签','笔记管理','批量导入','RSS聚合',
  '图谱','知识网络','全局搜索','路径探索','标签图谱','时间轴',
  '认知镜像','思维指纹','认知偏差','脑侧冲突','决策审计','未来模拟',
  '涌现工作室','素材池','跨域联想','创意碰撞','概念杂交','涌现画布',
  '注意力管家','仪表盘','深度工作','时间预算','专注时段','注意力报告',
  '知识库','个人知识','网络知识','知识图谱','知识卡片','知识回顾',
  '流水线','数据采集','数据清洗','数据处理','数据分析','数据输出',
  '社会大脑','社交聚合','社交网络','社交洞察','社交推荐','社交学习',
  '具身认知','身体感知','运动认知','环境认知','感官融合','身体智能',
];

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function makeNodes(W: number, H: number): GNode[] {
  const cx = W / 2, cy = H / 2;
  return LABELS.map((label, i) => {
    const angle = (i / LABELS.length) * Math.PI * 2;
    const dist = Math.min(W, H) * 0.22 + (i % 6) * 45;
    return {
      id: `n${i}`,
      x: clamp(cx + Math.cos(angle) * dist, 50, W - 50),
      y: clamp(cy + Math.sin(angle) * dist, 50, H - 50),
      vx: 0, vy: 0, fx: null, fy: null,
      r: 18 + (i % 4) * 3,
      color: COLORS[i % COLORS.length],
      label,
    };
  });
}

export default function GravityBalls() {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const mouseRef = useRef<[number, number] | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    const svgEl = svgRef.current;
    if (!container || !svgEl) return;

    let W = container.clientWidth;
    let H = container.clientHeight;
    // fallback if Tailwind hasn't given the container a size yet
    if (!W || !H) {
      const rect = container.getBoundingClientRect();
      W = rect.width || window.innerWidth;
      H = rect.height || window.innerHeight;
    }

    const svg = d3.select(svgEl).attr('width', W).attr('height', H);
    svg.selectAll('*').remove();

    // Defs
    const defs = svg.append('defs');
    const glow = defs.append('filter').attr('id', 'gb-glow')
      .attr('x', '-100%').attr('y', '-100%').attr('width', '300%').attr('height', '300%');
    glow.append('feGaussianBlur').attr('stdDeviation', '5').attr('result', 'blur');
    const gm = glow.append('feMerge');
    gm.append('feMergeNode').attr('in', 'blur');
    gm.append('feMergeNode').attr('in', 'SourceGraphic');

    const tg = defs.append('filter').attr('id', 'gb-txt')
      .attr('x', '-50%').attr('y', '-50%').attr('width', '200%').attr('height', '200%');
    tg.append('feGaussianBlur').attr('stdDeviation', '2').attr('result', 'blur');
    const tm = tg.append('feMerge');
    tm.append('feMergeNode').attr('in', 'blur');
    tm.append('feMergeNode').attr('in', 'SourceGraphic');

    // Data
    const nodes = makeNodes(W, H);
    const linkData: { source: number; target: number }[] = [];
    for (let i = 0; i < nodes.length; i++) {
      const j = (i + 3) % nodes.length;
      const k = (i + 7) % nodes.length;
      linkData.push({ source: i, target: j });
      if (i % 2 === 0) linkData.push({ source: i, target: k });
    }

    // Simulation
    const sim = d3.forceSimulation(nodes as any)
      .force('link', d3.forceLink(linkData)
        .id((_d: any, i: number) => i)
        .distance(90)
        .strength(0.12))
      .force('charge', d3.forceManyBody().strength(-140))
      .force('center', d3.forceCenter(W / 2, H / 2))
      .force('collide', d3.forceCollide().radius((d: any) => d.r + 8))
      .force('x', d3.forceX(W / 2).strength(0.0025))
      .force('y', d3.forceY(H / 2).strength(0.0025));

    // Render
    const g = svg.append('g');

    const linkSel = g.append('g').selectAll('line')
      .data(linkData).enter().append('line')
      .attr('stroke', 'rgba(255,255,255,0.06)')
      .attr('stroke-width', 0.7)
      .attr('stroke-dasharray', '2 3');

    const nodeSel = g.append('g').selectAll<SVGGElement, GNode>('g')
      .data(nodes).enter().append('g')
      .style('cursor', 'grab')
      .style('pointer-events', 'all');

    nodeSel.append('circle')
      .attr('r', (d: any) => d.r)
      .attr('fill', (d: any) => d.color)
      .attr('fill-opacity', 0.35)
      .attr('stroke', (d: any) => d.color)
      .attr('stroke-width', 1.2)
      .attr('stroke-opacity', 0.6)
      .attr('filter', 'url(#gb-glow)')
      .style('pointer-events', 'none');

    nodeSel.append('text')
      .text((d: any) => d.label)
      .attr('text-anchor', 'middle')
      .attr('dy', '0.38em')
      .attr('fill', '#fff')
      .attr('font-size', (d: any) => (d.label.length > 4 ? '8px' : '9px'))
      .attr('font-weight', '600')
      .attr('font-family', "'PingFang SC','Microsoft YaHei',system-ui,sans-serif")
      .style('pointer-events', 'none')
      .attr('filter', 'url(#gb-txt)');

    // Drag
    const drag = d3.drag<SVGGElement, GNode>()
      .on('start', (event, d) => {
        if (!event.active) sim.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on('drag', (event, d) => {
        d.fx = clamp(event.x, d.r + 20, W - d.r - 20);
        d.fy = clamp(event.y, d.r + 20, H - d.r - 20);
      })
      .on('end', (event, d) => {
        if (!event.active) sim.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      });
    nodeSel.call(drag);

    // Hover
    nodeSel
      .on('mouseenter', function () {
        d3.select(this).select('circle')
          .attr('fill-opacity', 0.65)
          .attr('stroke-opacity', 1)
          .attr('stroke-width', 2.2);
      })
      .on('mouseleave', function () {
        d3.select(this).select('circle')
          .attr('fill-opacity', 0.35)
          .attr('stroke-opacity', 0.6)
          .attr('stroke-width', 1.2);
      });

    // Mouse attraction
    const onMove = (e: MouseEvent) => {
      const rect = svgEl.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      mouseRef.current = [mx, my];
      sim.force('mouseX', d3.forceX(mx).strength(0.09));
      sim.force('mouseY', d3.forceY(my).strength(0.09));
      sim.alpha(0.3).restart();
    };
    const onLeave = () => {
      mouseRef.current = null;
      sim.force('mouseX', null);
      sim.force('mouseY', null);
      sim.alpha(0.05).restart();
    };
    container.addEventListener('mousemove', onMove);
    container.addEventListener('mouseleave', onLeave);

    // Tick
    sim.on('tick', () => {
      const pad = 30;
      (nodes as any[]).forEach((d: any) => {
        d.x = clamp(d.x, d.r + pad, W - d.r - pad);
        d.y = clamp(d.y, d.r + pad, H - d.r - pad);
      });
      linkSel
        .attr('x1', (d: any) => nodes[d.source].x)
        .attr('y1', (d: any) => nodes[d.source].y)
        .attr('x2', (d: any) => nodes[d.target].x)
        .attr('y2', (d: any) => nodes[d.target].y);
      nodeSel.attr('transform', (d: any) => `translate(${d.x},${d.y})`);
    });

    // Resize
    const onResize = () => {
      W = container.clientWidth || window.innerWidth;
      H = container.clientHeight || window.innerHeight;
      svg.attr('width', W).attr('height', H);
      sim.force('center', d3.forceCenter(W / 2, H / 2));
      sim.force('x', d3.forceX(W / 2).strength(0.0025));
      sim.force('y', d3.forceY(H / 2).strength(0.0025));
      sim.alpha(0.3).restart();
    };
    window.addEventListener('resize', onResize);

    return () => {
      sim.stop();
      container.removeEventListener('mousemove', onMove);
      container.removeEventListener('mouseleave', onLeave);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 z-[1]"
      style={{ pointerEvents: 'auto' }}
    >
      <svg ref={svgRef} className="w-full h-full" />
    </div>
  );
}
