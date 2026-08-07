/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // 亮色 + 暖米黄调色板（参考用户提供的健康仪表盘截图）
        canvas: '#F4F1EA',   // 主背景（暖米白）
        surface: '#FFFFFF',  // 卡片白
        'ink-strong': '#1F2024',  // 主文本（近黑）
        'ink-soft': '#6B6E76',    // 副文本
        'ink-mute': '#9A9CA3',    // 弱化文本
        line: '#E8E4DA',     // 细线/边框
        brand: '#1F2024',    // 主按钮（深近黑）
        'brand-soft': '#EFECE5', // 次按钮底
        accent: '#2D8A8A',   // 点缀（青绿）
        warning: '#E76A2A',
        danger: '#D8424F',
        success: '#2B9A6A',

        // 1:1 复刻健康仪表盘新增令牌
        sand: '#E0D5BD',          // 米色大卡背景（Workout Results）
        'sand-soft': '#EAE0CB',   // 米色浅一档
        'dark-card': '#2A2622',   // 深色卡片背景（Training Days 日历）
        'dark-card-soft': '#3A3631', // 深色卡片次级面
        'accent-yellow': '#F5C842', // 日历 done 标记 / 黄色气泡
        'accent-coral': '#E55B47',  // 红色气泡 / 圆环进度
        'accent-orange': '#FF7043', // 圆环 arc 橙
      },
      borderRadius: {
        card: '20px',
      },
      boxShadow: {
        card: '0 4px 16px -4px rgba(31, 32, 36, 0.06), 0 2px 4px -2px rgba(31, 32, 36, 0.04)',
        'card-hover': '0 8px 28px -6px rgba(31, 32, 36, 0.10), 0 4px 8px -4px rgba(31, 32, 36, 0.06)',
        iconBtn: '0 2px 8px -2px rgba(31, 32, 36, 0.08)',
      },
    },
  },
  plugins: [],
}
