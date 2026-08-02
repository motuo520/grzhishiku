import { defineConfig } from 'vitepress'

export default defineConfig({
  title: '个人第二大脑',
  description: '本地优先的开源个人知识库 / Local-first open-source personal knowledge base',
  lang: 'zh-CN',
  lastUpdated: true,
  cleanUrls: true,
  ignoreDeadLinks: true,
  themeConfig: {
    nav: [
      { text: '首页', link: '/' },
      { text: '指南', link: '/guide/getting-started' },
      { text: '对比', link: '/comparison' },
      { text: 'GitHub', link: 'https://github.com/motuo520/grzhishiku' },
    ],
    sidebar: {
      '/guide/': [
        {
          text: '开始使用',
          items: [
            { text: '快速开始', link: '/guide/getting-started' },
            { text: '自托管部署', link: '/guide/self-host' },
            { text: '模型配置', link: '/guide/model-setup' },
            { text: '云同步', link: '/guide/sync' },
          ],
        },
        {
          text: '更多',
          items: [
            { text: '与同类工具对比', link: '/comparison' },
            { text: '依赖许可证清单', link: '/compliance/dependency-licenses' },
          ],
        },
      ],
    },
    socialLinks: [
      { icon: 'github', link: 'https://github.com/motuo520/grzhishiku' },
    ],
    editLink: {
      pattern: 'https://github.com/motuo520/grzhishiku/edit/main/docs/:path',
      text: '在 GitHub 上编辑此页',
    },
    footer: {
      message: '基于 AGPL-3.0 协议发布。',
      copyright: '© 2024-2026 Personal Second Brain Contributors',
    },
  },
})
