# Changelog — Horun · Resultados

## Não lançado — 09/10/2026
### Artigo: COT inicial do LECO ou digitado; gás de qualquer amostra
- COT inicial: Rock-Eval da rocha original → C do LECO da rocha original →
  valor digitado na tela ("COT inicial (%)", guardado no navegador; vai como
  ?toc0= para o servidor). Rocha original = fração O ou, sem temperatura e
  sem fração, nome com "rocha", "virgem", "original" ou "araripe".
- Rendimentos aceitam o balanço de gás de qualquer amostra (temperatura do
  experimento ou do código quando a amostra não tem) e listam o que falta em
  cada corrida (massa de gás, composição, massa de rocha).

### Gráficos de gás em barras (pedido do mantenedor)
- "Composição do gás × temperatura" vira barras lado a lado (como FID e TCD);
  "Gás — FID" e "Gás — TCD" viram um gráfico de barras lado a lado cada
  (C1–C5+ / H2 e CO2, média ± desvio por temperatura), no lugar dos gráficos
  de linha por componente (`GasBarsChart`). Fonte: composição do balanço de
  gás; sem ela, % de área do GC-FID/TCD.
- Nos três, botão "Barras | Pontos e linha" (escolha guardada no navegador).

### Correção: "Composição do gás × temperatura" não aparecia
- O gráfico só aparecia na vista Parâmetros e só para amostras da fração G
  com temperatura preenchida. Agora aparece também em Balanço de massas e vale
  para qualquer amostra com composição de gás; sem temperatura na amostra,
  usa a do código do experimento (HP320NA2 → 320 °C).

### Séries → "Artigo" (pedido do mantenedor)
- Terceira vista da aba Séries com as figuras do Supporting Information do
  artigo de hidropirólise (menos FRX, MEV e DRX), calculadas com os dados do
  projeto: `GET /projects/{id}/article` (`services/article.py`) +
  `charts/ArticleCharts.tsx`. Rendimentos em µmol/g COT₀ (COT da rocha
  original; sem ela, µmol/g rocha); mols da tabela consolidada (massa ÷ massa
  molar, agora guardada por componente) ou estimados pela composição e massa
  total; consumo de S2 e taxa de transformação = (HI₀ − HI)/HI₀.
  Testes: `tests/test_article.py`.

### Exportação de gráficos em PNG reformulada (pedido do mantenedor)
- O PNG sai sempre com título, subtítulo, origem dos dados e a **legenda**
  (a legenda do Recharts é HTML, fora do <svg>, e sumia na imagem):
  `lib/chartExport.ts` desenha tudo num canvas, com as cores do tema e a
  fonte da página; ícones da legenda vão como estão na tela (traço, losango).
- "Baixar vários PNG" (Séries e Comparar; `components/ChartSelection.tsx`,
  provedor em `ProjectLayout`): marca os gráficos e baixa de uma vez — um
  gráfico → PNG; dois ou mais → .zip (escrito no navegador, sem biblioteca),
  numerado na ordem da tela. Gráfico em "Ver tabela" continua montado fora da
  tela e também exporta.

### Gás: tabela consolidada, séries FID/TCD e composição × temperatura (pedido do mantenedor)
- Novo modelo de importação do Balanço de gás: a "Tabela final consolidada de
  composição de gás" (`parsers/gas_consolidated.py`, ESPECIFICACAO 3.4b) —
  composição CO₂, H₂, C1–C4, C5+ (mol% sem N₂, por nº de carbonos), massa de
  gás por cromatografia e por pressão/pesagem, massa inicial e pressões. Mesma
  chave da planilha de cálculo: atualiza em vez de duplicar. Parâmetros novos:
  `gas_mass_pressure_g`, `gas_yield_pressure_mg_g`.
- Séries: grupos "Gás — composição" (gráfico novo `GasSeriesChart`: CO₂, H₂,
  C1, C2, C3, C4 e C5+ × temperatura, média entre experimentos da mesma
  temperatura), "Gás — FID (hidrocarbonetos)" e "Gás — TCD (H₂ e CO₂)".
- Testes sintéticos: `tests/test_gas_consolidated.py`.

### Novo modelo de importação: LECO - Resíduo Insolúvel (pedido do mantenedor)
- Técnica `leco_ri` ("LECO - Resíduo Insolúvel") lida da planilha de massas
  das amostras (`parsers/leco_ri.py`, ESPECIFICACAO 3.5b): por réplica,
  resíduo em **g** (cadinho + amostra − massa após o tratamento) e em **%**
  (÷ massa da amostra × 100), mais a massa da amostra. Aba "Dados" (agrupada)
  ou "Tabela" (plana). Sugestões de código: "sem extração" → SE, "E1" →
  alíquota. Escolha na Importação; série (%) em Séries → Elementar. Testes
  sintéticos: `tests/test_leco_ri_and_report.py`.

### Botão "Exportar" — relatório em Excel (pedido do mantenedor)
- Ao lado de "Importar resultados", para todos do projeto. A pessoa escolhe
  técnicas, amostras e validade. `POST /projects/{id}/export/report`
  (`services/report.py`): aba "Resumo geral" (projeto, quem/quando, quadro por
  técnica, média e DP dos parâmetros principais por amostra, formatada para
  apresentar) + uma aba por técnica (médias de todos os parâmetros e todas as
  réplicas, com arquivo, data e validade). Usa os mesmos valores das telas
  (inclusive a massa de gás editada).

## Não lançado — 08/10/2026
### Massa de gás editada vale em todo lugar (pedido do mantenedor)
- O valor digitado em Condições experimentais substitui o da planilha em
  tabelas, detalhe da amostra, séries ("Massa de gás gerada", "gás por massa
  de rocha", recalculado) e exportação (`results._with_edited_gas`, cópias em
  memória — o valor importado continua no banco e volta ao limpar a edição).

### Pessoas do projeto: lista vinda do Horun Core
- `services/directory.py` busca a lista em `GET /internal/modules/resultados/users`
  do Core (rota nova do Core, mesma chave dos avisos: `HORUN_CORE_URL` +
  `HORUN_NOTIFY_TOKEN`), com timeout de 3 s e cache de 60 s. Quem tem acesso ao
  Resultados no Horun já aparece para ser adicionado, sem precisar abrir o
  módulo antes; quem perdeu o acesso no Core some da lista.
- Plano B: Core não configurado ou fora do ar → `KnownUser` (quem já abriu o
  módulo), como antes. Diretório de faz de conta do desenvolvimento mantido.
- Regras de cargo iguais (coordenadores escolhem 3–5; pesquisadores, 4–5).
  Texto da janela e Manual atualizados. Testes: `tests/test_directory.py`.

### Massas de gás, óleo e betume por réplica; Séries → Balanço de massas (pedido do mantenedor)
- `Experiment` ganhou `gas_mass_g`, `oil_mass_g` e `bitumen_mass_g` (g, nulos;
  migração `_ensure_column`). Pesquisadores e coordenadores editam pelo PATCH
  do experimento (0 a 10 000 g); a mudança vai para o Histórico
  (`massas_editadas`, com antes/depois).
- Gás gerado: o valor digitado substitui o da planilha (medição `gas_balanco`
  mais recente e não invalidada; sem ela, `conditions_json["resultados"]`);
  `null` volta ao valor da planilha; reimportar a planilha não mexe no
  digitado. O experimento devolve `gas_mass_effective_g`, `gas_mass_source`
  (`planilha`/`editado`), `gas_mass_sheet_g` e `gas_mass_manual_g`.
- `app/services/masses.py` e `GET /projects/{id}/experiments/masses`: réplicas
  agrupadas por amostra (temperatura + atmosfera, ex. HP300N) com média,
  desvio e n de cada massa, **sem valores 0 ou vazios**.
- Condições experimentais: bloco **Massas** na ficha (etiqueta
  planilha/editado no gás), **Editar massas** (janela) para quem edita,
  tabela **Média da amostra (HP300N)** e o resumo da média abaixo de cada
  temperatura na lista.
- Séries: nova vista **Balanço de massas** (seletor Parâmetros | Balanço de
  massas, lembrado no navegador) com os gráficos Massa de óleo, Massa de gás e
  Massa de betume × temperatura e os gráficos do gás, que saíram do painel
  principal (o grupo "Gás" deixou de existir lá).
- Testes: `tests/test_masses.py`. Manual atualizado.

### Acesso por projeto: Pessoas do projeto (pedido do mantenedor)
- Coordenadores e o administrador máximo (níveis 1–2) seguem vendo todos os
  projetos. Pesquisadores, técnicos e ICs (3–5) só veem e abrem os projetos em
  que são membros: `GET /projects` filtra e toda rota por projeto
  (`get_project`) responde 404 a quem não é membro.
- Tabela nova `ProjectMember` (projeto, id no Core, usuário, nome, cargo na
  entrada, quem adicionou, quando) e `KnownUser` (quem já abriu o módulo, com
  o cargo da última visita) — criadas pelo `create_all`.
- Rotas `GET/POST /projects/{id}/members`, `DELETE .../members/{id}` e
  `GET .../members/candidates`: coordenadores adicionam/removem pesquisadores,
  técnicos e ICs; pesquisadores, só técnicos e ICs; técnicos e ICs só
  consultam. A regra usa o cargo atual (cabeçalho). Entradas e saídas no
  Histórico (`membro_adicionado`, `membro_removido`).
- `/me` ganhou `sees_all_projects` e `can_manage_members`; cada projeto,
  `can_manage_members`.
- Lista de pessoas: o Core não tem rota que liste usuários para os módulos;
  como no Financeiro, o módulo anota quem o abre (a cada `GET /me`). Quem
  nunca abriu o Resultados ainda não aparece. No desenvolvimento há um
  diretório de faz de conta (pessoas do "Ver como").
- Frontend: **Projeto ▾ → Pessoas do projeto** (janela com a lista, busca e
  "Adicionar pessoa", remover); visível para todos, só leitura para técnicos e
  ICs. Lista de projetos vazia explica a quem pedir acesso. Manual atualizado.
- Testes: `tests/test_members.py`; o projeto dos testes já traz PESQ, TEC e IC
  como membros.

### Pesquisadores validam; coordenadores veem o histórico (pedido do mantenedor)
- Validar/invalidar amostras e medições (uma a uma e em lote) passou a
  `require_editor` (níveis 1–3): pesquisadores marcam válidas e inválidas.
- Histórico (`GET /projects/{id}/history`, `can_see_history` no /me): níveis
  1–2 (administrador máximo e coordenadores).

### Técnicos e ICs só visualizam (pedido do mantenedor)
- Pesquisadores e coordenadores importam, criam, editam e excluem resultados;
  técnicos (nível 4) e ICs (nível 5) veem tudo (tabelas, séries, gráficos,
  fichas, exportar CSV/XLSX) mas não importam nem alteram nada.
- Backend: `require_editor` (níveis 1–3) em importar (prévia/confirmação),
  criar/editar/excluir amostra e experimento, cadastro em lote, excluir
  medição, excluir várias amostras e nomes lembrados — 403 "Técnicos e ICs
  só visualizam os resultados."; `/me` ganhou `can_edit`.
- Excluir amostras/medições/experimentos (uma a uma ou várias) passou a valer
  também para pesquisadores; validar/invalidar, projetos e frações seguem
  só com coordenadores; excluir projeto e histórico, só nível 1.
- Frontend: botões de alterar somem para quem não pode; /importar mostra um
  aviso; o selo do papel mostra "Somente leitura". Manual atualizado.

### Origem dos dados, filtro de frações, ficha da corrida e perfis (fundação)
- Etiquetas de **análise · equipamento** em cada gráfico e em cada grupo de
  Séries (`SourceChips`; `/catalog` devolve `instrument`).
- Séries → Opções → **Tratar apenas**: todas / só extraídas / só normais
  (`lib/fractionFilter.ts`); gás e rocha original sempre ficam.
- **Condições experimentais** sem criar corrida à mão (vem da planilha de
  gás): lista por temperatura + **ficha** no formato da planilha (Dados do
  experimento, Reator, Inicial, Final, Verificação da cromatografia) e
  composição do gás. Corrigir/Excluir no "Mais".
- **Perfis de projeto — só fundação, sem tela** (`services/profiles.py`,
  `Project.profile_json` + migração, `GET /api/profiles`, `profile` em
  criar/editar projeto; desenho em `docs/PERFIS_DE_PROJETO.md`).

### COT × LECO e histórico só para o administrador máximo
- Séries → Matéria orgânica: **COT (Rock-Eval) × C total (LECO)**, uma
  amostra por ponto, reta de mínimos quadrados, **R²**, equação e linha 1:1
  (`CorrelationChart`/`linearFit` em `charts/MoreCharts.tsx`).
- Histórico: `GET /projects/{id}/history` só para o nível 1
  (`require_history_access`); `/me` ganhou `can_see_history`; o item some do
  menu Projeto para os demais.

### Layout mais limpo e mais gráficos (pedido do mantenedor)
- Cabeçalho do projeto: só **Importar resultados** e o menu **Projeto ▾**
  (Histórico, Editar, Arquivar, Excluir). Abas leves (sublinhado): Amostras,
  Séries, Comparar, **Condições experimentais** (era "Experimentos"). A barra
  lateral lista só os projetos (sem repetir as abas).
- **Séries** virou um painel: todos os gráficos com dados aparecem juntos, em
  grupos (Matéria orgânica, Elementar, Gás, Py-GC-MS, Pirogramas), com botões
  para ver um grupo só; Van Krevelen do projeto; **+ Gráfico** guarda gráficos
  extras em "Meus gráficos" (no navegador); validade e réplicas em **Opções**.
- Pirograma com escolha do eixo X (temperatura × tempo) também no detalhe da
  amostra. n-alcanos em **barras finas** (uma por amostra, lado a lado).
- Detalhe da amostra: Editar e Excluir no menu **Mais**.

### Aba Amostras mais simples (pedido do mantenedor)
- Lista enxuta por padrão: amostra, fração, temperatura, técnicas com resultado
  (etiquetas) e validade — sem colunas de números.
- Filtros (fração, técnica, validade, médias, padrões) recolhidos no botão
  **Filtros**, que mostra quantos estão ativos e tem **Limpar filtros**.
- Visão **Valores** = a tabela antiga com uma coluna por parâmetro e **Colunas**;
  a escolha Lista/Valores fica lembrada no navegador.
- **Mais**: Selecionar várias (coordenador; as caixinhas só aparecem nesse modo),
  Criar várias, Exportar CSV/XLSX.
- Detalhe da amostra com **gráficos primeiro** e valores no final
  (`frontend/src/charts/SampleCharts.tsx`): pirograma (escolha do sinal),
  n-alcanos, composição do gás, composição elementar CHNSO (com desvio),
  HI × Tmax e Van Krevelen com a amostra em destaque entre as do projeto,
  "Na série" (parâmetro × temperatura na mesma fração) e "Réplicas". Só
  aparecem os que têm dados; janela mais larga no computador.
- Detalhe da amostra: **Valores principais** com um cartão por técnica (parâmetros
  principais, média ± DP); "Todos os valores e medições" e "Nomes lembrados"
  recolhidos.

## Não lançado — 07/10/2026

### Seleção de várias amostras (pedido do mantenedor)
- Backend: `POST /api/projects/{id}/samples/bulk-delete` (`{"sample_ids": [...]}`;
  com `dry_run` devolve a prévia: medições por amostra, arquivos que saem/ficam) e
  `POST /api/projects/{id}/samples/bulk-validation`. Só coordenador; todos os ids
  têm de ser do projeto (senão 404 e nada muda); uma transação; registro no Histórico.
- Exclusão de amostra (uma ou várias) com a mesma lógica (`app/services/deletion.py`):
  sai tudo o que é só da amostra (medições, valores, curvas, nomes lembrados,
  validação); o arquivo original fica se outras medições ainda o usam, senão sai
  do banco e do disco (e pode ser importado de novo).
- Aba Amostras (tabela e cartões): caixinhas para coordenadores, "Selecionar
  todas" (filtradas), barra fixa "N selecionada(s) · Marcar como válida ·
  Marcar como inválida · Excluir selecionadas · Limpar seleção" e confirmação com
  os códigos e o número de medições. Manual: "Excluir ou validar várias amostras
  de uma vez".

## 0.1.0 — 07/10/2026 (primeira versão)

### Backend
- Modelos: Projeto (sem código/vigência; arquivar; excluir só nível 1 digitando o
  nome), Experimento (atmosfera, réplica A/B/C, condições da planilha de gás),
  Amostra (fração, temperatura, validade pendente/válida/inválida), Análise (uma
  por medição, com réplica e alíquota, arquivo de origem, chave natural),
  Valores, Arquivo (sha256), Lote de importação, Apelido de amostra, Histórico.
- Leitores com detecção pelo conteúdo: CHNSO (Results Summary for Element % e
  Single Sample Result; recusa calibração/Área/K-Factor/parâmetros com aviso),
  LECO (CSV do Cornerstone, os dois layouts de resumo intercalados; recusa o PDF
  e o .zip de diagnóstico), Rock-Eval (.htm do GeoWorks, tabela + pirogramas),
  GC-FID/TCD (planilhas "Dados FID/TCD"), planilha de cálculo de gás (por rótulo),
  Py-GC-MS (uma aba por amostra). Arquivos temporários do Excel ignorados;
  tabela de literatura reconhecida mas ainda não importada.
- Derivados: H/C, N/C, S/C, O/C atômicas; PI; umidade do gás; gás gerado por
  massa de rocha; composição normalizada do gás; Pr/Ph, Pr/n-C17, Ph/n-C18, CPI.
- Parser de códigos com as respostas do mantenedor (SE = sem extração; .1/.2 =
  alíquotas; N = nitrogênio; A/B/C = réplicas do experimento).
- Importação: tipo de análise escolhido (com aviso se o arquivo não bater),
  prévia com uma linha por nome no arquivo, atribuição a amostras existentes /
  criar / ignorar, nomes lembrados, reimportação idempotente, .zip com pastas,
  desempate pela impressão mais nova, aviso aos coordenadores (sininho).
- Séries por temperatura (média ± desvio; réplicas A/B/C juntas ou separadas;
  SE na linha de H; rocha original como referência), curvas, exportação CSV/XLSX.
- Cadastro em lote de amostras e experimentos.

### Frontend
- Projetos → abas Amostras, Experimentos, Séries, Comparar, Importar, Histórico;
  Manual (último item, com Imprimir / salvar PDF).
- Gráficos prontos (Recharts 2.15.4): COT, HI/OI, HI × Tmax, H/C, S, composição
  do gás, massa de gás, n-alcanos, pirogramas sobrepostos; "Ver tabela" e PNG.
- Celular: gaveta, cartões, sem rolagem horizontal a 375 px.
- Seletor "Ver como" (nível 1–5) só no desenvolvimento; "← Voltar ao Horun" sob /m/.

### Infra
- `docker-compose.yml` de produção (`horun-resultados`, `resultados-db`,
  `db-backup`, `resultados-backend`/`resultados-frontend` na `horun-network`,
  sem portas, volume de uploads); `docker-compose.dev.yml` em 127.0.0.1.
