import { FC, useState } from 'react';
import { Database, ArrowRight, SquareStack, Loader2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import SourcePool from '@/components/emergence/SourcePool';
import { useSettings } from '@/store/settings';
import { useTransitionItem } from '@/hooks/usePipeline';

// 素材池类型 → 管线 content_type（管线只接受这几类，其余类型提示不可转）
const TO_PIPELINE_TYPE: Record<string, string> = {
  note: 'note',
  clip: 'clip',
  knowledge: 'knowledge',
  rss_entry: 'rss',
  read_later: 'read_later',
};

interface SelectedSource {
  id: string;
  type: string;
}

const SourcePoolPage: FC = () => {
  const navigate = useNavigate();
  const isClassic = useSettings((s) => s.uiMode === 'classic');
  // 此前这里传死 selectedIds={[]} + 空回调，勾选框点了没反应；
  // 接通为受控状态，并给选中项一个真实去处（转入管线卡片化）。
  const [selectedSources, setSelectedSources] = useState<SelectedSource[]>([]);
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const transitionItem = useTransitionItem();

  const transferable = selectedSources.filter((s) => TO_PIPELINE_TYPE[s.type]);
  const untransferable = selectedSources.length - transferable.length;

  const handleMoveToCards = async () => {
    if (transferable.length === 0 || moving) return;
    setMoving(true);
    setError(null);
    let failed = 0;
    for (const s of transferable) {
      try {
        await transitionItem.mutateAsync({
          content_type: TO_PIPELINE_TYPE[s.type],
          content_id: s.id,
          stage: 'card',
        });
      } catch {
        failed++;
      }
    }
    setMoving(false);
    if (failed === 0) {
      setSelectedSources([]);
      // 全部成功：自动进入管线卡片化页，与其他批操作跳转口径一致
      navigate('/pipeline/cards');
    } else {
      setError(`${transferable.length - failed} 条已转入，${failed} 条失败（可能已在管线中）`);
    }
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Database className="w-6 h-6 text-info" />
          <h1 className="text-2xl font-bold text-text-primary">素材池</h1>
        </div>
        {isClassic && (
          <button
            onClick={() => navigate('/emergence')}
            className="btn-primary flex items-center gap-2 text-xs"
          >
            去使用工具
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      <p className="text-sm text-text-secondary">
        从个人脑、网络脑以及双脑内容中挑选素材，作为涌现工具的灵感来源。
      </p>

      {selectedSources.length > 0 && (
        <div className="glass-card px-4 py-3 flex items-center justify-between gap-3 border-info/30">
          <div className="text-xs text-text-secondary">
            已选 {selectedSources.length} 项
            {untransferable > 0 && `（其中 ${untransferable} 项类型不支持入管线）`}
            {error && <span className="text-danger ml-2">{error}</span>}
          </div>
          <button
            onClick={handleMoveToCards}
            disabled={moving || transferable.length === 0}
            className="btn-primary flex items-center gap-1.5 text-xs shrink-0 disabled:opacity-50"
          >
            {moving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <SquareStack className="w-3.5 h-3.5" />}
            {moving ? '转入中...' : `转入管线卡片化（${transferable.length}）`}
          </button>
        </div>
      )}

      <SourcePool selectedSources={selectedSources} onSelectedSourcesChange={setSelectedSources} />
    </div>
  );
};

export default SourcePoolPage;
