import { FC, useState } from 'react';
import { Shield, Plus, Trash2, Bell, Globe, AppWindow, Loader2 } from 'lucide-react';
import { useAttention } from '@/hooks/useAttention';
import type { AttentionGuardianRule } from '@/api/attention';

const TYPE_ICONS: Record<string, React.ElementType> = {
  website: Globe,
  app: AppWindow,
  notification: Bell,
};

const TYPE_LABELS: Record<string, string> = {
  website: '网站',
  app: '应用',
  notification: '通知',
};

const AttentionGuardianPage: FC = () => {
  const { guardianRules, createGuardianRule, updateGuardianRule, deleteGuardianRule } = useAttention();

  const [newType, setNewType] = useState<AttentionGuardianRule['type']>('website');
  const [newTarget, setNewTarget] = useState('');
  const [newMode, setNewMode] = useState<AttentionGuardianRule['mode']>('block');
  const [newLimit, setNewLimit] = useState(30);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const rules = guardianRules ?? [];
  const activeCount = rules.filter((r) => r.active).length;

  const addRule = async () => {
    if (!newTarget.trim()) return;
    setIsSubmitting(true);
    setError('');
    try {
      await createGuardianRule({
        type: newType,
        target: newTarget.trim(),
        mode: newMode,
        limit_minutes: newMode === 'limit' ? Math.min(1440, Math.max(1, newLimit)) : undefined,
        active: true,
      });
      setNewTarget('');
      setNewLimit(30);
    } catch {
      setError('添加规则失败，请重试');
    } finally {
      setIsSubmitting(false);
    }
  };

  const toggleRule = async (rule: AttentionGuardianRule) => {
    try {
      await updateGuardianRule({ id: rule.id, data: { active: !rule.active } });
    } catch {
      setError('操作失败，请重试');
    }
  };

  const removeRule = async (id: string) => {
    try {
      await deleteGuardianRule(id);
    } catch {
      setError('删除失败，请重试');
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">干扰守门员</h1>
          <p className="text-sm text-text-secondary mt-1">网络脑入口控制：屏蔽通知、网站与应用</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <GuardianMetric label="已启用规则" value={String(activeCount)} icon={Shield} color="text-success" />
        <GuardianMetric label="屏蔽规则" value={String(rules.length)} icon={Globe} color="text-info" />
      </div>

      <div className="card">
        <div className="flex items-center gap-2 mb-4">
          <Shield className="w-5 h-5 text-network-primary" />
          <h3 className="text-lg font-semibold text-text-primary">屏蔽规则</h3>
        </div>

        <div className="space-y-2 mb-4">
          {rules.map((rule) => {
            const Icon = TYPE_ICONS[rule.type];
            return (
              <div key={rule.id} className="flex items-center justify-between p-3 rounded-xl bg-white/[0.02] border border-white/[0.06]">
                <div className="flex items-center gap-3">
                  <Icon className="w-4 h-4 text-text-muted" />
                  <div>
                    <div className="text-sm font-medium text-text-primary">{rule.target}</div>
                    <div className="text-xs text-text-muted">
                      {TYPE_LABELS[rule.type]} · {rule.mode === 'block' ? '完全屏蔽' : `限时 ${rule.limit_minutes} 分钟`}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => toggleRule(rule)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                      rule.active ? 'bg-success/10 text-success border border-success/20' : 'bg-white/[0.03] text-text-muted border border-white/[0.08]'
                    }`}
                  >
                    {rule.active ? '已启用' : '已停用'}
                  </button>
                  <button onClick={() => removeRule(rule.id)} className="p-1.5 rounded hover:bg-danger/10 text-text-muted hover:text-danger">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
          {rules.length === 0 && (
            <div className="text-sm text-text-muted py-6 text-center">暂无规则，添加一个目标开始守护专注。</div>
          )}
        </div>

        {error && (
          <div className="mb-3 px-3 py-2 rounded-lg bg-danger/10 border border-danger/20 text-danger text-xs">{error}</div>
        )}
        <div className="flex flex-col md:flex-row gap-3 pt-4 border-t border-white/[0.06]">
          <select
            value={newType}
            onChange={(e) => setNewType(e.target.value as AttentionGuardianRule['type'])}
            className="bg-white/[0.03] border border-white/[0.08] rounded-xl px-4 py-2.5 text-sm text-text-primary focus:outline-none focus:border-info/50"
          >
            <option value="website">网站</option>
            <option value="app">应用</option>
            <option value="notification">通知</option>
          </select>
          <input
            type="text"
            value={newTarget}
            onChange={(e) => setNewTarget(e.target.value)}
            placeholder="目标名称或域名"
            className="flex-1 bg-white/[0.03] border border-white/[0.08] rounded-xl px-4 py-2.5 text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-info/50"
          />
          <select
            value={newMode}
            onChange={(e) => setNewMode(e.target.value as AttentionGuardianRule['mode'])}
            className="bg-white/[0.03] border border-white/[0.08] rounded-xl px-4 py-2.5 text-sm text-text-primary focus:outline-none focus:border-info/50"
          >
            <option value="block">完全屏蔽</option>
            <option value="limit">限时</option>
          </select>
          {newMode === 'limit' && (
            <input
              type="number"
              min={5}
              value={newLimit}
              onChange={(e) => setNewLimit(parseInt(e.target.value) || 0)}
              className="w-24 bg-white/[0.03] border border-white/[0.08] rounded-xl px-4 py-2.5 text-sm text-text-primary focus:outline-none focus:border-info/50"
            />
          )}
          <button onClick={addRule} disabled={isSubmitting} className="btn-primary flex items-center gap-2">
            {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            添加
          </button>
        </div>
      </div>
    </div>
  );
};

const GuardianMetric: FC<{ label: string; value: string; icon: React.ElementType; color: string }> = ({
  label, value, icon: Icon, color,
}) => (
  <div className="card flex items-center gap-3">
    <Icon className={`w-6 h-6 ${color}`} />
    <div>
      <div className="text-2xl font-bold text-text-primary">{value}</div>
      <div className="text-xs text-text-muted">{label}</div>
    </div>
  </div>
);

export default AttentionGuardianPage;
