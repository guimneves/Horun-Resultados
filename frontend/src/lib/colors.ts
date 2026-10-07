// Paleta categórica validada (ordem fixa, nunca reciclada; checada com o
// validador de daltonismo/contraste — claro e escuro). Cores seguem o
// SIGNIFICADO (fração, componente do gás), nunca a posição na lista.
export const PALETTE = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948']

export const FRACTION_COLORS: Record<string, string> = {
  H: PALETTE[0], // hidropirolisada (e SE, que entra na mesma linha)
  SE: PALETTE[0],
  E: PALETTE[1], // extraída
  G: PALETTE[2], // gás
  HP: PALETTE[4], // HP sem sufixo
  O: '#6b6f7d', // rocha original: linha de referência neutra
  STD: '#8a8a8a',
  X: '#8a8a8a',
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
