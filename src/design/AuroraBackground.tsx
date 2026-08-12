// 极光背景层 —— 1:1 复刻设计稿 Background()
// 固定在视口底层，pointer-events:none，主内容区需 relative z-10 压其上

export default function AuroraBackground() {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 0, overflow: 'hidden', pointerEvents: 'none' }}>
      <div style={{ position: 'absolute', inset: 0, background: '#040408' }} />
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
        animation: 'aurora-drift-a 22s ease-in-out infinite',
      }} />
      {/* aurora layer 2 — purple, bottom-right */}
      <div style={{
        position: 'absolute', width: 650, height: 600,
        bottom: '-15%', right: '5%',
        background: 'radial-gradient(ellipse at center, rgba(192,132,252,0.11) 0%, transparent 60%)',
        filter: 'blur(55px)',
        animation: 'aurora-drift-b 28s ease-in-out infinite',
      }} />
      {/* aurora layer 3 — teal accent, mid */}
      <div style={{
        position: 'absolute', width: 440, height: 440,
        top: '38%', right: '20%',
        background: 'radial-gradient(circle, rgba(56,189,248,0.055) 0%, transparent 62%)',
        filter: 'blur(45px)',
        animation: 'aurora-drift-c 18s ease-in-out infinite',
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
