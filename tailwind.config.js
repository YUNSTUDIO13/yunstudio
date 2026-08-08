/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // 暗色玻璃语义（1:1 复刻高级简约UI）
        canvas: '#040408',        // 主背景（近黑，与设计稿 #040408 一致）
        surface: '#0e0e16',       // 卡片实色底（玻璃质感由 .glass-* 工具类提供）
        'ink-strong': '#ECECF4',  // 主文本（近白）
        'ink-soft': '#9A9CA8',    // 副文本
        'ink-mute': '#6B6E78',    // 弱化文本
        line: '#26262E',          // 细线/边框（玻璃边由 .glass-* 提供）
        brand: '#7c85f5',         // 主按钮（靛紫，渐变由 ui Button 处理）
        'brand-soft': '#1A1A24',  // 次按钮底
        accent: '#7c85f5',        // 靛紫强调
        'accent-2': '#c084fc',    // 紫
        warning: '#fbbf24',
        danger: '#f87171',
        success: '#5eead4',

        // 兼容旧引用（无害保留）
        sand: '#E0D5BD',
        'sand-soft': '#EAE0CB',
        'dark-card': '#2A2622',
        'dark-card-soft': '#3A3631',
        'accent-yellow': '#F5C842',
        'accent-coral': '#E55B47',
        'accent-orange': '#FF7043',
      },
      borderRadius: {
        card: '20px',
      },
      boxShadow: {
        card: '0 4px 16px -4px rgba(0,0,0,0.4), 0 2px 4px -2px rgba(0,0,0,0.3)',
        'card-hover': '0 8px 28px -6px rgba(0,0,0,0.5), 0 4px 8px -4px rgba(0,0,0,0.4)',
        iconBtn: '0 2px 8px -2px rgba(0,0,0,0.4)',
      },
    },
  },
  plugins: [],
}
