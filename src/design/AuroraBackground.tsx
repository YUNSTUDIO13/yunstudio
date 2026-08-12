// 极光背景层 —— 1:1 复刻设计稿 Background()
// 固定在视口底层，pointer-events:none，主内容区需 relative z-10 压其上

export default function AuroraBackground() {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 0, overflow: 'hidden', pointerEvents: 'none' }}>
      {/* 顶层画布：顶部一小段融入 theme_color(#0d0c1a) 再过渡到底色 #040408。
          目的：让状态栏(系统层theme_color)与网页内容的边界同色，视觉上消除安卓Chrome在
          standalone模式下绘制的系统级状态栏分隔线(灰线)。 */}
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, #0d0c1a 0%, #0d0c1a 7%, #040408 26%)' }} />
      {/* 顶部极光带 —— 让沉浸式状态栏透出有质感的紫调极光而非死黑画布（状态栏高度区域即其下缘） */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: '42vh',
        background: 'linear-gradient(to bottom, rgba(124,133,245,0.18) 0%, rgba(192,132,252,0.09) 38%, transparent 100%)',
        filter: 'blur(34px)',
        pointerEvents: 'none',
      }} />
      {/* aurora layer 1 — large violet */}
      <div style={{
        position: 'absolute', width: 900, height: 700,
        top: '-20%', left: '-5%',
        background: 'radial-gradient(ellipse at center, rgba(99,102,241,0.13) 0%, transparent 62%)',
        filter: 'blur(50px)',
        willChange: 'transform',
      }} />
      {/* aurora layer 2 — purple, bottom-right */}
      <div style={{
        position: 'absolute', width: 650, height: 600,
        bottom: '-15%', right: '5%',
        background: 'radial-gradient(ellipse at center, rgba(192,132,252,0.11) 0%, transparent 60%)',
        filter: 'blur(55px)',
        willChange: 'transform',
      }} />
      {/* aurora layer 3 — teal accent, mid */}
      <div style={{
        position: 'absolute', width: 440, height: 440,
        top: '38%', right: '20%',
        background: 'radial-gradient(circle, rgba(56,189,248,0.055) 0%, transparent 62%)',
        filter: 'blur(45px)',
        willChange: 'transform',
      }} />
      {/* very subtle dot grid */}
      <div style={{
        position: 'absolute', inset: 0,
        backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.018) 1px, transparent 1px)',
        backgroundSize: '28px 28px',
      }} />
      {/* vignette */}
      <div style={{
        position: 'absolute', inset: 0,
        background: 'radial-gradient(ellipse at 50% 50%, transparent 55%, rgba(4,4,8,0.65) 100%)',
      }} />
    </div>
  )
}
