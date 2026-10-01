import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { graphifyApi } from '@/api/graphify';

// 构建中（exporting/building）默认每 3s 轮询一次状态，也可通过参数覆盖
export const useGraphifyStatus = (refetchInterval?: number | false) => {
  return useQuery({
    queryKey: ['graphify-status'],
    queryFn: async () => {
      const response = await graphifyApi.getStatus();
      return response.data;
    },
    refetchInterval: refetchInterval ?? ((query) => {
      const s = query.state.data;
      return s && (s.state === 'exporting' || s.state === 'building') ? 3000 : false;
    }),
  });
};

export const useGraphifyGraph = (enabled = true, includeQuarantined = false) => {
  return useQuery({
    // 血泪#20：可变参数必须进缓存键，否则换参即拿旧缓存
    queryKey: ['graphify-graph', includeQuarantined ? 'with-quarantined' : 'main'],
    queryFn: async () => {
      const response = await graphifyApi.getGraph(includeQuarantined);
      return response.data;
    },
    staleTime: 60 * 1000,
    retry: false, // 未构建时后端返回 404，无需重试
    enabled,
  });
};

// 物理图（相似度图）：零 LLM、随时可取，未构建语义图也能看
export const usePhysicalGraph = (enabled = true) => {
  return useQuery({
    queryKey: ['graphify-physical-graph'],
    queryFn: async () => {
      const response = await graphifyApi.getPhysicalGraph();
      return response.data;
    },
    staleTime: 60 * 1000,
    retry: false,
    enabled,
  });
};

export const useGraphifyBuild = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (preferred_model?: string) => {
      const response = await graphifyApi.build(preferred_model);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['graphify-status'] });
      queryClient.invalidateQueries({ queryKey: ['graphify-graph'] });
    },
  });
};

export const useGraphifyQuery = () => {
  return useMutation({
    mutationFn: async ({ question, preferred_model }: { question: string; preferred_model?: string }) => {
      const response = await graphifyApi.query(question, preferred_model);
      return response.data;
    },
  });
};

export const useGraphifyPath = () => {
  return useMutation({
    mutationFn: async ({ a, b }: { a: string; b: string }) => {
      const response = await graphifyApi.path(a, b);
      return response.data;
    },
  });
};

export const useGraphifyExplain = () => {
  return useMutation({
    mutationFn: async (node: string) => {
      const response = await graphifyApi.explain(node);
      return response.data;
    },
  });
};

export const useGraphifyReport = (enabled = true) => {
  return useQuery({
    queryKey: ['graphify-report'],
    queryFn: async () => {
      const response = await graphifyApi.getReport();
      return response.data;
    },
    staleTime: 60 * 1000,
    retry: false, // 未构建时后端返回 404，无需重试
    enabled,
  });
};
