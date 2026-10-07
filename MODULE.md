# Resultados

Manifesto do módulo — referência para o administrador cadastrá-lo no Horun Core (ver `Prompt_Horun_Core.md`, seções 3 e 5).

- **id**: `resultados`
- **nome público**: Horun · Resultados
- **descrição**: Resultados de análises por projeto: amostras, experimentos, CHNSO, LECO, Rock-Eval e cromatografia, com tabelas e gráficos por série
- **ícone**: 🧪
- **porta interna do backend**: 8000
- **health check**: `GET /health`
- **URL interna do backend**: `http://resultados-backend:8000`
- **URL interna do frontend**: `http://resultados-frontend:80`
- **prefixo sob o Core**: `/m/resultados/` (build arg `VITE_BASE`)
- **avisos**: usa `POST /internal/modules/resultados/notify` do Core (só sininho), se `HORUN_CORE_URL` e `HORUN_NOTIFY_TOKEN` estiverem definidos

<!-- Sem codinome interno aqui nem em nenhum outro lugar público do módulo
     (interface, API, README, rodapé) — ver Prompt_Horun_Core.md, seção 2. -->
