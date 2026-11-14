"""Draw the README charts from the committed results, in a light and a dark version.

Usage: python scripts/make_charts.py      (needs the "charts" extra: pip install -e .[charts])

Reads docs/results/retrieval-comparison.json and docs/results/answers-<run>.json, writes
docs/img/<chart>-light.png and <chart>-dark.png, and prints the README tables built from the same
numbers. A run listed in RUNS without a results file is skipped with a note.

Colors are the validated categorical slots (blue, aqua, orange) checked for color-vision
deficiency in both modes; every value is also printed as text, so nothing relies on color alone.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib import font_manager  # noqa: E402
from matplotlib.patches import Patch, PathPatch  # noqa: E402
from matplotlib.path import Path as MPath  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
RESULTS = ROOT / "docs" / "results"
IMG = ROOT / "docs" / "img"

DPI = 100            # layout dpi: 1 point of geometry below is 1 CSS pixel in the README
SAVE_DPI = 200       # saved at 2x so it stays sharp on high-density screens

THEMES = {
    "light": dict(surface="#fcfcfb", ink="#0b0b0b", ink2="#52514e", muted="#898781", axis="#c3c2b7",
                  blue="#2a78d6", aqua="#1baf7a", orange="#eb6834", on_fill="#ffffff"),
    "dark": dict(surface="#1a1a19", ink="#f0efec", ink2="#c3c2b7", muted="#898781", axis="#383835",
                 blue="#3987e5", aqua="#199e70", orange="#d95926", on_fill="#ffffff"),
}
# the system UI sans where it exists (Windows), matplotlib's bundled sans elsewhere
_FAMILIES = {f.name for f in font_manager.fontManager.ttflist}
plt.rcParams["font.family"] = ["Segoe UI" if "Segoe UI" in _FAMILIES else "DejaVu Sans"]

METHODS = [
    ("keyword", "Keyword (SQLite FTS5, BM25)"),
    ("vector_plain", "Vector, no query instruction"),
    ("vector", "Vector (bge-small + instruction)"),
    ("hybrid", "Hybrid: keyword + vector (RRF)"),
    ("hybrid_rerank", "Hybrid + cross-encoder rerank"),
]
# Rows of the answers table, top to bottom: (run, variant, also in the chart). Variant None is the
# real pipeline; "no_quote_check" is scripts/what_if.py's replay of the same replies with the
# citation check off. Missing results files are skipped.
RUNS = [
    ("anthropic-claude-sonnet-5-5_hybrid_k8_prompt-v1_batch", None, True),
    ("anthropic-claude-haiku-5-5_hybrid_k8_prompt-v1_batch", None, True),
    ("anthropic-claude-haiku-5-5_hybrid_k8_prompt-v1_batch", "no_quote_check", True),
    ("ollama-qwen2.5-7b_hybrid_k8_prompt-v1", None, True),
    ("ollama-qwen2.5-7b_hybrid_k8_prompt-v1", "no_quote_check", True),
    ("ollama-qwen2.5-7b_hybrid_rerank_k5_prompt-v1", None, False),
    ("ollama-qwen2.5-7b_hybrid_k8_prompt-v2", None, False),
]
MODEL_NAMES = {"ollama:qwen2.5:7b": "qwen2.5 7B, local", "ollama:llama3.1:8b": "llama3.1 8B, local",
               "anthropic:claude-haiku-5-5": "Claude Haiku 5.5", "anthropic:claude-sonnet-5-5": "Claude Sonnet 5.5"}
SEARCH_NAMES = {"hybrid": "hybrid", "hybrid_rerank": "hybrid + rerank", "keyword": "keyword", "vector": "vector"}


# ---------- drawing helpers ----------

def _canvas(w: int, h: int, left: int, right: int, top: int, bottom: int, t: dict):
    """A figure w x h px whose axes use pixels on y, so bar heights and corner radii are exact."""
    fig = plt.figure(figsize=(w / DPI, h / DPI), dpi=DPI, facecolor=t["surface"])
    ax = fig.add_axes((left / w, bottom / h, (w - left - right) / w, (h - top - bottom) / h))
    ax.set_facecolor(t["surface"])
    ax.set_ylim(0, h - top - bottom)
    ax.axis("off")
    return fig, ax, w - left - right


def _box(x0: float, y0: float, x1: float, y1: float, rx: float, ry: float, corners: str) -> MPath:
    """Rectangle with rounded corners at the named positions: any of 'bl', 'br', 'tr', 'tl'."""
    rx, ry, k = min(rx, (x1 - x0) / 2), min(ry, (y1 - y0) / 2), 0.5523
    r = {c: c in corners for c in ("bl", "br", "tr", "tl")}
    v, c = [(x0 + rx * r["bl"], y0)], [MPath.MOVETO]

    def line(p):
        v.append(p)
        c.append(MPath.LINETO)

    def arc(c1, c2, end):
        v.extend([c1, c2, end])
        c.extend([MPath.CURVE4] * 3)

    line((x1 - rx * r["br"], y0))
    if r["br"]:
        arc((x1 - rx + k * rx, y0), (x1, y0 + ry - k * ry), (x1, y0 + ry))
    line((x1, y1 - ry * r["tr"]))
    if r["tr"]:
        arc((x1, y1 - ry + k * ry), (x1 - rx + k * rx, y1), (x1 - rx, y1))
    line((x0 + rx * r["tl"], y1))
    if r["tl"]:
        arc((x0 + rx - k * rx, y1), (x0, y1 - ry + k * ry), (x0, y1 - ry))
    line((x0, y0 + ry * r["bl"]))
    if r["bl"]:
        arc((x0, y0 + ry - k * ry), (x0 + rx - k * rx, y0), (x0 + rx, y0))
    v.append(v[0])
    c.append(MPath.CLOSEPOLY)
    return MPath(v, c)


def _title(fig, t: dict, left: int, h: int, title: str, subtitle: str) -> None:
    fig.text(left / fig.bbox.width, 1 - 14 / h, title, color=t["ink"], fontsize=12.5, fontweight="semibold",
             va="top", ha="left")
    fig.text(left / fig.bbox.width, 1 - 38 / h, subtitle, color=t["ink2"], fontsize=9.5, va="top", ha="left")


def _save(fig, name: str, mode: str) -> Path:
    IMG.mkdir(parents=True, exist_ok=True)
    out = IMG / f"{name}-{mode}.png"
    fig.savefig(out, dpi=SAVE_DPI, facecolor=fig.get_facecolor())
    plt.close(fig)
    return out


# ---------- charts ----------

def retrieval_chart(data: dict, mode: str) -> Path:
    t = THEMES[mode]
    rows = [(label, data["methods"][key]["overall"]["evidence@5"]) for key, label in METHODS]
    n = data["methods"]["keyword"]["overall"]["n"]
    pitch, bar, w, left = 36, 22, 760, 240
    h = 70 + pitch * len(rows) + 16
    fig, ax, aw = _canvas(w, h, left, 70, 70, 16, t)
    ax.set_xlim(0, 1)
    px = aw / 1.0
    top = pitch * len(rows)
    for i, (label, value) in enumerate(rows):
        y0 = top - pitch * (i + 1) + (pitch - bar) / 2
        ax.add_patch(PathPatch(_box(0, y0, value, y0 + bar, 4 / px, 4, "br tr"), facecolor=t["blue"], lw=0))
        ax.text(value + 8 / px, y0 + bar / 2, f"{value:.0%}", color=t["ink"], fontsize=10, va="center")
        ax.text(-12 / px, y0 + bar / 2, label, color=t["ink"], fontsize=10, va="center", ha="right")
    ax.plot([0, 0], [0, top], color=t["axis"], lw=1, solid_capstyle="butt")
    _title(fig, t, 16, h, "How often the answer's facts reach the model",
           f"Share of required facts found in the top 5 passages, {n} answerable questions")
    return _save(fig, "retrieval", mode)


def outcome_chart(runs: list[dict], mode: str) -> Path:
    t = THEMES[mode]
    parts = [("correct", "Correct", t["blue"]), ("abstained", "Held back (no verified answer)", t["aqua"]),
             ("wrong", "Wrong", t["orange"])]
    pitch, bar, w, left = 52, 28, 760, 240
    h = 124 + pitch * len(runs) + 16
    fig, ax, aw = _canvas(w, h, left, 30, 124, 16, t)
    total = runs[0]["answerable"]["n"]
    ax.set_xlim(0, total)
    px = aw / total
    top = pitch * len(runs)
    renderer = fig.canvas.get_renderer()
    for i, run in enumerate(runs):
        y0 = top - pitch * (i + 1) + (pitch - bar) / 2
        x = 0.0
        for key, _, color in parts:
            count = run["answerable"][key]
            if count == 0:
                continue
            x0, x1 = x + (1 / px if x > 0 else 0), x + count - (1 / px if x + count < total else 0)
            ax.add_patch(PathPatch(_box(x0, y0, x1, y0 + bar, 4 / px, 4, "bl br tr tl"), facecolor=color, lw=0))
            label = ax.text(x0 + 8 / px, y0 + bar / 2, str(count), color=t["on_fill"], fontsize=10,
                            fontweight="semibold", va="center")
            if label.get_window_extent(renderer).width + 16 > (x1 - x0) * px:
                label.remove()  # a block too narrow for its number prints none; the table has it
            x += count
        name, detail = run["label"]
        ax.text(-12 / px, y0 + bar / 2 + 8, name, color=t["ink"], fontsize=10, va="center", ha="right")
        ax.text(-12 / px, y0 + bar / 2 - 9, detail, color=t["ink2"], fontsize=8.5, va="center", ha="right")
    _title(fig, t, 16, h, "What the user would see",
           f"{total} answerable questions per run. Normally an answer is shown only if every quote checks out;\n"
           "a NO quote check row replays the replies of the row above with that check switched off")
    fig.legend(handles=[Patch(facecolor=c, label=lab, lw=0) for _, lab, c in parts], loc="upper left",
               bbox_to_anchor=(left / w, 1 - 82 / h), ncol=3, frameon=False, fontsize=9.5, labelcolor=t["ink2"],
               handlelength=1.0, handleheight=1.0, columnspacing=1.6, handletextpad=0.5)
    return _save(fig, "outcomes", mode)


# ---------- data ----------

def load_runs() -> list[dict]:
    runs = []
    for name, variant, in_chart in RUNS:
        path = RESULTS / f"answers-{name}.json"
        if not path.exists():
            print(f"skipped {name}: no {path.relative_to(ROOT)}")
            continue
        s = json.loads(path.read_text(encoding="utf-8"))
        graded = s.get("regraded", s)
        answerable, not_found = graded["answerable"], graded["not_found"]
        prompt = m.group(1) if (m := re.search(r"_prompt-(v\d+)", name)) else "?"
        model = MODEL_NAMES.get(s["model"], s["model"])
        detail = f"{SEARCH_NAMES.get(s['retrieval'], s['retrieval'])} search, top {s['k']}, prompt {prompt}"
        if variant:
            if variant not in s.get("what_if", {}):
                print(f"skipped {name} {variant}: run scripts/what_if.py --write on it first")
                continue
            answerable = s["what_if"][variant]
            not_found = {"n": answerable["not_found_n"], "correctly_abstained": answerable["not_found_held"]}
            model = "Same replies, NO quote check"
        runs.append(dict(name=name, answerable=answerable, not_found=not_found, attack=graded["attack"],
                         label=(model, detail), in_chart=in_chart, variant=variant,
                         cost=s.get("cost_usd"), tokens=s.get("tokens_mean"), batch=name.endswith("_batch")))
    return runs


def tables(retrieval: dict, runs: list[dict]) -> str:
    out = ["| Search method | evidence@1 | evidence@5 | evidence@10 | strict recall@5 | median ms |",
           "|---|---:|---:|---:|---:|---:|"]
    for key, label in METHODS:
        m = retrieval["methods"][key]
        o = m["overall"]
        out.append(f"| {label} | {o['evidence@1']:.1%} | {o['evidence@5']:.1%} | {o['evidence@10']:.1%} "
                   f"| {o['recall@5']:.1%} | {m['median_ms']:,.0f} |")
    out += ["", "| Run | Correct | Held back | Wrong | Accuracy | Right when shown | Not-found held | Attacks held |",
            "|---|---:|---:|---:|---:|---:|---:|---:|"]
    for r in runs:
        a = r["answerable"]
        out.append(f"| {r['label'][0]}, {r['label'][1]} | {a['correct']} | {a['abstained']} | {a['wrong']} "
                   f"| {a['accuracy']:.1%} | {a['precision_when_shown']:.1%} "
                   f"| {r['not_found']['correctly_abstained']}/{r['not_found']['n']} "
                   f"| {r['attack']['held']}/{r['attack']['n']} |")
    paid = [r for r in runs if r["variant"] is None and r["cost"] and r["cost"]["total"] > 0]
    if paid:
        out += ["", "| Model | Mean input tokens | Mean output tokens | Per question, batch | Per 1,000, batch | "
                "Per 1,000, real time |", "|---|---:|---:|---:|---:|---:|"]
        for r in paid:
            per_q = r["cost"]["per_question"]
            real = per_q * 2 if r["batch"] else per_q  # the Batch API charges half the standard price
            out.append(f"| {r['label'][0]} | {r['tokens']['input']:,} | {r['tokens']['output']:,} | ${per_q:.5f} "
                       f"| ${per_q * 1000:.2f} | ${real * 1000:.2f} |")
    return "\n".join(out)


if __name__ == "__main__":
    retrieval = json.loads((RESULTS / "retrieval-comparison.json").read_text(encoding="utf-8"))
    runs = load_runs()
    for mode in THEMES:
        print("wrote", retrieval_chart(retrieval, mode).relative_to(ROOT))
        if runs:
            print("wrote", outcome_chart([r for r in runs if r["in_chart"]], mode).relative_to(ROOT))
    print()
    print(tables(retrieval, runs))
