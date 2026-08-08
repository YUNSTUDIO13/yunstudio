// 从 public/logo.jpg 居中裁剪为正方形，生成 PWA 所需 PNG 图标
// 用法：node scripts/gen-pwa-icons.mjs
import { Jimp } from 'jimp'

const SRC = 'public/logo.jpg'

async function coverSquare(size, out) {
  const img = await Jimp.read(SRC)
  const w = img.bitmap.width
  const h = img.bitmap.height
  const s = Math.min(w, h)
  const x = Math.floor((w - s) / 2)
  const y = Math.floor((h - s) / 2)
  img.crop({ x, y, w: s, h: s })
  img.resize({ w: size, h: size })
  await img.write(out)
  console.log('wrote', out, `${size}x${size}`)
}

await coverSquare(192, 'public/pwa-192.png')
await coverSquare(512, 'public/pwa-512.png')
await coverSquare(180, 'public/apple-touch-icon.png')
console.log('done')
