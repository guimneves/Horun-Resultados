# Horun · Resultados — especificação (v1, 07/10/2026)

Módulo do Horun para **reunir, comparar e interpretar resultados de análises**
das amostras do laboratório (NQTR/IQ-UFRJ). Complementa o **Amostras**
(fluxo/fila de análises) e o **RE7S** (operação do Rock-Eval): aqui é onde os
resultados de vários equipamentos se encontram, por projeto, em tabelas e
gráficos de séries de experimentos — e onde fica o **banco de experimentos
válidos**.

> **Repositório: nunca commitar dados reais** (resultados, planilhas, PDFs,
> nomes de pessoas). Os arquivos de exemplo ficam FORA do repositório
> (`Programas/Horun/Exemplos-Resultados`, só na máquina do mantenedor); os
> testes geram arquivos sintéticos com a mesma estrutura.

## 1. Fluxo do laboratório (contexto)

Experimento de **hidropirólise** numa temperatura (tipicamente 280, 300, 320,
330, 340, 350, 355, 360, 365 °C) → as rochas são separadas, moídas, peneiradas
e parte delas é **extraída** → dois conjuntos de amostras: rocha **só
hidropirolisada** e rocha **hidropirolisada + extraída**. Também há a **rocha
original** (não aquecida) e o **gás** gerado no reator. Análises principais:
**CHNSO**, **LECO**, **Rock-Eval**, **cromatografia** (GC-FID/TCD do gás e
Py-GC-MS da rocha).

## 2. Códigos de amostra vistos nos arquivos reais

| Exemplo | Leitura provável |
|---|---|
| `HP320` / `HP320-1` (`-1..3` = réplica de análise) | hidropirólise a 320 °C (sem sufixo de fração) |
| `HP320H`, `HP320H-2` | rocha **hidropirolisada** (H) |
| `HP320E`, `HP355E-1`, `HP320E.1`, `HP320E.2` | rocha **extraída** (E); `.1/.2` = alíquotas/extrações |
| `HP280SE`, `HP330SE` | sufixo **SE** — significado a confirmar com o laboratório |
| `HP300NA`, `HP280NB`, `HP320NC`, `HP320NA2` | **experimento** (corrida) N + letra (A, B, C...) e às vezes número; é o nome das pastas do gás |
| `HP355NB`, `HP355NBE` | rocha do experimento HP355NB; `E` = extraída |
| `RO-1`, `ROA`, `Rocha virgem 80 mesh` | rocha original (não aquecida) |
| `Sulphanilamide`, `Cistina`, `BBOT`, `C28`, `CF`... | padrões e outras amostras (não são da série) |

Regra: o módulo **sugere** temperatura, experimento, fração e réplica a partir
do código (parser tolerante, com testes para todos os exemplos acima), mas a
pessoa **confirma ou corrige**; códigos que não seguem o padrão entram como
amostra livre. Os significados ficam numa tabela de "frações" editável
(H = hidropirolisada, E = extraída, SE = ?, original...).

## 3. Formatos de arquivo (verificados nos exemplos)

### 3.1 CHNSO — EuroVector (PDF "Results Summary for Element %")
PDF de várias páginas, uma tabela com todas as posições da corrida:
`# | Type (Byp/Std/Smp) | Name | N% | C% | H% | S% | O% | W (mg)`; `-` = sem valor.
O texto extraído (pypdf) vem **uma palavra por linha**; nomes podem ter várias
palavras (`Rocha virgem 80 mesh`, `C30 2104-1`) e vêm quebrados (`HP280-` `1`).
Valores numéricos têm sempre ponto decimal; linha começa com o nº inteiro da
posição seguido do tipo. Cabeçalho tem AutoRun Name e data da análise
(`25 Aug 2026 - 15:18:15`). Ignorar `Byp`; `Std` = padrão de calibração
(guardar como padrão, fora das séries). Há também PDFs "Single Sample Result
(N-Type-Name)" por amostra (mesma informação + áreas/tempos) — aceitar como
alternativa para uma amostra só. Razões derivadas: H/C atômica = (H%/1,008)/(C%/12,011);
S/C, N/C idem; O/C quando houver O.

### 3.2 LECO — CSV exportado do Cornerstone ("Leco Transports.csv")
UTF-8 com BOM, CRLF. Mistura dois tipos de linha:
- **réplica** (58 colunas; cabeçalho começa com `Date,Time,Set ID,Analysis Date,Analysis Time,Name,Type,...`):
  `Name`, `Type` (Sample/Standard/Blank...), `Repetition`, `Carbon` ("21.0 %"),
  `Sulfur` ("4.03 %"), `Sample Mass` ("0.2515 g"), `Method`, `Analysis Date`;
- **conjunto/resumo** (36 colunas, com DOIS cabeçalhos possíveis — um começa
  por `Date,...` e outro por `Name,Type,...`): `Carbon Average`, `Sulfur
  Average`, `Carbon Std. Dev.`, `%RSD`, `Number of Replicates`, `Method`.
Ler pelo nome das colunas (o cabeçalho vigente é o último visto com o mesmo nº
de colunas); calcular média/desvio a partir das réplicas; números vêm com
unidade (" %", " g") — remover. O PDF/ZIP de diagnóstico do aparelho NÃO são
resultados (recusar com mensagem clara).

### 3.3 Rock-Eval — relatório HTML do GeoWorks (".htm", "Job report")
HTML com `<script>` contendo variáveis JavaScript:
- `dataTableHeader` (lista de colunas: Analysis, Sample, Date, Quantity (mg),
  Method, Cycle, TpkS2 (°C), Tmax (°C), TOC (%), MINC (%), S1, S2, S3, S3CO,
  S3CO2, S4, S4CO, S5 (mg/g), S1 S, S2 S, Pyro Fe S, Residual S, Retained S,
  Sulfate S (%), HI, OI, S index) — atenção: há `\xa0` nos nomes;
- `dataTableArray` (uma linha por análise/réplica; Analysis = nome do arquivo
  `.B00`, Sample = código da amostra, ex. `HP355NB`);
- `pyroDataN` / `oxiDataN` (curvas: arrays JS de séries — tempo e sinais
  HC, CO, CO2, SO2, ..., T°) e `curveData` ligando cada Analysis às suas curvas
  (`null` quando não há oxidação).
Extrair com regex + json (os arrays são JSON válido). Guardar a tabela e as
curvas (para sobrepor pirogramas). Futuro: buscar direto do módulo RE7S.

### 3.4 Cromatografia de gás — GC-FID e GC-TCD (planilhas .xlsx do laboratório)
- `... Dados FID ....xlsx` e `... Dados TCD ....xlsx`: aba "Dados FID"/"Dados
  TCD": B2 = amostra (`AMOSTRA:` | `HP300NA`); a partir da linha 6:
  `ID | Átomos Carbono | Analito | TR (min) | Rep_1 | Rep_2 | Rep_3 | Média |
  DSV% | (vazio) | %Ai Rep_1..3 | %Ai Média`; linhas sem analito = fim.
  TCD inclui H2, CO2 além de HCs. Abas de calibração e base de componentes
  podem ser ignoradas (guardar o arquivo).
- `... Planilha cálculo gás.xlsx`: aba "Dados FID-TCD" com **condições do
  experimento** (rótulo na coluna A, valor na B: "Experimento/Amostra",
  "Reator utilizado", "Massa de inicial de amostra" (g), "Pressão inicial"
  (psi g), "Temperatura inicial", "Pressão abertura reator", "Massa de gás
  após pesagem"...) e resultados (rótulos na coluna I, valores na K: "Massa de
  gás gerada" (g), "Fechamento do balanço de pressão (%)"...) e a composição
  média FID (cols A–C a partir da linha "Componente") e TCD (cols D–E).
  Ler por RÓTULO (não por célula fixa), tolerante a linhas a mais.
- Ignorar arquivos temporários do Excel (`~$...`).

### 3.5 Py-GC-MS da rocha (planilha .xlsx)
Uma aba por amostra/experimento (`HP280`, `HP320`...): linha 2 =
`Tempo de retenção | m/z | Area | Area % | Altura | Altura% | Area/Altura |
Identificação`; linhas seguintes = picos (n-C10..., Pristano, Fitano...).
Derivados úteis: Pristano/Fitano, Pr/n-C17, Fi/n-C18, distribuição de
n-alcanos, CPI quando houver os pares.

### 3.6 Tabela de literatura (opcional)
Planilha "Table_6 ... Artigo Spigolon" = dados publicados (parâmetros por
temperatura). Suportar, de forma genérica, **importar uma tabela de referência**
(planilha com 1ª coluna = temperatura/amostra e demais = parâmetros) para
sobrepor nos gráficos como "referência" — não é prioridade da v1.

## 4. Modelo de dados

- **Projeto**: nome, descrição, cor, arquivado (sem código/vigência — pedido do mantenedor).
- **Experimento** (por projeto): código (`HP300NA`), temperatura (°C), tempo (h),
  reator, massa inicial, data, observações, condições extras (JSON) lidas da
  planilha de gás.
- **Amostra** (por projeto): código, experimento (opcional), fração/tipo
  (original, hidropirolisada H, extraída E, gás, padrão, outra), temperatura
  (herdada do experimento ou do código), réplica do material (`.1`, `.2`),
  observações, **válida** (sim/não, com quem/quando validou).
- **Análise**: amostra, técnica (chnso, leco, rockeval, gc_fid, gc_tcd,
  gas_balanco, pygcms), data da análise, equipamento/método, arquivo de
  origem, **válida** (sim/não), observações.
- **Valores**: (análise, parâmetro, réplica, valor, unidade) — esquema
  flexível; médias/desvios calculados. Parâmetros com nome e unidade padronizados
  por técnica (catálogo no código).
- **Curvas / tabelas de picos**: JSON por análise (pirogramas Rock-Eval,
  composição de gás, picos Py-GC-MS).
- **Arquivo**: original enviado (guardado no volume do módulo), sha256 (evita
  importar duas vezes), técnica detectada, relatório da importação.

## 5. Importação

1. A pessoa escolhe o projeto e envia um ou vários arquivos (ou um .zip).
2. O módulo **detecta o formato** (cabeçalhos/estrutura, não só a extensão) e
   mostra uma **prévia**: amostras encontradas → para cada uma, "vincular a
   amostra existente" (casada pelo código normalizado) ou "criar nova" (com
   temperatura/fração sugeridas); padrões e brancos marcados à parte; avisos.
3. Confirmar grava. Reimportar o mesmo arquivo (mesmo sha256) não duplica.
4. Tudo fica no histórico (quem importou, quando, de qual arquivo).

## 6. Visualização (o coração do módulo)

- **Projeto → Amostras**: tabela filtrável (técnicas disponíveis, temperatura,
  fração, experimento, válidas) com os principais parâmetros de cada técnica.
- **Série**: escolher parâmetro(s) × temperatura, uma linha por fração (H vs E
  vs original), média ± desvio das réplicas; só válidas (padrão) ou todas.
- **Gráficos prontos**: COT (LECO/Rock-Eval) × temperatura; HI e OI ×
  temperatura; HI × Tmax (com campos de tipo de querogênio); H/C × temperatura
  (CHNSO); S × temperatura; composição do gás (C1–C5+, H2, CO2) empilhada por
  experimento; massa de gás gerada × temperatura; distribuição de n-alcanos
  (Py-GC-MS) por amostra; **sobreposição de pirogramas** Rock-Eval.
- **Comparar**: escolher amostras/experimentos livres e ver tabela + gráficos lado a lado.
- **Exportar**: tabela (CSV/XLSX) do que está filtrado; gráfico em PNG.

## 7. Permissões (regra do mantenedor para módulos atrás do Core)

Papel pelo **cargo no Horun** (`X-Horun-Level`): níveis 1–2 (administrador
máximo, coordenador(a)) = **coordenador**; demais com acesso = **colaborador**.
Colaborador: ver tudo, criar amostras/experimentos, importar arquivos.
Coordenador: tudo isso + criar/arquivar projetos, **validar/invalidar**,
excluir análises/amostras. Excluir projeto: só administrador máximo, com
confirmação digitando o nome. Sem senhas próprias do módulo (no modo de
desenvolvimento, seletor "Ver como" para trocar o nível).

## 8. Regras do Horun que o módulo segue
`Horun Core/Prompt_Horun_Modulo.md` inteiro: API sob `/api`, `/health`,
identidade por cabeçalho, design-system copiado, migração defensiva
(`_ensure_column`), versões exatas, `db-backup`, healthcheck 127.0.0.1,
**aba Manual** (seção 12), **celular** (seção 13), **avisos pelo Core**
(seção 11; ex.: "arquivo importado com N amostras novas" — opcional, sininho).
