import { FC, useState, useMemo, useEffect } from 'react';
import { usePracticeRecords, useCreatePracticeRecord, useDeletePracticeRecord } from '@/hooks/useJianghu';
import { useKnowledge } from '@/hooks/useKnowledge';
import { useNotes } from '@/hooks/useNotes';
import { useNavigation } from '@/store/navigation';
import { Dumbbell, Loader2, Plus, Filter, ExternalLink, Trash2 } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';

const PRACTICE_TYPES = [
  { value: 'applied', label: '应用', color: 'text-network-primary bg-network-primary/10' },
  { value: 'taught', label: '教授', color: 'text-fusion-primary bg-fusion-primary/10' },
  { value: 'iterated', label: '迭代', color: 'text-success bg-success/10' },
  { value: 'failed', label: '失败', color: 'text-danger bg-danger/10' },
  { value: 'observed', label: '观察', color: 'text-warning bg-warning/10' },
];

const PracticeRecordsPage: FC = () => {
  const { brainSide } = useNavigation();
  const [limit, setLimit] = useState(50);
  const { data: records, isLoading, isFetching } = usePracticeRecords({ brain_side: brainSide, limit });
  const create = useCreatePracticeRecord();
  const del = useDeletePracticeRecord();
  const { units: knowledgeUnits } = useKnowledge(brainSide);
  const { notes } = useNotes({ brain_side: brainSide });
  const [searchParams] = useSearchParams();

  const [form, setForm] = useState({
    target_type: 'knowledge_unit' as 'note' | 'knowledge_unit',
    target_id: '',
    practice_type: 'applied' as const,
    description: '',
    result: '',
    learned_lesson: '',
  });
  const [filterType, setFilterType] = useState<string>('all');
  const [showForm, setShowForm] = useState(false);

  // 深链 ?target_id=&target_type=：自动展开表单并预填目标（非法 target_type 忽略）
  useEffect(() => {
    const targetId = searchParams.get('target_id');
    const targetType = searchParams.get('target_type');
    if (targetId && (targetType === 'note' || targetType === 'knowledge_unit')) {
      setForm((prev) => ({ ...prev, target_type: targetType, target_id: targetId }));
      setShowForm(true);
    }
  }, [searchParams]);

  const targetOptions = useMemo(() => {
    const all =
      form.target_type === 'knowledge_unit'
        ? (knowledgeUnits || []).map((k: { id: string; content_raw?: string | null }) => ({ id: k.id, label: (k.content_raw || '').slice(0, 60) || '(无内容)' }))
        : (notes || []).map((n: { id: string; title?: string | null; content?: string | null }) => ({ id: n.id, label: (n.title || n.content?.slice(0, 60) || '(无标题)') }));
    const options = all.slice(0, 50);
    // 深链预填的目标可能不在前 50 条内，补一个可选项保证下拉能选中
    if (form.target_id && !options.some((o) => o.id === form.target_id)) {
      const found = all.find((o) => o.id === form.target_id);
      options.unshift({ id: form.target_id, label: found ? found.label : `指定目标 ${form.target_id.slice(0, 8)}…` });
    }
    return options;
  }, [form.target_type, form.target_id, knowledgeUnits, notes]);

  const filteredRecords = useMemo(() => {
    if (!records) return [];
    if (filterType === 'all') return records;
    return records.filter((r) => r.practice_type === filterType);
  }, [records, filterType]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    create.mutate(form, {
      onSuccess: () => {
        setForm({ target_type: 'knowledge_unit', target_id: '', practice_type: 'applied', description: '', result: '', learned_lesson: '' });
        setShowForm(false);
      },
    });
  };

  const targetLink = (record: { target_type: string; target_id: string }) => {
    if (record.target_type === 'knowledge_unit') return `/knowledge/${record.target_id}`;
    return `/ingest/notes/${record.target_id}`;
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-text-primary flex items-center gap-2">
          <Dumbbell className="w-5 h-5 text-network-primary" />
          实操记录
        </h1>
        <button
          onClick={() => setShowForm((s) => !s)}
          className="flex items-center gap-2 px-4 py-2 rounded-[2px] bg-info/10 text-info hover:bg-info/20 transition-colors"
        >
          <Plus className="w-4 h-4" />
          {showForm ? '取消' : '记录实操'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="p-4 rounded-[2px] border border-white/[0.06] bg-bg-secondary mb-6 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <select
              value={form.target_type}
              onChange={(e) => setForm({ ...form, target_type: e.target.value as 'note' | 'knowledge_unit', target_id: '' })}
              className="px-3 py-2 rounded-[2px] bg-bg-primary border border-white/[0.06] text-sm text-text-primary"
            >
              <option value="knowledge_unit">知识单元</option>
              <option value="note">笔记</option>
            </select>
            <select
              value={form.target_id}
              onChange={(e) => setForm({ ...form, target_id: e.target.value })}
              className="px-3 py-2 rounded-[2px] bg-bg-primary border border-white/[0.06] text-sm text-text-primary"
            >
              <option value="">选择目标...</option>
              {targetOptions.map((opt: { id: string; label: string }) => (
                <option key={opt.id} value={opt.id}>{opt.label}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {PRACTICE_TYPES.map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => setForm({ ...form, practice_type: t.value as typeof form.practice_type })}
                className={`px-2 py-1.5 rounded-[2px] text-xs border transition-all ${
                  form.practice_type === t.value
                    ? `${t.color} border-current`
                    : 'bg-white/[0.03] text-text-secondary border-white/[0.06]'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <textarea
            placeholder="描述你做了什么..."
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            className="w-full px-3 py-2 rounded-[2px] bg-bg-primary border border-white/[0.06] text-sm text-text-primary min-h-[80px]"
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <textarea
              placeholder="结果如何（可选）"
              value={form.result}
              onChange={(e) => setForm({ ...form, result: e.target.value })}
              className="w-full px-3 py-2 rounded-[2px] bg-bg-primary border border-white/[0.06] text-sm text-text-primary min-h-[60px]"
            />
            <textarea
              placeholder="学到的教训（可选）"
              value={form.learned_lesson}
              onChange={(e) => setForm({ ...form, learned_lesson: e.target.value })}
              className="w-full px-3 py-2 rounded-[2px] bg-bg-primary border border-white/[0.06] text-sm text-text-primary min-h-[60px]"
            />
          </div>
          {create.isError && (
            <div className="p-3 rounded-[2px] bg-danger/10 border border-danger/30 text-sm text-danger">
              {(create.error as any)?.message || '创建失败，请稍后重试'}
            </div>
          )}
          <button
            type="submit"
            disabled={create.isPending || !form.target_id || !form.description}
            className="flex items-center gap-2 px-4 py-2 rounded-[2px] bg-info/10 text-info hover:bg-info/20 transition-colors disabled:opacity-50"
          >
            {create.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            添加记录
          </button>
        </form>
      )}

      <div className="flex items-center gap-2 mb-4">
        <Filter className="w-4 h-4 text-text-muted" />
        <div className="flex items-center gap-1 flex-wrap">
          <button
            onClick={() => setFilterType('all')}
            className={`px-2.5 py-1 rounded-[2px] text-xs border transition-all ${filterType === 'all' ? 'bg-info/15 text-info border-info/30' : 'bg-white/[0.03] text-text-secondary border-white/[0.06]'}`}
          >
            全部
          </button>
          {PRACTICE_TYPES.map((t) => (
            <button
              key={t.value}
              onClick={() => setFilterType(t.value)}
              className={`px-2.5 py-1 rounded-[2px] text-xs border transition-all ${filterType === t.value ? `${t.color} border-current` : 'bg-white/[0.03] text-text-secondary border-white/[0.06]'}`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading && <div className="text-sm text-text-secondary flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />加载中...</div>}

      <div className="space-y-3">
        {filteredRecords?.map((record) => {
          const typeMeta = PRACTICE_TYPES.find((t) => t.value === record.practice_type) || PRACTICE_TYPES[0];
          return (
            <div key={record.id} className="p-4 rounded-[2px] border border-white/[0.06] bg-bg-secondary group">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className={`px-2 py-0.5 rounded-md text-xs ${typeMeta.color} border border-current/20`}>{typeMeta.label}</span>
                  <Link
                    to={targetLink(record)}
                    className="flex items-center gap-1 text-xs text-info hover:underline"
                  >
                    {record.target_type === 'knowledge_unit' ? '知识单元' : '笔记'}
                    <ExternalLink className="w-3 h-3" />
                  </Link>
                  <span className="text-xs text-text-muted">{new Date(record.created_at).toLocaleDateString('zh-CN')}</span>
                </div>
                <button
                  onClick={() => {
                    if (window.confirm('确定删除这条实操记录吗？')) del.mutate(record.id);
                  }}
                  disabled={del.isPending && del.variables === record.id}
                  className="p-1.5 rounded-[2px] text-text-muted hover:text-danger hover:bg-danger/10 transition-colors disabled:opacity-50 shrink-0"
                  title="删除记录"
                >
                  {del.isPending && del.variables === record.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                </button>
              </div>
              <p className="text-sm text-text-primary whitespace-pre-wrap leading-relaxed mb-3">{record.description}</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                {record.result && (
                  <div className="p-2.5 rounded-[2px] bg-white/[0.03]">
                    <div className="text-xs text-text-muted mb-1">结果</div>
                    <div className="text-text-secondary whitespace-pre-wrap">{record.result}</div>
                  </div>
                )}
                {record.learned_lesson && (
                  <div className="p-2.5 rounded-[2px] bg-white/[0.03]">
                    <div className="text-xs text-text-muted mb-1">教训</div>
                    <div className="text-text-secondary whitespace-pre-wrap">{record.learned_lesson}</div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {filteredRecords?.length === 0 && !isLoading && (
        <div className="p-8 rounded-[2px] border border-white/[0.06] bg-bg-secondary text-center text-text-secondary">
          暂无实操记录，点击右上角开始记录。
        </div>
      )}

      {records && records.length >= limit && (
        <div className="mt-6 flex justify-center">
          <button
            onClick={() => setLimit((l) => l + 50)}
            disabled={isFetching}
            className="flex items-center gap-2 px-4 py-2 rounded-[2px] bg-info/10 text-info hover:bg-info/20 transition-colors disabled:opacity-50"
          >
            {isFetching && <Loader2 className="w-4 h-4 animate-spin" />}
            {isFetching ? '加载中…' : '加载更多'}
          </button>
        </div>
      )}
    </div>
  );
};

export default PracticeRecordsPage;
