import { FC, ReactNode } from 'react';
import { FileText, AlertTriangle, Loader2 } from 'lucide-react';
import { useGraphifyStatus, useGraphifyReport } from '@/hooks/useGraphify';

// 行内样式：仅处理 **粗体**
const renderInline = (text: string): ReactNode[] => {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) =>
    part.startsWith('**') && part.endsWith('**')
      ? <strong key={i} className="text-text-primary font-semibold">{part.slice(2, -2)}</strong>
      : part
  );
};

// 极简 markdown 渲染：#/##/### 标题、- 与数字列表、**粗体**，其余按段落
const renderMarkdown = (md: string): ReactNode[] => {
  const blocks: ReactNode[] = [];
  let listItems: string[] = [];
  let listOrdered = false;

  const flushList = (key: string) => {
    if (listItems.length === 0) return;
    const items = listItems.map((item, i) => (
      <li key={i} className="text-sm text-text-secondary leading-relaxed">{renderInline(item)}</li>
    ));
    blocks.push(
      listOrdered
        ? <ol key={key} className="list-decimal list-inside space-y-1 my-2">{items}</ol>
        : <ul key={key} className="list-disc list-inside space-y-1 my-2">{items}</ul>
    );
    listItems = [];
  };

  md.split('\n').forEach((line, idx) => {
    const trimmed = line.trim();

    if (/^#{1,4}\s/.test(trimmed)) {
      flushList(`list-${idx}`);
      const level = trimmed.match(/^#+/)![0].length;
      const text = trimmed.replace(/^#+\s*/, '');
      const cls =
        level === 1 ? 'text-xl font-bold text-text-primary mt-6 mb-3' :
        level === 2 ? 'text-lg font-bold text-text-primary mt-5 mb-2' :
        'text-base font-semibold text-text-primary mt-4 mb-2';
      blocks.push(<div key={idx} className={cls}>{renderInline(text)}</div>);
      return;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      if (listItems.length > 0 && listOrdered) flushList(`list-${idx}`);
      listOrdered = false;
      listItems.push(trimmed.replace(/^[-*]\s+/, ''));
      return;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      if (listItems.length > 0 && !listOrdered) flushList(`list-${idx}`);
      listOrdered = true;
      listItems.push(trimmed.replace(/^\d+\.\s+/, ''));
      return;
    }

    flushList(`list-${idx}`);
    if (trimmed === '') return;
    if (/^-{3,}$/.test(trimmed)) {
      blocks.push(<hr key={idx} className="border-white/[0.08] my-4" />);
      return;
    }
    blocks.push(
      <p key={idx} className="text-sm text-text-secondary leading-relaxed my-2">{renderInline(trimmed)}</p>
    );
  });

  flushList('list-end');
  return blocks;
};

const GraphReportPage: FC = () => {
  const { data: status, isLoading: statusLoading } = useGraphifyStatus();
  const { data: report, isLoading: reportLoading } = useGraphifyReport(Boolean(status?.has_graph));

  // 未构建图谱时的引导
  if (!statusLoading && !status?.has_graph) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center px-6">
        <FileText className="w-12 h-12 text-text-muted mb-4" />
        <div className="text-text-primary font-semibold mb-2">知识图谱尚未构建</div>
        <div className="text-sm text-text-secondary max-w-md">
          请先在「知识网络」页点击「重建图谱」，构建完成后即可查看图谱统计报告。
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-3xl mx-auto space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-text-primary">图谱报告</h1>
            <p className="text-sm text-text-secondary mt-1">知识网络的统计与结构概览</p>
          </div>
        </div>

        {status?.stale && (
          <div className="glass-card px-4 py-2.5 rounded-xl flex items-center gap-2 text-xs text-amber-300 border border-amber-400/30">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            内容已更新，报告将在重新构建后更新
          </div>
        )}

        {reportLoading ? (
          <div className="flex items-center gap-2 text-sm text-text-secondary py-8 justify-center">
            <Loader2 className="w-4 h-4 animate-spin text-info" />
            加载报告中...
          </div>
        ) : report ? (
          <div className="card">{renderMarkdown(report.content)}</div>
        ) : (
          <div className="card text-sm text-text-secondary text-center py-8">暂无报告内容</div>
        )}
      </div>
    </div>
  );
};

export default GraphReportPage;
