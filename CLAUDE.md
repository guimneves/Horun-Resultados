# Horun · Resultados — guia para o Claude Code

Módulo do Horun que reúne os resultados das análises (CHNSO, LECO, Rock-Eval,
GC-FID/TCD, balanço de gás, Py-GC-MS) por projeto, com tabelas e séries por
temperatura. Backend FastAPI+SQLModel (`backend/`), frontend React+Vite (`frontend/`).

**Leia primeiro:** `docs/ESPECIFICACAO.md` (requisitos e formatos verificados),
`docs/ESTADO_E_PLANOS.md` (estado, decisões, perguntas em aberto) e
`docs/CHANGELOG.md`. Regras da plataforma: `../Horun Core/Prompt_Horun_Modulo.md`.

## Regras do projeto

- **Nunca commitar dados reais**: resultados, PDFs, CSVs, planilhas, `.htm`,
  bancos `.db`, uploads, nomes de pessoas. Os exemplos reais ficam em
  `../Exemplos-Resultados` (só na máquina do mantenedor) — use-os só para conferir
  à mão, imprimindo contagens/códigos, nunca copiando valores para o repositório.
  Testes usam arquivos **sintéticos** (`backend/tests/synthetic.py`) com a mesma
  estrutura e códigos genéricos (HP300H...).
- Interface, mensagens de erro, comentários e o Manual em **português**; nomes de
  código em inglês.
- **Mudou uma tela? Atualize `frontend/src/manual/content.tsx` no mesmo commit.**
- Leitores (`backend/app/parsers/`): ler por **rótulo/cabeçalho**, nunca por
  célula fixa; arquivo que não é de resultados → `NotResultsFile` com mensagem
  clara; arquivo quebrado → `ParseError`. Todo formato novo ganha teste sintético.
- Códigos de amostra (`app/services/codes.py`), decisões do mantenedor de
  07/10/2026: **SE = sem extração** (mesma linha de H nas séries); **.1/.2 =
  alíquotas da mesma amostra** (ficam na medição, `Analysis.aliquot`); **N =
  atmosfera de nitrogênio**, **A/B/C = réplicas do experimento**, número final
  (NA2) faz parte do código. Em aberto: HP280 / HP280-1 sem letra de fração.
- Importação (`app/services/importer.py`): uma linha por **nome no arquivo**;
  sugestão = nome lembrado (`SampleAlias`) → mesmo código → código lido do nome
  → criar; gás nunca casa com amostra de rocha; reimportar não duplica (sha256 do
  arquivo + `Analysis.source_key`).
- **Migrações**: campo novo em modelo com tabela em produção → `_ensure_column`
  em `backend/app/db/session.py` **no mesmo commit** (Alembic não é usado).
- SQLModel 0.0.47 exige `datetime` com fuso: use `app.db.models.utcnow()`.
- Toda rota da API sob `/api` (prefixo em `main.py`); `/health` na raiz.
- Papéis (`app/core/permissions.py`): cargo no Horun — níveis 1–2 coordenador,
  demais colaborador; excluir projeto só nível 1, digitando o nome. Sem senha.
- Gráficos: cores por significado (`frontend/src/lib/colors.ts`, paleta validada),
  sempre com legenda e "Ver tabela"; nada de eixo duplo.

## Comandos

```bash
cd backend && .venv/Scripts/python -m pytest -q        # 101 passam
cd frontend && npx tsc -b && npx oxlint && npm run build
```

Os testes rodam com `HORUN_DEV_MODE=false` (pessoas simuladas por cabeçalho,
`tests/conftest.py`), banco e uploads em pastas temporárias.
