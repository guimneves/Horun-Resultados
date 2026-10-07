# Horun · Resultados

Módulo do **Projeto Horun** (NQTR/IQ-UFRJ) para reunir, comparar e interpretar os
resultados das análises das amostras de cada projeto: **CHNSO** (EuroVector),
**LECO** (Cornerstone), **Rock-Eval** (relatório GeoWorks), cromatografia do gás
(**GC-FID**, **GC-TCD**, planilha de cálculo de gás) e **Py-GC-MS** da rocha.
Tabelas filtráveis, séries parâmetro × temperatura por fração (média ± desvio),
gráficos prontos, sobreposição de pirogramas e o banco de experimentos válidos.

Especificação: [`docs/ESPECIFICACAO.md`](docs/ESPECIFICACAO.md). Estado e próximos
passos: [`docs/ESTADO_E_PLANOS.md`](docs/ESTADO_E_PLANOS.md). Histórico:
[`docs/CHANGELOG.md`](docs/CHANGELOG.md).

> **Nunca commitar dados reais** (PDFs, CSVs, planilhas, resultados, nomes de
> pessoas). Os exemplos reais ficam fora do repositório; os testes geram arquivos
> sintéticos com a mesma estrutura (`backend/tests/synthetic.py`).

## Estrutura

```
backend/    API FastAPI + SQLModel (toda sob /api; /health na raiz)
  app/parsers/    leitores de cada formato (detecção pelo conteúdo)
  app/services/   códigos de amostra, importação, séries, catálogo de parâmetros
frontend/   React 19 + Vite + Tailwind 4 + @horun/design-system (cópia em vendor/)
docs/       especificação, estado/planos, changelog
MODULE.md   manifesto para o cadastro no Horun Core
```

## Rodando sozinho (desenvolvimento, sem o Core)

```powershell
# backend
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -e ".[dev]"
$env:HORUN_DEV_MODE = "true"
uvicorn app.main:app --reload            # http://localhost:8000

# frontend (outro terminal)
cd frontend
npm install
npm run dev                              # http://localhost:5173
```

Com `HORUN_DEV_MODE=true` não há login: sem cabeçalhos, a pessoa é o
administrador máximo "dev". No `npm run dev`, o seletor **Ver como** (no alto)
troca o cargo no Horun (níveis 1 a 5) para ver o módulo como coordenador ou
colaborador. Banco: `MODULE_DATABASE_URL` (padrão `sqlite:///./resultados_dev.db`);
originais enviados: `MODULE_UPLOAD_ROOT` (padrão `./uploads`) — ambos ignorados
pelo git. Para outra porta do backend: `VITE_API_URL=http://localhost:8095 npm run dev`.

Em Docker, só na própria máquina: `docker compose -f docker-compose.dev.yml up --build`
(backend em 127.0.0.1:8000, frontend em 127.0.0.1:8080).

## Testes e verificações

```bash
cd backend && .venv/Scripts/python -m pytest -q      # 101 testes, só arquivos sintéticos
cd frontend && npx tsc -b && npx oxlint && npm run build
```

## Produção (plugado no Horun Core)

1. `docker network create horun-network` (uma vez, já feito pelo Core).
2. Copiar `.env.example` para `.env` e preencher (`POSTGRES_PASSWORD`, `BACKUP_DIR`,
   e, para os avisos no sininho, `HORUN_CORE_URL`/`HORUN_NOTIFY_TOKEN`).
3. `docker compose up -d --build` — sobe `resultados-db` (Postgres 16, volume
   nomeado), `db-backup` (dump diário verificado, 30 dias), `resultados-backend`
   e `resultados-frontend` na `horun-network`, **sem nenhuma porta publicada**.
4. No Core (Admin → Módulos): id `resultados`, backend `http://resultados-backend:8000`,
   frontend `http://resultados-frontend:80` (ver `MODULE.md`).

## Regras que já vêm prontas (não desfaça)

- **Versões exatas** em `backend/pyproject.toml` e `recharts` fixo em `frontend/package.json`.
- **Migração defensiva**: campo novo em modelo com tabela em produção → `_ensure_column`
  em `backend/app/db/session.py` no mesmo commit.
- **Design-system por cópia** em `frontend/vendor/horun-design-system/` (não editar;
  atualizar com `python <Horun Core>/scripts/vendor_design_system.py frontend`).
- Portas do compose de desenvolvimento só em `127.0.0.1`.
