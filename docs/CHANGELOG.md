# Changelog — Horun · Resultados

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
