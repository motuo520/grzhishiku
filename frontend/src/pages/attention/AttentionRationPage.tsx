import { FC, useState } from 'react';
import { Newspaper, Rss, MessageCircle, Mail, Plus, Trash2, Loader2 } from 'lucide-react';
import { useAttention } from '@/hooks/useAttention';
import type { AttentionRation } from '@/api/attention';

const SOURCE_ICONS: Record<string, React.ElementType> = {
  rss: Rss,
  social: MessageCircle,
  email: Mail,
  clip: Newspaper,
};

const SOURCE_LABELS: Record<string, string> = {
  rss: 'RSS 订阅',
  social: '社交聚合',
  email: '邮件集成',
  clip: '浏览器剪藏',
};

const AttentionRationPage: FC = () => {
  const { rations, createRation, updateRation, deleteRation } = useAttention();

  const [newType, setNewType] = useState<AttentionRation['source_type']>('rss');
  const [newName, setNewName] = useState('');
  const [newLimit, setNewLimit] = useState(30);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const items = rations ?? [];

  const addItem = async () => {
    if (!newName.trim()) return;
    setIsSubmitting(true);
    setError('');
    try {
      await createRation({
        source_type: newType,
        name: newName.trim(),
        daily_limit_minutes: Math.min(1440, Math.max(1, newLimit)),
      });
      setNewName('');
      setNewLimit(30);
    } catch {
      setError('添加配额失败，请重试');
    } finally {
      setIsSubmitting(false);
    }
  };

  const toggleActive = async (item: AttentionRation) => {
    try {
      await updateRation({ id: item.id, data: { active: !item.active } });
    } catch {
      setError('操作失败，请重试');
    }
  };

  const removeItem = async (id: string) => {
    try {
      await deleteRation(id);
    } catch {
      setError('删除失败，请重试');
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">信息流配给</h1>
          <p className="text-sm text-text-secondary mt-1">网络脑内容消费限额：RSS、社交、邮件等</p>
        </div>
      </div>

      <div className="card">
        <div className="flex items-center gap-2 mb-4">
          <Newspaper className="w-5 h-5 text-network-primary" />
          <h3 className="text-lg font-semibold text-text-primary">来源配额</h3>
        </div>
        <p className="text-xs text-text-muted -mt-2 mb-4">用量自动累计将在浏览器扩展接入后生效，当前用于手动维护各来源的每日限额。</p>

        <div className="space-y-3 mb-4">
          {items.map((item) => {
            const Icon = SOURCE_ICONS[item.source_type];
            const pct = Math.min(100, Math.round((item.used_minutes / item.daily_limit_minutes) * 100));
            const overLimit = item.used_minutes > item.daily_limit_minutes;
            return (
              <div key={item.id} className={`p-3 rounded-xl border ${item.active ? 'bg-white/[0.02] border-white/[0.06]' : 'bg-white/[0.01] border-white/[0.04] opacity-60'}`}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Icon className="w-4 h-4 text-text-muted" />
                    <span className="text-sm font-medium text-text-primary">{item.name}</span>
                    <span className="text-[10px] text-text-muted px-1.5 py-0.5 rounded bg-white/[0.05]">{SOURCE_LABELS[item.source_type]}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => toggleActive(item)}
                      className={`px-2 py-0.5 rounded text-[10px] font-medium border ${
                        item.active ? 'bg-success/10 text-success border-success/20' : 'bg-white/[0.03] text-text-muted border-white/[0.08]'
                      }`}
                    >
                      {item.active ? '启用' : '停用'}
                    </button>
                    <button onClick={() => removeItem(item.id)} className="p-1.5 rounded hover:bg-danger/10 text-text-muted hover:text-danger">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                <div className="flex items-center justify-between text-xs text-text-muted mb-1.5">
                  <span>{item.used_minutes} / {item.daily_limit_minutes} 分钟</span>
                  <span className={overLimit ? 'text-danger' : ''}>{pct}% {overLimit && '(已超支)'}</span>
                </div>
                <div className="h-2 bg-white/[0.05] rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${overLimit ? 'bg-danger' : 'bg-network-primary'}`}
                    style={{ width: `${Math.min(100, pct)}%` }}
                  />
                </div>
              </div>
            );
          })}
          {items.length === 0 && (
            <div className="text-sm text-text-muted py-6 text-center">暂无来源配额，添加一个来源开始控制信息流。</div>
          )}
        </div>

        {error && (
          <div className="mb-3 px-3 py-2 rounded-lg bg-danger/10 border border-danger/20 text-danger text-xs">{error}</div>
        )}
        <div className="flex flex-col md:flex-row gap-3 pt-4 border-t border-white/[0.06]">
          <select
            value={newType}
            onChange={(e) => setNewType(e.target.value as AttentionRation['source_type'])}
            className="bg-white/[0.03] border border-white/[0.08] rounded-xl px-4 py-2.5 text-sm text-text-primary focus:outline-none focus:border-info/50"
          >
            <option value="rss">RSS 订阅</option>
            <option value="social">社交聚合</option>
            <option value="email">邮件集成</option>
            <option value="clip">浏览器剪藏</option>
          </select>
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="来源名称"
            className="flex-1 bg-white/[0.03] border border-white/[0.08] rounded-xl px-4 py-2.5 text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-info/50"
          />
          <input
            type="number"
            min={5}
            value={newLimit}
            onChange={(e) => setNewLimit(parseInt(e.target.value) || 0)}
            className="w-28 bg-white/[0.03] border border-white/[0.08] rounded-xl px-4 py-2.5 text-sm text-text-primary focus:outline-none focus:border-info/50"
          />
          <button onClick={addItem} disabled={isSubmitting} className="btn-primary flex items-center gap-2">
            {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            添加
          </button>
        </div>
      </div>
    </div>
  );
};

export default AttentionRationPage;
