import { FC, useState } from 'react';
import { MessageSquare, Send, Trash2, Loader2 } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useCommunityPosts, useCreateCommunityPost, useDeleteCommunityPost } from '@/hooks/useCommunity';
import { formatDistanceToNow } from '@/utils/date';

const MAX_LENGTH = 1000;

const CommunityPage: FC = () => {
  const { isLoggedIn, user } = useAuth();
  const [content, setContent] = useState('');
  const { data, isLoading, error } = useCommunityPosts();
  const createPost = useCreateCommunityPost();
  const deletePost = useDeleteCommunityPost();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = content.trim();
    if (!text || createPost.isPending) return;
    try {
      await createPost.mutateAsync(text);
      setContent('');
    } catch (err: any) {
      // error shown by mutation error state
    }
  };

  const handleDelete = (postId: string) => {
    if (!confirm('确定要删除这条发言吗？')) return;
    deletePost.mutate(postId);
  };

  const posts = data?.posts ?? [];

  return (
    <div className="min-h-[calc(100vh-64px)] bg-bg-primary p-4 sm:p-6 overflow-y-auto">
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-info/15 flex items-center justify-center">
            <MessageSquare className="w-5 h-5 text-info" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-text-primary">社区</h1>
            <p className="text-xs text-text-secondary">登录后可以发言，垃圾内容会被自动屏蔽</p>
          </div>
        </div>

        {/* Compose */}
        {isLoggedIn ? (
          <form onSubmit={handleSubmit} className="glass-card rounded-xl p-4 space-y-3">
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value.slice(0, MAX_LENGTH))}
              placeholder="分享你的想法、问题或灵感..."
              rows={3}
              className="w-full bg-bg-secondary border border-border-color rounded-xl p-3 text-sm text-text-primary placeholder-text-muted outline-none resize-none focus:border-info/40 transition-colors"
            />
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-text-muted">
                {content.length}/{MAX_LENGTH}
              </span>
              <button
                type="submit"
                disabled={!content.trim() || createPost.isPending}
                className="btn-primary flex items-center gap-1.5 text-xs py-2 px-4 disabled:opacity-50"
              >
                {createPost.isPending ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Send className="w-3.5 h-3.5" />
                )}
                发布
              </button>
            </div>
            {createPost.error && (
              <div className="text-xs text-danger">
                {(createPost.error as any)?.message || '发布失败'}
              </div>
            )}
          </form>
        ) : (
          <div className="glass-card rounded-xl p-6 text-center">
            <p className="text-sm text-text-secondary">登录后即可参与社区讨论</p>
          </div>
        )}

        {/* Posts */}
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-info" />
          </div>
        ) : error ? (
          <div className="glass-card rounded-xl p-6 text-center text-sm text-danger">
            加载失败，请稍后重试
          </div>
        ) : posts.length === 0 ? (
          <div className="glass-card rounded-xl p-8 text-center">
            <MessageSquare className="w-8 h-8 text-text-muted mx-auto mb-3" />
            <p className="text-sm text-text-secondary">还没有发言，来做第一个发言的人吧</p>
          </div>
        ) : (
          <div className="space-y-3">
            {posts.map((post) => {
              const isMine = user?.id === post.user_id;
              const displayName = post.user.display_name || post.user.name || '匿名用户';
              return (
                <div key={post.id} className="glass-card rounded-xl p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-info/15 flex items-center justify-center text-info text-xs font-bold">
                        {displayName.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div className="text-sm font-medium text-text-primary">{displayName}</div>
                        <div className="text-[10px] text-text-muted">
                          {formatDistanceToNow(new Date(post.created_at))}
                        </div>
                      </div>
                    </div>
                    {isMine && (
                      <button
                        onClick={() => handleDelete(post.id)}
                        disabled={deletePost.isPending}
                        className="p-1.5 rounded-lg text-text-muted hover:text-danger hover:bg-danger/10 transition-colors"
                        title="删除"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                  <div className="mt-3 text-sm text-text-primary whitespace-pre-wrap break-words leading-relaxed">
                    {post.content}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default CommunityPage;
