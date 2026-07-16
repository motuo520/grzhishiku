import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { emergenceApi } from '@/api/emergence';
import type {
  AssociateRequest,
  CollisionRequest,
  HybridRequest,
  CounterfactualRequest,
  SaveIdeaRequest,
  PromoteIdeaRequest,
  CanvasCreateRequest,
  CanvasUpdateRequest,
  CanvasCombineRequest,
  CanvasReportRequest,
  CanvasToNoteRequest,
  BrainSide,
} from '@/api/emergence';

const EMERGENCE_QUERY_KEY = ['emergence'];

export const useEmergence = (options?: { brainSide?: BrainSide | 'all'; typeFilter?: string }) => {
  const queryClient = useQueryClient();
  const { brainSide, typeFilter } = options ?? {};

  // ─────────────────────────── 涌现工具调用 ───────────────────────────
  const associateMutation = useMutation({
    mutationFn: (data: AssociateRequest) => emergenceApi.associate(data).then((res) => res.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...EMERGENCE_QUERY_KEY, 'history'] });
    },
  });

  const collisionMutation = useMutation({
    mutationFn: (data: CollisionRequest) => emergenceApi.collision(data).then((res) => res.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...EMERGENCE_QUERY_KEY, 'history'] });
    },
  });

  const hybridMutation = useMutation({
    mutationFn: (data: HybridRequest) => emergenceApi.hybrid(data).then((res) => res.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...EMERGENCE_QUERY_KEY, 'history'] });
    },
  });

  const counterfactualMutation = useMutation({
    mutationFn: (data: CounterfactualRequest) =>
      emergenceApi.counterfactual(data).then((res) => res.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...EMERGENCE_QUERY_KEY, 'history'] });
    },
  });

  // ─────────────────────────── 查询 ───────────────────────────
  const { data: sources, isLoading: isLoadingSources } = useQuery({
    queryKey: [...EMERGENCE_QUERY_KEY, 'sources', brainSide],
    queryFn: async () => {
      const response = await emergenceApi.getSources(brainSide);
      return response.data;
    },
  });

  const { data: history, isLoading: isLoadingHistory } = useQuery({
    queryKey: [...EMERGENCE_QUERY_KEY, 'history', typeFilter],
    queryFn: async () => {
      const response = await emergenceApi.history(typeFilter, 0, 50);
      return response.data;
    },
  });

  const { data: ideas, isLoading: isLoadingIdeas } = useQuery({
    queryKey: [...EMERGENCE_QUERY_KEY, 'ideas', brainSide],
    queryFn: async () => {
      const response = await emergenceApi.getIdeas(undefined, brainSide, 0, 50);
      return response.data;
    },
  });

  const { data: canvases, isLoading: isLoadingCanvases } = useQuery({
    queryKey: [...EMERGENCE_QUERY_KEY, 'canvases'],
    queryFn: async () => {
      const response = await emergenceApi.getCanvases(0, 50);
      return response.data;
    },
  });

  // ─────────────────────────── 历史/成果变更 ───────────────────────────
  const deleteEmergenceMutation = useMutation({
    mutationFn: (id: string) => emergenceApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...EMERGENCE_QUERY_KEY, 'history'] });
    },
  });

  const saveIdeaMutation = useMutation({
    mutationFn: (data: SaveIdeaRequest) => emergenceApi.saveIdea(data).then((res) => res.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...EMERGENCE_QUERY_KEY, 'ideas'] });
      queryClient.invalidateQueries({ queryKey: [...EMERGENCE_QUERY_KEY, 'history'] });
    },
  });

  const promoteIdeaMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: PromoteIdeaRequest }) =>
      emergenceApi.promoteIdea(id, data).then((res) => res.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...EMERGENCE_QUERY_KEY, 'ideas'] });
    },
  });

  const deleteIdeaMutation = useMutation({
    mutationFn: (id: string) => emergenceApi.deleteIdea(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...EMERGENCE_QUERY_KEY, 'ideas'] });
    },
  });

  // ─────────────────────────── 画布 ───────────────────────────
  const createCanvasMutation = useMutation({
    mutationFn: (data: CanvasCreateRequest) =>
      emergenceApi.createCanvas(data).then((res) => res.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...EMERGENCE_QUERY_KEY, 'canvases'] });
    },
  });

  const updateCanvasMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: CanvasUpdateRequest }) =>
      emergenceApi.updateCanvas(id, data).then((res) => res.data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: [...EMERGENCE_QUERY_KEY, 'canvases'] });
      queryClient.invalidateQueries({ queryKey: [...EMERGENCE_QUERY_KEY, 'canvas', variables.id] });
    },
  });

  const deleteCanvasMutation = useMutation({
    mutationFn: (id: string) => emergenceApi.deleteCanvas(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...EMERGENCE_QUERY_KEY, 'canvases'] });
    },
  });

  const combineNodesMutation = useMutation({
    mutationFn: ({ canvasId, data }: { canvasId: string; data: CanvasCombineRequest }) =>
      emergenceApi.combineCanvasNodes(canvasId, data).then((res) => res.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...EMERGENCE_QUERY_KEY, 'canvases'] });
      queryClient.invalidateQueries({ queryKey: [...EMERGENCE_QUERY_KEY, 'ideas'] });
    },
  });

  const generateCanvasReportMutation = useMutation({
    mutationFn: ({ canvasId, data }: { canvasId: string; data: CanvasReportRequest }) =>
      emergenceApi.generateCanvasReport(canvasId, data).then((res) => res.data),
  });

  const convertCanvasToNoteMutation = useMutation({
    mutationFn: ({ canvasId, data }: { canvasId: string; data: CanvasToNoteRequest }) =>
      emergenceApi.convertCanvasToNote(canvasId, data).then((res) => res.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notes'] });
    },
  });

  return {
    // Queries
    sources,
    history,
    ideas,
    canvases,
    isLoadingSources,
    isLoadingHistory,
    isLoadingIdeas,
    isLoadingCanvases,

    // Tool mutations
    associate: associateMutation.mutateAsync,
    collide: collisionMutation.mutateAsync,
    hybrid: hybridMutation.mutateAsync,
    counterfactual: counterfactualMutation.mutateAsync,
    isAssociating: associateMutation.isPending,
    isColliding: collisionMutation.isPending,
    isHybridizing: hybridMutation.isPending,
    isRunningCounterfactual: counterfactualMutation.isPending,

    // History / ideas
    deleteEmergence: deleteEmergenceMutation.mutateAsync,
    saveIdea: saveIdeaMutation.mutateAsync,
    promoteIdea: promoteIdeaMutation.mutateAsync,
    deleteIdea: deleteIdeaMutation.mutateAsync,
    isSavingIdea: saveIdeaMutation.isPending,
    isPromotingIdea: promoteIdeaMutation.isPending,

    // Canvas
    createCanvas: createCanvasMutation.mutateAsync,
    updateCanvas: updateCanvasMutation.mutateAsync,
    deleteCanvas: deleteCanvasMutation.mutateAsync,
    combineNodes: combineNodesMutation.mutateAsync,
    generateCanvasReport: generateCanvasReportMutation.mutateAsync,
    convertCanvasToNote: convertCanvasToNoteMutation.mutateAsync,
    isCreatingCanvas: createCanvasMutation.isPending,
    isUpdatingCanvas: updateCanvasMutation.isPending,
  };
};

export default useEmergence;
