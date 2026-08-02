import { ExternalLink } from 'lucide-react';

interface BrainSideBadgeProps {
  side: 'personal' | 'network' | 'both';
  className?: string;
}

export const BrainSideBadge = ({ side, className = 'text-[10px]' }: BrainSideBadgeProps) => {
  if (side === 'both') {
    return <span className={`badge-fusion ${className}`}>双脑</span>;
  }
  if (side === 'personal') {
    return <span className={`badge-personal ${className}`}>个人脑</span>;
  }
  return <span className={`badge-network ${className}`}>网络脑</span>;
};

function isValidHttpUrl(url?: string | null): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function getDomain(url?: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

interface SourceLinkProps {
  url?: string | null;
  className?: string;
}

export const SourceLink = ({ url, className = '' }: SourceLinkProps) => {
  const domain = getDomain(url);
  if (!domain) return null;
  const valid = isValidHttpUrl(url);
  const content = (
    <>
      <ExternalLink className="w-3 h-3 shrink-0" />
      <span className="truncate max-w-[200px]">{domain}</span>
    </>
  );
  if (valid) {
    return (
      <a
        href={url!}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className={`flex items-center gap-1 hover:text-info transition-colors ${className}`}
      >
        {content}
      </a>
    );
  }
  return (
    <span className={`flex items-center gap-1 text-text-muted ${className}`}>{content}</span>
  );
};
