import { FC } from 'react';
import { Database, ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import SourcePool from '@/components/emergence/SourcePool';
import { useSettings } from '@/store/settings';

const SourcePoolPage: FC = () => {
  const navigate = useNavigate();
  const isClassic = useSettings((s) => s.uiMode === 'classic');

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

      <SourcePool selectedIds={[]} onSelectionChange={() => {}} />
    </div>
  );
};

export default SourcePoolPage;
