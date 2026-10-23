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

**Variante "multiheating"** (projeto de tabaco, 14/10/2026): o cabeçalho é
Sample, MINC (%), OI, HI, Q1–Q5 (mg/g), Tmax (°C), TOC (%), Total HC Gas (%),
Total HC Liquid (%), PC (%), RC (%) — **sem** Analysis, Date, Method. O
`curveData` traz o nome da corrida (`"AAAA-MM-DD-AMOSTRA"`) na MESMA ORDEM das
linhas da tabela: sem Analysis, as curvas são ligadas pela posição (se o nº de
curvas e de linhas bater; senão, aviso e sem curvas) e o nome da corrida vira a
chave da medição (data da análise = a data no começo do nome). Parâmetros novos
no catálogo: `Q1`–`Q5`, `PC`, `RC`, `TotalHCGas`, `TotalHCLiquid`.

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

### 3.4b Gás — tabela consolidada ("Tabela_final_consolidada de composição de gás_HP.xlsx", 09/10/2026)
Modelo alternativo à "Planilha cálculo gás": um arquivo com todos os
experimentos. Aba **"Detalhe"** (a fonte; "Tabela final" só soma por
fórmula): Amostra (= código do experimento) | Linha na planilha original |
Componente (original) | Componente (agrupado) | MM | mol% (final, sem N2) |
% mássico | Massa gerada – cromatografia (g) | (mg/g) | Massa gerada –
pressão/pesagem (g) | (mg/g). Aba **"Resumo"** (opcional): uma coluna por
experimento — Massa inicial de amostra (g), Pressão inicial, Pressão de
abertura do reator. Vira `gas_balanco` com a mesma chave da planilha de
cálculo (código do experimento): `comp_*` = mol% somado por nº de carbonos
(C5p = ≥ C5) e normalizado a 100; `gas_mass_g` = Σ massa por cromatografia;
`gas_mass_pressure_g` = Σ massa por pressão/pesagem; `initial_mass_g`;
`gas_yield_mg_g` e `gas_yield_pressure_mg_g`. Linhas sem código de
experimento (notas) são puladas. Leitor: `parsers/gas_consolidated.py`.

### 3.5b LECO - Resíduo Insolúvel ("planilha_massas_amostras-LECO.xlsx", 09/10/2026)
Aba **"Dados"**: linha de grupos (Data | Amostra | Massa do cadinho (g) |
Massa da amostra (g) | Massa do cadinho com amostra (g) | Massa após
tratamento (g) | Resíduo Insolúvel | Observações), com a réplica (1, 2, 3)
na linha de baixo; as colunas "com amostra" e "Resíduo Insolúvel" são
fórmulas (I = C + F; O = I − L). Aba **"Tabela"** (opcional): o mesmo em
layout plano (Cadinho n, Amostra n, Após n) — só é lida se não houver a
"Dados" (no exemplo real as duas divergem em alguns valores).
Por réplica o leitor refaz a conta com as massas: `RI` (g) = cadinho +
amostra − após; `RI_pct` (%) = RI ÷ massa da amostra × 100 (decisão do
mantenedor: resíduo em g, mostrar também em %); `sample_mass` (g).
Réplica sem alguma das três massas é ignorada; Data → data da análise;
Observações → `extra.notes`. Leitor: `parsers/leco_ri.py`.

### 3.7 TG — Shimadzu TGA-50 / TA-60, exportação ASCII (projeto de tabaco, 14/10/2026)
Duas variantes: **UTF-16 com BOM** (começa por "File Name:") e **cp1252**
(começa por "[TA Ascii File]", arquivos "-Corrected.txt" com
`[DataCorrectHistory]`). Seções por rótulo: `[File Information]` ("Sample
Name:", "Sample Weight:	8.000[mg]", "Atmosphere:", "Acquire Date" ou
"Acquisition Date" em aa/mm/dd) e `[Data]`: cabeçalho `Time	Temp	TGA`,
linha de unidades (`sec	C	%` **ou** `sec	C	mg`) e linhas numéricas até a
linha em branco. Em mg, a massa vira % do **1º ponto** (aviso). O arquivo
binário do TA-60 ("TA-60 FILE VER2.00", .tad sem extensão) fica **ignorado**
com o pedido de exportar em ASCII.
Parâmetros (`tg`, pontos percentuais da massa inicial): `loss_150` (umidade,
100 − m(150 °C)), `loss_150_400`, `loss_400_600`, `loss_600_900` (m(início) −
m(fim) da faixa; m(T) = 1º ponto com temperatura ≥ T; faixa não alcançada →
sem valor e aviso), `residue_pct` (massa no ponto de temperatura máxima),
`t_final_c`, `dtg_peak_c` (mínimo de dm/dT, média móvel de 15 pontos e
diferença central ±5 pontos, só com aquecimento > 0,5 °C), `mass_mg` ("Sample
Weight"). Curva em `data` (temperatura, massa %, DTG, tempo; ≤ 800 pontos).
Nome: o do **arquivo** quando ele traz a réplica ("Amostra - rep 2
(Triplicata).txt"), senão o "Sample Name". Leitor: `parsers/tg.py`.

### 3.8 MEV-EDS — Oxford AZtec (projeto de tabaco, 14/10/2026)
Pastas `MEV/<amostra>/[<região>/]eds[N]/Sample 1/Spectrum NN/`. Só o
**"Spectrum NN Quantity analysis.csv"** é de resultados: linhas `CHAVE;valor`
(AV = tensão em V, contagens...), linha em branco, `Element,Atomic %,Weight %`
e linhas `Carbon,55.00%,45.00%`. "Spectrum NN Spectrum.csv" (`Energy
[eV];Counts`), `.msa` (EMSA), imagens e PDFs nas pastas do MEV → **ignorados**.
Parâmetros (`mev_eds`): `wt_<símbolo>` (% massa) e `at_<símbolo>` (% atômica)
para 31 elementos (nome em inglês → símbolo, inclusive "Aluminum"/"Sulphur");
elemento fora da lista → aviso. A amostra vem das **pastas** (`path_hint` do
.zip): a pasta antes de `eds*`; se essa for uma região (externo, interno,
folha externa, miolo, capa, talo...), a amostra é a anterior e a região vai
para `extra.region` (mostrada na prévia; faz parte da chave da medição). Nº do
espectro = réplica. Sem pastas: nome = "Spectrum NN" (a pessoa liga na
prévia). Leitor: `parsers/mev_eds.py`.

### 3.9 LECO — sinal bruto do Cornerstone (projeto de tabaco, 14/10/2026)
CSV com `"Set","Rep","Time","Carbon","Sulfur Low","Sulfur High","Furnace
Power","Furnace Temperature"`, **uma linha por segundo** (~250 s por
corrida), um Set por amostra com réplicas e os brancos ("Blank", réplicas
1–3); células vazias = 0. Não há massa nem calibração → não dá % de C/S.
Leitor `parsers/leco_raw.py` (técnica `leco_bruto`): por Set/Rep soma C, S
baixo e S alto e desconta a **média dos brancos do mesmo arquivo**:
`area_C`, `area_S_low`, `area_S_high` (u.a.) e `duration_s`; curva (tempo ×
sinais, ≤ 600 pontos) em `data`; brancos → `kind = blank` (ignorados por
padrão); aviso fixo "áreas RELATIVAS, não %". Detecção: 1ª linha com Set,
Rep, Time, Carbon e **sem** Name (o CSV de resultados da 3.2 tem Name).

### 3.10 GC-FID (.gcd, GCsolution) e GC-MS (.qgd, GCMSsolution) — Shimadzu (projeto de tabaco, 21/10/2026)

Arquivos compostos do Windows (OLE/CFB, assinatura `D0 CF 11 E0`), lidos com
`olefile` (`parsers/shimadzu.py`). Conferido nos exemplos do laboratório
(mesma corrida com FID e MS em paralelo, método `..._Análise_PY_Tabaco.qgm`).

- `File Property` (os dois): nome da amostra no byte 204 (64 bytes, cp1252),
  ID no 268, data da corrida (FILETIME) no 52, caminhos do arquivo e do método
  como texto.
- `.gcd`: `GC Raw Data-1/Status` = int32 intervalo (ms), int32, int32 pontos;
  `GC Raw Data-1/Intensity Data` = um double por ponto. **Sem tabela de picos**
  — o Horun integra (mínimo móvel 60 s; proeminência ≥ 10 × ruído MAD e ≥ 5 %
  da altura; perpendicular no vale). Parâmetros: `n_peaks`, `total_area`,
  `rt_main_peak`.
- `.qgd`: `GCMS Raw Data/Retention Time` (int32 ms por varredura) e `TIC Data`
  (int64); `GCMS Data Processing/MC Peak Info` (uint16 = nº de picos) e
  `MC Peak Table` (registros de 208 bytes: int32 TR ms @4, double área @8,
  double altura @16, int32 início/fim ms @40/@44, int16 similaridade @60, nome
  do composto @80). Identificado = similaridade ≥ 80. Parâmetros (% da área
  total, só identificados, nomes exatos da biblioteca): `pct_nicotine`,
  `pct_propylene_glycol`, `pct_glycerol`, `pct_furfural`, `pct_hmf`; mais
  `n_peaks`, `n_identified`, `pct_identified`.
- Nome: o sufixo do detector (`_FID`, `_MS`) sai do nome da amostra.

### 3.11 Estudo do PostRun — RE7S (.xlsx, projetos de polímeros, 22/10/2026)

Exportado pelo módulo RE7S (PostRun → Estudos) ao fim de um estudo de
quantificação de polímeros por pirólise. **Contrato versão 1** (o RE7S produz
exatamente isto; versão maior que a suportada → erro pedindo atualização):

- Aba **Sobre** (A = chave, B = valor; linha 1 = `Chave | Valor`): `formato`
  = `horun-postrun-estudo` (outro → "não é um Estudo do PostRun"), `versao`,
  `estudo`, `descricao`, `metodo` (`gauss` | `molde`, o principal), `canal`
  (ex. `pyro:FID`), `gerado_em` (ISO), `status` (`aberto` → aviso | `finalizado`).
- Aba **Horun_Resultados** (cabeçalho na linha 1, lido por rótulo): `Estudo |
  Método | Amostra | Réplica | Composição | Componente | Parâmetro | Valor |
  Unidade | U95 | Fração nominal (%) | Fração real (%) | Massa da amostra (mg) |
  Data`. Por componente: Massa encontrada, Massa esperada (mg), Recuperação
  (%), ΔTmax (°C), Δlargura (%); da corrida (Componente vazio): Recuperação
  total (%), Massa encontrada total (mg), R².
- Demais abas (Análises, Curvas, Moldes, Médias...) são ignoradas.

Mapeamento (`parsers/postrun_estudo.py`): **Amostra** (chave do grupo de
réplicas = texto da composição nominal, ex. `PP 50 % · PS 50 %`, `PP 100 %`)
= código da amostra do projeto; frações em 0–100, "Fração real" pode vir
vazia, "Data" em texto ISO;
**Réplica** = medição (chave `estudo|réplica`; réplica nº = "_N" do fim);
parâmetros dinâmicos por componente `rec_PP`, `mfound_PP`, `mexp_PP`,
`dtmax_PP`, `dwidth_PP`, `frac_real_PP` (fração real da réplica) e da corrida
`rec_total`, `mfound_total`, `r2`, `sample_mass`. **Métodos**: a chave sem
sufixo e a U95 (`__u95`) são do método principal; cada método presente entra
também com sufixo (`__gauss`, `__molde`). **Variáveis de amostra** (criadas
ou atualizadas na confirmação): "Fração <componente>" (%, nominal; 0 para
componente do estudo ausente na amostra) e "Composição" (categoria).

### 3.6 Tabela de literatura (opcional)
Planilha de um artigo de referência = dados publicados (parâmetros por
temperatura). Suportar, de forma genérica, **importar uma tabela de referência**
(planilha com 1ª coluna = temperatura/amostra e demais = parâmetros) para
sobrepor nos gráficos como "referência" — não é prioridade da v1.

## 4. Modelo de dados

- **Projeto**: nome, descrição, cor, arquivado (sem código/vigência — pedido do mantenedor).
- **Experimento** (por projeto): código (`HP300NA`), temperatura (°C), tempo (h),
  reator, massa inicial, data, observações, condições extras (JSON) lidas da
  planilha de gás. **Massas da réplica** (08/10/2026, `gas_mass_g`,
  `oil_mass_g`, `bitumen_mass_g`, em g, 0 a 10 000): digitadas por níveis 1–3.
  Gás: o valor digitado substitui o da planilha (medição `gas_balanco`, ou as
  condições da corrida); vazio = vale a planilha; reimportar não mexe no
  digitado. A API devolve o valor efetivo e a origem (`planilha`/`editado`).
  **Média da amostra** = réplicas com a mesma temperatura e atmosfera
  (HP300NA/NB/NC → HP300N): média, desvio e n de cada massa **sem os valores 0
  ou vazios** (`app/services/masses.py`, `GET /projects/{id}/experiments/masses`).
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
- **Pessoa do projeto** (`ProjectMember`, 08/10/2026): projeto, id da pessoa no
  Core (texto), usuário, nome, cargo na hora em que entrou (só registro),
  quem adicionou e quando.
- **Pessoa conhecida** (`KnownUser`): id no Core, usuário e cargo da última
  visita de quem já abriu o módulo — plano B da lista para escolher pessoas,
  quando o Core não responde (ver seção 7).

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
- **Séries → Balanço de massas** (08/10/2026): massas de óleo, gás e betume ×
  temperatura, três gráficos separados (média ± desvio por amostra, réplicas
  como pontos, uma linha por atmosfera quando há mais de uma), mais os
  gráficos do balanço de gás (massa de gás gerada, gás por massa de rocha,
  wetness, composição).
- **Comparar**: escolher amostras/experimentos livres e ver tabela + gráficos lado a lado.
- **Exportar**: tabela (CSV/XLSX) do que está filtrado; gráfico em PNG.

## 7. Permissões (regra do mantenedor para módulos atrás do Core)

Papel pelo **cargo no Horun** (`X-Horun-Level`): níveis 1–2 (administrador
máximo, coordenador(a)) = **coordenador**; demais com acesso = **colaborador**.
Quem altera (`can_edit`, 08/10/2026): níveis 1–3 (administrador,
coordenador/a, pesquisador/a) importam, criam/editam/excluem amostras,
experimentos e medições. Técnico(a) (4) e IC (5): **só visualizam** (inclui
exportar CSV/XLSX) — 403 "Técnicos e ICs só visualizam os resultados." em
toda rota que altera, inclusive **validar/invalidar**. Coordenador: tudo isso
+ criar/editar/arquivar projetos, tabela de frações e o **histórico**. Excluir projeto: só administrador máximo, com
confirmação digitando o nome. Sem senhas próprias do módulo (no modo de
desenvolvimento, seletor "Ver como" para trocar o nível).

**Acesso por projeto** (pedido do mantenedor, 08/10/2026): níveis 1–2 veem e
abrem **todos** os projetos; níveis 3–5 só os projetos em que são membros
(`ProjectMember`). `GET /projects` filtra; toda rota `/projects/{id}/...`
(amostras, séries, comparar, experimentos, importação, exportação, arquivos,
histórico, pessoas) responde **404** a quem não é membro (`get_project` em
`api/deps.py`). Dentro do projeto, cada um mantém os direitos do cargo
(pesquisador importa, edita, exclui, valida; técnico e IC só veem).
"Pessoas do projeto" (`/projects/{id}/members`, `.../members/candidates`):
coordenadores adicionam/removem pesquisadores, técnicos e ICs; pesquisadores
adicionam/removem só técnicos e ICs; técnicos e ICs só consultam (403 ao
alterar). Vale sempre o cargo **atual** do cabeçalho; o cargo guardado na
entrada é só registro. `/me` e cada projeto trazem `can_manage_members`; `/me`
traz `sees_all_projects`. Entradas e saídas vão para o histórico
(`membro_adicionado`, `membro_removido`). A lista para escolher vem do Horun
Core: `GET {HORUN_CORE_URL}/internal/modules/resultados/users` com a chave dos
avisos (`HORUN_NOTIFY_TOKEN`) — quem tem acesso ao Resultados agora, com nome e
nível; timeout de 3 s e cache em memória de 60 s (falha guardada 15 s). Sem o
Core (variáveis ausentes, fora do ar, chave errada), plano B: quem já abriu o
módulo (`KnownUser`, anotado a cada `GET /me`). No desenvolvimento, mais um
diretório de faz de conta (`services/directory.py`).

## 8. Regras do Horun que o módulo segue
`Horun Core/Prompt_Horun_Modulo.md` inteiro: API sob `/api`, `/health`,
identidade por cabeçalho, design-system copiado, migração defensiva
(`_ensure_column`), versões exatas, `db-backup`, healthcheck 127.0.0.1,
**aba Manual** (seção 12), **celular** (seção 13), **avisos pelo Core**
(seção 11; ex.: "arquivo importado com N amostras novas" — opcional, sininho).
