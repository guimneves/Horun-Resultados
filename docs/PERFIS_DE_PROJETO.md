# Perfis de projeto — fundação (08/10/2026)

O Resultados nasceu para a maturação artificial de rochas (hidropirólise). O
laboratório quer usá-lo também em outros projetos: tabaco, incrustações etc.
Cada um tem **outras análises** (equipamentos), **outros parâmetros** e
**outro tipo de amostra**. Este documento fixa a ideia e o que já está pronto.

> **22/10/2026 (polímeros):** novo tipo **Polímeros — quantificação por
> pirólise (Rock-Eval)** (`polimeros_pirolise`): receitas `postrun_estudo`
> (o .xlsx do Estudo do PostRun/RE7S, ESPECIFICACAO.md 3.11) e `rockeval`;
> leitor `codes.parse_polymer_code`; fração `POL`; sem eixo de temperatura —
> as Séries usam as variáveis "Fração <componente>" e "Composição" que a
> importação cria.
>
> **22/10/2026:** "Rocha — maturação artificial" passou a se chamar
> **Geoquímica — Rochas** (mesma chave `rocha_hidropirolise`, nada muda) e
> entrou **Geoquímica — Extração ASE** (`ase_extracao`): mesmas receitas da
> rocha, leitor `codes.parse_ase_code`, frações PRE/RES/EXT e a aba Extrações
> ASE (planejamento fatorial + resultados finais do ASE — ver CHANGELOG).
>
> **Estado (14/10/2026):** o tipo de amostra **já muda o módulo**: tela de
> criar/editar projeto ("Tipo de amostra"), leitor de nomes na importação e no
> cadastro, análises do passo 1 da importação e abas (sem Séries e Condições
> experimentais quando o tipo não tem eixo de temperatura). **Tabaco está
> pronto** (seção 6). Projeto sem perfil gravado se comporta exatamente como antes.

## 1. A ideia em três peças

| Peça | O que responde | Onde está |
|---|---|---|
| **Tipo de amostra** | Que material é? Como ler os códigos? Que frações existem? | `SAMPLE_TYPES` em `backend/app/services/profiles.py` |
| **Receita de importação** | Como ler os arquivos de UMA análise/equipamento e que parâmetros saem dela | `RECIPES` (hoje = técnicas de `catalog.py` + leitor em `app/parsers/`) |
| **Perfil do projeto** | Este projeto usa qual tipo de amostra, quais receitas e quais parâmetros? | `Project.profile_json` |

Na hora de **criar um projeto** (tela futura), a pessoa escolherá:

1. o **tipo de amostra** (rocha / tabaco / incrustação...);
2. as **análises** que o projeto vai importar (a tela mostra as receitas
   prontas; as "planejadas" aparecem desabilitadas);
3. os **parâmetros de interesse** de cada análise (o padrão são as colunas
   principais do catálogo).

## 2. O que já existe (servidor)

- `Project.profile_json` (texto JSON), com migração `_ensure_column` em
  `db/session.py`. Vazio = perfil padrão.
- `services/profiles.py`:
  - `validate(dict)` confere tipo de amostra, receitas e parâmetros e recusa o que
    não existe, com mensagem em português. Recusa também tipos "planejado".
  - `load(json)` lê o perfil do banco; se estiver ilegível, usa o padrão.
  - `ProjectProfile.resolved()` devolve o perfil com os padrões preenchidos.
    É isso que o resto do módulo vai consultar.
  - `options_json()` lista tipos de amostra e receitas, com `status`.
- API (tela: "Tipo de amostra" em Novo projeto / Editar projeto):
  - `POST /api/projects` e `PATCH /api/projects/{id}` aceitam `"profile"`,
    por exemplo `{"sample_type": "rocha_hidropirolise", "recipes": ["leco",
    "rockeval"], "parameters": {"rockeval": ["TOC", "HI"]}}`.
  - Todo projeto devolvido pela API traz `"profile"` já resolvido.
  - `GET /api/profiles` lista os tipos de amostra e as receitas disponíveis.
- Testes: `backend/tests/test_profiles.py`.
- Tipos registrados: `rocha_hidropirolise` (pronto, padrão), `tabaco`
  (pronto, 14/10/2026) e `incrustacao` (planejado).

**O que o perfil já muda** (14/10/2026): `profiles.code_reader()` escolhe o
leitor de nomes (rocha → `parse_sample_code`, tabaco → `parse_tobacco_code`)
para importação, cadastro e cadastro em lote; `temperature_axis` (no perfil
resolvido) esconde Séries/Condições experimentais e os campos de temperatura e
experimento da prévia; o passo 1 da importação mostra as receitas do perfil
(rocha: a lista de sempre). Colunas padrão por `parameters` ainda não.

## 3. Onde o perfil vai entrar (próximos passos, em ordem)

1. **Tela de criação/edição do projeto**: escolher tipo de amostra,
   análises e parâmetros (usa `GET /api/profiles`).
2. **Importação** (`services/importer.py`): o passo "1. Qual análise?" mostra
   só as receitas do perfil; arquivo de uma análise fora do perfil dá aviso.
3. **Códigos das amostras**: hoje `codes.py` só entende rocha (HP300H...).
   Cada tipo de amostra terá o seu leitor (`SampleType.code_reader`); tipo sem
   leitor aceita o código como veio, sem fração/temperatura.
4. **Tabela, séries e detalhe**:
   - colunas padrão = `profile.parameters`;
   - grupos de Séries e gráficos especiais (HI × Tmax, Van Krevelen, COT × LECO)
     definidos pelo tipo de amostra;
   - o eixo "temperatura" só vale para hidropirólise; outros tipos podem usar
     outro eixo (tempo, ponto de coleta...).
5. **Receitas novas** (ex.: um ICP para incrustações): "treinar" com
   arquivos de exemplo do laboratório. A regra é a mesma dos leitores atuais:
   - ler por rótulo, nunca por célula fixa;
   - teste com arquivo sintético;
   - parâmetros novos entram no catálogo.

   Só então a receita passa de "planejado" para "pronto".

## 4. Perguntas para o laboratório (antes de cada tipo novo)

- Que análises/equipamentos esse projeto usa? Há arquivos de exemplo?
- Como as amostras são nomeadas? Existe algo como "fração" ou "temperatura"?
- Quais parâmetros importam no dia a dia (colunas e gráficos)?
- Há padrões/brancos que devem ser ignorados na importação?
- Qual é o eixo natural dos gráficos (temperatura, tempo, profundidade, ponto)?

## 5. Regras

- Perfil novo nunca pode mudar o comportamento dos projetos de rocha já
  existentes: perfil vazio = `rocha_hidropirolise` com todas as receitas.
- Formato versionado (`version`). Se o formato mudar, `load()` converte as
  versões antigas.
- Nenhum dado real em teste ou exemplo (mesma regra do resto do repositório).

## 6. Tabaco (pronto em 14/10/2026)

- Receitas: `chnso`, `leco`, `leco_bruto` (sinal bruto do Cornerstone),
  `rockeval` (inclusive o relatório "multiheating"), `tg` (TGA-50), `mev_eds`
  (Oxford AZtec), `gcfid_tab` (.gcd do GCsolution, picos integrados pelo
  Horun) e `gcms_tab` (.qgd do GCMSsolution, compostos com similaridade ≥ 80).
  Formatos: ESPECIFICACAO.md 3.3, 3.7–3.10.
- Amostra = produto; "fração" = tipo do produto (19/10/2026): CHA charuto,
  CIG cigarro, NAR essência de narguilé, TAB a definir (`codes.tobacco_type`,
  `FractionType.sample_type = "tabaco"`). Sem temperatura nem experimento;
  Séries por tipo de produto (tabela + barras por parâmetro + TG).
- Nomes (`codes.parse_tobacco_code`): tira réplica no fim ("_1", " 2",
  " - rep 2", "-rep 2", " -1", dígito colado "SABOR1"), "(Triplicata)",
  "(triturado)", "-Corrected", data "AAAA-MM-DD Ch1", data no começo, nº da
  corrida ("2-..."), sigla ("PX-Nome", "P - Nome"; sigla colada só antes de
  palavra com minúsculas, para não cortar marcas em maiúsculas) e o prefixo do
  tipo ("Ch_", "Cha_", "Char_", "Charuto"). "_" vira espaço. Comparação por
  `normalize_code`. "Blank" → branco; padrões → padrão; "Spectrum NN" fica inteiro.
- Em aberto com o laboratório: nomes que não casam sozinhos (número por extenso × algarismo, "de" × "da") ficam por conta dos apelidos; "(folha
  externa)" no TG e "_FOLHA_EXTERNA" no Rock-Eval continuam como amostras
  próprias (regiões do produto); calibração do LECO bruto (massa + padrão)
  para chegar a % de C/S; faixas de temperatura do TG (150/400/600/900 °C)
  são uma primeira escolha.
