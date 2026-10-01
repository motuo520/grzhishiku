import { FC, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Network, Sparkles, Plus, Save, Trash2, Loader2, ArrowLeft, LayoutGrid,
  BookOpen, Type, Database, GitMerge, X, Check, GripVertical,
  GitBranch, Pencil, ChevronRight, Clock, ZoomIn, ZoomOut, Maximize,
  Download, FileText, Wand2, Lightbulb, LayoutTemplate, type LucideIcon } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  emergenceApi, type Idea, type CanvasNode, type CanvasEdge,
  type BrainSide, type EmergenceSource, type CanvasReportRequest,
} from '@/api/emergence';
import ModelSelector from '@/components/llm/ModelSelector';
import { LLMCostBadge } from '@/components/llm/LLMCostBadge';
import AiErrorNotice from '@/components/llm/AiErrorNotice';
import { useConfirm } from '@/components/common/dialogContext';

const BRAIN_SIDE_COLORS: Record<string, string> = {
  personal: '#58a6ff',
  network: '#a371f7',
  both: '#f0883e',
  unknown: '#8b949e',
};

const BRAIN_SIDE_CLASS: Record<string, string> = {
  personal: 'border-personal-primary/40 bg-personal-primary/10',
  network: 'border-network-primary/40 bg-network-primary/10',
  both: 'border-fusion-primary/40 bg-fusion-primary/10',
  unknown: 'border-white/[0.08] bg-white/[0.03]',
};

const BRAIN_SIDE_LABEL: Record<string, string> = {
  personal: '个人脑',
  network: '网络脑',
  both: '双脑',
  unknown: '未知',
};

const TYPE_ICON: Record<string, LucideIcon> = {
  idea: BookOpen,
  text: Type,
  source: Database,
};

const NODE_COLOR_PRESETS = [
  { value: '', label: '默认' },
  { value: '#58a6ff', label: '蓝' },
  { value: '#a371f7', label: '紫' },
  { value: '#f0883e', label: '橙' },
  { value: '#3fb950', label: '绿' },
  { value: '#f85149', label: '红' },
  { value: '#d29922', label: '黄' },
  { value: '#79c0ff', label: '青' },
  { value: '#ff7b72', label: '粉' },
];

interface Template {
  id: string;
  name: string;
  description: string;
  // dx/dy：相对视野中心的偏移（09-26 重设计：原硬编码 2000×1200 舞台坐标与
  // 实际视口/pan/scale 脱节，模板落点经常跑到不可见区域）
  nodes: (Omit<CanvasNode, 'id' | 'x' | 'y'> & { dx: number; dy: number })[];
  edges?: Omit<CanvasEdge, 'id'>[];
}

const CANVAS_TEMPLATES: Template[] = [
  {
    id: 'empty',
    name: '空白画布',
    description: '从一张白纸开始',
    nodes: [],
  },
  {
    id: 'brainstorm',
    name: '头脑风暴',
    description: '中心主题 + 四个分支',
    nodes: [
      { type: 'text', label: '核心主题', dx: 0, dy: 0, brain_side: 'both' },
      { type: 'text', label: '分支一', dx: -230, dy: -170, brain_side: 'personal' },
      { type: 'text', label: '分支二', dx: 230, dy: -170, brain_side: 'network' },
      { type: 'text', label: '分支三', dx: -230, dy: 170, brain_side: 'personal' },
      { type: 'text', label: '分支四', dx: 230, dy: 170, brain_side: 'network' },
    ],
    edges: [
      { source: '0', target: '1' },
      { source: '0', target: '2' },
      { source: '0', target: '3' },
      { source: '0', target: '4' },
    ],
  },
  {
    id: 'comparison',
    name: '双脑对比',
    description: '个人脑 vs 网络脑',
    nodes: [
      { type: 'text', label: '主题', dx: 0, dy: -190, brain_side: 'both' },
      { type: 'text', label: '个人脑观点 A', dx: -260, dy: 0, brain_side: 'personal' },
      { type: 'text', label: '个人脑观点 B', dx: -260, dy: 160, brain_side: 'personal' },
      { type: 'text', label: '网络脑事实 A', dx: 260, dy: 0, brain_side: 'network' },
      { type: 'text', label: '网络脑事实 B', dx: 260, dy: 160, brain_side: 'network' },
    ],
    edges: [
      { source: '0', target: '1' },
      { source: '0', target: '2' },
      { source: '0', target: '3' },
      { source: '0', target: '4' },
    ],
  },
  {
    id: 'timeline',
    name: '时间线',
    description: '按阶段推进',
    nodes: [
      { type: 'text', label: '起点', dx: -480, dy: 0, brain_side: 'both' },
      { type: 'text', label: '阶段一', dx: -240, dy: 0, brain_side: 'both' },
      { type: 'text', label: '阶段二', dx: 0, dy: 0, brain_side: 'both' },
      { type: 'text', label: '阶段三', dx: 240, dy: 0, brain_side: 'both' },
      { type: 'text', label: '终点', dx: 480, dy: 0, brain_side: 'both' },
    ],
    edges: [
      { source: '0', target: '1' },
      { source: '1', target: '2' },
      { source: '2', target: '3' },
      { source: '3', target: '4' },
    ],
  },
];

const generateId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;

const Toast: FC<{ message: string; type: 'success' | 'error'; onClose: () => void }> = ({ message, type, onClose }) => {
  useEffect(() => {
    const timer = setTimeout(onClose, 3000);
    return () => clearTimeout(timer);
  }, [onClose]);

  return (
    <div className={`fixed top-5 right-5 z-[60] flex items-center gap-2 px-4 py-3 rounded-xl border backdrop-blur ${
      type === 'success'
        ? 'bg-green-500/10 border-green-500/30 text-green-400'
        : 'bg-red-500/10 border-red-500/30 text-red-400'
    }`}>
      {type === 'success' ? <Check className="w-4 h-4" /> : <X className="w-4 h-4" />}
      <span className="text-sm">{message}</span>
    </div>
  );
};

interface CanvasEditorProps {
  canvasId: string | null;
  onBack: () => void;
  onCanvasCreated?: (id: string) => void;
}

const CanvasEditor: FC<CanvasEditorProps> = ({ canvasId, onBack, onCanvasCreated }) => {
  const askConfirm = useConfirm();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const canvasRef = useRef<HTMLDivElement>(null);

  const [title, setTitle] = useState('未命名画布');
  const [description, setDescription] = useState('');
  const [brainSide, setBrainSide] = useState<BrainSide>('both');
  const [nodes, setNodes] = useState<CanvasNode[]>([]);
  const [edges, setEdges] = useState<CanvasEdge[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  // 09-26 重设计：干掉三态模式切换（选择/连线/平移是基础操作门槛）——拖节点=
  // 移动、拖空白=平移、滚轮=缩放全时可用；连线由节点上的连线按钮武装。
  const [connectingSourceId, setConnectingSourceId] = useState<string | null>(null);
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);
  const [activeTab, setActiveTab] = useState<'ideas' | 'sources' | 'text' | 'recommend'>('ideas');
  // 侧边栏成果库/素材池递增加载上限；与后端 le=1000 对齐
  const [ideaLimit, setIdeaLimit] = useState(100);
  const [sourceLimit, setSourceLimit] = useState(100);
  const [textInput, setTextInput] = useState('');
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [editColor, setEditColor] = useState('');
  const [editBrainSide, setEditBrainSide] = useState<BrainSide>('both');
  const [combineOpen, setCombineOpen] = useState(false);
  const [combineTitle, setCombineTitle] = useState('');
  const [combineSummary, setCombineSummary] = useState('');
  const [combineTags, setCombineTags] = useState('');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // Template dropdown state (fixed positioning to escape overflow-hidden ancestors)
  const templateBtnRef = useRef<HTMLButtonElement>(null);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [templatePos, setTemplatePos] = useState({ top: 0, left: 0 });

  // Zoom / pan state
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  // 平移位移阈值（09-27 修复：拖空白平移后 click 照样派发，多选被清空/连线被取消——
  // 超 4px 视为平移收尾，click 不再当「单击空白」处理；同 GraphTagsPage 口径）
  const panMoved = useRef(false);

  // Report modal state
  const [reportOpen, setReportOpen] = useState(false);
  const [reportFormat, setReportFormat] = useState<CanvasReportRequest['format']>('proposal');
  const [reportResult, setReportResult] = useState<{ title: string; content: string } | null>(null);
  const [reportModelId, setReportModelId] = useState<string>('');

  const { data: existingCanvas, isLoading: isLoadingCanvas, isError: isLoadingCanvasError } = useQuery({
    queryKey: ['emergence', 'canvas', canvasId],
    queryFn: async () => {
      if (!canvasId) return null;
      const response = await emergenceApi.getCanvas(canvasId);
      return response.data;
    },
    enabled: !!canvasId,
    refetchOnWindowFocus: false,
  });

  const { data: ideasData } = useQuery({
    queryKey: ['emergence', 'ideas', 'canvas', ideaLimit],
    queryFn: async () => {
      const response = await emergenceApi.getIdeas(undefined, 'all', 0, ideaLimit);
      return response.data;
    },
  });

  const { data: sourcesData } = useQuery({
    queryKey: ['emergence', 'sources', 'canvas', sourceLimit],
    queryFn: async () => {
      const response = await emergenceApi.getSources(undefined, undefined, undefined, sourceLimit);
      return response.data;
    },
  });

  const createMutation = useMutation({
    mutationFn: emergenceApi.createCanvas,
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ['emergence', 'canvases'] });
      // 创建成功后切到新画布，避免 canvasId 仍为空导致重复创建
      const newCanvasId = response.data?.id;
      if (newCanvasId) {
        onCanvasCreated?.(newCanvasId);
      }
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof emergenceApi.updateCanvas>[1] }) =>
      emergenceApi.updateCanvas(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['emergence', 'canvases'] });
      queryClient.invalidateQueries({ queryKey: ['emergence', 'canvas', canvasId] });
    },
  });

  const combineMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof emergenceApi.combineCanvasNodes>[1] }) =>
      emergenceApi.combineCanvasNodes(id, data),
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ['emergence', 'ideas'] });
      const idea = response.data;
      const slot = findFreeSlot();
      addNode({
        id: generateId(),
        type: 'idea',
        idea_id: idea.id,
        label: idea.title,
        content: idea.summary || undefined,
        x: slot.x,
        y: slot.y,
        brain_side: idea.brain_side,
      });
      setCombineOpen(false);
      setCombineTitle('');
      setCombineSummary('');
      setCombineTags('');
      setSelectedIds([]);
      setToast({ message: '已生成新创意', type: 'success' });
    },
    onError: () => setToast({ message: '组合创意失败', type: 'error' }),
  });

  const reportMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof emergenceApi.generateCanvasReport>[1] }) =>
      emergenceApi.generateCanvasReport(id, data),
    onSuccess: (response) => {
      setReportResult(response.data);
      setToast({ message: '报告生成成功', type: 'success' });
    },
    onError: () => setToast({ message: '报告生成失败', type: 'error' }),
  });

  const toNoteMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof emergenceApi.convertCanvasToNote>[1] }) =>
      emergenceApi.convertCanvasToNote(id, data),
    onSuccess: (response) => {
      setToast({ message: '已转为笔记', type: 'success' });
      navigate(`/ingest/notes/${response.data.note_id}`);
    },
    onError: () => setToast({ message: '转笔记失败', type: 'error' }),
  });

  const syncedCanvasId = useRef<string | null>(null);
  useEffect(() => {
    // 仅在首次加载对应 canvasId 时同步本地状态，避免后台 refetch 覆盖未保存编辑
    if (existingCanvas && canvasId && syncedCanvasId.current !== canvasId) {
      syncedCanvasId.current = canvasId;
      setTitle(existingCanvas.title);
      setDescription(existingCanvas.description || '');
      setBrainSide(existingCanvas.brain_side as BrainSide);
      setNodes(existingCanvas.nodes || []);
      setEdges(existingCanvas.edges || []);
    }
  }, [existingCanvas, canvasId]);

  const getCanvasCenter = () => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: 1000, y: 600 };
    // 按视口/pan/scale 反算画布中心，避免新增节点落在不可见区域
    return {
      x: (rect.width / 2 - pan.x) / scale,
      y: (rect.height / 2 - pan.y) / scale,
    };
  };

  // 新增节点自动找空位（09-26 画布重设计：原 center+random±40 中心堆叠实捕——
  // 连点几条素材全叠成一摞）。从视口中心向外环形扫描，第一个与既有节点
  // （含 24px 间隙）不重叠的槽位即落位；扫不到级联偏移兜底，保证永不叠。
  const findFreeSlot = (w = 200, h = 130): { x: number; y: number } => {
    const center = getCanvasCenter();
    const overlaps = (x: number, y: number) =>
      nodes.some((n) => {
        const nw = n.width || 200;
        const nh = n.height || 130;
        return x < n.x + nw + 24 && x + w + 24 > n.x && y < n.y + nh + 24 && y + h + 24 > n.y;
      });
    for (let ring = 0; ring <= 12; ring++) {
      const candidates: [number, number][] = ring === 0
        ? [[center.x - w / 2, center.y - h / 2]]
        : Array.from({ length: ring * 8 }, (_, i) => {
            const angle = (i / (ring * 8)) * Math.PI * 2;
            return [
              center.x - w / 2 + Math.cos(angle) * ring * 240,
              center.y - h / 2 + Math.sin(angle) * ring * 150,
            ] as [number, number];
          });
      for (const [x, y] of candidates) {
        if (!overlaps(x, y)) return { x: Math.round(x), y: Math.round(y) };
      }
    }
    return { x: center.x + nodes.length * 30, y: center.y + nodes.length * 30 };
  };

  // 一键整理：确定性网格均布（09-26 重设计「分布不均匀」根修）——类型分组
  // 排序（创意/素材/便签），按视口纵横比定列数，视野中心为锚铺开，只动坐标
  // 不动边，整理后自动 fit。
  const tidyLayout = () => {
    if (!nodes.length) return;
    const TYPE_ORDER: Record<string, number> = { idea: 0, source: 1, text: 2 };
    const sorted = [...nodes].sort((a, b) => (TYPE_ORDER[a.type] ?? 3) - (TYPE_ORDER[b.type] ?? 3));
    const rect = canvasRef.current?.getBoundingClientRect();
    const aspect = rect && rect.height > 0 ? rect.width / rect.height : 4 / 3;
    const cols = Math.max(1, Math.ceil(Math.sqrt(sorted.length * aspect)));
    const rows = Math.ceil(sorted.length / cols);
    const cellW = 240;
    const cellH = 170;
    const center = getCanvasCenter();
    const originX = center.x - ((cols - 1) * cellW) / 2 - 100;
    const originY = center.y - ((rows - 1) * cellH) / 2 - 65;
    const next = sorted.map((n, i) => ({
      ...n,
      x: Math.round(originX + (i % cols) * cellW),
      y: Math.round(originY + Math.floor(i / cols) * cellH),
    }));
    setNodes(next);
    setSelectedIds([]);
    zoomFit(next);
    setToast({ message: '已整理画布布局', type: 'success' });
  };

  const addNode = (node: CanvasNode) => {
    setNodes((prev) => [...prev, node]);
    setSelectedIds([node.id]);
  };

  const addIdeaNode = (idea: Idea) => {
    const slot = findFreeSlot();
    addNode({
      id: generateId(),
      type: 'idea',
      idea_id: idea.id,
      label: idea.title,
      content: idea.summary || undefined,
      x: slot.x,
      y: slot.y,
      brain_side: idea.brain_side,
    });
  };

  const addSourceNode = (source: EmergenceSource) => {
    const slot = findFreeSlot();
    addNode({
      id: generateId(),
      type: 'source',
      source_id: source.id,
      label: source.title,
      content: source.excerpt || undefined,
      x: slot.x,
      y: slot.y,
      brain_side: source.brain_side,
    });
  };

  const addTextNode = () => {
    if (!textInput.trim()) return;
    const slot = findFreeSlot();
    addNode({
      id: generateId(),
      type: 'text',
      label: textInput.trim(),
      x: slot.x,
      y: slot.y,
      brain_side: 'both',
    });
    setTextInput('');
  };

  const toggleTemplate = () => {
    if (!templateOpen && templateBtnRef.current) {
      const rect = templateBtnRef.current.getBoundingClientRect();
      setTemplatePos({ top: rect.bottom + 8, left: rect.left });
    }
    setTemplateOpen((prev) => !prev);
  };

  useEffect(() => {
    if (!templateOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (
        templateBtnRef.current?.contains(e.target as Node) ||
        (e.target as HTMLElement)?.closest('[data-template-dropdown]')
      ) {
        return;
      }
      setTemplateOpen(false);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setTemplateOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [templateOpen]);

  // Esc 取消连线（重设计：连线由节点按钮武装，Esc/点空白取消）
  useEffect(() => {
    if (!connectingSourceId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setConnectingSourceId(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [connectingSourceId]);

  const applyTemplate = async (template: Template) => {
    if (nodes.length > 0 && !(await askConfirm('应用模板会清空当前画布，是否继续？'))) return;
    // 视口中心为锚落位（模板 dx/dy 是相对偏移），应用后自动 fit
    const center = getCanvasCenter();
    const idMap = new Map<string, string>();
    const newNodes: CanvasNode[] = template.nodes.map((n, idx) => {
      const id = generateId();
      idMap.set(String(idx), id);
      const { dx, dy, ...rest } = n;
      return { ...rest, id, x: center.x + dx, y: center.y + dy } as CanvasNode;
    });
    const newEdges: CanvasEdge[] = (template.edges || []).map((e) => ({
      ...e,
      id: generateId(),
      source: idMap.get(e.source) || e.source,
      target: idMap.get(e.target) || e.target,
    }));
    setNodes(newNodes);
    setEdges(newEdges);
    setSelectedIds([]);
    zoomFit(newNodes);
    setToast({ message: `已应用「${template.name}」模板`, type: 'success' });
  };

  const updateNodePosition = (id: string, x: number, y: number) => {
    setNodes((prev) => prev.map((n) => (n.id === id ? { ...n, x, y } : n)));
  };

  const deleteNode = (id: string) => {
    setNodes((prev) => prev.filter((n) => n.id !== id));
    setEdges((prev) => prev.filter((e) => e.source !== id && e.target !== id));
    setSelectedIds((prev) => prev.filter((sid) => sid !== id));
  };

  // deleteEdge 为死代码（无删除连线入口），已移除

  const handleNodeClick = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (connectingSourceId) {
      if (connectingSourceId !== id) {
        const exists = edges.some(
          (edge) =>
            (edge.source === connectingSourceId && edge.target === id) ||
            (edge.source === id && edge.target === connectingSourceId)
        );
        if (!exists) {
          setEdges((prev) => [
            ...prev,
            { id: generateId(), source: connectingSourceId, target: id },
          ]);
        }
      }
      setConnectingSourceId(null);
      return;
    }

    if (e.shiftKey) {
      setSelectedIds((prev) =>
        prev.includes(id) ? prev.filter((sid) => sid !== id) : [...prev, id]
      );
    } else {
      setSelectedIds([id]);
    }
  };

  const handleCanvasClick = () => {
    if (panMoved.current) { panMoved.current = false; return; }  // 平移收尾不算单击空白
    if (connectingSourceId) {
      setConnectingSourceId(null);
      return;
    }
    setSelectedIds([]);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (connectingSourceId && canvasRef.current) {
      const rect = canvasRef.current.getBoundingClientRect();
      setMousePos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    }
    if (isPanning) {
      const dx = e.clientX - panStart.current.x;
      const dy = e.clientY - panStart.current.y;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) panMoved.current = true;
      setPan({ x: panStart.current.panX + dx, y: panStart.current.panY + dy });
    }
  };

  const handleWheel = (e: React.WheelEvent) => {
    if (!canvasRef.current) return;
    e.preventDefault();
    const rect = canvasRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
    const newScale = Math.min(3, Math.max(0.25, scale * zoomFactor));

    // Zoom towards mouse pointer
    const scaleRatio = newScale / scale;
    const newPanX = mouseX - (mouseX - pan.x) * scaleRatio;
    const newPanY = mouseY - (mouseY - pan.y) * scaleRatio;

    setScale(newScale);
    setPan({ x: newPanX, y: newPanY });
  };

  const startPan = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    // 节点上按下=拖节点（framer-motion drag），不抢成平移；空白处才平移
    if ((e.target as HTMLElement).closest('[data-node]')) return;
    setIsPanning(true);
    panMoved.current = false;
    panStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
  };

  const endPan = () => {
    setIsPanning(false);
  };

  const zoomIn = () => setScale((s) => Math.min(3, s * 1.2));
  const zoomOut = () => setScale((s) => Math.max(0.25, s / 1.2));
  const zoomReset = () => {
    setScale(1);
    setPan({ x: 0, y: 0 });
  };
  const zoomFit = (target?: CanvasNode[]) => {
    const list = target ?? nodes;
    if (!list.length) {
      zoomReset();
      return;
    }
    const xs = list.map((n) => n.x);
    const ys = list.map((n) => n.y);
    const minX = Math.min(...xs) - 100;
    const maxX = Math.max(...xs) + 280;
    const minY = Math.min(...ys) - 100;
    const maxY = Math.max(...ys) + 200;
    const contentW = maxX - minX;
    const contentH = maxY - minY;
    const rect = canvasRef.current?.getBoundingClientRect();
    const viewW = rect?.width || 1000;
    const viewH = rect?.height || 600;
    const newScale = Math.min(viewW / contentW, viewH / contentH, 1.5);
    setScale(newScale);
    setPan({ x: -minX * newScale + (viewW - contentW * newScale) / 2, y: -minY * newScale + (viewH - contentH * newScale) / 2 });
  };

  const startEditNode = (node: CanvasNode) => {
    setEditingNodeId(node.id);
    setEditLabel(node.label);
    setEditColor(node.color || '');
    setEditBrainSide((node.brain_side || 'both') as BrainSide);
  };

  const saveEditNode = () => {
    if (!editingNodeId || !editLabel.trim()) return;
    setNodes((prev) =>
      prev.map((n) =>
        n.id === editingNodeId
          ? { ...n, label: editLabel.trim(), color: editColor || null, brain_side: editBrainSide }
          : n
      )
    );
    setEditingNodeId(null);
  };

  const handleSave = async () => {
    setSaveError(null);
    // 画布未加载完成/失败时禁止保存，避免用默认空画布覆盖已有数据
    if (canvasId && (isLoadingCanvas || isLoadingCanvasError || !existingCanvas)) {
      setSaveError('画布尚未加载完成，无法保存');
      setToast({ message: '画布尚未加载完成，无法保存', type: 'error' });
      return;
    }
    try {
      const payload = {
        title,
        description: description || undefined,
        brain_side: brainSide,
        nodes,
        edges,
      };
      if (canvasId) {
        await updateMutation.mutateAsync({ id: canvasId, data: payload });
        setToast({ message: '保存成功', type: 'success' });
      } else {
        await createMutation.mutateAsync(payload);
        setToast({ message: '创建成功', type: 'success' });
      }
    } catch (err) {
      setSaveError('保存失败，请重试');
      setToast({ message: '保存失败', type: 'error' });
    }
  };

  // 组合/报告/转笔记前静默保存当前画布，避免基于未持久化节点操作
  const saveCanvasSilently = async () => {
    if (!canvasId) return false;
    if (isLoadingCanvas || isLoadingCanvasError || !existingCanvas) {
      setToast({ message: '画布尚未加载完成', type: 'error' });
      return false;
    }
    try {
      await updateMutation.mutateAsync({
        id: canvasId,
        data: { title, description: description || undefined, brain_side: brainSide, nodes, edges },
      });
      return true;
    } catch {
      setToast({ message: '保存失败', type: 'error' });
      return false;
    }
  };

  const handleCombine = () => {
    if (selectedIds.length < 2 || !canvasId) return;
    const selectedNodes = nodes.filter((n) => selectedIds.includes(n.id));
    const defaultTitle = selectedNodes.map((n) => n.label).slice(0, 2).join(' × ');
    setCombineTitle(defaultTitle);
    const contents = selectedNodes.map((n) => n.content).filter(Boolean) as string[];
    setCombineSummary(contents.slice(0, 3).join('\n'));
    setCombineOpen(true);
  };

  const submitCombine = async () => {
    if (!canvasId || !combineTitle.trim()) return;
    if (!(await saveCanvasSilently())) return;
    combineMutation.mutate({
      id: canvasId,
      data: {
        node_ids: selectedIds,
        title: combineTitle.trim(),
        summary: combineSummary.trim(),
        tags: combineTags
          .split(/[,，]/)
          .map((t) => t.trim())
          .filter(Boolean),
      },
    });
  };

  const exportMarkdown = () => {
    const lines = [`# ${title}`, ''];
    if (description) {
      lines.push(`> ${description}`, '');
    }
    lines.push(`## 节点 (${nodes.length})`, '');
    nodes.forEach((n) => {
      lines.push(`- **${n.label}** (${n.type})`);
      if (n.content) lines.push(`  - ${n.content}`);
      lines.push(`  - 脑侧: ${BRAIN_SIDE_LABEL[n.brain_side || 'unknown']}`);
    });
    if (edges.length) {
      lines.push('', `## 连线 (${edges.length})`, '');
      edges.forEach((e) => {
        const src = nodeById.get(e.source);
        const tgt = nodeById.get(e.target);
        lines.push(`- ${src?.label || e.source} → ${tgt?.label || e.target}`);
      });
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title || '画布'}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setToast({ message: 'Markdown 已导出', type: 'success' });
  };

  const generateReport = async () => {
    if (!canvasId) return;
    if (!(await saveCanvasSilently())) return;
    reportMutation.mutate({
      id: canvasId,
      data: {
        format: reportFormat,
        title,
        focus_node_ids: selectedIds.length ? selectedIds : undefined,
        preferred_model: reportModelId || undefined,
      },
    });
  };

  const convertToNote = async () => {
    if (!canvasId) return;
    if (!(await askConfirm('将把当前画布转为一条笔记，是否继续？'))) return;
    if (!(await saveCanvasSilently())) return;
    toNoteMutation.mutate({ id: canvasId, data: { title } });
  };

  // Recommendations: simple token overlap between canvas text and source/idea text
  const recommendations = useMemo(() => {
    const canvasText = nodes
      .map((n) => `${n.label} ${n.content || ''}`)
      .join(' ')
      .toLowerCase();
    const tokens = new Set(
      canvasText.split(/\s+|[,，.。;；!！?？、]/).filter((t) => t.length >= 2)
    );

    const scoreItems = <T extends { title: string; excerpt?: string | null; summary?: string | null }>(
      items: T[] | undefined,
      type: string
    ) => {
      if (!items) return [];
      return items
        .map((item) => {
          const text = `${item.title} ${item.excerpt || ''} ${item.summary || ''}`.toLowerCase();
          const itemTokens = text.split(/\s+|[,，.。;；!！?？、]/).filter((t) => t.length >= 2);
          const overlap = itemTokens.filter((t) => tokens.has(t)).length;
          const density = itemTokens.length ? overlap / itemTokens.length : 0;
          return { item: item as T, type, score: overlap + density * 5 };
        })
        .filter((r) => r.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 8);
    };

    const ideaRecs = scoreItems(ideasData?.items, 'idea');
    const sourceRecs = scoreItems(sourcesData?.items, 'source');
    return [...ideaRecs, ...sourceRecs].sort((a, b) => b.score - a.score).slice(0, 10);
  }, [nodes, ideasData, sourcesData]);

  const nodeById = useMemo(() => {
    const map = new Map<string, CanvasNode>();
    nodes.forEach((n) => map.set(n.id, n));
    return map;
  }, [nodes]);

  const connectingSource = connectingSourceId ? nodeById.get(connectingSourceId) : null;

  const getNodeCenter = (node: CanvasNode) => {
    const w = node.width || 180;
    const h = node.height || 100;
    return { x: node.x + w / 2, y: node.y + h / 2 };
  };

  const addRecommendedItem = (item: Idea | EmergenceSource, type: string) => {
    if (type === 'idea') {
      addIdeaNode(item as Idea);
    } else {
      addSourceNode(item as EmergenceSource);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex-shrink-0 px-4 py-3 border-b border-white/[0.06] bg-bg-secondary/80 backdrop-blur-sm">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <button onClick={onBack} className="p-2 rounded-lg hover:bg-white/[0.05] text-text-secondary">
              <ArrowLeft className="w-4 h-4" />
            </button>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="bg-transparent border-b border-transparent hover:border-white/[0.1] focus:border-info focus:outline-none text-lg font-bold text-text-primary px-1 py-0.5 min-w-[120px] max-w-[300px]"
            />
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* 整理布局：确定性网格均布（重设计「分布不均匀」根修） */}
            <button
              onClick={tidyLayout}
              disabled={!nodes.length}
              className="px-2.5 py-1.5 rounded-md text-xs font-medium flex items-center gap-1 bg-bg-tertiary text-text-muted hover:text-text-secondary disabled:opacity-50"
              title="按类型分组网格均布全部节点"
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              整理
            </button>

            {/* Template selector */}
            <div className="relative">
              <button
                ref={templateBtnRef}
                onClick={toggleTemplate}
                className={`px-2.5 py-1.5 rounded-md text-xs font-medium flex items-center gap-1 bg-bg-tertiary ${
                  templateOpen ? 'text-text-primary' : 'text-text-muted hover:text-text-secondary'
                }`}
              >
                <LayoutTemplate className="w-3.5 h-3.5" />
                模板
              </button>
              {templateOpen && createPortal(
                <div
                  data-template-dropdown
                  className="fixed w-56 bg-bg-secondary border border-white/[0.08] rounded-xl shadow-xl z-[9999] p-2"
                  style={{ top: templatePos.top, left: templatePos.left }}
                >
                  {CANVAS_TEMPLATES.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => { applyTemplate(t); setTemplateOpen(false); }}
                      className="w-full text-left p-2.5 rounded-lg hover:bg-white/[0.05] transition-colors"
                    >
                      <div className="text-xs font-medium text-text-primary">{t.name}</div>
                      <div className="text-[10px] text-text-muted">{t.description}</div>
                    </button>
                  ))}
                </div>,
                document.body
              )}
            </div>

            {/* Zoom controls */}
            <div className="flex items-center gap-1 bg-bg-tertiary rounded-lg p-1">
              <button onClick={zoomOut} className="p-1.5 rounded hover:bg-white/[0.08] text-text-muted hover:text-text-secondary" title="缩小">
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <span className="text-[10px] text-text-muted w-10 text-center">{Math.round(scale * 100)}%</span>
              <button onClick={zoomIn} className="p-1.5 rounded hover:bg-white/[0.08] text-text-muted hover:text-text-secondary" title="放大">
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
              <button onClick={zoomReset} className="p-1.5 rounded hover:bg-white/[0.08] text-text-muted hover:text-text-secondary" title="重置">
                <Maximize className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => zoomFit()} className="p-1.5 rounded hover:bg-white/[0.08] text-text-muted hover:text-text-secondary" title="适配">
                <LayoutGrid className="w-3.5 h-3.5" />
              </button>
            </div>

            {selectedIds.length >= 2 && canvasId && (
              <button
                onClick={handleCombine}
                className="btn-primary text-xs py-1.5 px-3 flex items-center gap-1"
              >
                <GitMerge className="w-3.5 h-3.5" />
                组合创意
              </button>
            )}

            <button
              onClick={exportMarkdown}
              className="px-2.5 py-1.5 rounded-md text-xs font-medium flex items-center gap-1 bg-bg-tertiary text-text-muted hover:text-text-secondary"
              title="导出 Markdown"
            >
              <Download className="w-3.5 h-3.5" />
              导出
            </button>

            {canvasId && (
              <>
                <button
                  onClick={() => setReportOpen(true)}
                  className="px-2.5 py-1.5 rounded-md text-xs font-medium flex items-center gap-1 bg-bg-tertiary text-text-muted hover:text-text-secondary"
                  title="生成报告"
                >
                  <FileText className="w-3.5 h-3.5" />
                  报告
                </button>
                <button
                  onClick={convertToNote}
                  disabled={toNoteMutation.isPending}
                  className="px-2.5 py-1.5 rounded-md text-xs font-medium flex items-center gap-1 bg-bg-tertiary text-text-muted hover:text-text-secondary disabled:opacity-60"
                  title="转为笔记"
                >
                  {toNoteMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <BookOpen className="w-3.5 h-3.5" />}
                  转笔记
                </button>
              </>
            )}

            <button
              onClick={handleSave}
              disabled={createMutation.isPending || updateMutation.isPending}
              className="btn-primary text-xs py-1.5 px-3 flex items-center gap-1 disabled:opacity-60"
            >
              {createMutation.isPending || updateMutation.isPending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Save className="w-3.5 h-3.5" />
              )}
              保存
            </button>
          </div>
        </div>

        {saveError && (
          <div className="mt-2 text-xs text-danger">{saveError}</div>
        )}

        {connectingSourceId && (
          <div className="mt-2 text-xs text-info flex items-center gap-1">
            <GitBranch className="w-3 h-3" />
            点击目标节点完成连线，点空白或 Esc 取消
          </div>
        )}
      </div>

      {/* Main workspace */}
      <div className="flex-1 flex overflow-hidden">
        {/* Canvas */}
        <div
          ref={canvasRef}
          className="flex-1 relative overflow-hidden bg-bg-primary cursor-grab active:cursor-grabbing"
          onClick={handleCanvasClick}
          onMouseMove={handleMouseMove}
          onMouseDown={startPan}
          onMouseUp={endPan}
          onMouseLeave={endPan}
          onWheel={handleWheel}
        >
          <div
            className="absolute top-0 left-0 origin-top-left"
            style={{
              width: 2000,
              height: 1200,
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
            }}
          >
            {/* Grid */}
            <div
              className="absolute inset-0 opacity-20 pointer-events-none"
              style={{
                backgroundImage:
                  'linear-gradient(rgba(200,149,108,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(200,149,108,0.1) 1px, transparent 1px)',
                backgroundSize: '32px 32px',
              }}
            />

            {/* SVG edges：二次贝塞尔曲线 + 目标端箭头（重设计质感提升） */}
            {/* overflow visible：节点可拖出 2000×1200 舞台（findFreeSlot/拖拽无边界），
                SVG 默认 overflow:hidden 会把指向界外节点的边线裁没（09-27 修） */}
            <svg className="absolute inset-0 w-full h-full pointer-events-none z-0" style={{ overflow: 'visible' }}>
              <defs>
                <marker id="canvas-arrow" viewBox="0 0 10 10" refX="9" refY="5"
                  markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(139,148,158,0.85)" />
                </marker>
              </defs>
              {edges.map((edge) => {
                const source = nodeById.get(edge.source);
                const target = nodeById.get(edge.target);
                if (!source || !target) return null;
                const s = getNodeCenter(source);
                const t = getNodeCenter(target);
                const dx = t.x - s.x;
                const dy = t.y - s.y;
                const len = Math.hypot(dx, dy) || 1;
                // 中点法线偏移 15%，让多条边彼此可分
                const cx = (s.x + t.x) / 2 - (dy / len) * len * 0.15;
                const cy = (s.y + t.y) / 2 + (dx / len) * len * 0.15;
                return (
                  <path
                    key={edge.id}
                    d={`M ${s.x} ${s.y} Q ${cx} ${cy} ${t.x} ${t.y}`}
                    fill="none"
                    stroke="rgba(139,148,158,0.5)"
                    strokeWidth={2}
                    markerEnd="url(#canvas-arrow)"
                  />
                );
              })}
              {connectingSource && mousePos && (() => {
                const s = getNodeCenter(connectingSource);
                const tx = mousePos.x / scale - pan.x / scale;
                const ty = mousePos.y / scale - pan.y / scale;
                const dx = tx - s.x;
                const dy = ty - s.y;
                const len = Math.hypot(dx, dy) || 1;
                const cx = (s.x + tx) / 2 - (dy / len) * len * 0.15;
                const cy = (s.y + ty) / 2 + (dx / len) * len * 0.15;
                return (
                  <path
                    d={`M ${s.x} ${s.y} Q ${cx} ${cy} ${tx} ${ty}`}
                    fill="none"
                    stroke="#58a6ff"
                    strokeWidth={2}
                    strokeDasharray="6 4"
                  />
                );
              })()}
            </svg>

            {/* Nodes */}
            {nodes.map((node) => {
              const selected = selectedIds.includes(node.id);
              const isConnectSource = connectingSourceId === node.id;
              const Icon = TYPE_ICON[node.type];
              const color = node.color || BRAIN_SIDE_COLORS[node.brain_side || 'unknown'];
              return (
                <motion.div
                  key={node.id}
                  data-node
                  drag
                  dragMomentum={false}
                  onDragEnd={(_, info) => {
                    updateNodePosition(node.id, node.x + info.offset.x / scale, node.y + info.offset.y / scale);
                  }}
                  onClick={(e) => handleNodeClick(e as unknown as React.MouseEvent, node.id)}
                  initial={false}
                  style={{
                    position: 'absolute',
                    left: 0,
                    top: 0,
                    x: node.x,
                    y: node.y,
                    width: node.width || 200,
                  }}
                  className={`z-10 group ${selected || isConnectSource ? 'z-20' : ''}`}
                >
                  <div
                    className={`rounded-xl border p-3 cursor-grab active:cursor-grabbing shadow-sm transition-all hover:shadow-lg hover:-translate-y-0.5 ${
                      selected
                        ? 'ring-2 ring-info ring-offset-0 ring-offset-bg-primary'
                        : isConnectSource
                          ? 'ring-2 ring-info/60'
                          : ''
                    } ${BRAIN_SIDE_CLASS[node.brain_side || 'unknown']}`}
                    style={{ borderLeftWidth: 4, borderLeftColor: color }}
                  >
                    <div className="flex items-start justify-between gap-2 mb-1.5">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <Icon className="w-3.5 h-3.5 flex-shrink-0" style={{ color }} />
                        <span className="text-[10px] uppercase tracking-wider text-text-muted">
                          {node.type === 'idea' ? '创意' : node.type === 'source' ? '素材' : '便签'}
                        </span>
                      </div>
                      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={(e) => { e.stopPropagation(); setConnectingSourceId(node.id); }}
                          className="p-1 rounded hover:bg-white/[0.08] text-text-muted hover:text-info"
                          title="连线到其它节点（点目标节点完成，Esc 取消）"
                        >
                          <GitBranch className="w-3 h-3" />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); startEditNode(node); }}
                          className="p-1 rounded hover:bg-white/[0.08] text-text-muted"
                          title="编辑节点"
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); deleteNode(node.id); }}
                          className="p-1 rounded hover:bg-danger/10 text-text-muted hover:text-danger"
                          title="删除节点"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    </div>

                    <h4 className="text-sm font-medium text-text-primary line-clamp-2">{node.label}</h4>
                    {node.content && (
                      <p className="text-xs text-text-secondary line-clamp-3 mt-1 leading-relaxed">
                        {node.content}
                      </p>
                    )}

                    {node.type === 'source' && node.source_id && (
                      <div className="mt-2 text-[10px] text-text-muted flex items-center gap-1">
                        <GripVertical className="w-3 h-3" />
                        {BRAIN_SIDE_LABEL[node.brain_side || 'unknown']}
                      </div>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </div>

          {/* 空态引导（重设计：空画布零引导是「没人懂」主因之一） */}
          {nodes.length === 0 && (
            <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
              <div className="pointer-events-auto max-w-md glass-card p-6 space-y-4 text-center">
                <Network className="w-10 h-10 text-fusion-primary mx-auto" />
                <div className="text-sm font-bold text-text-primary">三步开始组合创意</div>
                <ol className="text-xs text-text-secondary text-left space-y-2 leading-relaxed">
                  <li>① 从右侧「成果库 / 素材池 / 便签」点一下，内容自动找空位上画布</li>
                  <li>② 拖动节点摆位；hover 节点点 <GitBranch className="w-3 h-3 inline -mt-0.5" /> 图标连线，「整理」一键均布</li>
                  <li>③ 保存后可组合创意、生成报告、转笔记</li>
                </ol>
                <div className="flex items-center justify-center gap-2">
                  <button
                    onClick={() => applyTemplate(CANVAS_TEMPLATES[1])}
                    className="btn-primary text-xs py-2 px-3 flex items-center gap-1"
                  >
                    <LayoutTemplate className="w-3.5 h-3.5" />
                    用「头脑风暴」模板
                  </button>
                  <button
                    onClick={() => setActiveTab('sources')}
                    className="btn-secondary text-xs py-2 px-3"
                  >
                    去选素材
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="w-80 flex-shrink-0 border-l border-white/[0.06] bg-bg-secondary/80 backdrop-blur-sm flex flex-col">
          <div className="flex items-center gap-2 p-4 border-b border-white/[0.06]">
            <LayoutGrid className="w-4 h-4 text-fusion-primary" />
            <h3 className="text-sm font-bold text-text-primary">添加节点</h3>
          </div>

          <div className="flex items-center gap-1 p-2 border-b border-white/[0.06]">
            {(['ideas', 'sources', 'text', 'recommend'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`flex-1 py-1.5 rounded-md text-xs font-medium transition-all ${
                  activeTab === tab
                    ? 'bg-bg-tertiary text-text-primary'
                    : 'text-text-muted hover:text-text-secondary'
                }`}
              >
                {tab === 'ideas' ? '成果库' : tab === 'sources' ? '素材池' : tab === 'text' ? '便签' : '推荐'}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto p-3">
            {activeTab === 'ideas' && (
              <div className="space-y-2">
                {ideasData?.items.map((idea) => (
                  <button
                    key={idea.id}
                    onClick={() => addIdeaNode(idea)}
                    className="w-full text-left p-3 rounded-xl bg-white/[0.02] border border-white/[0.06] hover:border-white/[0.12] transition-all"
                  >
                    <div className="flex items-center gap-1.5 mb-1">
                      <BookOpen className="w-3.5 h-3.5 text-fusion-primary" />
                      <span className="text-xs font-medium text-text-primary line-clamp-1">{idea.title}</span>
                    </div>
                    <p className="text-xs text-text-secondary line-clamp-2">{idea.summary || '暂无摘要'}</p>
                  </button>
                ))}
                {(!ideasData?.items || ideasData.items.length === 0) && (
                  <p className="text-xs text-text-muted text-center py-6">成果库为空</p>
                )}
                {ideasData && ideasData.total > ideasData.items.length && (
                  ideaLimit < 1000 ? (
                    <button
                      onClick={() => setIdeaLimit((l) => Math.min(l + 200, 1000))}
                      className="w-full py-2 rounded-xl border border-white/[0.08] text-xs text-text-muted hover:text-text-primary hover:border-white/[0.15] transition-colors"
                    >
                      加载更多（已显示 {ideasData.items.length} / 共 {ideasData.total}）
                    </button>
                  ) : (
                    <p className="text-xs text-text-muted text-center py-2">已达上限，请到成果库页筛选查看</p>
                  )
                )}
              </div>
            )}

            {activeTab === 'sources' && (
              <div className="space-y-2">
                {sourcesData?.items.map((source) => (
                  <button
                    key={source.id}
                    onClick={() => addSourceNode(source)}
                    className="w-full text-left p-3 rounded-xl bg-white/[0.02] border border-white/[0.06] hover:border-white/[0.12] transition-all"
                  >
                    <div className="flex items-center gap-1.5 mb-1">
                      <Database className="w-3.5 h-3.5 text-info" />
                      <span className="text-xs font-medium text-text-primary line-clamp-1">{source.title}</span>
                    </div>
                    <p className="text-xs text-text-secondary line-clamp-2">{source.excerpt || '暂无摘要'}</p>
                  </button>
                ))}
                {(!sourcesData?.items || sourcesData.items.length === 0) && (
                  <p className="text-xs text-text-muted text-center py-6">素材池为空</p>
                )}
                {sourcesData && sourcesData.total > sourcesData.items.length && (
                  sourceLimit < 1000 ? (
                    <button
                      onClick={() => setSourceLimit((l) => Math.min(l + 200, 1000))}
                      className="w-full py-2 rounded-xl border border-white/[0.08] text-xs text-text-muted hover:text-text-primary hover:border-white/[0.15] transition-colors"
                    >
                      加载更多（已显示 {sourcesData.items.length} / 共 {sourcesData.total}）
                    </button>
                  ) : (
                    <p className="text-xs text-text-muted text-center py-2">已达上限，请到素材池页搜索或筛选</p>
                  )
                )}
              </div>
            )}

            {activeTab === 'text' && (
              <div className="space-y-3">
                <textarea
                  value={textInput}
                  onChange={(e) => setTextInput(e.target.value)}
                  placeholder="输入便签内容..."
                  className="w-full h-24 bg-bg-tertiary border border-white/[0.08] rounded-xl p-3 text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-info/50 resize-none"
                />
                <button
                  onClick={addTextNode}
                  disabled={!textInput.trim()}
                  className="w-full btn-primary text-xs py-2 flex items-center justify-center gap-1 disabled:opacity-60"
                >
                  <Plus className="w-3.5 h-3.5" />
                  添加便签
                </button>
              </div>
            )}

            {activeTab === 'recommend' && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-xs text-text-muted">
                  <Wand2 className="w-3.5 h-3.5 text-fusion-primary" />
                  根据画布内容推荐相关素材
                </div>
                {recommendations.length === 0 ? (
                  <p className="text-xs text-text-muted text-center py-6">暂无推荐，先在画布添加一些节点吧</p>
                ) : (
                  <div className="space-y-2">
                    {recommendations.map(({ item, type }, idx) => (
                      <div
                        key={`${type}-${item.id}-${idx}`}
                        className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.06] hover:border-white/[0.12] transition-all"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-1.5 min-w-0">
                            {type === 'idea' ? (
                              <Lightbulb className="w-3.5 h-3.5 text-fusion-primary flex-shrink-0" />
                            ) : (
                              <Database className="w-3.5 h-3.5 text-info flex-shrink-0" />
                            )}
                            <span className="text-xs font-medium text-text-primary line-clamp-1">
                              {(item as Idea).title || (item as EmergenceSource).title}
                            </span>
                          </div>
                          <button
                            onClick={() => addRecommendedItem(item, type)}
                            className="p-1 rounded hover:bg-white/[0.08] text-text-muted hover:text-text-secondary flex-shrink-0"
                            title="添加到画布"
                          >
                            <Plus className="w-3 h-3" />
                          </button>
                        </div>
                        <p className="text-xs text-text-secondary line-clamp-2 mt-1">
                          {(item as Idea).summary || (item as EmergenceSource).excerpt || '暂无摘要'}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="p-3 border-t border-white/[0.06] text-xs text-text-muted">
            已选 {selectedIds.length} 个节点
            {selectedIds.length >= 2 && !canvasId && (
              <span className="block mt-1 text-warning">保存画布后才能组合创意</span>
            )}
          </div>
        </div>
      </div>

      {/* Edit node modal */}
      <AnimatePresence>
        {editingNodeId && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
            onClick={() => setEditingNodeId(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md bg-bg-secondary border border-border-color rounded-2xl p-5"
            >
              <h3 className="text-sm font-bold text-text-primary mb-3">编辑节点</h3>
              <input
                type="text"
                value={editLabel}
                onChange={(e) => setEditLabel(e.target.value)}
                className="input w-full mb-4"
                autoFocus
              />

              <div className="mb-4">
                <label className="block text-xs text-text-muted mb-2">脑侧</label>
                <div className="flex items-center gap-2">
                  {(['personal', 'network', 'both'] as const).map((side) => (
                    <button
                      key={side}
                      onClick={() => setEditBrainSide(side)}
                      className={`flex-1 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                        editBrainSide === side
                          ? 'bg-info/10 border-info text-info'
                          : 'border-white/[0.08] text-text-muted hover:text-text-secondary'
                      }`}
                    >
                      {BRAIN_SIDE_LABEL[side]}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mb-4">
                <label className="block text-xs text-text-muted mb-2">节点颜色</label>
                <div className="flex flex-wrap gap-2">
                  {NODE_COLOR_PRESETS.map((preset) => (
                    <button
                      key={preset.value}
                      onClick={() => setEditColor(preset.value)}
                      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs border transition-all ${
                        editColor === preset.value
                          ? 'border-info bg-info/10 text-text-primary'
                          : 'border-white/[0.08] text-text-muted hover:text-text-secondary'
                      }`}
                    >
                      {preset.value && (
                        <span
                          className="w-3 h-3 rounded-full border border-white/20"
                          style={{ backgroundColor: preset.value }}
                        />
                      )}
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <button onClick={() => setEditingNodeId(null)} className="btn-secondary text-xs py-2 px-4">
                  取消
                </button>
                <button onClick={saveEditNode} className="btn-primary text-xs py-2 px-4 flex items-center gap-1">
                  <Check className="w-3.5 h-3.5" />
                  保存
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Combine modal */}
      <AnimatePresence>
        {combineOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
            onClick={() => setCombineOpen(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-lg bg-bg-secondary border border-border-color rounded-2xl p-5"
            >
              <h3 className="text-sm font-bold text-text-primary mb-4 flex items-center gap-2">
                <GitMerge className="w-4 h-4 text-fusion-primary" />
                组合为新创意
              </h3>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs text-text-muted mb-1.5">标题</label>
                  <input
                    type="text"
                    value={combineTitle}
                    onChange={(e) => setCombineTitle(e.target.value)}
                    className="input w-full"
                    placeholder="给组合创意起个名字..."
                  />
                </div>
                <div>
                  <label className="block text-xs text-text-muted mb-1.5">摘要</label>
                  <textarea
                    value={combineSummary}
                    onChange={(e) => setCombineSummary(e.target.value)}
                    className="w-full h-24 bg-bg-tertiary border border-white/[0.08] rounded-xl p-3 text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-info/50 resize-none"
                    placeholder="组合后的摘要..."
                  />
                </div>
                <div>
                  <label className="block text-xs text-text-muted mb-1.5">标签</label>
                  <input
                    type="text"
                    value={combineTags}
                    onChange={(e) => setCombineTags(e.target.value)}
                    className="input w-full"
                    placeholder="用逗号分隔..."
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 mt-5">
                <button onClick={() => setCombineOpen(false)} className="btn-secondary text-xs py-2 px-4">
                  取消
                </button>
                <button
                  onClick={submitCombine}
                  disabled={!combineTitle.trim() || combineMutation.isPending}
                  className="btn-primary text-xs py-2 px-4 flex items-center gap-1 disabled:opacity-60"
                >
                  {combineMutation.isPending ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <GitMerge className="w-3.5 h-3.5" />
                  )}
                  生成创意
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Report modal */}
      <AnimatePresence>
        {reportOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
            onClick={() => { setReportOpen(false); setReportResult(null); }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-3xl bg-bg-secondary border border-border-color rounded-2xl p-5 max-h-[85vh] flex flex-col"
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-bold text-text-primary flex items-center gap-2">
                  <FileText className="w-4 h-4 text-fusion-primary" />
                  画布报告
                </h3>
                <button onClick={() => { setReportOpen(false); setReportResult(null); }} className="p-1.5 rounded hover:bg-white/[0.08] text-text-muted">
                  <X className="w-4 h-4" />
                </button>
              </div>

              {!reportResult ? (
                <>
                  <div className="mb-4">
                    <label className="block text-xs text-text-muted mb-2">报告类型</label>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                      {([
                        { id: 'proposal', label: '创新提案' },
                        { id: 'summary', label: '精炼摘要' },
                        { id: 'story', label: '叙事脚本' },
                        { id: 'mindmap', label: '思维导图' },
                      ] as const).map((fmt) => (
                        <button
                          key={fmt.id}
                          onClick={() => setReportFormat(fmt.id)}
                          className={`py-2 rounded-lg text-xs font-medium border transition-all ${
                            reportFormat === fmt.id
                              ? 'bg-info/10 border-info text-info'
                              : 'border-white/[0.08] text-text-muted hover:text-text-secondary'
                          }`}
                        >
                          {fmt.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {selectedIds.length > 0 && (
                    <p className="text-xs text-text-muted mb-4">
                      已选中 {selectedIds.length} 个节点，报告将聚焦这些节点。
                    </p>
                  )}

                  <div className="mb-4 p-3 rounded-xl bg-white/[0.02] border border-white/[0.06] space-y-3">
                    <ModelSelector
                      value={reportModelId}
                      onChange={setReportModelId}
                      taskType="creative"
                      className="w-full md:w-64"
                    />
                    <LLMCostBadge
                      modelId={reportModelId}
                      inputText={[
                        title,
                        description,
                        '节点：',
                        ...nodes.map((n) => `- ${n.label}${n.content ? `：${n.content}` : ''}`),
                        ...(selectedIds.length ? [`聚焦节点：${selectedIds.map((id) => nodeById.get(id)?.label).filter(Boolean).join('、')}`] : []),
                      ].join('\n')}
                      outputTokenEstimate={800}
                    />
                  </div>

                  <AiErrorNotice error={reportMutation.error} className="mb-4" />

                  <div className="flex justify-end gap-2 mt-2">
                    <button
                      onClick={() => { setReportOpen(false); setReportResult(null); }}
                      className="btn-secondary text-xs py-2 px-4"
                    >
                      取消
                    </button>
                    <button
                      onClick={generateReport}
                      disabled={reportMutation.isPending}
                      className="btn-primary text-xs py-2 px-4 flex items-center gap-1 disabled:opacity-60"
                    >
                      {reportMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                      生成报告
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex-1 overflow-y-auto mb-4 pr-1">
                    <h4 className="text-base font-bold text-text-primary mb-3">{reportResult.title}</h4>
                    <div className="prose prose-invert prose-sm max-w-none">
                      {reportResult.content.split('\n').map((line, i) => {
                        if (line.startsWith('# ')) return <h1 key={i} className="text-xl font-bold mt-4 mb-2">{line.slice(2)}</h1>;
                        if (line.startsWith('## ')) return <h2 key={i} className="text-lg font-bold mt-3 mb-2">{line.slice(3)}</h2>;
                        if (line.startsWith('- ')) return <li key={i} className="ml-4">{line.slice(2)}</li>;
                        if (line.match(/^\d+\. /)) return <li key={i} className="ml-4 list-decimal">{line.replace(/^\d+\. /, '')}</li>;
                        if (line.trim() === '') return <div key={i} className="h-2" />;
                        return <p key={i} className="text-sm text-text-secondary leading-relaxed">{line}</p>;
                      })}
                    </div>
                  </div>
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => setReportResult(null)}
                      className="btn-secondary text-xs py-2 px-4"
                    >
                      重新生成
                    </button>
                    <button
                      onClick={() => { setReportOpen(false); setReportResult(null); }}
                      className="btn-primary text-xs py-2 px-4"
                    >
                      关闭
                    </button>
                  </div>
                </>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
};

const CanvasPage: FC = () => {
  const askConfirm = useConfirm();
  const [view, setView] = useState<'list' | 'editor'>('list');
  const [editingCanvasId, setEditingCanvasId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const { data, isLoading } = useQuery({
    queryKey: ['emergence', 'canvases'],
    queryFn: async () => {
      const response = await emergenceApi.getCanvases(0, 50);
      return response.data;
    },
  });

  const createMutation = useMutation({
    mutationFn: emergenceApi.createCanvas,
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ['emergence', 'canvases'] });
      setEditingCanvasId(response.data.id);
      setView('editor');
      setCreating(false);
      setNewTitle('');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: emergenceApi.deleteCanvas,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['emergence', 'canvases'] }),
  });

  const handleCreate = () => {
    if (!newTitle.trim()) return;
    createMutation.mutate({ title: newTitle.trim() });
  };

  const handleDelete = async (id: string) => {
    if (!(await askConfirm('确定要删除这个画布吗？'))) return;
    deleteMutation.mutate(id);
  };

  const openEditor = (id: string) => {
    setEditingCanvasId(id);
    setView('editor');
  };

  const backToList = () => {
    setView('list');
    setEditingCanvasId(null);
  };

  if (view === 'editor') {
    return (
      <CanvasEditor
        canvasId={editingCanvasId}
        onBack={backToList}
        onCanvasCreated={(id) => setEditingCanvasId(id)}
      />
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/emergence')}
            className="p-2 rounded-lg hover:bg-white/[0.06] text-text-secondary hover:text-text-primary transition-colors"
            title="返回涌现工作室"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2">
            <Network className="w-6 h-6 text-fusion-primary" />
            <h1 className="text-2xl font-bold text-text-primary">涌现画布</h1>
          </div>
        </div>
        {!creating && (
          <button
            onClick={() => setCreating(true)}
            className="btn-primary flex items-center gap-2 text-xs py-2 px-4"
          >
            <Plus className="w-3.5 h-3.5" />
            新建画布
          </button>
        )}
      </div>

      <p className="text-sm text-text-secondary">
        将成果库中的创意、素材池中的来源以及临时便签拖拽组合，发现新的连接与涌现。
      </p>

      {/* Create form */}
      <AnimatePresence>
        {creating && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="glass-card p-4"
          >
            <div className="flex items-center gap-3">
              <input
                type="text"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="画布名称..."
                className="input flex-1"
                autoFocus
                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              />
              <button
                onClick={handleCreate}
                disabled={!newTitle.trim() || createMutation.isPending}
                className="btn-primary text-xs py-2 px-4 disabled:opacity-60"
              >
                {createMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : '创建'}
              </button>
              <button
                onClick={() => { setCreating(false); setNewTitle(''); }}
                className="btn-secondary text-xs py-2 px-4"
              >
                取消
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Canvas list */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-8 h-8 text-info animate-spin" />
        </div>
      ) : !data?.items || data.items.length === 0 ? (
        <div className="glass-card flex flex-col items-center justify-center py-16">
          <Network className="w-16 h-16 text-text-muted mb-4" />
          <p className="text-text-secondary mb-1">还没有画布</p>
          <p className="text-xs text-text-muted">点击右上角新建画布，开始组合创意</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {data.items.map((canvas) => (
            <motion.div
              key={canvas.id}
              whileHover={{ y: -2 }}
              className="glass-card p-5 cursor-pointer group relative"
              onClick={() => openEditor(canvas.id)}
            >
              <div className="flex items-start justify-between gap-2 mb-3">
                <div className="flex items-center gap-2">
                  <Network className="w-5 h-5 text-fusion-primary" />
                  <h3 className="text-sm font-bold text-text-primary line-clamp-1">{canvas.title}</h3>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDelete(canvas.id); }}
                  disabled={deleteMutation.isPending}
                  className="p-1.5 rounded-lg hover:bg-danger/10 text-text-muted hover:text-danger opacity-0 group-hover:opacity-100 transition-all disabled:opacity-50"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>

              {canvas.description && (
                <p className="text-xs text-text-secondary line-clamp-2 mb-3">{canvas.description}</p>
              )}

              <div className="flex items-center gap-3 text-xs text-text-muted mb-3">
                <span className="flex items-center gap-1">
                  <LayoutGrid className="w-3 h-3" />
                  {canvas.node_count} 节点
                </span>
                <span className="flex items-center gap-1">
                  <GitBranch className="w-3 h-3" />
                  {canvas.edge_count} 连线
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-[10px] text-text-muted flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {new Date(canvas.updated_at).toLocaleDateString('zh-CN')}
                </span>
                <ChevronRight className="w-4 h-4 text-text-muted" />
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
};

export default CanvasPage;
