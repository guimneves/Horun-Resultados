// Paleta categórica validada (ordem fixa, nunca reciclada; checada com o
// validador de daltonismo/contraste — claro e escuro). Cores seguem o
// SIGNIFICADO (fração, componente do gás), nunca a posição na lista.
export const PALETTE = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948']

// Famílias por fração (pedido do mantenedor, 15/10/2026: "mais cores por
// padrão, sempre diferenciando hidropirólise das extraídas"): cada série de
// uma fração (réplicas A/B/C, atmosferas) ganha um tom próprio da família —
// hidropirolisada sempre em tons FRIOS (azuis/violetas), extraída sempre em
// tons QUENTES (laranjas/vermelhos). Nunca se cruzam. O 1º tom é o de sempre.
export const FRACTION_FAMILIES: Record<string, string[]> = {
  H: ['#2a78d6', '#0f9fb5', '#4a3aa7', '#5aa9e6', '#1d4f91', '#7b61c9'],
  E: ['#eb6834', '#e34948', '#eda100', '#e87ba4', '#a8521d', '#c2366d'],
  G: ['#1baf7a', '#008300', '#6fbf3a', '#0b6e4f'],
  HP: ['#8c8a2a', '#b3a43c', '#6e6a1e'],
}
// SE (sem extração) entra na mesma linha de H
FRACTION_FAMILIES.SE = FRACTION_FAMILIES.H

export const FRACTION_COLORS: Record<string, string> = {
  H: FRACTION_FAMILIES.H[0], // hidropirolisada (e SE, que entra na mesma linha)
  SE: FRACTION_FAMILIES.H[0],
  E: FRACTION_FAMILIES.E[0], // extraída
  G: FRACTION_FAMILIES.G[0], // gás
  HP: FRACTION_FAMILIES.HP[0], // HP sem sufixo
  O: '#6b6f7d', // rocha original: linha de referência neutra
  STD: '#8a8a8a',
  X: '#8a8a8a',
  // tabaco (19/10/2026): um tom por tipo de produto
  CHA: '#a8521d', // charuto
  CIG: '#2a78d6', // cigarro
  NAR: '#1baf7a', // essência de narguilé
  TAB: '#6b6f7d', // tipo a definir
}

/** i-ésimo tom da família da fração (séries da mesma fração lado a lado). */
export function familyColor(fraction: string, i: number): string {
  const fam = FRACTION_FAMILIES[fraction]
  return fam ? fam[i % fam.length] : fractionColor(fraction)
}

// Composição do gás (barras empilhadas): ordem fixa da paleta validada.
export const GAS_COLORS: Record<string, string> = {
  H2: PALETTE[0],
  CO2: PALETTE[1],
  C1: PALETTE[2],
  C2: PALETTE[3],
  C3: PALETTE[4],
  C4: PALETTE[5],
  C5p: PALETTE[6],
}

/** Réplicas do experimento separadas: mesmo tom da fração, traço diferente
 * (codificação secundária, não só cor). */
export const REPLICATE_DASH: Record<string, string | undefined> = { A: undefined, B: '6 3', C: '2 3', D: '8 3 2 3' }

export function fractionColor(code: string): string {
  return FRACTION_COLORS[code] ?? '#6b6f7d'
}

/** Cor da i-ésima amostra/curva sobreposta; acima de 8, repete com traço
 * diferente (quem chama decide o traço com `dashFor`). */
export function seriesColor(i: number): string {
  return PALETTE[i % PALETTE.length]
}

export function dashFor(i: number): string | undefined {
  return i < PALETTE.length ? undefined : '5 3'
}

// Massas do balanço (gráficos de massa × temperatura): uma cor por massa;
// o gás usa a mesma cor da fração G.
export const MASS_COLORS: Record<string, string> = {
  oil_mass_g: PALETTE[3],
  gas_mass_g: PALETTE[2],
  bitumen_mass_g: PALETTE[6],
}

/** Atmosferas diferentes no mesmo gráfico de massa: mesmo tom, traço diferente. */
export function atmosphereDash(i: number): string | undefined {
  return [undefined, '6 3', '2 3', '8 3 2 3'][i % 4]
}
