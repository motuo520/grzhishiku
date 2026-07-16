import { FC, useState } from 'react';
import { Megaphone, X } from 'lucide-react';
import { useSystemAnnouncement } from '@/hooks/useSystemAnnouncement';

const AnnouncementBanner: FC = () => {
  const { data, isLoading } = useSystemAnnouncement();
  const [dismissed, setDismissed] = useState(false);

  if (isLoading || dismissed || !data?.enabled || (!data.title && !data.content)) {
    return null;
  }

  return (
    <div className="relative z-50 bg-bg-secondary/80 backdrop-blur-md border-b border-amber-500/20 px-4 py-2">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 min-w-0">
          <Megaphone className="w-4 h-4 text-amber-400 flex-shrink-0" />
          <div className="text-sm text-amber-200 truncate">
            {data.title && <span className="font-semibold mr-2">{data.title}</span>}
            <span className="text-amber-100/80">{data.content}</span>
          </div>
        </div>
        <button
          onClick={() => setDismissed(true)}
          className="p-1 rounded-lg text-amber-400 hover:bg-amber-500/10 flex-shrink-0"
          title="关闭"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};

export default AnnouncementBanner;
