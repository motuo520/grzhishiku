import { FC, useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft, Plus, Globe, User, AlertCircle, CheckCircle2,
  FileText, Link, Tag
} from 'lucide-react';
import { knowledgeApi } from '@/api/knowledge';

const KnowledgeCreatePage: FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const defaultBrainSide = (location.state as { brainSide?: 'personal' | 'network' } | null)?.brainSide || 'network';
  const [content, setContent] = useState('');
  const [brainSide, setBrainSide] = useState<'personal' | 'network'>(defaultBrainSide);
  const [contentType, setContentType] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [sourceTitle, setSourceTitle] = useState('');
  const [sourceAuthor, setSourceAuthor] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    const fromState = (location.state as { brainSide?: 'personal' | 'network' } | null)?.brainSide;
    if (fromState) setBrainSide(fromState);
  }, [location.state]);

  const handleSubmit = async () => {
    if (!content.trim()) {
      setErrorMsg('请输入知识内容');
      return;
    }
    setIsSubmitting(true);
    setErrorMsg(null);
    try {
      await knowledgeApi.create({
        content_raw: content,
        brain_side: brainSide,
        content_type: contentType || undefined,
        source_url: sourceUrl || undefined,
        source_title: sourceTitle || undefined,
        source_author: sourceAuthor || undefined,
      });
      await queryClient.invalidateQueries({ queryKey: ['knowledge'], refetchType: 'all' });
      setSuccessMsg('知识单元已创建');
      setTimeout(() => navigate(`/knowledge/${brainSide}`), 1000);
    } catch (err: any) {
      setErrorMsg(err?.response?.data?.detail || '创建失败');
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate(-1)}
          className="p-2 bg-white/[0.03] border border-white/[0.08] rounded-lg text-text-secondary hover:text-text-primary hover:bg-white/[0.06] transition-all"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <h1 className="text-2xl font-bold text-text-primary">新增知识</h1>
      </div>

      <AnimatePresence>
        {errorMsg && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-danger/10 border border-danger/20 text-danger text-sm">
            <AlertCircle className="w-4 h-4" /> {errorMsg}
          </motion.div>
        )}
        {successMsg && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-success/10 border border-success/20 text-success text-sm">
            <CheckCircle2 className="w-4 h-4" /> {successMsg}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="glass-card p-5 space-y-5">
        <div>
          <label className="text-xs text-text-secondary mb-2 block">所属脑侧</label>
          <div className="flex gap-2">
            <button
              onClick={() => setBrainSide('network')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium border transition-all ${
                brainSide === 'network'
                  ? 'bg-info/15 text-info border-info/30'
                  : 'bg-white/[0.03] text-text-secondary border-white/[0.06]'
              }`}
            >
              <Globe className="w-3.5 h-3.5" /> 网络脑
            </button>
            <button
              onClick={() => setBrainSide('personal')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium border transition-all ${
                brainSide === 'personal'
                  ? 'bg-personal-primary/15 text-personal-primary border-personal-primary/30'
                  : 'bg-white/[0.03] text-text-secondary border-white/[0.06]'
              }`}
            >
              <User className="w-3.5 h-3.5" /> 个人脑
            </button>
          </div>
        </div>

        <div>
          <label className="text-xs text-text-secondary mb-2 block flex items-center gap-1">
            <FileText className="w-3 h-3" /> 知识内容 *
          </label>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={6}
            placeholder="输入需要保存或验证的知识内容..."
            className="w-full bg-white/[0.03] border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-info/40 transition-colors resize-none"
          />
        </div>

        <div>
          <label className="text-xs text-text-secondary mb-2 block flex items-center gap-1">
            <Tag className="w-3 h-3" /> 内容类型
          </label>
          <input
            type="text"
            value={contentType}
            onChange={(e) => setContentType(e.target.value)}
            placeholder="例如：article、note、claim"
            className="w-full bg-white/[0.03] border border-white/[0.08] rounded-xl px-4 py-2 text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-info/40 transition-colors"
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-text-secondary mb-2 block flex items-center gap-1">
              <Link className="w-3 h-3" /> 来源 URL
            </label>
            <input
              type="text"
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              placeholder="https://..."
              className="w-full bg-white/[0.03] border border-white/[0.08] rounded-xl px-4 py-2 text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-info/40 transition-colors"
            />
          </div>
          <div>
            <label className="text-xs text-text-secondary mb-2 block">来源标题</label>
            <input
              type="text"
              value={sourceTitle}
              onChange={(e) => setSourceTitle(e.target.value)}
              placeholder="文章或书籍标题"
              className="w-full bg-white/[0.03] border border-white/[0.08] rounded-xl px-4 py-2 text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-info/40 transition-colors"
            />
          </div>
        </div>

        <div>
          <label className="text-xs text-text-secondary mb-2 block">作者</label>
          <input
            type="text"
            value={sourceAuthor}
            onChange={(e) => setSourceAuthor(e.target.value)}
            placeholder="来源作者"
            className="w-full bg-white/[0.03] border border-white/[0.08] rounded-xl px-4 py-2 text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-info/40 transition-colors"
          />
        </div>

        <button
          onClick={handleSubmit}
          disabled={isSubmitting}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-gradient-to-r from-info to-network-secondary text-white rounded-xl text-sm font-medium hover:shadow-[0_0_20px_rgba(88,166,255,0.4)] transition-all disabled:opacity-60"
        >
          {isSubmitting ? (
            <>
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> 创建中...
            </>
          ) : (
            <>
              <Plus className="w-4 h-4" /> 创建知识单元
            </>
          )}
        </button>
      </div>
    </div>
  );
};

export default KnowledgeCreatePage;
