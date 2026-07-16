import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { communityApi } from '@/api/community';

const POSTS_QUERY_KEY = ['community-posts'] as const;

export const useCommunityPosts = (skip = 0, limit = 20) => {
  return useQuery({
    queryKey: [...POSTS_QUERY_KEY, skip, limit],
    queryFn: async () => {
      const res = await communityApi.getPosts(skip, limit);
      return res.data;
    },
  });
};

export const useCreateCommunityPost = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (content: string) => communityApi.createPost(content),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: POSTS_QUERY_KEY });
    },
  });
};

export const useDeleteCommunityPost = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (postId: string) => communityApi.deletePost(postId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: POSTS_QUERY_KEY });
    },
  });
};
