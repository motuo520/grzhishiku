import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { foldersApi, FolderCreateData, FolderUpdateData } from '@/api/folders';
import { invalidateContentQueries } from '@/utils/invalidateContent';

// 文件夹必属一个脑（personal / network）；brainSide='both' 时两脑各拉一棵
export const useFolders = (brainSide: string) => {
  const queryClient = useQueryClient();

  const { data: personalFolders, isLoading: isPersonalLoading } = useQuery({
    queryKey: ['folders', 'personal'],
    queryFn: async () => (await foldersApi.list('personal')).data,
    enabled: brainSide === 'personal' || brainSide === 'both',
    staleTime: 60 * 1000,
  });

  const { data: networkFolders, isLoading: isNetworkLoading } = useQuery({
    queryKey: ['folders', 'network'],
    queryFn: async () => (await foldersApi.list('network')).data,
    enabled: brainSide === 'network' || brainSide === 'both',
    staleTime: 60 * 1000,
  });

  // 文件夹变更会影响笔记的 folder_id 与夹内计数，统一走内容失效
  const invalidate = () => invalidateContentQueries(queryClient);

  const createMutation = useMutation({
    mutationFn: (data: FolderCreateData) => foldersApi.create(data),
    onSuccess: invalidate,
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: FolderUpdateData }) => foldersApi.update(id, data),
    onSuccess: invalidate,
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => foldersApi.remove(id),
    onSuccess: invalidate,
  });

  return {
    personalFolders,
    networkFolders,
    isLoading: isPersonalLoading || isNetworkLoading,
    createFolder: createMutation.mutateAsync,
    updateFolder: updateMutation.mutateAsync,
    removeFolder: removeMutation.mutateAsync,
  };
};
