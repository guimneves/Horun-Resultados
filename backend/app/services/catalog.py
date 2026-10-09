"""Catálogo de técnicas e parâmetros (nome e unidade padronizados).

`main=True` = coluna padrão da tabela de amostras. Parâmetros derivados são
calculados na importação (services/derived.py) e gravados como valores comuns.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Param:
    key: str
    label: str
    unit: str = ""
    main: bool = False
    derived: bool = False


TECHNIQUES: dict[str, dict] = {
    "chnso": {
        "label": "CHNSO",
        "instrument": "EuroVector EA",
        "params": [
            Param("N", "N", "%", True),
            Param("C", "C", "%", True),
            Param("H", "H", "%", True),
            Param("S", "S", "%", True),
            Param("O", "O", "%"),
            Param("W", "Massa", "mg"),
            Param("HC_at", "H/C atômica", "", True, True),
            Param("NC_at", "N/C atômica", "", False, True),
            Param("SC_at", "S/C atômica", "", False, True),
            Param("OC_at", "O/C atômica", "", False, True),
        ],
    },
    "leco": {
        "label": "LECO",
        "instrument": "LECO SC832",
        "params": [
            Param("C", "C total", "%", True),
            Param("S", "S total", "%", True),
            Param("mass", "Massa", "g"),
        ],
    },
    # "Planilha de massas das amostras" do LECO (parsers/leco_ri.py): por réplica,
    # resíduo (g) = cadinho + amostra − massa após o tratamento; % = g ÷ amostra × 100.
    "leco_ri": {
        "label": "LECO - Resíduo Insolúvel",
        "instrument": "LECO",
        "params": [
            Param("RI_pct", "Resíduo insolúvel", "%", True, True),
            Param("RI", "Resíduo insolúvel", "g", True),
            Param("sample_mass", "Massa da amostra", "g"),
        ],
    },
    "rockeval": {
        "label": "Rock-Eval",
        "instrument": "Rock-Eval 7S",
        "params": [
            Param("TOC", "COT", "%", True),
            Param("Tmax", "Tmax", "°C", True),
            Param("TpkS2", "TpkS2", "°C"),
            Param("MINC", "MINC", "%"),
            Param("S1", "S1", "mg/g", True),
            Param("S2", "S2", "mg/g", True),
            Param("S3", "S3", "mg/g"),
            Param("S3CO", "S3CO", "mg/g"),
            Param("S3CO2", "S3CO2", "mg/g"),
            Param("S4", "S4", "mg/g"),
            Param("S4CO", "S4CO", "mg/g"),
            Param("S5", "S5", "mg/g"),
            Param("S1S", "S1 S", "%"),
            Param("S2S", "S2 S", "%"),
            Param("PyroFeS", "Pyro Fe S", "%"),
            Param("ResidualS", "Residual S", "%"),
            Param("RetainedS", "Retained S", "%"),
            Param("SulfateS", "Sulfate S", "%"),
            Param("HI", "HI", "mg HC/g COT", True),
            Param("OI", "OI", "mg CO2/g COT", True),
            Param("Sindex", "S index", ""),
            Param("quantity", "Massa", "mg"),
            Param("PI", "PI = S1/(S1+S2)", "", False, True),
        ],
    },
    "gc_fid": {
        "label": "GC-FID (gás)",
        "instrument": "GC-FID",
        "params": [
            Param("pct_C1", "C1", "% área", True),
            Param("pct_C2", "C2", "% área"),
            Param("pct_C3", "C3", "% área"),
            Param("pct_C4", "C4", "% área"),
            Param("pct_C5p", "C5+", "% área"),
            Param("wetness", "Umidade do gás (C2–C5+)/ΣC", "%", False, True),
        ],
    },
    "gc_tcd": {
        "label": "GC-TCD (gás)",
        "instrument": "GC-TCD",
        "params": [
            Param("pct_H2", "H2", "% área", True),
            Param("pct_CO2", "CO2", "% área", True),
            Param("pct_C1", "C1", "% área"),
            Param("pct_C2", "C2", "% área"),
            Param("pct_C3", "C3", "% área"),
        ],
    },
    "gas_balanco": {
        "label": "Balanço de gás",
        "instrument": "Planilha cálculo gás",
        "params": [
            Param("gas_mass_g", "Massa de gás gerada", "g", True),
            Param("gas_yield_mg_g", "Gás gerado por massa de rocha", "mg/g", True, True),
            Param("initial_mass_g", "Massa inicial de amostra", "g"),
            Param("weighed_gas_g", "Massa de gás após pesagem", "g"),
            Param("pressure_closure_pct", "Fechamento do balanço de pressão", "%"),
            Param("comp_H2", "H2 (normalizado)", "%"),
            Param("comp_CO2", "CO2 (normalizado)", "%"),
            Param("comp_C1", "C1 (normalizado)", "%"),
            Param("comp_C2", "C2 (normalizado)", "%"),
            Param("comp_C3", "C3 (normalizado)", "%"),
            Param("comp_C4", "C4 (normalizado)", "%"),
            Param("comp_C5p", "C5+ (normalizado)", "%"),
        ],
    },
    "pygcms": {
        "label": "Py-GC-MS",
        "instrument": "Py-GC-MS",
        "params": [
            Param("pr_ph", "Pristano/Fitano", "", True, True),
            Param("pr_nc17", "Pristano/n-C17", "", True, True),
            Param("ph_nc18", "Fitano/n-C18", "", True, True),
            Param("cpi", "CPI (C24–C34)", "", False, True),
            Param("n_peaks", "Picos identificados", ""),
        ],
    },
}

TECHNIQUE_ORDER = list(TECHNIQUES)


def param(technique: str, key: str) -> Param | None:
    for p in TECHNIQUES.get(technique, {}).get("params", []):
        if p.key == key:
            return p
    return None


def catalog_json() -> list[dict]:
    return [
        {
            "key": tech,
            "label": info["label"],
            "instrument": info.get("instrument", ""),
            "params": [
                {"key": p.key, "label": p.label, "unit": p.unit, "main": p.main, "derived": p.derived}
                for p in info["params"]
            ],
        }
        for tech, info in TECHNIQUES.items()
    ]
