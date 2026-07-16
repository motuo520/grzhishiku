import { FC, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, Database } from 'lucide-react';
import SourcePool from './SourcePool';
import type { SelectedSource } from '@/api/emergence';

interface SourcePoolPanelProps {
  selectedSources: SelectedSource[];
  onSelectionChange: (sources: SelectedSource[]) => void;
}

const SourcePoolPanel: FC<SourcePoolPanelProps> = ({ selectedSources, onSelectionChange }) => {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="glass-card p-4 mb-6">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between group"
      >
        <div className="flex items-center gap-2">
          <Database className="w-4 h-4 text-info" />
          <span className="text-sm font-medium text-text-primary">素材选择</span>
          {selectedSources.length > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-info/15 text-info text-xs font-medium">
              已选 {selectedSources.length} 条
            </span>
          )}
        </div>
        <ChevronDown
          className={`w-4 h-4 text-text-muted transition-transform ${expanded ? 'rotate-180' : ''}`}
        />
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="pt-4">
              <SourcePool
                selectedSources={selectedSources}
                onSelectedSourcesChange={onSelectionChange}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default SourcePoolPanel;
