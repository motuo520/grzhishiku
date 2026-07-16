import { useQuery } from '@tanstack/react-query';
import { graphApi } from '@/api/graph';

export const useGraphBridges = (limit = 50) => {
  return useQuery({
    queryKey: ['graph-bridges', limit],
    queryFn: async () => {
      const response = await graphApi.getBridges(limit);
      return response.data;
    },
    staleTime: 60 * 1000,
  });
};

export const useGraphTagNetwork = (minCooccurrence = 1) => {
  return useQuery({
    queryKey: ['graph-tag-network', minCooccurrence],
    queryFn: async () => {
      const response = await graphApi.getTagNetwork(minCooccurrence);
      return response.data;
    },
    staleTime: 60 * 1000,
  });
};

export const useGraphNodes = () => {
  return useQuery({
    queryKey: ['graph-nodes'],
    queryFn: async () => {
      const response = await graphApi.getNodes();
      return response.data;
    },
    staleTime: 60 * 1000,
  });
};
