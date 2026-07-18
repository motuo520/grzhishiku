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
    <div className="relative z-50 bg-bg-secondary/80 border-b border-warning/20 px-4 py-2">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 min-w-0">
          <Megaphone className="w-4 h-4 text-warning flex-shrink-0" />
          <div className="text-sm text-warning truncate">
            {data.title && <span className="font-semibold mr-2">{data.title}</span>}
            <span className="text-warning/80">{data.content}</span>
          </div>
        </div>
        <button
          onClick={() => setDismissed(true)}
          className="p-1 rounded-[2px] text-warning hover:bg-warning/10 flex-shrink-0"
          title="关闭"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};

export default AnnouncementBanner;
