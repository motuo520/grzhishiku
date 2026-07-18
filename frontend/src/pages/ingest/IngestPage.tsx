import { FC } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Scissors, FileText, Rss, Tag, Mail, Share2, ArrowRight, Construction, Upload, BookOpen, FolderOpen } from 'lucide-react';

const ingestCards = [
  {
    key: 'clipper',
    title: '浏览器剪藏',
    desc: '一键采集网页内容，构建外部知识库',
    icon: Scissors,
    active: true,
    path: '/ingest/clipper',
    badge: 'Network Brain',
    badgeClass: 'badge-network',
  },
  {
    key: 'notes',
    title: '笔记管理',
    desc: '记录灵感、整理思绪，Personal Brain 核心',
    icon: FileText,
    active: true,
    path: '/ingest/notes',
    badge: 'Personal Brain',
    badgeClass: 'badge-personal',
  },
  {
    key: 'batch',
    title: '批量导入',
    desc: '批量导入笔记、剪藏、URL 和 RSS 源',
    icon: Upload,
    active: true,
    path: '/ingest/batch-import',
    badge: 'Fusion',
    badgeClass: 'badge-fusion',
  },
  {
    key: 'rss',
    title: 'RSS 聚合',
    desc: '订阅源自动聚合，信息高速公路',
    icon: Rss,
    active: true,
    path: '/ingest/rss',
    badge: 'Network Brain',
    badgeClass: 'badge-network',
  },
  {
    key: 'tags',
    title: '标签系统',
    desc: '多维度知识组织与自动标签关联',
    icon: Tag,
    active: true,
    path: '/ingest/tags',
    badge: 'Fusion',
    badgeClass: 'badge-fusion',
  },
  {
    key: 'email',
    title: '邮件集成',
    desc: '通过邮件发送内容到双脑系统',
    icon: Mail,
    active: false,
    badge: 'Personal Brain',
    badgeClass: 'badge-personal',
  },
  {
    key: 'social',
    title: '社交聚合',
    desc: '整合微信、钉钉、飞书等社交/协作数据',
    icon: Share2,
    active: true,
    path: '/ingest/social',
    badge: 'Network Brain',
    badgeClass: 'badge-network',
  },
  {
    key: 'read-later',
    title: '稍后读',
    desc: '收藏链接，稍后阅读并归档到知识库',
    icon: BookOpen,
    active: true,
    path: '/ingest/read-later',
    badge: 'Network Brain',
    badgeClass: 'badge-network',
  },
  {
    key: 'documents',
    title: '文件/文档库',
    desc: '上传本地文档，提取正文并归档到知识库',
    icon: FolderOpen,
    active: true,
    path: '/ingest/documents',
    badge: 'Fusion',
    badgeClass: 'badge-fusion',
  },
];

const IngestPage: FC = () => {
  const navigate = useNavigate();

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">采集中心</h1>
          <p className="text-sm text-text-secondary mt-1">信息摄入、整理与分类入口</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {ingestCards.map((card, index) => {
          const Icon = card.icon;
          return (
            <motion.div
              key={card.key}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.06 }}
              onClick={() => {
                if (card.active && card.path) {
                  navigate(card.path);
                }
              }}
              className={`relative group overflow-hidden rounded-[2px] border p-5 transition-all duration-300 ${
                card.active
                  ? 'bg-white/[0.03] border-white/[0.08] cursor-pointer hover:border-info/30'
                  : 'bg-white/[0.015] border-white/[0.04] cursor-default'
              }`}
            >
              <div className="flex items-start justify-between mb-3">
                <div
                  className={`p-2.5 rounded-[2px] ${
                    card.active
                      ? 'bg-white/[0.05] text-info group-hover:text-[#5b7c99] group-hover:bg-white/[0.08]'
                      : 'bg-white/[0.03] text-[#484f58]'
                  } transition-colors`}
                >
                  <Icon className="w-5 h-5" />
                </div>
                <div className="flex items-center gap-2">
                  <span className={`${card.badgeClass} text-[10px] py-0.5 px-2`}>{card.badge}</span>
                  {card.active ? (
                    <ArrowRight className="w-4 h-4 text-text-muted opacity-0 group-hover:opacity-100 transition-opacity -translate-x-1 group-hover:translate-x-0" />
                  ) : (
                    <Construction className="w-4 h-4 text-[#484f58]" />
                  )}
                </div>
              </div>
              <div className="text-sm font-medium text-text-primary mb-1">{card.title}</div>
              <div className={`text-xs leading-relaxed ${card.active ? 'text-text-secondary' : 'text-[#484f58]'}`}>
                {card.active ? card.desc : '功能开发中...'}
              </div>
              {!card.active && (
                <div className="absolute inset-0 flex items-center justify-center bg-bg-primary/40 rounded-[2px]">
                  <div className="flex items-center gap-2 px-3 py-1.5 rounded-[2px] bg-bg-tertiary/80 border border-border-color/50 text-text-secondary text-xs">
                    <Construction className="w-3.5 h-3.5" />
                    开发中
                  </div>
                </div>
              )}
            </motion.div>
          );
        })}
      </div>
    </div>
  );
};

export default IngestPage;
