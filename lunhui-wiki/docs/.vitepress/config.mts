import { defineConfig } from 'vitepress'

// 《轮回乐园》世界观百科 —— 逐章考据 · 忠于原著 · 渐进更新
export default defineConfig({
  lang: 'zh-CN',
  title: '轮回乐园百科',
  description: '《轮回乐园》世界观百科 · 逐章考据 · 忠于原著',
  lastUpdated: true,
  cleanUrls: true,
  head: [['link', { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }]],
  themeConfig: {
    logo: '/favicon.svg',
    search: { provider: 'local' },
    outline: { level: [2, 3], label: '本页目录' },
    docFooter: { prev: '上一篇', next: '下一篇' },
    darkModeSwitchLabel: '主题',
    lightModeSwitchTitle: '切换到浅色',
    darkModeSwitchTitle: '切换到深色',
    sidebarMenuLabel: '目录',
    returnToTopLabel: '回到顶部',
    lastUpdatedText: '最后更新',
    nav: [
      { text: '总览', link: '/总览/' },
      { text: '力量体系', link: '/力量体系/' },
      { text: '人物', link: '/人物/' },
      { text: '势力', link: '/势力/' },
      { text: '世界', link: '/世界/' },
      { text: '参考', link: '/参考/编写规范' }
    ],
    sidebar: [
      {
        text: '总览',
        collapsed: false,
        items: [
          { text: '简介', link: '/总览/' },
          { text: '轮回乐园机制', link: '/总览/轮回乐园机制' },
          { text: '货币与商店', link: '/总览/货币与商店' },
          { text: '纪元与宇宙背景', link: '/总览/纪元与宇宙背景' },
          { text: '时间线', link: '/总览/时间线' }
        ]
      },
      {
        text: '力量体系',
        collapsed: false,
        items: [
          { text: '总览', link: '/力量体系/' },
          { text: '阶位', link: '/力量体系/阶位' },
          { text: '天赋', link: '/力量体系/天赋' },
          { text: '技能·功法', link: '/力量体系/技能' },
          { text: '血脉·体质', link: '/力量体系/血脉体质' },
          { text: '装备·道具', link: '/力量体系/装备道具' },
          { text: '消耗品·材料', link: '/力量体系/消耗品材料' }
        ]
      },
      {
        text: '人物',
        collapsed: false,
        items: [
          { text: '总览', link: '/人物/' },
          { text: '苏晓', link: '/人物/苏晓' }
        ]
      },
      {
        text: '势力',
        collapsed: false,
        items: [{ text: '总览', link: '/势力/' }]
      },
      {
        text: '世界',
        collapsed: false,
        items: [
          { text: '总览', link: '/世界/' },
          { text: '任务世界', link: '/世界/任务世界/' },
          { text: '地点', link: '/世界/地点/' },
          { text: '生物·万族', link: '/世界/生物万族/' }
        ]
      },
      {
        text: '参考',
        collapsed: false,
        items: [
          { text: '章节梗概', link: '/参考/章节梗概/' },
          { text: '编写规范', link: '/参考/编写规范' }
        ]
      }
    ]
  }
})
