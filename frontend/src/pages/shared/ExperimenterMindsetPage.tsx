import { FC, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useNavigation } from '@/store/navigation';
import {
  useExperimentLogs,
  useCreateExperimentLog,
  useUpdateExperimentLog,
  useDeleteExperimentLog,
} from '@/hooks/useJianghu';
import { useKnowledge } from '@/hooks/useKnowledge';
import { useNotes } from '@/hooks/useNotes';
import {
  FlaskConical, Plus, Loader2, Save, Trash2, Edit3, X,
  Play, CheckCircle2, XCircle, PauseCircle
} from 'lucide-react';
import type { ExperimentLog, ExperimentLogCreateData, ExperimentLogUpdateData } from '@/api/jianghu';

const STATUS_OPTIONS: { value: ExperimentLog['status']; label: string; icon: React.ElementType; color: string }[] = [
  { value: 'planned', label: '计划中', icon: PauseCircle, color: 'text-text-muted' },
  { value: 'running', label: '进行中', icon: Play, color: 'text-info' },
  { value: 'completed', label: '已完成', icon: CheckCircle2, color: 'text-success' },
  { value: 'abandoned', label: '已放弃', icon: XCircle, color: 'text-danger' },
];

const EMPTY_FORM: ExperimentLogCreateData = {
  title: '',
  hypothesis: '',
  controlled_variable: '',
  expected_result: '',
  actual_result: '',
  conclusion: '',
  status: 'planned',
  related_content_type: undefined,
  related_content_id: '',
};

const ExperimenterMindsetPage: FC = () => {
  const navigate = useNavigate();
  const { brainSide } = useNavigation();
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const filters = useMemo(() => ({
    status: statusFilter === 'all' ? undefined : statusFilter,
    brain_side: brainSide === 'unknown' ? undefined : brainSide,
  }), [statusFilter, brainSide]);

  const { data: logs, isLoading, isError, error } = useExperimentLogs(filters);
  const create = useCreateExperimentLog();
  const update = useUpdateExperimentLog();
  const remove = useDeleteExperimentLog();

  const { units: knowledgeUnits } = useKnowledge(brainSide);
  const { notes } = useNotes({ brain_side: brainSide === 'unknown' ? undefined : brainSide });

  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ExperimentLogCreateData>(EMPTY_FORM);

  const targetOptions = useMemo(() => {
    const kOpts = (knowledgeUnits || []).slice(0, 50).map((k) => ({ id: k.id, type: 'knowledge_unit' as const, label: (k.content_raw || '').slice(0, 60) || '(无内容)' }));
    const nOpts = (notes || []).slice(0, 50).map((n) => ({ id: n.id, type: 'note' as const, label: (n.title || n.content?.slice(0, 60) || '(无标题)') }));
    return [...kOpts, ...nOpts];
  }, [knowledgeUnits, notes]);

  const startNew = () => {
    setEditingId('new');
    setForm({ ...EMPTY_FORM });
  };

  const startEdit = (log: ExperimentLog) => {
    setEditingId(log.id);
    setForm({
      title: log.title,
      hypothesis: log.hypothesis,
      controlled_variable: log.controlled_variable || '',
      expected_result: log.expected_result || '',
      actual_result: log.actual_result || '',
      conclusion: log.conclusion || '',
      status: log.status,
      related_content_type: log.related_content_type || undefined,
      related_content_id: log.related_content_id || '',
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
  };

  const handleSave = () => {
    if (!form.title.trim() || !form.hypothesis.trim()) return;
    const basePayload = {
      ...form,
      related_content_id: form.related_content_id || undefined,
    };
    if (editingId === 'new') {
      // 新建时写入当前全局脑区
      create.mutate(
        { ...basePayload, brain_side: brainSide === 'unknown' ? 'both' : brainSide },
        { onSuccess: cancelEdit }
      );
    } else if (editingId) {
      // 编辑时不传 brain_side，保留记录原值，避免被全局开关悄悄改掉
      // 后端 update 使用 exclude_unset：显式传 null 才会清除关联，不传/undefined 则保留原值
      const data: ExperimentLogUpdateData = form.related_content_id
        ? basePayload
        : { ...basePayload, related_content_type: null, related_content_id: null };
      update.mutate({ id: editingId, data }, { onSuccess: cancelEdit });
    }
  };

  const handleDelete = (id: string) => {
    if (confirm('确定删除这条实验记录？')) remove.mutate(id);
  };

  const setRelatedTarget = (value: string) => {
    const target = targetOptions.find((t) => t.id === value);
    if (!target || value === '') {
      setForm({ ...form, related_content_type: undefined, related_content_id: '' });
    } else {
      setForm({ ...form, related_content_type: target.type, related_content_id: target.id });
    }
  };

  const relatedLabel = (log: ExperimentLog) => {
    if (!log.related_content_id) return null;
    return log.related_content_type === 'note' ? '笔记' : '知识';
  };

  const relatedLink = (log: ExperimentLog) => {
    if (!log.related_content_id) return '#';
    return log.related_content_type === 'note' ? `/ingest/notes/${log.related_content_id}` : `/knowledge/${log.related_content_id}`;
  };

  return (
    <div className="p-6 max-w-6xl mx-auto h-full overflow-auto">
      <div className="flex items-start justify-between flex-wrap gap-4 mb-6">
        <div>
          <h1 className="text-xl font-semibold text-text-primary flex items-center gap-2">
            <FlaskConical className="w-5 h-5 text-success" />
            实验者心态
          </h1>
          <p className="text-sm text-text-secondary mt-1">
            每次只控制一个变量，把创作和知识应用当作实验，用真实反馈迭代。
          </p>
        </div>
        <button
          onClick={startNew}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-success/10 text-success hover:bg-success/20 transition-colors"
        >
          <Plus className="w-4 h-4" />
          新建实验
        </button>
      </div>

      {(create.isError || update.isError || remove.isError) && (
        <div className="mb-4">
          <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-400">
            {((create.error || update.error || remove.error) as any)?.message || '操作失败，请重试'}
          </div>
        </div>
      )}

      {isError && (
        <div className="mb-4">
          <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-400">
            {(error as any)?.message || '操作失败，请重试'}
          </div>
        </div>
      )}

      {editingId && (
        <div className="rounded-xl border border-white/[0.06] bg-bg-secondary p-4 mb-6 space-y-3">
          <input
            type="text"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="实验标题"
            className="w-full px-3 py-2 rounded-lg bg-bg-primary border border-white/[0.06] text-sm text-text-primary"
          />
          <textarea
            value={form.hypothesis}
            onChange={(e) => setForm({ ...form, hypothesis: e.target.value })}
            placeholder="假设：如果...那么..."
            className="w-full px-3 py-2 rounded-lg bg-bg-primary border border-white/[0.06] text-sm text-text-primary min-h-[80px]"
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <textarea
              value={form.controlled_variable}
              onChange={(e) => setForm({ ...form, controlled_variable: e.target.value })}
              placeholder="控制的变量（只改一个）"
              className="w-full px-3 py-2 rounded-lg bg-bg-primary border border-white/[0.06] text-sm text-text-primary min-h-[60px]"
            />
            <textarea
              value={form.expected_result}
              onChange={(e) => setForm({ ...form, expected_result: e.target.value })}
              placeholder="预期结果"
              className="w-full px-3 py-2 rounded-lg bg-bg-primary border border-white/[0.06] text-sm text-text-primary min-h-[60px]"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <textarea
              value={form.actual_result}
              onChange={(e) => setForm({ ...form, actual_result: e.target.value })}
              placeholder="实际结果"
              className="w-full px-3 py-2 rounded-lg bg-bg-primary border border-white/[0.06] text-sm text-text-primary min-h-[60px]"
            />
            <textarea
              value={form.conclusion}
              onChange={(e) => setForm({ ...form, conclusion: e.target.value })}
              placeholder="结论/学到的东西"
              className="w-full px-3 py-2 rounded-lg bg-bg-primary border border-white/[0.06] text-sm text-text-primary min-h-[60px]"
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <select
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value as ExperimentLog['status'] })}
              className="px-3 py-2 rounded-lg bg-bg-primary border border-white/[0.06] text-sm text-text-primary"
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
            <select
              value={form.related_content_id || ''}
              onChange={(e) => setRelatedTarget(e.target.value)}
              className="px-3 py-2 rounded-lg bg-bg-primary border border-white/[0.06] text-sm text-text-primary min-w-[200px]"
            >
              <option value="">关联到知识/笔记（可选）</option>
              {targetOptions.map((t) => (
                <option key={`${t.type}-${t.id}`} value={t.id}>
                  [{t.type === 'note' ? '笔记' : '知识'}] {t.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center justify-end gap-2">
            <button onClick={cancelEdit} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs text-text-secondary hover:bg-white/[0.04]">
              <X className="w-3.5 h-3.5" />
              取消
            </button>
            <button
              onClick={handleSave}
              disabled={create.isPending || update.isPending || !form.title.trim() || !form.hypothesis.trim()}
              className="flex items-center gap-1 px-4 py-1.5 rounded-lg bg-info/10 text-info hover:bg-info/20 transition-colors disabled:opacity-50 text-xs"
            >
              {create.isPending || update.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              保存
            </button>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <button
          onClick={() => setStatusFilter('all')}
          className={`px-2.5 py-1 rounded-lg text-xs border transition-all ${statusFilter === 'all' ? 'bg-info/15 text-info border-info/30' : 'bg-white/[0.03] text-text-secondary border-white/[0.06]'}`}
        >
          全部
        </button>
        {STATUS_OPTIONS.map((s) => (
          <button
            key={s.value}
            onClick={() => setStatusFilter(s.value)}
            className={`px-2.5 py-1 rounded-lg text-xs border transition-all ${statusFilter === s.value ? `${s.color} bg-white/[0.05] border-current` : 'bg-white/[0.03] text-text-secondary border-white/[0.06]'}`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {isLoading && (
        <div className="text-sm text-text-secondary flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" />
          加载中...
        </div>
      )}

      <div className="space-y-3">
        {logs?.map((log) => {
          const statusMeta = STATUS_OPTIONS.find((s) => s.value === log.status) || STATUS_OPTIONS[0];
          const StatusIcon = statusMeta.icon;
          return (
            <div key={log.id} className="rounded-xl border border-white/[0.06] bg-bg-secondary p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border ${statusMeta.color} border-current/20 bg-white/[0.03]`}>
                      <StatusIcon className="w-3 h-3" />
                      {statusMeta.label}
                    </span>
                    {log.related_content_id && (
                      <button
                        onClick={() => navigate(relatedLink(log))}
                        className="text-[10px] text-info hover:underline"
                      >
                        关联{relatedLabel(log)}
                      </button>
                    )}
                    <span className="text-[10px] text-text-muted">
                      {new Date(log.updated_at).toLocaleString('zh-CN')}
                    </span>
                  </div>
                  <h3 className="text-sm font-medium text-text-primary">{log.title}</h3>
                  <p className="text-xs text-text-secondary mt-1 line-clamp-2">{log.hypothesis}</p>
                  {log.controlled_variable && (
                    <div className="mt-2 text-xs text-text-muted">
                      <span className="text-text-secondary">变量：</span>{log.controlled_variable}
                    </div>
                  )}
                  {log.actual_result && (
                    <div className="mt-2 p-2.5 rounded-lg bg-white/[0.03] text-xs text-text-secondary">
                      <span className="text-text-muted">实际结果：</span>{log.actual_result}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => startEdit(log)}
                    className="p-1.5 rounded-lg text-text-secondary hover:bg-white/[0.04] hover:text-text-primary transition-colors"
                    title="编辑"
                  >
                    <Edit3 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(log.id)}
                    className="p-1.5 rounded-lg text-danger hover:bg-danger/10 transition-colors"
                    title="删除"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {!isLoading && logs?.length === 0 && !editingId && (
        <div className="p-8 rounded-xl border border-white/[0.06] bg-bg-secondary text-center text-text-secondary">
          <FlaskConical className="w-10 h-10 mx-auto mb-3 text-text-muted/40" />
          <p className="text-sm">暂无实验记录。</p>
          <p className="text-xs mt-1">从一个可验证的假设开始，记录每次只控制一个变量的实验。</p>
        </div>
      )}
    </div>
  );
};

export default ExperimenterMindsetPage;
