"""Build every Brandrune logo asset as SVG into public/brand/assets/.

    python3 -m venv .venv && .venv/bin/pip install shapely
    .venv/bin/python brand-src/build.py
    node brand-src/render.mjs          # PNGs, the zip, og.png, apple-touch-icon.png

The mark and the wordmark are geometry, not drawings: see geometry.py.
No asset uses live <text> for the name. Light mode only.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

from geometry import (COS, SIN, TAN, Point, Polygon, Rune, Wordmark, box, monogram_b, poly_path, rune_at,
                      shape_path, unary_union, fmt)
from shapely.geometry import LineString

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "brand" / "assets"

C = {
    "paper": "#fafaf8", "card": "#ffffff", "ink": "#1d1d1b", "stone": "#5f5f5a", "rule": "#e6e5e0",
    "ochre": "#9c3d1c", "ochre_tint": "#f6ebe5", "open": "#1f6b3a", "open_tint": "#e8f5ec",
    "amber": "#8a5a00", "amber_tint": "#fdf3e1",
}
# Facet tones. The mark is the only place these appear.
CARVED = {"hl": "#c25a33", "lt": "#ad4925", "mid": C["ochre"], "dp": "#7a2d14"}
CARVED_LIGHT = {"hl": "#ffffff", "lt": "#fbf4ef", "mid": "#efd9cc", "dp": "#d9b19c"}

KERN = {("r", "a"): -1.2, ("a", "n"): 0.7, ("d", "r"): 0.7, ("u", "n"): 0.7, ("r", "u"): -0.5, ("b", "r"): 0.2}
WM = Wordmark(tracking=1.5).build(kern=KERN)
WM_D = shape_path(WM)
WM_X0, WM_Y0, WM_X1, WM_Y1 = WM.bounds          # y-down: top is about -28.6, baseline 0
WM_W, WM_H = WM_X1 - WM_X0, WM_Y1 - WM_Y0
WM_MID = (WM_Y0 + WM_Y1) / 2

ARIA = "Brandrune"


def tone(b, tones):
    if b >= 0.8:
        return tones["hl"]
    if b >= 0.3:
        return tones["lt"]
    if b >= -0.5:
        return tones["mid"]
    return tones["dp"]


def rune_svg(r: Rune, mode="carved", color=None, tones=CARVED):
    """SVG elements for a rune: carved facets, or a flat silhouette."""
    if mode == "flat":
        return f'<path d="{r.silhouette_path()}" fill="{color}" fill-rule="evenodd"/>'
    # the flat silhouette underneath hides anti-aliasing seams between facets
    under = f'<path d="{r.silhouette_path()}" fill="{tones["mid"]}" fill-rule="evenodd"/>'
    facets = "".join(f'<path d="{d}" fill="{tone(b, tones)}"/>' for d, b in r.facet_paths())
    return under + facets


def wordmark_svg(dx, dy=0.0, color=C["ink"], scale=1.0):
    t = f"translate({fmt(dx)} {fmt(dy)})" + (f" scale({fmt(scale)})" if scale != 1 else "")
    return f'<path transform="{t}" d="{WM_D}" fill="{color}" fill-rule="evenodd"/>'


def doc(vb, body, w=None, h=None, label=ARIA, extra=""):
    x, y, vw, vh = vb
    size = f' width="{fmt(w)}" height="{fmt(h)}"' if w else ""
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{fmt(x)} {fmt(y)} {fmt(vw)} {fmt(vh)}"{size} '
            f'role="img" aria-label="{label}"{extra}><title>{label}</title>{body}</svg>\n')


def write(name, text):
    (OUT / name).write_text(text)
    return name


# ------------------------------------------------------------- lockups

MARK_H = 40.0         # mark height in a horizontal lockup, wordmark units
GAP = 9.0


def horizontal(mode="carved", rune_color=None, word_color=C["ink"], tones=CARVED, pad=4.0, bg=None):
    r = rune_at(MARK_H, x0=0, top=WM_MID - MARK_H / 2)
    wx = r.bbox[2] + GAP - WM_X0
    x0, y0 = r.bbox[0] - pad, r.bbox[1] - pad
    vw, vh = wx + WM_X1 + pad - x0, r.height + 2 * pad
    # overhang by one unit so a rounded viewport never leaves a transparent edge row
    back = f'<rect x="{fmt(x0 - 1)}" y="{fmt(y0 - 1)}" width="{fmt(vw + 2)}" height="{fmt(vh + 2)}" fill="{bg}"/>' if bg else ""
    body = back + rune_svg(r, mode, rune_color, tones) + wordmark_svg(wx, 0, word_color)
    return (x0, y0, vw, vh), body


STACK_MARK_H = 64.0
STACK_GAP = 13.0


def stacked(mode="carved", rune_color=None, word_color=C["ink"], tones=CARVED, pad=4.0, bg=None):
    cx = (WM_X0 + WM_X1) / 2
    r = rune_at(STACK_MARK_H, cx=cx, top=0)
    wy = r.bbox[3] + STACK_GAP - WM_Y0
    x0, y0 = WM_X0 - pad, -pad
    vw, vh = WM_W + 2 * pad, wy + WM_Y1 + pad - y0
    # overhang by one unit so a rounded viewport never leaves a transparent edge row
    back = f'<rect x="{fmt(x0 - 1)}" y="{fmt(y0 - 1)}" width="{fmt(vw + 2)}" height="{fmt(vh + 2)}" fill="{bg}"/>' if bg else ""
    return (x0, y0, vw, vh), back + rune_svg(r, mode, rune_color, tones) + wordmark_svg(0, wy, word_color)


def square_mark(mode="carved", color=None, tones=CARVED, size=48.0, height=38.0, bg=None, rx=0.0):
    r = rune_at(height, cx=size / 2, top=(size - height) / 2)
    back = f'<rect width="{fmt(size)}" height="{fmt(size)}" rx="{fmt(rx)}" fill="{bg}"/>' if bg else ""
    return (0, 0, size, size), back + rune_svg(r, mode, color, tones)


def app_icon(full_bleed=False):
    """512 grid. Ochre tile, the rune carved in light tones."""
    vb, body = square_mark("carved", tones=CARVED_LIGHT, size=512, height=318, bg=C["ochre"], rx=0 if full_bleed else 114)
    return vb, body


def favicon():
    """32 grid, flat: facets vanish at 16px, the silhouette holds."""
    return square_mark("flat", C["paper"], size=32, height=24, bg=C["ochre"], rx=7)


# ------------------------------------------------------------- explorations

def exploration_monogram():
    g = monogram_b(40, 6.2, 0, 0)
    x0, y0, x1, y1 = g.bounds
    cx = 24 - (x0 + x1) / 2 + 1.2
    body = f'<path transform="translate({fmt(cx)} 4)" d="{shape_path(g)}" fill="{C["ochre"]}"/>'
    return (0, 0, 48, 48), body


def _bezier(p0, p1, p2, p3, n=40):
    out = []
    for i in range(n + 1):
        t = i / n
        a = (1 - t) ** 3
        b = 3 * (1 - t) ** 2 * t
        c = 3 * (1 - t) * t ** 2
        d = t ** 3
        out.append((a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]))
    return out


def exploration_runestone():
    """A raised stone with the rune cut through and a carved band inside the
    edge, the way Viking-age runestones frame their text."""
    pts = [(9.5, 45)] + _bezier((8.6, 30), (7.6, 16), (13, 4.6), (25, 3.4)) + \
        _bezier((25, 3.4), (35.5, 2.6), (40.6, 13), (39.6, 27))[1:] + [(38.6, 45)]
    stone = Polygon(pts)
    band = stone.buffer(-2.4, join_style="round").difference(stone.buffer(-3.6, join_style="round"))
    band = band.intersection(box(0, 0, 48, 41.2))
    r = rune_at(25, cx=24.4, top=12.5)
    body = (f'<path d="{shape_path(stone)}" fill="{C["ochre"]}"/>'
            f'<path d="{shape_path(band)}" fill="{C["paper"]}" opacity="0.9"/>'
            f'<path d="{r.silhouette_path()}" fill="{C["paper"]}" fill-rule="evenodd"/>')
    return (0, 0, 48, 48), body


def exploration_seal():
    """A registry seal: a ring of 60 ticks, every fifth long, around the rune."""
    cx = cy = 24
    ring = Point(cx, cy).buffer(22.5, quad_segs=64).difference(Point(cx, cy).buffer(21, quad_segs=64))
    ticks = []
    for i in range(60):
        a = math.radians(i * 6)
        inner = 16.6 if i % 5 == 0 else 17.8
        ticks.append(LineString([(cx + inner * math.cos(a), cy + inner * math.sin(a)),
                                 (cx + 19.6 * math.cos(a), cy + 19.6 * math.sin(a))]).buffer(0.42 if i % 5 == 0 else 0.3, cap_style="flat"))
    marks = unary_union([ring] + ticks)
    r = rune_at(21, cx=24.6, top=13.5)
    body = f'<path d="{shape_path(marks)}" fill="{C["ochre"]}"/>' + rune_svg(r, "flat", C["ochre"])
    return (0, 0, 48, 48), body


# ------------------------------------------------------------- misuse

def misuse():
    """Each 'do' and 'don't' is drawn from the real lockup with one change."""
    (x0, y0, vw, vh), _ = horizontal()
    pad = 14
    vb = (x0 - pad, y0 - pad, vw + 2 * pad, vh + 2 * pad)
    r = rune_at(MARK_H, x0=0, top=WM_MID - MARK_H / 2)
    wx = r.bbox[2] + GAP - WM_X0
    bg = lambda c: f'<rect x="{fmt(vb[0])}" y="{fmt(vb[1])}" width="{fmt(vb[2])}" height="{fmt(vb[3])}" fill="{c}"/>'
    cx, cy = (r.bbox[0] + r.bbox[2]) / 2, (r.bbox[1] + r.bbox[3]) / 2
    out = {}
    out["do-paper"] = bg(C["paper"]) + rune_svg(r) + wordmark_svg(wx)
    out["do-reversed"] = bg(C["ochre"]) + rune_svg(r, "carved", tones=CARVED_LIGHT) + wordmark_svg(wx, 0, C["paper"])
    out["do-ink"] = bg(C["ochre_tint"]) + rune_svg(r, "flat", C["ink"]) + wordmark_svg(wx, 0, C["ink"])
    out["do-card"] = bg(C["card"]) + rune_svg(r, "flat", C["ochre"]) + wordmark_svg(wx)

    out["dont-recolor"] = bg(C["paper"]) + rune_svg(r, "flat", C["open"]) + wordmark_svg(wx)
    out["dont-outline"] = bg(C["paper"]) + (f'<path d="{r.silhouette_path()}" fill="none" stroke="{C["ochre"]}" '
                                            f'stroke-width="1.4" stroke-linejoin="miter"/>') + wordmark_svg(wx)
    glow = (f'<defs><filter id="g" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="3.2"/></filter></defs>'
            f'<path d="{r.silhouette_path()}" fill="#ff8a3d" filter="url(#g)"/>')
    out["dont-glow"] = bg(C["paper"]) + glow + rune_svg(r) + wordmark_svg(wx)
    # squashed to 70% height, kept centered in the frame
    sy = 0.7
    mid_y = vb[1] + vb[3] / 2
    out["dont-stretch"] = bg(C["paper"]) + f'<g transform="translate(0 {fmt(mid_y * (1 - sy))}) scale(1 {sy})">' + \
        rune_svg(r) + wordmark_svg(wx) + "</g>"
    out["dont-rotate"] = bg(C["paper"]) + f'<g transform="rotate(-18 {fmt(cx)} {fmt(cy)})">' + rune_svg(r) + "</g>" + wordmark_svg(wx)
    out["dont-retype"] = bg(C["paper"]) + rune_svg(r) + (
        f'<text x="{fmt(wx)}" y="0" font-family="Georgia, \'Times New Roman\', serif" font-style="italic" '
        f'font-size="34" fill="{C["ink"]}">BrandRune</text>')
    out["dont-contrast"] = bg(C["stone"]) + rune_svg(r) + wordmark_svg(wx, 0, C["ochre"])
    swapped_r = rune_at(MARK_H, x0=WM_W + GAP, top=WM_MID - MARK_H / 2)
    out["dont-rearrange"] = bg(C["paper"]) + wordmark_svg(-WM_X0) + rune_svg(swapped_r)
    return vb, out


def clearspace():
    """The horizontal lockup inside its clear space. x is a quarter of the
    mark's height, which is the depth of one branch."""
    X = MARK_H / 4
    r = rune_at(MARK_H, x0=0, top=WM_MID - MARK_H / 2)
    wx = r.bbox[2] + GAP - WM_X0
    bx0, by0, bx1, by1 = r.bbox[0], r.bbox[1], wx + WM_X1, r.bbox[3]
    m = X + 8
    vb = (bx0 - m, by0 - m, (bx1 - bx0) + 2 * m, (by1 - by0) + 2 * m)
    font = 'font-family="-apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, Helvetica, Arial, sans-serif" font-size="5.2" font-weight="600"'

    def xsq(x, y):
        return (f'<rect x="{fmt(x)}" y="{fmt(y)}" width="{fmt(X)}" height="{fmt(X)}" fill="{C["ochre_tint"]}" '
                f'stroke="{C["ochre"]}" stroke-width="0.35"/>'
                f'<text x="{fmt(x + X / 2)}" y="{fmt(y + X / 2 + 1.8)}" text-anchor="middle" {font} fill="{C["ochre"]}">x</text>')
    outer = (f'<rect x="{fmt(bx0 - X)}" y="{fmt(by0 - X)}" width="{fmt(bx1 - bx0 + 2 * X)}" height="{fmt(by1 - by0 + 2 * X)}" '
             f'fill="none" stroke="{C["stone"]}" stroke-width="0.4" stroke-dasharray="1.6 1.2"/>')
    inner = (f'<rect x="{fmt(bx0)}" y="{fmt(by0)}" width="{fmt(bx1 - bx0)}" height="{fmt(by1 - by0)}" '
             f'fill="none" stroke="{C["rule"]}" stroke-width="0.4"/>')
    squares = xsq(bx0 - X, by0 - X) + xsq(bx1, by1) + xsq(bx0 + (bx1 - bx0) / 2 - X / 2, by0 - X) + xsq(bx1, by0 + (by1 - by0) / 2 - X / 2)
    # x measured on the mark: one branch is a quarter of its height
    tick = (f'<rect x="{fmt(r.bbox[2] + 1.2)}" y="{fmt(by0)}" width="0.5" height="{fmt(X)}" fill="{C["ochre"]}"/>')
    body = (f'<rect x="{fmt(vb[0])}" y="{fmt(vb[1])}" width="{fmt(vb[2])}" height="{fmt(vb[3])}" fill="{C["card"]}"/>'
            + outer + inner + squares + rune_svg(r) + wordmark_svg(wx) + tick)
    return vb, body


# ------------------------------------------------------------- construction

def construction():
    """The mark at size with its centerline, the two equilateral triangles
    and the 30 degree angle drawn over it. Annotation text is live text on
    purpose: it is a diagram, not the logo."""
    size = 240
    r = Rune(h=136, t=24, x=0, y=0)
    dx = size / 2 - (r.bbox[0] + r.bbox[2]) / 2
    dy = size / 2 - (r.bbox[1] + r.bbox[3]) / 2
    r = Rune(h=136, t=24, x=dx, y=dy)
    q = 34
    w = q * math.sqrt(3)
    T, P1, M, P2, B = (dx, dy), (dx + w, dy + q), (dx, dy + 2 * q), (dx + w, dy + 3 * q), (dx, dy + 4 * q)
    # presentation attributes, not a <style> block: the site CSP has no
    # 'unsafe-inline' for styles and it is sent with the SVG files too.
    ATTR = {
        "c": 'stroke="#1d1d1b" stroke-width="1.2" stroke-dasharray="4 3" fill="none"',
        "g": 'stroke="#5f5f5a" stroke-width="0.8" stroke-dasharray="2 4" opacity="0.7"',
    }
    line = lambda a, b, cls: f'<line x1="{fmt(a[0])}" y1="{fmt(a[1])}" x2="{fmt(b[0])}" y2="{fmt(b[1])}" {ATTR[cls]}/>'
    guides = "".join([
        line(T, B, "c"), line(T, P1, "c"), line(P1, M, "c"), line(M, P2, "c"), line(P2, B, "c"),
        line((T[0] - 40, T[1]), (P1[0] + 60, T[1]), "g"),
        line((M[0] - 40, M[1]), (P1[0] + 60, M[1]), "g"),
        line((B[0] - 40, B[1]), (P1[0] + 60, B[1]), "g"),
    ])
    # the 30 degree angle at T, between the horizontal and the first branch
    ar = 26
    arc = (f'<path stroke="#1d1d1b" stroke-width="1.2" fill="none" d="M{fmt(T[0] + ar)} {fmt(T[1])}A{ar} {ar} 0 0 1 '
           f'{fmt(T[0] + ar * COS)} {fmt(T[1] + ar * SIN)}"/>')
    nodes = "".join(f'<circle cx="{fmt(p[0])}" cy="{fmt(p[1])}" r="3" fill="#fafaf8" stroke="#1d1d1b" stroke-width="1.2"/>'
                    for p in (T, P1, M, P2, B))
    font = 'font-family="-apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, Helvetica, Arial, sans-serif" font-size="12" font-weight="600"'
    labels = f'<text x="{fmt(T[0] + ar + 6)}" y="{fmt(T[1] - 6)}" {font} fill="#1d1d1b">30°</text>'
    body = rune_svg(r) + guides + arc + nodes + labels
    return (0, 0, size, size), body


# ------------------------------------------------------------- OG template

def og_template(headline=("Names you can read.", "Domains that are really open."), foot="A free Claude Code skill. Registry-checked."):
    """1200x630. The lockup and the big rune are paths; the headline and
    the foot line are live text so the template can be edited."""
    W, H = 1200, 630
    (lx, ly, lw, lh), lbody = horizontal(pad=0)
    k = 64 / lh
    lock = f'<g transform="translate(80 72) scale({fmt(k)}) translate({fmt(-lx)} {fmt(-ly)})">{lbody}</g>'
    big = rune_at(600, cx=1085, top=15)
    ghost = f'<path d="{big.silhouette_path()}" fill="{C["ochre_tint"]}" fill-rule="evenodd"/>'
    sans = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    h1 = "".join(f'<text x="80" y="{300 + i * 84}" font-family="{sans}" font-size="72" font-weight="700" '
                 f'letter-spacing="-1.4" fill="{C["ink"]}">{line}</text>' for i, line in enumerate(headline))
    footer = (f'<text x="80" y="540" font-family="{sans}" font-size="28" fill="{C["stone"]}">{foot}</text>'
              f'<rect x="0" y="{H - 14}" width="{W}" height="14" fill="{C["ochre"]}"/>')
    body = f'<rect width="{W}" height="{H}" fill="{C["paper"]}"/>' + ghost + lock + h1 + footer
    return (0, 0, W, H), body


# ------------------------------------------------------------- main

def main():
    OUT.mkdir(parents=True, exist_ok=True)
    manifest = []

    def emit(name, vb_body, w=None, h=None, png=None, label=ARIA, transparent=True):
        vb, body = vb_body
        write(name + ".svg", doc(vb, body, w, h, label))
        manifest.append({"name": name, "vb": vb, "png": png, "transparent": transparent})

    emit("brandrune-lockup", horizontal(), png=[1200])
    emit("brandrune-lockup-flat", horizontal("flat", C["ochre"]), png=[1200])
    emit("brandrune-lockup-ink", horizontal("flat", C["ink"]), png=[1200])
    emit("brandrune-lockup-reversed", horizontal("carved", word_color=C["paper"], tones=CARVED_LIGHT, pad=22, bg=C["ochre"]), png=[1200], transparent=False)
    emit("brandrune-stacked", stacked(), png=[800])
    emit("brandrune-stacked-ink", stacked("flat", C["ink"]), png=[800])
    emit("brandrune-stacked-reversed", stacked("carved", word_color=C["paper"], tones=CARVED_LIGHT, pad=26, bg=C["ochre"]), png=[800], transparent=False)
    emit("brandrune-wordmark", ((WM_X0 - 2, WM_Y0 - 2, WM_W + 4, WM_H + 4), wordmark_svg(0)), png=[1200])
    emit("brandrune-mark", square_mark(), png=[512, 1024])
    emit("brandrune-mark-flat", square_mark("flat", C["ochre"]), png=[512])
    emit("brandrune-mark-ink", square_mark("flat", C["ink"]), png=[512])
    emit("brandrune-mark-reversed", square_mark("flat", C["paper"], bg=C["ochre"]), png=[512], transparent=False)
    emit("brandrune-app-icon", app_icon(), png=[16, 32, 64, 180, 192, 512, 1024])
    emit("brandrune-github-avatar", app_icon(full_bleed=True), png=[512], transparent=False)
    emit("favicon", favicon(), png=[16, 32, 48])
    emit("brandrune-og-template", og_template(), png=[1200], transparent=False, label="Brandrune: names you can read, domains that are really open")

    emit("explore-carved", square_mark(), png=[512])
    emit("explore-monogram-b", exploration_monogram(), png=[512])
    emit("explore-runestone", exploration_runestone(), png=[512])
    emit("explore-seal", exploration_seal(), png=[512])
    emit("construction", construction(), label="Construction of the Brandrune mark")
    emit("clearspace", clearspace(), label="Clear space around the Brandrune lockup")

    vb, items = misuse()
    for name, body in items.items():
        write(f"usage-{name}.svg", doc(vb, body, label=name.replace("-", " ")))

    # the site's favicon is the same file
    (ROOT / "public" / "favicon.svg").write_text((OUT / "favicon.svg").read_text())
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=1))
    print(f"wrote {len(manifest)} assets and {len(items)} usage drawings to {OUT.relative_to(ROOT)}")


def package():
    """brandrune-brand-assets.zip: every SVG and PNG in assets/, run after render.mjs."""
    import zipfile
    target = OUT / "brandrune-brand-assets.zip"
    files = sorted(p for p in OUT.iterdir() if p.suffix in (".svg", ".png") and not p.name.startswith("usage-"))
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as z:
        for p in files:
            # fixed timestamp so a rebuild gives the same zip bytes
            info = zipfile.ZipInfo(f"brandrune-brand/{p.name}", date_time=(2026, 10, 10, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, p.read_bytes())
    print(f"packed {len(files)} files into {target.relative_to(ROOT)}")


if __name__ == "__main__":
    import sys
    package() if sys.argv[1:] == ["zip"] else main()
