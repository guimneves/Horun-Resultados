/** Exporta o primeiro <svg> do Recharts dentro de `container` como PNG
 * (fundo do tema atual), sem biblioteca extra. */
export async function downloadChartPng(container: HTMLElement | null, filename: string): Promise<void> {
  const svg = container?.querySelector('svg.recharts-surface') as SVGSVGElement | null
  if (!svg) return
  const { width, height } = svg.getBoundingClientRect()
  const clone = svg.cloneNode(true) as SVGSVGElement
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.setAttribute('width', String(width))
  clone.setAttribute('height', String(height))
  // as cores vêm de variáveis CSS: resolve antes de serializar
  const styles = getComputedStyle(document.documentElement)
  const text = new XMLSerializer()
    .serializeToString(clone)
    .replace(/var\((--[\w-]+)\)/g, (_m, name: string) => styles.getPropertyValue(name).trim() || '#000')
  const img = new Image()
  const url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml;charset=utf-8' }))
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('svg'))
    img.src = url
  })
  const scale = 2
  const canvas = document.createElement('canvas')
  canvas.width = width * scale
  canvas.height = height * scale
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.fillStyle = styles.getPropertyValue('--color-bg-elevated').trim() || '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.scale(scale, scale)
  ctx.drawImage(img, 0, 0, width, height)
  URL.revokeObjectURL(url)
  const a = document.createElement('a')
  a.href = canvas.toDataURL('image/png')
  a.download = filename.endsWith('.png') ? filename : `${filename}.png`
  a.click()
}
