import { FC, useState } from 'react';
import { Wallet, Plus, Trash2, Clock, Brain, Loader2, AlertCircle, Timer } from 'lucide-react';
import { useAttention } from '@/hooks/useAttention';
import type { AttentionCategory } from '@/api/attention';

const PRESET_COLORS = ['#58a6ff', '#3fb950', '#f778ba', '#d29922', '#a371f7', '#f85149'];

const AttentionBudgetPage: FC = () => {
  const {
    categories, isLoading, createCategory, deleteCategory, createActivity,
  } = useAttention();
  const [newName, setNewName] = useState('');
  const [newSide, setNewSide] = useState<'personal' | 'network'>('personal');
  const [newMinutes, setNewMinutes] = useState(60);
  const [error, setError] = useState<string | null>(null);

  const addItem = async () => {
    if (!newName.trim()) return;
    setError(null);
    try {
      await createCategory({
        name: newName.trim(),
        brain_side: newSide,
        allocated_minutes: Math.min(1440, Math.max(1, newMinutes)),
        color: PRESET_COLORS[Math.floor(Math.random() * PRESET_COLORS.length)],
      });
      setNewName('');
      setNewMinutes(60);
    } catch {
      setError('添加失败，请重试');
    }
  };

  const removeItem = async (id: string) => {
    if (!confirm('确定删除该预算类别吗？')) return;
    setError(null);
    try {
      await deleteCategory(id);
    } catch {
      setError('删除失败，请重试');
    }
  };

  // 手动记录某类别的专注时长，写入注意力活动（驱动 used_minutes 与统计）
  const handleRecord = async (item: AttentionCategory, minutes: number) => {
    setError(null);
    try {
      await createActivity({
        category_id: item.id,
        category: item.name,
        brain_side: item.brain_side,
        description: `手动记录：${item.name}`,
        start_time: new Date().toISOString(),
        actual_duration: Math.min(1440, Math.max(1, Math.round(minutes))),
        source: 'manual',
        completion_status: 'completed',
      });
    } catch {
      setError('记录失败，请重试');
      throw new Error('record failed');
    }
  };

  const personal = (categories || []).filter((i) => i.brain_side === 'personal' || i.brain_side === 'both');
  const network = (categories || []).filter((i) => i.brain_side === 'network');

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">时间预算</h1>
          <p className="text-sm text-text-secondary mt-1">个人脑 / 网络脑时间投入规划</p>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-danger/10 border border-danger/30 text-danger text-sm">
          <AlertCircle className="w-4 h-4" />
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card">
          <div className="flex items-center gap-2 mb-4">
            <Brain className="w-5 h-5 text-personal-primary" />
            <h3 className="text-lg font-semibold text-text-primary">个人脑预算</h3>
          </div>
          <BudgetList items={personal} onRemove={removeItem} isLoading={isLoading} onRecord={handleRecord} />
        </div>

        <div className="card">
          <div className="flex items-center gap-2 mb-4">
            <Clock className="w-5 h-5 text-network-primary" />
            <h3 className="text-lg font-semibold text-text-primary">网络脑预算</h3>
          </div>
          <BudgetList items={network} onRemove={removeItem} isLoading={isLoading} onRecord={handleRecord} />
        </div>
      </div>

      <div className="card">
        <div className="flex items-center gap-2 mb-4">
          <Wallet className="w-5 h-5 text-fusion-primary" />
          <h3 className="text-lg font-semibold text-text-primary">新增预算类别</h3>
        </div>
        <div className="flex flex-col md:flex-row gap-3">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="类别名称"
            className="flex-1 bg-white/[0.03] border border-white/[0.08] rounded-xl px-4 py-2.5 text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-info/50"
          />
          <select
            value={newSide}
            onChange={(e) => setNewSide(e.target.value as 'personal' | 'network')}
            className="bg-white/[0.03] border border-white/[0.08] rounded-xl px-4 py-2.5 text-sm text-text-primary focus:outline-none focus:border-info/50"
          >
            <option value="personal">个人脑</option>
            <option value="network">网络脑</option>
          </select>
          <input
            type="number"
            min={15}
            max={1440}
            value={newMinutes}
            onChange={(e) => setNewMinutes(parseInt(e.target.value) || 0)}
            className="w-28 bg-white/[0.03] border border-white/[0.08] rounded-xl px-4 py-2.5 text-sm text-text-primary focus:outline-none focus:border-info/50"
          />
          <button onClick={addItem} className="btn-primary flex items-center gap-2">
            <Plus className="w-4 h-4" />
            添加
          </button>
        </div>
      </div>
    </div>
  );
};

const BudgetList: FC<{
  items: AttentionCategory[];
  onRemove: (id: string) => void;
  isLoading: boolean;
  onRecord: (item: AttentionCategory, minutes: number) => Promise<void>;
}> = ({ items, onRemove, isLoading, onRecord }) => {
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const [recordMinutes, setRecordMinutes] = useState(30);
  const [recordSaving, setRecordSaving] = useState(false);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 text-info animate-spin" />
      </div>
    );
  }

  if (items.length === 0) {
    return <p className="text-sm text-text-muted py-8 text-center">暂无预算类别</p>;
  }

  const submitRecord = async (item: AttentionCategory) => {
    setRecordSaving(true);
    try {
      await onRecord(item, recordMinutes);
      setRecordingId(null);
    } catch {
      // 错误提示由父级 error banner 展示
    } finally {
      setRecordSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      {items.map((item) => {
        const rawPct = (item.used_minutes / item.allocated_minutes) * 100;
        const pct = Math.min(100, Math.round(rawPct));
        const overBudget = rawPct > 100;
        return (
          <div key={item.id} className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.06]">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full" style={{ backgroundColor: item.color || '#58a6ff' }} />
                <span className="text-sm font-medium text-text-primary">{item.name}</span>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => { setRecordingId(item.id); setRecordMinutes(30); }} title="记录专注时长" className="p-1 rounded hover:bg-info/10 text-text-muted hover:text-info">
                  <Timer className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => onRemove(item.id)} className="p-1 rounded hover:bg-danger/10 text-text-muted hover:text-danger">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className="text-text-muted">{item.used_minutes} / {item.allocated_minutes} 分钟</span>
              <span className={overBudget ? 'text-danger font-medium' : 'text-text-muted'}>
                {Math.round(rawPct)}% {overBudget && '(超支)'}
              </span>
            </div>
            <div className="h-2 bg-white/[0.05] rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${overBudget ? 'bg-danger' : ''}`}
                style={{ width: `${pct}%`, backgroundColor: overBudget ? undefined : item.color || '#58a6ff' }}
              />
            </div>
            {recordingId === item.id && (
              <div className="flex items-center gap-2 mt-2.5 pt-2.5 border-t border-white/[0.05]">
                <input
                  type="number"
                  min={1}
                  max={1440}
                  value={recordMinutes}
                  onChange={(e) => setRecordMinutes(parseInt(e.target.value) || 0)}
                  className="w-24 bg-white/[0.03] border border-white/[0.08] rounded-lg px-2 py-1 text-xs text-text-primary focus:outline-none focus:border-info/50"
                />
                <span className="text-xs text-text-muted">分钟</span>
                <button
                  onClick={() => submitRecord(item)}
                  disabled={recordSaving || recordMinutes < 1}
                  className="px-2.5 py-1 rounded-lg bg-info/10 text-info text-xs border border-info/20 disabled:opacity-50"
                >
                  {recordSaving ? '保存中...' : '确认'}
                </button>
                <button onClick={() => setRecordingId(null)} className="px-2 py-1 rounded-lg text-text-muted text-xs hover:text-text-secondary">
                  取消
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default AttentionBudgetPage;
