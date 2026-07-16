import api from './client';

export interface CommunityPostUser {
  id: string;
  name: string | null;
  display_name: string | null;
}

export interface CommunityPost {
  id: string;
  user_id: string;
  content: string;
  is_spam: boolean;
  created_at: string;
  updated_at: string;
  user: CommunityPostUser;
}

export interface CommunityPostList {
  total: number;
  posts: CommunityPost[];
}

export const communityApi = {
  getPosts: (skip = 0, limit = 20) =>
    api.get<CommunityPostList>('/api/v1/community/', { params: { skip, limit } }),
  createPost: (content: string) =>
    api.post<CommunityPost>('/api/v1/community/', { content }),
  deletePost: (postId: string) =>
    api.delete(`/api/v1/community/${postId}`),
};
