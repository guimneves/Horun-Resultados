"""Estudo do PostRun (módulo RE7S) — .xlsx "absoluto" de um estudo de
quantificação de polímeros por pirólise no Rock-Eval (ESPECIFICACAO.md, 3.11).

Contrato (versão 1, definido junto com o RE7S em 22/10/2026):

* aba **Sobre**: coluna A = chave, B = valor (linha 1 = cabeçalho "Chave |
  Valor"). `formato` tem de ser `horun-postrun-estudo` (senão: erro claro);
  `versao` (1), `estudo`, `descricao`, `metodo` (gauss | molde — o método
  PRINCIPAL de deconvolução do estudo), `canal`, `gerado_em`, `status`
  (aberto | finalizado).
* aba **Horun_Resultados** (formato longo, cabeçalho na linha 1, lido por
  RÓTULO): Estudo | Método | Amostra | Réplica | Composição | Componente |
  Parâmetro | Valor | Unidade | U95 | Fração nominal (%) | Fração real (%) |
  Massa da amostra (mg) | Data.
* as outras abas (Análises, Curvas, Moldes, Médias...) são para gente e ficam
  de fora.

Como vira o modelo do Resultados:

* **Réplica** (id da análise, o .B00 sem extensão) → uma MEDIÇÃO; chave
  natural `estudo|réplica` — reimportar o mesmo estudo (outra exportação)
  ATUALIZA. **Amostra** (a chave do grupo de réplicas = o texto da composição
  nominal, ex. `PP 50 % · PS 50 %`, `PP 100 %`) → a AMOSTRA, com esse código
  (via `code_hint`): as réplicas da mesma composição ficam juntas e entram nas
  médias como as réplicas de qualquer outra análise. Frações em 0–100;
  "Fração real (%)" pode vir vazia; "Data" em texto ISO (`2026-09-15`).
* Parâmetros por componente (nomes livres — PP, PS, PEAD...) são dinâmicos
  (`catalog.postrun_param`): `rec_PP` (Recuperação), `mfound_PP` (Massa
  encontrada), `mexp_PP`, `dtmax_PP`, `dwidth_PP`, mais `frac_real_PP`
  (fração real da réplica) e, da corrida, `rec_total`, `mfound_total`, `r2`
  e `sample_mass`.
* **Método**: as linhas do método principal (`Sobre.metodo`) dão a chave sem
  sufixo (a que aparece por padrão em Séries/Comparar) e a U95 (`__u95`);
  CADA método presente também entra com sufixo (`rec_PP__gauss`,
  `rec_PP__molde`), para comparar métodos e estudos com principais
  diferentes. Sem `metodo` no Sobre: o único método das linhas; com os dois,
  gauss (com aviso).
* **Composição** → variáveis de amostra (aplicadas na confirmação,
  `variables.apply_imported`): "Fração <componente>" (número, %, a fração
  NOMINAL; 0 para os componentes do estudo ausentes na amostra — um PS puro
  tem Fração PP = 0) e "Composição" (categoria, o texto da coluna).
"""

from __future__ import annotations

import datetime as dt
import re
import unicodedata

from app.parsers.common import ParseError, ParseResult, Record, Value, clean_label, to_float
from app.services.catalog import POSTRUN, POSTRUN_COMPONENT_METRICS, POSTRUN_METHODS, POSTRUN_RUN_METRICS, postrun_key
from app.services.codes import FRACTION_POLYMER, parse_polymer_code

TECHNIQUE = POSTRUN
FORMAT = "horun-postrun-estudo"
SUPPORTED_VERSION = 1
SHEET_ABOUT = "sobre"
SHEET_RESULTS = "horun_resultados"
FORMAT_LABEL = "Estudo PostRun (RE7S) — .xlsx"

# coluna (rótulo normalizado) → campo
_COLUMNS = {
    "estudo": "study",
    "metodo": "method",
    "amostra": "sample",
    "replica": "replica",
    "composicao": "composition",
    "componente": "component",
    "parametro": "parameter",
    "valor": "value",
    "unidade": "unit",
    "u95": "u95",
    "fracao nominal": "frac_nominal",
    "fracao real": "frac_real",
    "massa da amostra": "mass",
    "data": "date",
}
_REQUIRED = ("sample", "replica", "component", "parameter", "value")

# nome do parâmetro (normalizado) → prefixo da chave (catalog.POSTRUN_*)
_COMPONENT_PARAMS = {
    "massa encontrada": "mfound",
    "massa esperada": "mexp",
    "recuperacao": "rec",
    "delta tmax": "dtmax",
    "delta largura": "dwidth",
}
_RUN_PARAMS = {
    "recuperacao total": "rec_total",
    "massa encontrada total": "mfound_total",
    "r2": "r2",
}
_DEFAULT_UNIT = {m[0]: m[2] for m in POSTRUN_COMPONENT_METRICS} | {m[0]: m[2] for m in POSTRUN_RUN_METRICS}
_REPLICA_TAIL_RE = re.compile(r"_(\d{1,3})$")


def _norm(text) -> str:
    """"Fração nominal (%)" → "fracao nominal"; "ΔTmax" → "delta tmax"; "R²" → "r2"."""
    t = clean_label(text).replace("Δ", "delta ").replace("∆", "delta ").replace("δ", "delta ").replace("²", "2")
    t = "".join(c for c in unicodedata.normalize("NFKD", t) if not unicodedata.combining(c)).lower()
    t = re.sub(r"\(.*?\)", " ", t)
    return re.sub(r"[^0-9a-z]+", " ", t).strip()


def _sheet(wb, name: str):
    for n in wb.sheetnames:
        if n.strip().lower() == name:
            return wb[n]
    return None


def is_postrun_workbook(wb) -> bool:
    return _sheet(wb, SHEET_RESULTS) is not None


def _about(wb) -> dict[str, str]:
    ws = _sheet(wb, SHEET_ABOUT)
    if ws is None:
        raise ParseError(
            "Planilha com a aba \"Horun_Resultados\" mas sem a aba \"Sobre\" — exporte o estudo de novo pelo PostRun do RE7S "
            "(Estudos → exportar .xlsx)."
        )
    out: dict[str, str] = {}
    for i, row in enumerate(ws.iter_rows(values_only=True)):
        if not row or row[0] is None:
            continue
        key = _norm(row[0])
        if i == 0 and key == "chave":
            continue
        value = row[1] if len(row) > 1 else None
        if isinstance(value, (dt.datetime, dt.date)):
            value = value.isoformat()
        out.setdefault(key, "" if value is None else str(value).strip())
    return out


def _date(value) -> str:
    if value is None:
        return ""
    if isinstance(value, dt.datetime):
        return value.date().isoformat()
    if isinstance(value, dt.date):
        return value.isoformat()
    return clean_label(value)[:32]


def _slug(component: str) -> str:
    plain = "".join(c for c in unicodedata.normalize("NFKD", component) if not unicodedata.combining(c))
    return re.sub(r"[^0-9A-Za-z-]+", "", plain)


def _fmt_pct(x: float) -> str:
    return f"{x:.4g}".replace(".", ",")


def parse_workbook(wb, filename: str = "") -> ParseResult:
    about = _about(wb)
    fmt = about.get("formato", "")
    if fmt != FORMAT:
        raise ParseError(
            f"Esta planilha não é um Estudo do PostRun (aba \"Sobre\": formato \"{fmt or 'vazio'}\", esperado \"{FORMAT}\")."
        )
    version = to_float(about.get("versao"))
    if version is not None and int(version) > SUPPORTED_VERSION:
        raise ParseError(
            f"Estudo do PostRun na versão {int(version)} do formato — este Resultados lê até a versão {SUPPORTED_VERSION}. "
            "Atualize o módulo Resultados."
        )
    study = clean_label(about.get("estudo", "")) or re.sub(r"\.xlsx$", "", filename, flags=re.IGNORECASE)
    channel = clean_label(about.get("canal", ""))
    status = _norm(about.get("status", ""))
    generated = clean_label(about.get("gerado_em", ""))

    ws = _sheet(wb, SHEET_RESULTS)
    rows = ws.iter_rows(values_only=True)
    header = next(rows, None) or ()
    cols: dict[str, int] = {}
    for i, h in enumerate(header):
        field = _COLUMNS.get(_norm(h))
        if field and field not in cols:
            cols[field] = i
    missing = [f for f in _REQUIRED if f not in cols]
    if missing:
        names = {v: k for k, v in _COLUMNS.items()}
        raise ParseError(
            "Aba \"Horun_Resultados\" sem as colunas: " + ", ".join(f'"{names[m]}"' for m in missing) + " (o cabeçalho fica na linha 1)."
        )

    def cell(row, field):
        i = cols.get(field)
        return row[i] if i is not None and i < len(row) else None

    result = ParseResult(TECHNIQUE, FORMAT_LABEL, tiebreak=generated)
    raw_rows = []
    methods_seen: set[str] = set()
    for row in rows:
        if not row or all(c is None or str(c).strip() == "" for c in row):
            continue
        method = _norm(cell(row, "method"))
        if method:
            methods_seen.add(method)
        raw_rows.append((row, method))

    main = _norm(about.get("metodo", ""))
    known_seen = methods_seen & set(POSTRUN_METHODS)
    if main not in POSTRUN_METHODS:
        if len(known_seen) == 1:
            main = next(iter(known_seen))
        else:
            main = "gauss"
            if known_seen:
                result.warnings.append("O \"Sobre\" não diz o método principal — valem as gaussianas (gauss) como padrão.")
    unknown_methods = methods_seen - set(POSTRUN_METHODS)
    if unknown_methods:
        result.warnings.append("Método(s) desconhecido(s) ignorado(s): " + ", ".join(sorted(unknown_methods)) + ".")

    # réplica → acumulado
    reps: dict[str, dict] = {}
    study_components: dict[str, str] = {}  # slug → nome como veio
    unknown_params: set[str] = set()
    bad_components: set[str] = set()
    for row, method in raw_rows:
        method = method or main
        if method not in POSTRUN_METHODS:
            continue
        replica = clean_label(cell(row, "replica"))
        if not replica:
            continue
        sample = clean_label(cell(row, "sample")) or parse_polymer_code(replica).base_code
        rep = reps.setdefault(
            replica,
            {"sample": sample, "composition": "", "date": "", "mass": None, "values": {}, "nominal": {}, "real": {}, "study": ""},
        )
        rep["study"] = rep["study"] or clean_label(cell(row, "study"))
        rep["composition"] = rep["composition"] or clean_label(cell(row, "composition"))
        rep["date"] = rep["date"] or _date(cell(row, "date"))
        if rep["mass"] is None:
            rep["mass"] = to_float(cell(row, "mass"))

        component = clean_label(cell(row, "component"))
        pname = _norm(cell(row, "parameter"))
        value = to_float(cell(row, "value"))
        unit = clean_label(cell(row, "unit"))
        u95 = to_float(cell(row, "u95"))
        if component:
            slug = _slug(component)
            if not slug or slug.lower() == "total":
                bad_components.add(component)
                continue
            study_components.setdefault(slug, component)
            nominal, real = to_float(cell(row, "frac_nominal")), to_float(cell(row, "frac_real"))
            if nominal is not None:
                rep["nominal"].setdefault(slug, nominal)
            if real is not None:
                rep["real"].setdefault(slug, real)
            metric = _COMPONENT_PARAMS.get(pname)
        else:
            slug = ""
            metric = _RUN_PARAMS.get(pname)
        if metric is None:
            unknown_params.add(clean_label(cell(row, "parameter")) or "(vazio)")
            continue
        if value is None:
            continue
        unit = unit or _DEFAULT_UNIT.get(metric, "")
        rep["values"][postrun_key(metric, slug, method)] = (value, unit)
        if method == main:
            rep["values"][postrun_key(metric, slug)] = (value, unit)
            if u95 is not None:
                rep["values"][postrun_key(metric, slug, "u95")] = (u95, unit)

    if unknown_params:
        result.warnings.append("Parâmetro(s) desconhecido(s) ignorado(s): " + ", ".join(sorted(unknown_params)) + ".")
    if bad_components:
        result.warnings.append("Componente(s) com nome inválido ignorado(s): " + ", ".join(sorted(bad_components)) + ".")
    if status == "aberto":
        result.warnings.append("Estudo ainda ABERTO no PostRun — os números podem mudar; reimporte quando ele for finalizado.")
    if not reps:
        raise ParseError("Aba \"Horun_Resultados\" sem réplicas com resultados.")

    # composição nominal por amostra (a das réplicas; vale a 1ª vista)
    nominal_by_sample: dict[str, dict[str, float]] = {}
    text_by_sample: dict[str, str] = {}
    for rep in reps.values():
        target = nominal_by_sample.setdefault(rep["sample"], {})
        for slug, v in rep["nominal"].items():
            if slug in target and abs(target[slug] - v) > 1e-6:
                result.warnings.append(f"{rep['sample']}: fração nominal de {study_components[slug]} diferente entre réplicas — vale {target[slug]:g} %.")
            target.setdefault(slug, v)
        text_by_sample.setdefault(rep["sample"], rep["composition"])
        if rep["composition"] and not text_by_sample[rep["sample"]]:
            text_by_sample[rep["sample"]] = rep["composition"]

    order = sorted(study_components, key=lambda s: study_components[s].lower())
    counters: dict[str, int] = {}
    for replica, rep in reps.items():
        sample = rep["sample"]
        values = [Value(k, round(v, 6), u) for k, (v, u) in rep["values"].items()]
        for slug, v in rep["real"].items():
            values.append(Value(postrun_key("frac_real", slug), round(v, 6), "%"))
        if rep["mass"] is not None:
            values.append(Value("sample_mass", round(rep["mass"], 6), "mg"))
        counters[sample] = counters.get(sample, 0) + 1
        m = _REPLICA_TAIL_RE.search(replica)
        replicate = int(m.group(1)) if m else counters[sample]

        nominal = nominal_by_sample.get(sample, {})
        composition = text_by_sample.get(sample) or " · ".join(
            f"{study_components[s]} {_fmt_pct(nominal[s])} %" for s in order if nominal.get(s)
        )
        sample_vars = []
        if nominal:
            for slug in order:
                sample_vars.append(
                    {"label": f"Fração {study_components[slug]}", "kind": "numero", "unit": "%", "value": nominal.get(slug, 0.0),
                     "description": "Fração nominal do componente na amostra (Estudo do PostRun/RE7S)."}
                )
        if composition:
            sample_vars.append(
                {"label": "Composição", "kind": "categoria", "unit": "", "value": composition,
                 "description": "Composição nominal da amostra (Estudo do PostRun/RE7S)."}
            )
        study_name = rep["study"] or study
        result.records.append(
            Record(
                key=f"{study_name}|{replica}",
                raw_name=replica,
                technique=TECHNIQUE,
                analyzed_at=rep["date"],
                instrument="Rock-Eval 7S (PostRun)",
                method=f"Estudo {study_name} · {POSTRUN_METHODS[main]}" + (f" · {channel}" if channel else ""),
                values=values,
                code_hint=sample,
                fraction_hint=FRACTION_POLYMER,
                extra={
                    "study": study_name,
                    "main_method": main,
                    "channel": channel,
                    "composition": composition,
                    "study_status": status,
                    "generated_at": generated,
                    "replicate_hint": replicate,
                    "sample_variables": sample_vars,
                },
            )
        )
    return result
