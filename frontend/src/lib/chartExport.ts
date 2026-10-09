// Exportação dos gráficos em PNG (reformulada em 09/10/2026, pedido do
// mantenedor): a imagem sai SEMPRE com título, subtítulo e a legenda do
// gráfico (a legenda do Recharts é HTML, fora do <svg> — antes ela sumia no
// PNG). Vários gráficos de uma vez saem num .zip. Tudo no navegador, sem
// biblioteca extra.

export interface ChartImageSource {
  /** Elemento que contém o gráfico do Recharts (.recharts-wrapper). */
  chart: HTMLElement
  title: string
  subtitle?: string
}

const SCALE = 2
const PAD = 20

function cssVars(): CSSStyleDeclaration {
  return getComputedStyle(document.documentElement)
}

/** <svg> → imagem, com as variáveis CSS (cores do tema) já resolvidas e a fonte da página. */
async function svgToImage(svg: SVGSVGElement, width: number, height: number): Promise<HTMLImageElement> {
  const clone = svg.cloneNode(true) as SVGSVGElement
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.setAttribute('width', String(width))
  clone.setAttribute('height', String(height))
  clone.style.fontFamily = getComputedStyle(svg).fontFamily || 'sans-serif'
  // cores que vêm de CSS (classes) e não de atributo: copia o valor calculado
  const src = svg.querySelectorAll<SVGElement>('text, tspan')
  clone.querySelectorAll<SVGElement>('text, tspan').forEach((el, i) => {
    const cs = src[i] ? getComputedStyle(src[i]) : null
    if (cs && !el.getAttribute('fill')) el.setAttribute('fill', cs.fill)
    if (cs) el.style.fontSize = cs.fontSize
  })
  const styles = cssVars()
  const text = new XMLSerializer()
    .serializeToString(clone)
    .replace(/var\((--[\w-]+)\)/g, (_m, name: string) => styles.getPropertyValue(name).trim() || '#000')
  const url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml;charset=utf-8' }))
  try {
    const img = new Image()
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('Não foi possível desenhar o gráfico.'))
      img.src = url
    })
    return img
  } finally {
    // a imagem já foi decodificada; o endereço pode ir embora depois do desenho
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
}

interface LegendEntry {
  icon: HTMLImageElement | null
  iconW: number
  iconH: number
  text: string
  color: string
  inactive: boolean
}

async function legendEntries(chart: HTMLElement): Promise<LegendEntry[]> {
  const items = Array.from(chart.querySelectorAll<HTMLElement>('.recharts-legend-item'))
  return Promise.all(
    items.map(async (item) => {
      const iconSvg = item.querySelector('svg') as SVGSVGElement | null
      const rect = iconSvg?.getBoundingClientRect()
      const iconW = rect?.width || 14
      const iconH = rect?.height || 14
      const label = item.querySelector<HTMLElement>('.recharts-legend-item-text') ?? item
      return {
        icon: iconSvg ? await svgToImage(iconSvg, iconW, iconH).catch(() => null) : null,
        iconW,
        iconH,
        text: (label.textContent ?? '').trim(),
        color: getComputedStyle(label).color,
        inactive: item.classList.contains('inactive'),
      }
    }),
  )
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    const test = line ? `${line} ${word}` : word
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line)
      line = word
    } else line = test
  }
  if (line) lines.push(line)
  return lines
}

/** Gráfico (título + subtítulo + desenho + legenda) → PNG. */
export async function renderChartPng(source: ChartImageSource): Promise<Blob> {
  const wrapper = source.chart.querySelector<HTMLElement>('.recharts-wrapper')
  const svg = wrapper?.querySelector(':scope > svg.recharts-surface') as SVGSVGElement | null
  if (!wrapper || !svg) throw new Error(`"${source.title}": gráfico não encontrado na tela.`)
  const box = svg.getBoundingClientRect()
  const chartW = box.width || Number(svg.getAttribute('width')) || 800
  const chartH = box.height || Number(svg.getAttribute('height')) || 320
  const chartImg = await svgToImage(svg, chartW, chartH)
  const legend = await legendEntries(wrapper)

  const styles = cssVars()
  const bg = styles.getPropertyValue('--color-bg-elevated').trim() || '#ffffff'
  const fg = styles.getPropertyValue('--color-text').trim() || '#111111'
  const muted = styles.getPropertyValue('--color-text-muted').trim() || '#666666'
  const font = getComputedStyle(document.body).fontFamily || 'sans-serif'
  const width = Math.max(chartW, 480) + 2 * PAD

  // medidas (num contexto de rascunho)
  const measure = document.createElement('canvas').getContext('2d')!
  measure.font = `600 16px ${font}`
  const titleLines = wrapText(measure, source.title, width - 2 * PAD)
  measure.font = `12px ${font}`
  const subLines = source.subtitle ? wrapText(measure, source.subtitle, width - 2 * PAD) : []
  const rows: { entries: (LegendEntry & { w: number })[]; w: number }[] = []
  measure.font = `12px ${font}`
  for (const e of legend) {
    const w = e.iconW + 6 + measure.measureText(e.text).width + 18
    const last = rows[rows.length - 1]
    if (!last || last.w + w > width - 2 * PAD) rows.push({ entries: [{ ...e, w }], w })
    else {
      last.entries.push({ ...e, w })
      last.w += w
    }
  }
  const titleH = titleLines.length * 22
  const subH = subLines.length * 16
  const legendH = rows.length ? rows.length * 22 + 8 : 0
  const height = PAD + titleH + (subH ? subH + 4 : 0) + 10 + chartH + legendH + PAD

  const canvas = document.createElement('canvas')
  canvas.width = Math.round(width * SCALE)
  canvas.height = Math.round(height * SCALE)
  const ctx = canvas.getContext('2d')!
  ctx.scale(SCALE, SCALE)
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, width, height)
  ctx.textBaseline = 'top'

  let y = PAD
  ctx.fillStyle = fg
  ctx.font = `600 16px ${font}`
  for (const line of titleLines) {
    ctx.fillText(line, PAD, y)
    y += 22
  }
  if (subLines.length) {
    ctx.fillStyle = muted
    ctx.font = `12px ${font}`
    for (const line of subLines) {
      ctx.fillText(line, PAD, y)
      y += 16
    }
    y += 4
  }
  y += 10
  ctx.drawImage(chartImg, PAD + (width - 2 * PAD - chartW) / 2, y, chartW, chartH)
  y += chartH + 8

  ctx.font = `12px ${font}`
  ctx.textBaseline = 'middle'
  for (const row of rows) {
    let x = (width - row.w) / 2
    for (const e of row.entries) {
      ctx.globalAlpha = e.inactive ? 0.4 : 1
      if (e.icon) ctx.drawImage(e.icon, x, y + 11 - e.iconH / 2, e.iconW, e.iconH)
      ctx.fillStyle = e.color || fg
      ctx.fillText(e.text, x + e.iconW + 6, y + 11)
      x += e.w
    }
    y += 22
  }
  ctx.globalAlpha = 1

  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Não foi possível gerar o PNG.'))), 'image/png'),
  )
}

export function safeFilename(name: string): string {
  const clean = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\w.\- ()+×]+/g, '_')
    .replace(/×/g, 'x')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100)
  return clean || 'grafico'
}

function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export async function downloadChartPng(source: ChartImageSource, filename?: string): Promise<void> {
  const name = safeFilename(filename ?? source.title)
  saveBlob(await renderChartPng(source), name.endsWith('.png') ? name : `${name}.png`)
}

// ---------------------------------------------------------------- .zip

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff
  for (let i = 0; i < data.length; i++) crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

/** .zip sem compressão (PNG já é comprimido) — formato "stored". */
export function makeZip(files: { name: string; data: Uint8Array }[]): Blob {
  const enc = new TextEncoder()
  const parts: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  for (const f of files) {
    const name = enc.encode(f.name)
    const crc = crc32(f.data)
    const local = new DataView(new ArrayBuffer(30))
    local.setUint32(0, 0x04034b50, true)
    local.setUint16(4, 20, true)
    local.setUint16(6, 0x0800, true) // nomes em UTF-8
    local.setUint32(14, crc, true)
    local.setUint32(18, f.data.length, true)
    local.setUint32(22, f.data.length, true)
    local.setUint16(26, name.length, true)
    parts.push(new Uint8Array(local.buffer), name, f.data)
    const cd = new DataView(new ArrayBuffer(46))
    cd.setUint32(0, 0x02014b50, true)
    cd.setUint16(4, 20, true)
    cd.setUint16(6, 20, true)
    cd.setUint16(8, 0x0800, true)
    cd.setUint32(16, crc, true)
    cd.setUint32(20, f.data.length, true)
    cd.setUint32(24, f.data.length, true)
    cd.setUint16(28, name.length, true)
    cd.setUint32(42, offset, true)
    central.push(new Uint8Array(cd.buffer), name)
    offset += 30 + name.length + f.data.length
  }
  const centralSize = central.reduce((n, p) => n + p.length, 0)
  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054b50, true)
  end.setUint16(8, files.length, true)
  end.setUint16(10, files.length, true)
  end.setUint32(12, centralSize, true)
  end.setUint32(16, offset, true)
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)] as BlobPart[], { type: 'application/zip' })
}

/** Vários gráficos: um só → PNG; dois ou mais → .zip com um PNG cada. */
export async function downloadChartsPng(sources: ChartImageSource[], zipName = 'graficos'): Promise<void> {
  if (sources.length === 1) return downloadChartPng(sources[0])
  const used = new Set<string>()
  const files: { name: string; data: Uint8Array }[] = []
  for (const [i, s] of sources.entries()) {
    let base = `${String(i + 1).padStart(2, '0')} - ${safeFilename(s.title)}`
    while (used.has(base)) base += '_'
    used.add(base)
    files.push({ name: `${base}.png`, data: new Uint8Array(await (await renderChartPng(s)).arrayBuffer()) })
  }
  saveBlob(makeZip(files), `${safeFilename(zipName)}.zip`)
}
