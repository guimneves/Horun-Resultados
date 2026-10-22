"""Planejamento fatorial completo de dois níveis (2², 2³, 2⁴) — pedido do
mantenedor de 22/10/2026 (projetos "Geoquímica — Extração ASE").

* Fatores: nome, unidade, tipo e níveis baixo (−1) e alto (+1). Tipos:
  "continuo" (temperatura), "discreto" (nº de ciclos: só inteiros) e
  "categorico" (solvente). Letras A, B, C, D na ordem informada.
* Condições na ordem padrão (Yates: A alterna mais rápido) — F01…F2ᵏ. Pontos
  centrais (C01…) só quando o centro existe de verdade: todos os fatores
  contínuos, ou discretos com ponto médio inteiro. Fator categórico ou ponto
  médio não inteiro → o centro NÃO é criado e o motivo é mostrado.
* Análise (`analyze`): mínimos quadrados com as colunas codificadas ±1 de
  todos os efeitos (A, B, AB, …, ABC…) e, havendo pontos centrais, uma coluna
  de curvatura. Efeito = 2 × coeficiente. Só execuções independentes entram
  (uma linha por execução; leituras analíticas repetidas da mesma rocha já
  chegam como a média da amostra). Sem graus de liberdade no resíduo (uma
  execução por condição, sem centro) os efeitos aparecem, mas SEM valor-p — o
  motivo é dito na resposta (`significance_note`).
"""

from __future__ import annotations

import itertools
import math
import random

from app.services import stats

FACTOR_KINDS = ("continuo", "discreto", "categorico")
LETTERS = "ABCD"
MAX_REPLICATES = 10
MAX_CENTER = 10


class DoeError(ValueError):
    """Mensagem em português para a pessoa."""


def _num(v) -> float | None:
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)):
        return float(v)
    try:
        return float(str(v).replace(",", "."))
    except ValueError:
        return None


def clean_factors(raw: list[dict]) -> list[dict]:
    if not 2 <= len(raw) <= 4:
        raise DoeError("O planejamento fatorial completo aceita 2, 3 ou 4 fatores.")
    out = []
    for i, f in enumerate(raw):
        letter = LETTERS[i]
        name = (f.get("name") or "").strip()
        if not name:
            raise DoeError(f"Dê um nome ao fator {letter}.")
        kind = f.get("kind") or "continuo"
        if kind not in FACTOR_KINDS:
            raise DoeError(f"Fator {letter}: tipo inválido.")
        low, high = f.get("low"), f.get("high")
        if kind == "categorico":
            low, high = str(low or "").strip(), str(high or "").strip()
            if not low or not high or low == high:
                raise DoeError(f"Fator {letter} ({name}): informe dois níveis diferentes.")
        else:
            low, high = _num(low), _num(high)
            if low is None or high is None or low == high:
                raise DoeError(f"Fator {letter} ({name}): informe dois níveis numéricos diferentes.")
            if kind == "discreto" and (low != int(low) or high != int(high)):
                raise DoeError(f"Fator {letter} ({name}): fator discreto só aceita números inteiros.")
        out.append({
            "letter": letter,
            "name": name[:80],
            "unit": (f.get("unit") or "").strip()[:20],
            "kind": kind,
            "low": low,
            "high": high,
            # rótulos opcionais dos níveis (ex.: "3 ciclos de 10 min")
            "low_label": (f.get("low_label") or "").strip()[:60],
            "high_label": (f.get("high_label") or "").strip()[:60],
        })
    return out


def center_feasibility(factors: list[dict]) -> tuple[bool, str]:
    """O ponto central existe fisicamente? (e por que não)."""
    reasons = []
    for f in factors:
        if f["kind"] == "categorico":
            reasons.append(f'{f["letter"]} — {f["name"]} é categórico (não há nível intermediário entre "{f["low"]}" e "{f["high"]}")')
        elif f["kind"] == "discreto" and (f["low"] + f["high"]) % 2:
            # sem f-string aninhada com as mesmas aspas: o servidor roda Python 3.11
            mid = ("%g" % ((f["low"] + f["high"]) / 2)).replace(".", ",")
            reasons.append(f'{f["letter"]} — {f["name"]}: o ponto médio seria {mid}, que não é um valor possível')
    if reasons:
        return False, "Ponto central não é possível: " + "; ".join(reasons) + "."
    return True, ""


def center_values(factors: list[dict]) -> dict[str, float]:
    return {f["letter"]: (f["low"] + f["high"]) / 2 for f in factors}


def terms(k: int) -> list[str]:
    """Efeitos do modelo completo na ordem usual: A, B, C, AB, AC, BC, ABC…"""
    out = []
    for size in range(1, k + 1):
        for combo in itertools.combinations(LETTERS[:k], size):
            out.append("".join(combo))
    return out


def conditions(factors: list[dict]) -> list[dict]:
    """Condições na ordem padrão (F01…), com níveis codificados e reais."""
    k = len(factors)
    out = []
    for i in range(2 ** k):
        coded = {f["letter"]: (1 if (i >> j) & 1 else -1) for j, f in enumerate(factors)}
        out.append({"code": f"F{i + 1:02d}", "coded": coded, "center": False})
    return out


def level_value(f: dict, coded: int) -> object:
    if coded == 0:
        return (f["low"] + f["high"]) / 2
    return f["high"] if coded > 0 else f["low"]


def level_text(f: dict, coded: int) -> str:
    if coded == 0:
        v = (f["low"] + f["high"]) / 2
        return f"{v:g}{(' ' + f['unit']) if f['unit'] else ''}"
    label = f["high_label"] if coded > 0 else f["low_label"]
    if label:
        return label
    v = level_value(f, coded)
    if isinstance(v, float):
        return f"{v:g}{(' ' + f['unit']) if f['unit'] else ''}"
    return str(v)


def plan_runs(factors: list[dict], replicates: int, center_points: int, randomize: bool, seed: int) -> list[dict]:
    """Execuções planejadas: cada condição × réplica (R1, R2…) e os pontos
    centrais; ordem planejada padrão ou aleatorizada (semente guardada)."""
    if not 1 <= replicates <= MAX_REPLICATES:
        raise DoeError(f"Execuções por condição: de 1 a {MAX_REPLICATES}.")
    if not 0 <= center_points <= MAX_CENTER:
        raise DoeError(f"Pontos centrais: de 0 a {MAX_CENTER}.")
    if center_points:
        ok, why = center_feasibility(factors)
        if not ok:
            raise DoeError(why)
    runs = []
    for r in range(1, replicates + 1):
        for c in conditions(factors):
            runs.append({"condition": c["code"], "replicate": r})
    for n in range(1, center_points + 1):
        runs.append({"condition": "C", "replicate": n})
    order = list(range(len(runs)))
    if randomize:
        random.Random(seed).shuffle(order)
    for pos, idx in enumerate(order, start=1):
        runs[idx]["planned_order"] = pos
    return runs


def coded_of(factors: list[dict], condition: str) -> dict[str, int]:
    if condition == "C":
        return {f["letter"]: 0 for f in factors}
    for c in conditions(factors):
        if c["code"] == condition:
            return c["coded"]
    raise DoeError(f"Condição desconhecida: {condition}.")


def _term_col(coded: dict[str, int], term: str) -> int:
    v = 1
    for letter in term:
        v *= coded[letter]
    return v


def _mean(v: list[float]) -> float | None:
    return sum(v) / len(v) if v else None


def analyze(factors: list[dict], observations: list[dict], confidence: float = 0.95) -> dict:
    """`observations` = [{"condition": "F01"|"C", "y": float, "run": "..."}]
    (uma por execução independente)."""
    if not 0.5 < confidence < 1:
        raise DoeError("Nível de confiança entre 50 % e 99,99 %.")
    k = len(factors)
    tm = terms(k)
    obs = [o for o in observations if o.get("y") is not None and math.isfinite(o["y"])]
    fact = [o for o in obs if o["condition"] != "C"]
    centers = [o for o in obs if o["condition"] == "C"]
    present = {o["condition"] for o in fact}
    missing = [c["code"] for c in conditions(factors) if c["code"] not in present]
    base = {
        "terms": tm,
        "confidence": confidence,
        "n_runs": len(obs),
        "n_center": len(centers),
        "missing_conditions": missing,
    }
    if missing:
        return {**base, "ok": False, "message": (
            "Para estimar todos os efeitos, cada condição precisa de ao menos uma execução com resultado. "
            f"Faltam: {', '.join(missing)}."
        )}
    use_curv = bool(centers)
    x, y = [], []
    for o in obs:
        coded = coded_of(factors, o["condition"])
        row = [1.0] + [float(_term_col(coded, t)) for t in tm]
        if use_curv:
            row.append(1.0 if o["condition"] == "C" else 0.0)
        x.append(row)
        y.append(o["y"])
    fit = stats.ols(x, y)
    if fit is None:
        return {**base, "ok": False, "message": "Não foi possível ajustar o modelo com estes dados."}
    n, p = len(y), len(x[0])
    df = n - p
    sse = sum(r * r for r in fit["resid"])
    mse = sse / df if df > 0 else None
    alpha = 1 - confidence
    tcrit = stats.t_quantile(1 - alpha / 2, df) if df > 0 else None
    ybar = sum(y) / n
    sst = sum((v - ybar) ** 2 for v in y)

    effects = []
    names = {f["letter"]: f["name"] for f in factors}
    for i, t in enumerate(tm, start=1):
        coef = fit["beta"][i]
        item = {"term": t, "label": " × ".join(names[c] for c in t), "order": len(t), "coef": coef, "effect": 2 * coef}
        if mse is not None:
            se = math.sqrt(mse * fit["inv"][i][i])
            tval = coef / se if se > 0 else float("inf")
            pval = stats.t_pvalue(tval, df)
            item.update({"se_effect": 2 * se, "t": tval, "p": pval, "significant": pval < alpha,
                         "ss": tval * tval * mse})
        effects.append(item)

    result = {
        **base,
        "ok": True,
        "intercept": fit["beta"][0],
        "df_resid": df,
        "mse": mse,
        "s": math.sqrt(mse) if mse is not None else None,
        "t_crit": tcrit,
        "alpha": alpha,
        "effects": effects,
    }
    if use_curv:
        coef = fit["beta"][-1]
        curv = {"coef": coef, "mean_center": _mean([o["y"] for o in centers]), "mean_factorial": _mean([o["y"] for o in fact])}
        if mse is not None:
            se = math.sqrt(mse * fit["inv"][-1][-1])
            tval = coef / se if se > 0 else float("inf")
            curv.update({"t": tval, "p": stats.t_pvalue(tval, df), "significant": stats.t_pvalue(tval, df) < alpha})
        result["curvature"] = curv

    if mse is not None:
        ss_model = sst - sse
        result.update({
            "r2": 1 - sse / sst if sst > 0 else None,
            "r2_adj": 1 - (sse / df) / (sst / (n - 1)) if sst > 0 and n > 1 else None,
            "press": None,
            "anova": None,
        })
        lev = fit["leverage"]
        if all(h < 1 - 1e-9 for h in lev):
            press = sum((r / (1 - h)) ** 2 for r, h in zip(fit["resid"], lev))
            result["press"] = press
            result["r2_pred"] = 1 - press / sst if sst > 0 else None
        else:
            result["r2_pred"] = None
        rows = []
        for e in effects:
            f_val = e["t"] ** 2 if math.isfinite(e["t"]) else float("inf")
            rows.append({"source": e["term"], "label": e["label"], "df": 1, "ss": e["ss"], "ms": e["ss"], "f": f_val, "p": e["p"]})
        if use_curv and "t" in result["curvature"]:
            c = result["curvature"]
            ss_c = c["t"] ** 2 * mse
            rows.append({"source": "Curvatura", "label": "Curvatura (pontos centrais)", "df": 1, "ss": ss_c, "ms": ss_c,
                         "f": c["t"] ** 2, "p": c["p"]})
        f_model = (ss_model / (p - 1)) / mse if p > 1 and mse > 0 else None
        rows.append({"source": "Modelo", "label": "Modelo", "df": p - 1, "ss": ss_model, "ms": ss_model / (p - 1) if p > 1 else None,
                     "f": f_model, "p": stats.f_pvalue(f_model, p - 1, df) if f_model is not None else None})
        rows.append({"source": "Resíduo", "label": "Erro (entre execuções independentes)", "df": df, "ss": sse, "ms": mse, "f": None, "p": None})
        rows.append({"source": "Total", "label": "Total", "df": n - 1, "ss": sst, "ms": None, "f": None, "p": None})
        result["anova"] = rows
        result["significance_note"] = None
    else:
        result["significance_note"] = (
            "Sem graus de liberdade para o erro: com uma execução por condição e todos os efeitos no modelo, "
            "não há como estimar o erro experimental e calcular valores-p pelo procedimento convencional. "
            "Os efeitos são mostrados, mas não é possível concluir sobre a significância. Faça réplicas "
            "(execuções independentes) ou pontos centrais para obter o erro."
        )
        # gráfico meio-normal: apoio visual quando não há réplicas (não é teste)
        absv = sorted((abs(e["effect"]), e["term"]) for e in effects)
        m = len(absv)
        result["half_normal"] = [
            {"term": t, "abs_effect": v, "quantile": stats.normal_ppf(0.5 + 0.5 * (i + 1 - 0.5) / m)}
            for i, (v, t) in enumerate(absv)
        ]

    # efeitos principais e interações (médias observadas; só fatoriais)
    main = []
    for f in factors:
        lo = [o["y"] for o in fact if coded_of(factors, o["condition"])[f["letter"]] < 0]
        hi = [o["y"] for o in fact if coded_of(factors, o["condition"])[f["letter"]] > 0]
        main.append({"letter": f["letter"], "name": f["name"], "low": level_text(f, -1), "high": level_text(f, 1),
                     "mean_low": _mean(lo), "mean_high": _mean(hi)})
    result["main_effects"] = main
    inter = []
    for a, b in itertools.combinations(factors, 2):
        cells = {}
        for la in (-1, 1):
            for lb in (-1, 1):
                vals = [o["y"] for o in fact if coded_of(factors, o["condition"])[a["letter"]] == la
                        and coded_of(factors, o["condition"])[b["letter"]] == lb]
                cells[f"{la}{lb}"] = _mean(vals)
        inter.append({"a": a["letter"], "b": b["letter"], "a_name": a["name"], "b_name": b["name"],
                      "a_low": level_text(a, -1), "a_high": level_text(a, 1), "b_low": level_text(b, -1), "b_high": level_text(b, 1),
                      "means": cells})
    result["interactions"] = inter

    # resíduos (diagnóstico)
    resid = []
    order = sorted(range(n), key=lambda i: fit["resid"][i])
    scores = stats.normal_scores(n)
    rank = {idx: pos for pos, idx in enumerate(order)}
    for i, o in enumerate(obs):
        h = fit["leverage"][i]
        std = fit["resid"][i] / math.sqrt(mse * (1 - h)) if mse and h < 1 - 1e-9 else None
        resid.append({"run": o.get("run"), "condition": o["condition"], "y": o["y"], "fitted": fit["fitted"][i],
                      "residual": fit["resid"][i], "standardized": std, "normal_score": scores[rank[i]]})
    result["residuals"] = resid
    return result
