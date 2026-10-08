# Horun · Resultados — estado, decisões e planos (07/10/2026)

## 1. Estado

Versão 0.1.0 completa da especificação (`ESPECIFICACAO.md`), com o refinamento do
mantenedor para a importação. 101 testes do backend passando (só arquivos
sintéticos); frontend com `tsc`, `oxlint` e `build` limpos. Ainda **não plugado
no Core** e sem repositório remoto.

Conferência manual com os exemplos reais (`../Exemplos-Resultados`, fora do
repositório), importados pela API num banco temporário e apagados depois:

| Tipo | Arquivos | Resultado |
|---|---|---|
| CHNSO | 166 PDFs da corrida | 2 resumos "Element %" + 96 "Single Sample" lidos; 33 recusados com motivo (calibração, Área, Área %, K-Factor, µg, parâmetros, posições Bypass); 84 medições únicas (as dos PDFs individuais e da impressão antiga caem na mesma chave, sem duplicar); 22 amostras + padrões |
| LECO | CSV + PDF + ZIP | CSV: 11 conjuntos (33 réplicas); PDF e ZIP de diagnóstico recusados com mensagem |
| Rock-Eval | 1 .htm | 9 análises (3 amostras × 3 réplicas) com pirogramas |
| GC-FID/TCD + gás | 28 planilhas (em .zip com as pastas) | 9 FID, 9 TCD, 8 planilhas de gás; 2 temporários `~$` ignorados; 9 experimentos criados (atmosfera nitrogênio, réplicas A/B/C) |
| Py-GC-MS | 1 planilha + tabela de literatura | 3 amostras (aba HP355 vazia, com aviso); tabela de literatura reconhecida e não importada |

Avisos que os dados reais geram (de propósito, para a pessoa conferir):
- célula "AMOSTRA" das planilhas de GC com `EXPXXXXX`, `HP300` (sem a corrida) ou
  até outro experimento (`HP320NB` dentro da pasta HP330NB) — vale a pasta/arquivo;
- pasta `HP350NA` com a planilha de gás chamada `HP355NA` — usado HP350NA, com aviso;
- planilha de gás do HP340NA sem o valor calculado de "Massa de gás gerada".

## 2. Decisões tomadas

- **Códigos** (respostas do mantenedor, 07/10/2026): `SE` = sem extração (mesma
  linha de H nas séries, mas o código original fica); `.1/.2` = alíquotas da mesma
  amostra (gravadas na medição; média geral + média por alíquota); `N` = atmosfera
  de nitrogênio (catálogo `ATMOSPHERES` em `services/codes.py`), `A/B/C` = réplicas
  do experimento, número final (`NA2`) faz parte do código.
- **Uma `Analysis` por medição** (réplica); LECO = um conjunto por análise, com as
  repetições como réplicas dos valores. Média ± desvio de uma amostra = todos os
  valores (todas as réplicas e alíquotas), desvio amostral (n−1).
- **Ponto da série** = fração (grupo da série) × temperatura × atmosfera (só quando
  o projeto tem mais de uma): com 2+ amostras (ex. réplicas A/B/C), média ± desvio
  das médias das amostras; com uma, média ± desvio das réplicas dela.
- **Validade**: amostra/medição nasce **pendente**. Padrão das telas = "válidas e
  pendentes" (sem as inválidas); "Só as validadas" = banco de experimentos válidos;
  "Todas" inclui as inválidas. (A especificação dizia "só válidas por padrão"; com
  amostras recém-importadas pendentes, os gráficos nasceriam vazios — ver pergunta 4.)
- **Gás**: cada experimento vira uma amostra `HPxxxNy (gás)` (fração G), nunca
  misturada com a rocha de mesmo código. Composição do gráfico empilhado = planilha
  de gás normalizada sem o gás de enchimento (H2/CO2 do TCD, HCs da mistura do FID);
  sem a planilha, a distribuição de HCs do GC-FID.
- **Reimportação**: mesmo arquivo (sha256) = "já importado" (mostra em quais
  amostras); mesma medição por outro arquivo (ex. outra impressão do relatório) =
  atualiza. No mesmo lote, o resumo do CHNSO vence o PDF individual e a impressão
  mais nova vence a antiga.
- **Nomes lembrados** só são gravados quando a pessoa escolhe uma amostra diferente
  do que o código sugeriria (HP320E.1 → HP320E não precisa ser lembrado).
- Pirogramas guardados reduzidos a até 600 pontos por curva.
- Sem `MODULE_SECRET_KEY` (o módulo não assina nada nem tem senha).

## 3. Perguntas em aberto (para o mantenedor/laboratório)

1. **HP280 / HP280-1 sem letra de fração** (CHNSO): é rocha só hidropirolisada
   (igual a H), outra coisa, ou um material diferente? Hoje entram como fração
   "HP sem sufixo", em linha própria nas séries — dá para juntar com H mudando
   "Linha da série" da fração HP (tabela de frações, coordenador).
2. Códigos como **ROA** e **RO-1/2/3**: ROA é a mesma rocha original que RO (lotes
   diferentes?) e "Rocha virgem 80 mesh" é outra preparação da mesma rocha? Hoje
   são amostras separadas, todas fração "original".
3. **Rock-Eval HP355NB** (sem letra de fração, da corrida B): é a rocha
   hidropirolisada não extraída? (Hoje "HP sem sufixo", como o item 1.)
4. Validade padrão dos gráficos: manter "válidas e pendentes", ou passar a "só
   validadas" assim que o laboratório começar a validar?
5. Faixas do diagrama **HI × Tmax** (campos de querogênio) — usamos faixas usuais
   simplificadas; o laboratório tem um diagrama de referência preferido?
6. O **CPI** usado é o de Bray & Evans (C24–C34); o laboratório usa outro intervalo?
7. Amostras "C28", "C29", "C30 2104", "CF", "Qui-Al-MCM-41" no CHNSO: são de outro
   projeto? Hoje entram como "Outra" (fora das séries); podem ser ignoradas na
   importação.

## 4. Próximos passos

- **Perfis de projeto** (tabaco, incrustações...): fundação no servidor pronta
  em 08/10/2026, sem tela — próximos passos em `docs/PERFIS_DE_PROJETO.md`, seção 3.
- **Plugar no Core**: cadastrar o módulo (MODULE.md), gerar a chave de avisos, subir
  o `docker-compose.yml`, conferir o limite de tamanho de upload do gateway do Core
  (o .zip do GC tem alguns MB; o módulo aceita até 100 MB por arquivo).
- **Rock-Eval direto do RE7S**: em vez de exportar o .htm, buscar as análises e
  curvas do módulo RE7S (API interna) — mesma chave natural (nome da análise).
- Tabela de **referência de literatura** (ESPECIFICACAO.md, 3.6) para sobrepor nos
  gráficos.
- Ligar o resultado à fila do módulo **Amostras** (quem pediu recebe o aviso
  "resultado pronto").
- Edição de valores à mão (correção pontual) com histórico.
- Dividir o pacote do frontend (Recharts) se o tempo de carga incomodar.
