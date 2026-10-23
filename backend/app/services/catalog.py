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
            # relatório "multiheating" (tabaco): picos Q1–Q5 e frações de carbono
            Param("Q1", "Q1", "mg/g"),
            Param("Q2", "Q2", "mg/g"),
            Param("Q3", "Q3", "mg/g"),
            Param("Q4", "Q4", "mg/g"),
            Param("Q5", "Q5", "mg/g"),
            Param("PC", "PC (carbono pirolisável)", "%"),
            Param("RC", "RC (carbono residual)", "%"),
            Param("TotalHCGas", "HC total — gás", "%"),
            Param("TotalHCLiquid", "HC total — líquido", "%"),
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
            # tabela consolidada de gás (parsers/gas_consolidated.py): massa por pressão/pesagem
            Param("gas_mass_pressure_g", "Massa de gás gerada (pressão/pesagem)", "g"),
            Param("gas_yield_pressure_mg_g", "Gás por massa de rocha (pressão/pesagem)", "mg/g", False, True),
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
    # Cornerstone, sinal bruto do detector (parsers/leco_raw.py): áreas relativas
    # (soma do sinal, menos a média dos brancos) — NÃO são % sem massa e calibração.
    "leco_bruto": {
        "label": "LECO — sinal bruto",
        "instrument": "LECO (Cornerstone, sinal bruto)",
        "params": [
            Param("area_C", "Área do sinal de C", "u.a.", True),
            Param("area_S_low", "Área do sinal de S (baixo)", "u.a.", True),
            Param("area_S_high", "Área do sinal de S (alto)", "u.a."),
            Param("duration_s", "Duração da corrida", "s"),
        ],
    },
    # Shimadzu TGA-50 / TA-60, exportação ASCII (parsers/tg.py). Perdas em pontos
    # percentuais da massa inicial; DTG = dm/dT da curva suavizada.
    "tg": {
        "label": "TG",
        "instrument": "Shimadzu TGA-50",
        "params": [
            Param("loss_150", "Perda até 150 °C (umidade)", "%", True),
            Param("loss_150_400", "Perda 150–400 °C", "%", True),
            Param("loss_400_600", "Perda 400–600 °C", "%", True),
            Param("loss_600_900", "Perda 600–900 °C", "%"),
            Param("residue_pct", "Resíduo final", "%", True),
            Param("dtg_peak_c", "Pico da DTG", "°C", True),
            Param("t_final_c", "Temperatura final", "°C"),
            Param("mass_mg", "Massa da amostra", "mg"),
        ],
    },
}

# MEV-EDS (Oxford AZtec, "Quantity analysis"): % em massa (wt_) e atômica (at_)
# por elemento. Elemento fora desta lista entra só como aviso na importação.
EDS_ELEMENTS: list[tuple[str, str]] = [
    ("B", "Boron"), ("C", "Carbon"), ("N", "Nitrogen"), ("O", "Oxygen"), ("F", "Fluorine"), ("Na", "Sodium"),
    ("Mg", "Magnesium"), ("Al", "Aluminium"), ("Si", "Silicon"), ("P", "Phosphorus"), ("S", "Sulfur"), ("Cl", "Chlorine"),
    ("K", "Potassium"), ("Ca", "Calcium"), ("Ti", "Titanium"), ("V", "Vanadium"), ("Cr", "Chromium"), ("Mn", "Manganese"),
    ("Fe", "Iron"), ("Co", "Cobalt"), ("Ni", "Nickel"), ("Cu", "Copper"), ("Zn", "Zinc"), ("Br", "Bromine"),
    ("Rb", "Rubidium"), ("Sr", "Strontium"), ("Zr", "Zirconium"), ("Nb", "Niobium"), ("Mo", "Molybdenum"), ("Ba", "Barium"),
    ("Pb", "Lead"),
]  # fmt: skip
EDS_MAIN = {"C", "O", "K", "Ca", "Cl", "Mg", "Si"}
TECHNIQUES["mev_eds"] = {
    "label": "MEV-EDS",
    "instrument": "MEV-EDS (Oxford AZtec)",
    "params": [Param(f"wt_{sym}", f"{sym} (massa)", "% massa", sym in EDS_MAIN) for sym, _name in EDS_ELEMENTS]
    + [Param(f"at_{sym}", f"{sym} (atômica)", "% atômica") for sym, _name in EDS_ELEMENTS],
}

# GC-FID e GC-MS da Shimadzu nos projetos de tabaco (21/10/2026, parsers/shimadzu.py)
TECHNIQUES["gcfid_tab"] = {
    "label": "GC-FID",
    "instrument": "GC-FID Shimadzu (GCsolution)",
    "params": [
        Param("n_peaks", "Picos integrados", "", True),
        Param("total_area", "Área total dos picos", "sinal·s", True),
        Param("rt_main_peak", "Tempo do maior pico", "min", True),
    ],
}
TECHNIQUES["gcms_tab"] = {
    "label": "GC-MS",
    "instrument": "GCMS-QP2010 Shimadzu (GCMSsolution)",
    "params": [
        Param("pct_nicotine", "Nicotina", "% área", True),
        Param("pct_propylene_glycol", "Propilenoglicol", "% área", True),
        Param("pct_glycerol", "Glicerol", "% área", True),
        Param("pct_furfural", "Furfural", "% área", True),
        Param("pct_hmf", "5-HMF", "% área", True),
        Param("n_identified", "Compostos identificados (similaridade ≥ 80)", ""),
        Param("pct_identified", "Área identificada", "% área"),
        Param("n_peaks", "Picos", ""),
    ],
}

# ------------------------------------------------------------------ Estudo PostRun (RE7S)
#
# Quantificação de polímeros por pirólise no Rock-Eval (módulo RE7S, aba
# PostRun → Estudos; 22/10/2026). O .xlsx "absoluto" do estudo traz, por
# réplica, resultados POR COMPONENTE (PP, PS, PEAD... — nomes livres, quem
# define é o estudo) e da corrida inteira. Como os componentes não são uma
# lista fechada, os parâmetros por componente são DINÂMICOS: a chave diz a
# métrica e o componente, e o rótulo é montado aqui (`postrun_param`):
#
#   rec_PP            Recuperação PP (%)            — método principal do estudo
#   rec_PP__molde     Recuperação PP (moldes)       — cada método calculado
#   rec_PP__u95       U95 Recuperação PP            — incerteza (método principal)
#   frac_real_PP      Fração real PP (%)            — da réplica (massas pesadas)
#   rec_total, mfound_total, r2                     — da corrida (fixos, abaixo)
#
# O catálogo devolvido pela API soma aos fixos os parâmetros dinâmicos já
# gravados no banco (`catalog_json(present)`), para Séries/Comparar/Tabela.
POSTRUN = "postrun_estudo"
POSTRUN_METHODS: dict[str, str] = {"gauss": "gaussianas", "molde": "moldes"}
# métrica por componente: (prefixo da chave, rótulo, unidade padrão, principal)
POSTRUN_COMPONENT_METRICS: list[tuple[str, str, str, bool]] = [
    ("rec", "Recuperação", "%", True),
    ("mfound", "Massa encontrada", "mg", True),
    ("mexp", "Massa esperada", "mg", False),
    ("dtmax", "ΔTmax", "°C", False),
    ("dwidth", "Δlargura", "%", False),
    ("frac_real", "Fração real", "%", False),
]
# métrica da corrida (Componente vazio): (chave, rótulo, unidade padrão, principal)
POSTRUN_RUN_METRICS: list[tuple[str, str, str, bool]] = [
    ("rec_total", "Recuperação total", "%", True),
    ("mfound_total", "Massa encontrada total", "mg", True),
    ("r2", "R² do ajuste", "", False),
]
_POSTRUN_VARIANTS = ("", *(f"__{m}" for m in POSTRUN_METHODS), "__u95")


def _postrun_variant(label: str, variant: str) -> str:
    if variant == "__u95":
        return f"U95 {label}"
    if variant:
        return f"{label} ({POSTRUN_METHODS.get(variant[2:], variant[2:])})"
    return label


TECHNIQUES[POSTRUN] = {
    "label": "Estudo PostRun (RE7S)",
    "instrument": "Rock-Eval 7S (PostRun)",
    "params": [
        Param(key + variant, _postrun_variant(label, variant), unit, main and not variant)
        for key, label, unit, main in POSTRUN_RUN_METRICS
        for variant in _POSTRUN_VARIANTS
    ]
    + [Param("sample_mass", "Massa da amostra", "mg")],
}


def postrun_key(metric: str, component: str = "", variant: str = "") -> str:
    """Chave do parâmetro: métrica da corrida ("rec_total") ou métrica +
    componente ("rec_PP"); `variant` = "gauss" | "molde" | "u95" | ""."""
    base = f"{metric}_{component}" if component else metric
    return f"{base}__{variant}" if variant else base


def postrun_param(key: str) -> Param | None:
    """Rótulo/unidade de um parâmetro dinâmico por componente (None se a
    chave não segue o formato)."""
    base, sep, variant = key.partition("__")
    variant = f"__{variant}" if sep else ""
    if variant not in _POSTRUN_VARIANTS:
        return None
    for prefix, label, unit, main in sorted(POSTRUN_COMPONENT_METRICS, key=lambda m: -len(m[0])):
        if base.startswith(prefix + "_") and len(base) > len(prefix) + 1:
            component = base[len(prefix) + 1 :]
            if variant == "__u95" and prefix == "frac_real":
                return None
            return Param(key, _postrun_variant(f"{label} {component}", variant), unit, main and not variant)
    return None


def _postrun_sort(key: str) -> tuple:
    base, _, variant = key.partition("__")
    order = [m[0] for m in POSTRUN_COMPONENT_METRICS]
    for i, prefix in sorted(enumerate(order), key=lambda x: -len(x[1])):
        if base.startswith(prefix + "_"):
            v = f"__{variant}" if variant else ""
            return (base[len(prefix) + 1 :].lower(), i, _POSTRUN_VARIANTS.index(v) if v in _POSTRUN_VARIANTS else 9)
    return (key, 99, 0)


# técnicas com parâmetros dinâmicos: técnica → (rótulo da chave, ordem)
DYNAMIC_PARAMS = {POSTRUN: (postrun_param, _postrun_sort)}

TECHNIQUE_ORDER = list(TECHNIQUES)


def param(technique: str, key: str) -> Param | None:
    for p in TECHNIQUES.get(technique, {}).get("params", []):
        if p.key == key:
            return p
    dyn = DYNAMIC_PARAMS.get(technique)
    return dyn[0](key) if dyn else None


def technique_params(technique: str, present=()) -> list[Param]:
    """Parâmetros fixos da técnica + os dinâmicos presentes (`present` = chaves
    gravadas no banco), na ordem do catálogo."""
    base = list(TECHNIQUES.get(technique, {}).get("params", []))
    dyn = DYNAMIC_PARAMS.get(technique)
    if not dyn:
        return base
    known = {p.key for p in base}
    extra = [p for p in (dyn[0](k) for k in sorted(set(present) - known, key=dyn[1])) if p is not None]
    return extra + base


def catalog_json(present: dict[str, set[str]] | None = None) -> list[dict]:
    present = present or {}
    return [
        {
            "key": tech,
            "label": info["label"],
            "instrument": info.get("instrument", ""),
            "params": [
                {"key": p.key, "label": p.label, "unit": p.unit, "main": p.main, "derived": p.derived}
                for p in technique_params(tech, present.get(tech, ()))
            ],
        }
        for tech, info in TECHNIQUES.items()
    ]
