import { FC, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as d3 from 'd3';
import { Tag, Loader2, AlertCircle, ZoomIn, ZoomOut, RotateCcw, Search } from 'lucide-react';
import { useGraphTagNetwork } from '@/hooks/useGraph';
import type { GraphTagNode, GraphTagEdge } from '@/api/graph';

type SimNode = GraphTagNode & d3.SimulationNodeDatum;
type SimLink = GraphTagEdge & d3.SimulationLinkDatum<SimNode>;

// 标签 LOD：缩放越低能看清的标签越少，只画高度数头部（5000 标签全画文字必卡，
// 09-26 实捕；与 3D 星系 far 态同哲学）。文字绘制是 Canvas 最贵的一档（血泪#41）。
const labelBudget = (k: number) => (k >= 1.5 ? Infinity : k >= 0.6 ? 200 : 50);

// 双主题调色板（09-26 浅色主题实捕：暗色硬编码在浅底上节点淡到看不见；
// SVG 时代同病的存量问题，Canvas 化时一并治）。主题 = documentElement 的 light/dark 类
const PAL = {
  dark: { link: '#8b949e', nodeStroke: '#0d1117', label: '#c9d1d9', hoverText: '#e6edf3', hoverStroke: '#0d1117', hl: '#e6edf3' },
  light: { link: '#9aa4b2', nodeStroke: '#ffffff', label: '#3d4450', hoverText: '#1c2128', hoverStroke: '#ffffff', hl: '#b45309' },
} as const;

const GraphTagsPage: FC = () => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  // 画图闭包要拿最新搜索词/高亮函数（effect 只随 data 重建）
  const searchRef = useRef('');
  const transformRef = useRef(d3.zoomIdentity);
  const drawRef = useRef<() => void>(() => {});
  const panToRef = useRef<(x: number, y: number) => void>(() => {});
  const nodesRef = useRef<SimNode[]>([]);

  const { data, isLoading, error } = useGraphTagNetwork();
  const isEmpty = !data || data.nodes.length === 0;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !data || data.nodes.length === 0) return;
    const container = containerRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const degreeMap: Record<string, number> = {};
    data.edges.forEach((e) => {
      degreeMap[e.source] = (degreeMap[e.source] || 0) + 1;
      degreeMap[e.target] = (degreeMap[e.target] || 0) + 1;
    });
    const maxWeight = Math.max(1, ...data.edges.map((e) => e.weight || 1));
    const nodeRadius = (id: string) => Math.max(6, Math.min(20, 6 + (degreeMap[id] || 0) * 2));
    // 标签 LOD 的头部名单：按度降序（常显标签的优先级）
    const degreeRank = new Map<string, number>(
      data.nodes.map((n, i) => [n.id, i] as [string, number])
        .sort((a, b) => (degreeMap[b[0]] || 0) - (degreeMap[a[0]] || 0))
        .map(([id], rank) => [id, rank]),
    );

    const nodes = data.nodes.map((n) => ({ ...n })) as SimNode[];
    const links = data.edges.map((e) => ({ ...e })) as SimLink[];

    let width = container?.clientWidth || 1200;
    let height = container?.clientHeight || 800;
    const dpr = window.devicePixelRatio || 1;

    const simulation = d3.forceSimulation(nodes as any)
      .force('link', d3.forceLink(links as any).id((d: any) => d.id).distance(70))
      .force('charge', d3.forceManyBody().strength(-100))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius(22));

    let hovered: SimNode | null = null;
    let rafId = 0;
    let rafPending = false;

    const resize = () => {
      width = container?.clientWidth || 1200;
      height = container?.clientHeight || 800;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      scheduleDraw();
    };

    const draw = () => {
      rafPending = false;
      const t = transformRef.current;
      const pal = document.documentElement.classList.contains('light') ? PAL.light : PAL.dark;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.setTransform(dpr * t.k, 0, 0, dpr * t.k, dpr * t.x, dpr * t.y);
      // 视口裁剪（留边）：只画看得见的节点/边（高缩放下的主要省点）
      const margin = 40 / t.k;
      const vx0 = -t.x / t.k - margin;
      const vy0 = -t.y / t.k - margin;
      const vx1 = (width - t.x) / t.k + margin;
      const vy1 = (height - t.y) / t.k + margin;
      const inView = (d: SimNode) =>
        d.x != null && d.y != null && d.x >= vx0 && d.x <= vx1 && d.y >= vy0 && d.y <= vy1;

      const q = searchRef.current.trim().toLowerCase();
      const match = (d: SimNode) => q && d.name.toLowerCase().includes(q);
      // 屏幕最小半径：fit 全局视图 k 很小（3661 节点≈0.2）时节点不缩到亚像素
      const rOf = (d: SimNode) => Math.max(nodeRadius(d.id), 1.8 / t.k);

      ctx.lineWidth = 1;
      for (const l of links) {
        const s = l.source as SimNode;
        const tg = l.target as SimNode;
        if (s.x == null || tg.x == null) continue;
        if (!inView(s) && !inView(tg)) continue;
        ctx.strokeStyle = pal.link;
        ctx.globalAlpha = q ? 0.1 : 0.45;
        ctx.lineWidth = 0.8 + ((l.weight || 1) / maxWeight) * 3;
        ctx.beginPath();
        ctx.moveTo(s.x, s.y!);
        ctx.lineTo(tg.x, tg.y!);
        ctx.stroke();
      }

      const budget = labelBudget(t.k);
      for (const d of nodes) {
        if (!inView(d)) continue;
        const m = match(d);
        ctx.globalAlpha = q ? (m ? 1 : 0.15) : 1;
        ctx.fillStyle = d.color || '#8b949e';
        ctx.strokeStyle = m ? pal.hl : pal.nodeStroke;
        ctx.lineWidth = m ? 3 : 1.5;
        ctx.beginPath();
        ctx.arc(d.x!, d.y!, rOf(d), 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }

      // 标签：LOD 预算内（按度排名）+ 视口内 + 有连边
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'center';
      for (const d of nodes) {
        if (!inView(d) || !(degreeMap[d.id] > 0)) continue;
        if ((degreeRank.get(d.id) ?? Infinity) >= budget) continue;
        const m = match(d);
        ctx.globalAlpha = q ? (m ? 1 : 0.1) : 0.85;
        ctx.fillStyle = pal.label;
        const name = d.name.length > 10 ? d.name.slice(0, 10) + '…' : d.name;
        ctx.fillText(name, d.x!, d.y! - nodeRadius(d.id) - 6);
      }

      if (hovered && hovered.x != null) {
        ctx.globalAlpha = 1;
        ctx.font = '12px sans-serif';
        const text = `${hovered.name}（使用 ${hovered.usage_count ?? 0} 次）`;
        const y = hovered.y! - nodeRadius(hovered.id) - 8;
        ctx.lineWidth = 3;
        ctx.strokeStyle = pal.hoverStroke;
        ctx.strokeText(text, hovered.x, y);
        ctx.fillStyle = pal.hoverText;
        ctx.fillText(text, hovered.x, y);
      }
      ctx.globalAlpha = 1;
    };

    function scheduleDraw() {
      if (rafPending) return;
      rafPending = true;
      rafId = requestAnimationFrame(draw);
    }

    const screenToWorld = (sx: number, sy: number) => {
      const t = transformRef.current;
      return [(sx - t.x) / t.k, (sy - t.y) / t.k] as const;
    };

    const findNode = (sx: number, sy: number): SimNode | null => {
      const [wx, wy] = screenToWorld(sx, sy);
      const tree = d3.quadtree<SimNode>()
        .x((d) => d.x ?? 0)
        .y((d) => d.y ?? 0)
        .addAll(nodes.filter((d) => d.x != null && d.y != null));
      const t = transformRef.current;
      const found = tree.find(wx, wy, 20 / t.k + 20);
      if (!found) return null;
      const dist = Math.hypot((found.x ?? 0) - wx, (found.y ?? 0) - wy);
      // 命中半径同样按屏幕最小 6px 兜底（fit 低缩放时 2px 目标点不中）
      return dist <= Math.max(nodeRadius(found.id) + 4, 6 / t.k) ? found : null;
    };

    // 指针交互：点中节点=拖拽/点击，空白=平移，滚轮=以指针为中心缩放
    let panning = false;
    let dragNode: SimNode | null = null;
    let downX = 0;
    let downY = 0;
    let moved = false;

    const onPointerDown = (ev: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      downX = ev.clientX - rect.left;
      downY = ev.clientY - rect.top;
      moved = false;
      dragNode = findNode(downX, downY);
      if (dragNode) {
        simulation.alphaTarget(0.3).restart();
        dragNode.fx = dragNode.x;
        dragNode.fy = dragNode.y;
      } else {
        panning = true;
      }
      canvas.setPointerCapture(ev.pointerId);
    };

    const onPointerMove = (ev: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const sx = ev.clientX - rect.left;
      const sy = ev.clientY - rect.top;
      if (Math.abs(sx - downX) + Math.abs(sy - downY) > 4) moved = true;
      if (dragNode) {
        const [wx, wy] = screenToWorld(sx, sy);
        dragNode.fx = wx;
        dragNode.fy = wy;
        return;
      }
      if (panning) {
        const t = transformRef.current;
        transformRef.current = d3.zoomIdentity
          .translate(t.x + ev.movementX, t.y + ev.movementY)
          .scale(t.k);
        scheduleDraw();
        return;
      }
      const hit = findNode(sx, sy);
      if (hit !== hovered) {
        hovered = hit;
        canvas.style.cursor = hit ? 'pointer' : 'default';
        scheduleDraw();
      }
    };

    const onPointerUp = (ev: PointerEvent) => {
      if (dragNode) {
        simulation.alphaTarget(0);
        dragNode.fx = null;
        dragNode.fy = null;
        if (!moved) {
          navigate(`/ingest/tags?assoc=${encodeURIComponent(dragNode.id)}`);
        }
      } else if (panning && !moved) {
        const rect = canvas.getBoundingClientRect();
        const hit = findNode(ev.clientX - rect.left, ev.clientY - rect.top);
        if (hit) navigate(`/ingest/tags?assoc=${encodeURIComponent(hit.id)}`);
      }
      dragNode = null;
      panning = false;
    };

    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const sx = ev.clientX - rect.left;
      const sy = ev.clientY - rect.top;
      const t = transformRef.current;
      const factor = ev.deltaY < 0 ? 1.15 : 1 / 1.15;
      const k = Math.max(0.1, Math.min(4, t.k * factor));
      // 以指针为锚缩放：指针下的世界点保持不动
      const [wx, wy] = screenToWorld(sx, sy);
      transformRef.current = d3.zoomIdentity
        .translate(sx - wx * k, sy - wy * k)
        .scale(k);
      scheduleDraw();
    };

    const zoomBy = (factor: number) => {
      const t = transformRef.current;
      const k = Math.max(0.1, Math.min(4, t.k * factor));
      const [wx, wy] = screenToWorld(width / 2, height / 2);
      transformRef.current = d3.zoomIdentity
        .translate(width / 2 - wx * k, height / 2 - wy * k)
        .scale(k);
      scheduleDraw();
    };

    panToRef.current = (x: number, y: number) => {
      const t = transformRef.current;
      transformRef.current = d3.zoomIdentity
        .translate(width / 2 - x * t.k, height / 2 - y * t.k)
        .scale(t.k);
      scheduleDraw();
    };

    const zoomCtl = { in: () => zoomBy(1.3), out: () => zoomBy(1 / 1.3) };
    (canvas as any).__zoomCtl = zoomCtl;
    (canvas as any).__resetView = () => {
      transformRef.current = d3.zoomIdentity;
      scheduleDraw();
    };

    simulation.on('tick', scheduleDraw);
    drawRef.current = scheduleDraw;
    nodesRef.current = nodes;

    // 视野适配（5000 节点实捕：恒等变换开局只见中心稀疏几颗，等于没图）：
    // 冷却后按全图包围盒一次性 fit，留 10% 边距；clamp 下限 0.1 按
    // 「数据还会变大」留余量（血泪#71）；只 fit 一次，不抢用户视角
    let fitted = false;
    simulation.on('end', () => {
      if (fitted) return;
      fitted = true;
      // 用户已动手（缩放/平移/定位）就不抢视角（09-27 修：end 约在挂载 5s 后触发，
      // 此前无条件 fit 会把用户刚调好的视角拽回全局，与上方注释自相矛盾）
      const cur = transformRef.current;
      if (cur.k !== 1 || cur.x !== 0 || cur.y !== 0) return;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const d of nodes) {
        if (d.x == null || d.y == null) continue;
        minX = Math.min(minX, d.x); maxX = Math.max(maxX, d.x);
        minY = Math.min(minY, d.y); maxY = Math.max(maxY, d.y);
      }
      if (!isFinite(minX)) return;
      const bw = Math.max(1, maxX - minX);
      const bh = Math.max(1, maxY - minY);
      const k = Math.max(0.1, Math.min(1.5, 0.9 * Math.min(width / bw, height / bh)));
      transformRef.current = d3.zoomIdentity
        .translate(width / 2 - (minX + bw / 2) * k, height / 2 - (minY + bh / 2) * k)
        .scale(k);
      scheduleDraw();
    });

    const ro = new ResizeObserver(resize);
    if (container) ro.observe(container);
    // 主题切换即时重画（light/dark 类翻转 → 调色板换档）
    const mo = new MutationObserver(scheduleDraw);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    resize();

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      simulation.stop();
      cancelAnimationFrame(rafId);
      ro.disconnect();
      mo.disconnect();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
    };
  }, [data, navigate]);

  // 搜索定位：词进 ref 立即重画（降透明非匹配），并平移视野到首个匹配
  useEffect(() => {
    searchRef.current = searchQuery;
    drawRef.current();
    const q = searchQuery.trim().toLowerCase();
    if (!q || !data) return;
    const first = nodesRef.current.find((n) => n.name.toLowerCase().includes(q));
    if (first && first.x != null && first.y != null) {
      panToRef.current(first.x, first.y);
    }
  }, [searchQuery, data]);

  const zoomIn = () => (canvasRef.current as any)?.__zoomCtl?.in();
  const zoomOut = () => (canvasRef.current as any)?.__zoomCtl?.out();
  const resetView = () => (canvasRef.current as any)?.__resetView?.();

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
      <canvas ref={canvasRef} className="absolute inset-0" />

      {/* 搜索定位 */}
      <div className="absolute top-4 right-4 z-30 glass-card rounded-xl flex items-center gap-2 px-3 py-2">
        <Search className="w-3.5 h-3.5 text-text-muted" />
        <input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="定位标签…"
          className="bg-transparent text-xs text-text-primary placeholder-text-secondary outline-none w-28"
        />
      </div>

      {/* 顶部统计 */}
      <div className="absolute top-4 left-4 z-30 glass-card px-3 py-2 rounded-xl flex items-center gap-3 text-xs text-text-secondary">
        <span>标签 <span className="text-text-primary font-semibold">{data.node_count}</span></span>
        <span>共现关系 <span className="text-text-primary font-semibold">{data.edge_count}</span></span>
        <a href="/ingest/tags" className="text-fusion-primary hover:underline">标签档夹 →</a>
      </div>

      {/* 底部提示 */}
      <div className="absolute bottom-4 left-4 z-30 text-[10px] text-text-muted pointer-events-none">
        点击节点查看该标签下的内容
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
