"""Geometry for the Brandrune mark and wordmark.

Everything is built from one angle: 30 degrees, the slope of the berkanan
rune's branches. With 30 degree branches each half of the rune is an
equilateral triangle, so the mark, its facets and the wordmark's cuts all
come out of the same construction.

Coordinates are SVG coordinates (y grows downward). Needs shapely for the
wordmark outlines; the mark itself is plain line intersections.
"""
from __future__ import annotations

import math

from shapely import affinity
from shapely.geometry import LineString, MultiPolygon, Point, Polygon, box
from shapely.ops import unary_union

ANGLE = math.radians(30)
COS, SIN, TAN = math.cos(ANGLE), math.sin(ANGLE), math.tan(ANGLE)


# ---------------------------------------------------------------- helpers

def intersect(p, d, q, e):
    """Intersection of line p + t*d with line q + u*e."""
    den = d[0] * e[1] - d[1] * e[0]
    t = ((q[0] - p[0]) * e[1] - (q[1] - p[1]) * e[0]) / den
    return (p[0] + t * d[0], p[1] + t * d[1])


def offset(p, n, k):
    return (p[0] + n[0] * k, p[1] + n[1] * k)


def fmt(v):
    s = f"{v:.2f}".rstrip("0").rstrip(".")
    return "0" if s in ("-0", "") else s


def poly_path(points):
    pts = list(points)
    head = f"M{fmt(pts[0][0])} {fmt(pts[0][1])}"
    rest = "".join(f"L{fmt(x)} {fmt(y)}" for x, y in pts[1:])
    return head + rest + "Z"


def shape_path(geom):
    """SVG path data for a shapely Polygon or MultiPolygon, holes included."""
    polys = geom.geoms if isinstance(geom, MultiPolygon) else [geom]
    out = []
    for p in polys:
        out.append(poly_path(list(p.exterior.coords)[:-1]))
        for ring in p.interiors:
            out.append(poly_path(list(ring.coords)[:-1]))
    return "".join(out)


# ---------------------------------------------------------------- the mark

class Rune:
    """Berkanan, carved.

    Centerline: a stave from T to B, and a zigzag T, P1, M, P2, B whose
    segments run at 30 degrees, so T-P1-M and M-P2-B are equilateral.
    The stroke has width `t`. The top and bottom are cut along the outer
    edge of the first and last branch, so the whole top of the rune is one
    30 degree chisel line, and the same at the bottom.

    The facets are the straight skeleton of that outline: each edge of the
    shape slopes down to the centerline, the way a V-cut groove does. Every
    skeleton node is a centerline vertex, which keeps the facet set at 11
    flat polygons.
    """

    def __init__(self, h=34.0, t=6.0, x=0.0, y=0.0):
        self.h, self.t = h, t
        q = h / 4
        w = q * math.sqrt(3)
        hw = t / 2
        T, P1, M, P2, B = (x, y), (x + w, y + q), (x, y + 2 * q), (x + w, y + 3 * q), (x, y + 4 * q)
        down = (COS, SIN)        # direction of T->P1 and M->P2
        back = (-COS, SIN)       # direction of P1->M and P2->B
        n_up = (SIN, -COS)       # normal of `down` segments, pointing up-right
        n_out = (SIN, COS)       # normal of `back` segments, pointing down-right
        vert = (0.0, 1.0)

        left = ((x - hw, 0.0), vert)
        stave_r = ((x + hw, 0.0), vert)
        a_up, a_lo = (offset(T, n_up, hw), down), (offset(T, n_up, -hw), down)
        b_out, b_in = (offset(P1, n_out, hw), back), (offset(P1, n_out, -hw), back)
        c_out, c_in = (offset(M, n_up, hw), down), (offset(M, n_up, -hw), down)
        d_out, d_in = (offset(P2, n_out, hw), back), (offset(P2, n_out, -hw), back)

        X = lambda l1, l2: intersect(l1[0], l1[1], l2[0], l2[1])
        TL, O1, J, O2, BL = X(left, a_up), X(a_up, b_out), X(b_out, c_out), X(c_out, d_out), X(d_out, left)
        H1a, H1b, H1c = X(stave_r, a_lo), X(a_lo, b_in), X(b_in, stave_r)
        H2a, H2b, H2c = X(stave_r, c_in), X(c_in, d_in), X(d_in, stave_r)

        self.outline = [TL, O1, J, O2, BL]
        self.holes = [[H1a, H1b, H1c], [H2a, H2b, H2c]]
        # (polygon, inward normal of its edge). Incised: each wall faces
        # its edge's inward normal, so that is what the light reads.
        self.facets = [
            ([TL, O1, P1, T], (-SIN, COS)),      # top chisel line
            ([O1, J, M, P1], (-SIN, -COS)),      # upper point, lower face
            ([J, O2, P2, M], (-SIN, COS)),       # lower point, upper face
            ([O2, BL, B, P2], (-SIN, -COS)),     # bottom chisel line
            ([BL, TL, T, B], (1.0, 0.0)),        # left of the stave
            ([H1a, H1b, P1, T], (SIN, -COS)),    # counter 1
            ([H1b, H1c, M, P1], (SIN, COS)),
            ([H1c, H1a, T, M], (-1.0, 0.0)),
            ([H2a, H2b, P2, M], (SIN, -COS)),    # counter 2
            ([H2b, H2c, B, P2], (SIN, COS)),
            ([H2c, H2a, M, B], (-1.0, 0.0)),
        ]
        xs = [p[0] for p in self.outline]
        ys = [p[1] for p in self.outline]
        self.bbox = (min(xs), min(ys), max(xs), max(ys))

    def silhouette_path(self):
        return poly_path(self.outline) + "".join(poly_path(h) for h in self.holes)

    def facet_paths(self, light=(-0.55, -0.83)):
        """Yield (path, brightness in -1..1) per facet."""
        ln = math.hypot(*light)
        L = (light[0] / ln, light[1] / ln)
        for pts, n in self.facets:
            yield poly_path(pts), n[0] * L[0] + n[1] * L[1]

    @property
    def width(self):
        return self.bbox[2] - self.bbox[0]

    @property
    def height(self):
        return self.bbox[3] - self.bbox[1]


def rune_at(height, cx=None, x0=None, top=0.0, t_ratio=6 / 34):
    """A Rune scaled so its silhouette is `height` tall, placed by its
    silhouette's top edge, and either left edge x0 or optical center cx."""
    probe = Rune(h=34, t=34 * t_ratio)
    k = height / probe.height
    r = Rune(h=34 * k, t=34 * k * t_ratio)
    dx = (x0 - r.bbox[0]) if x0 is not None else (cx - (r.bbox[0] + r.bbox[2]) / 2)
    dy = top - r.bbox[1]
    return Rune(h=34 * k, t=34 * k * t_ratio, x=dx, y=dy)


# ---------------------------------------------------------------- monogram b

def monogram_b(height=44.0, t=6.0, x=0.0, y=0.0):
    """Exploration B: the rune's lower triangle on a full stave, which reads
    as a lowercase b. Top of the stave cut at 30 degrees."""
    q = height / 4
    stave = box(x - t / 2, y - 10, x + t / 2, y + height + 10)
    M, P2, Bt = (x, y + 2 * q), (x + q * math.sqrt(3), y + 3 * q), (x, y + 4 * q)
    bowl = LineString([(x - 1, M[1] - 1 / math.sqrt(3)), M, P2, Bt, (x - 1, Bt[1] + 1 / math.sqrt(3))]).buffer(
        t / 2, cap_style="flat", join_style="mitre", mitre_limit=10)
    g = unary_union([stave, bowl])
    # top: 30 degree cut descending to the right; bottom: the bowl's own edge
    top_cut = Polygon([(x - 50, y - 50 * TAN + 0), (x + 50, y + 50 * TAN), (x + 50, y + 200), (x - 50, y + 200)])
    bot_line_y_at = lambda px: Bt[1] + t / 2 / COS - (px - x) * TAN
    bot_cut = Polygon([(x - 50, bot_line_y_at(x - 50)), (x + 50, bot_line_y_at(x + 50)), (x + 50, y - 200), (x - 50, y - 200)])
    return g.intersection(top_cut).intersection(bot_cut)


# ---------------------------------------------------------------- wordmark

def _stroke(coords, s, cap="flat"):
    return LineString(coords).buffer(s / 2, cap_style=cap, join_style="mitre", mitre_limit=4, quad_segs=48)


def _ring(cx, cy, r, s):
    return Point(cx, cy).buffer(r + s / 2, quad_segs=64).difference(Point(cx, cy).buffer(r - s / 2, quad_segs=64))


def _arc(cx, cy, r, a0, a1, s, n=96):
    """Arc of the centerline circle from angle a0 to a1 (degrees, math
    orientation, y up), stroked. Returned in y-up space."""
    pts = [(cx + r * math.cos(math.radians(a0 + (a1 - a0) * i / n)),
            cy + r * math.sin(math.radians(a0 + (a1 - a0) * i / n))) for i in range(n + 1)]
    return _stroke(pts, s)


def _stem_into_round(x0, x1, y_from, y_to, cx, cy, r_outer, up=True):
    """A stem that runs into an arch (up=True) or bowl (up=False) and is
    clipped to that round's outer circle, so the join has no step."""
    if up:
        stem = box(x0, y_from, x1, cy + 3)
        keep = unary_union([box(x0 - 1, y_from - 1, x1 + 1, cy), Point(cx, cy).buffer(r_outer, quad_segs=96)])
    else:
        stem = box(x0, cy - 3, x1, y_to)
        keep = unary_union([box(x0 - 1, cy, x1 + 1, y_to + 1), Point(cx, cy).buffer(r_outer, quad_segs=96)])
    return stem.intersection(keep)


def _chisel_top(g, x_left, top, s, extra=0.0):
    """Cut a stem top along the brand's 30 degree line, descending to the
    right: the left corner stays at `top`."""
    cut = Polygon([(x_left - 40, top + 40 * TAN), (x_left + 40, top - 40 * TAN),
                   (x_left + 40, top - 200), (x_left - 40, top - 200)])
    return g.intersection(cut)


class Wordmark:
    """`brandrune`, lowercase, monoline, round bowls kept round so the name
    reads at a glance. The rune shows up in the cuts: every stem top and the
    free terminals of r and e are cut along the same 30 degree line as the
    mark's chisel top. Built in y-up space, flipped on output."""

    XH = 20.0     # x-height
    ASC = 28.6    # ascender
    S = 4.3       # stroke
    OV = 0.45     # overshoot for round shapes

    def __init__(self, tracking=1.6):
        self.tracking = tracking
        S, XH = self.S, self.XH
        self.rb = (XH + 2 * self.OV - S) / 2      # bowl centerline radius
        self.cy = XH / 2

    # each glyph returns (geometry, advance). Origin at the glyph's left edge.
    def g_b(self):
        S, rb, cy = self.S, self.rb, self.cy
        stem = _chisel_top(box(0, 0, S, self.ASC), 0, self.ASC, S)
        bowl = _ring(S / 2 + rb, cy, rb, S)
        return unary_union([stem, bowl]), S / 2 + 2 * rb + S / 2

    def g_d(self):
        S, rb, cy = self.S, self.rb, self.cy
        w = S / 2 + 2 * rb + S / 2
        stem = _chisel_top(box(w - S, 0, w, self.ASC), w - S, self.ASC, S)
        bowl = _ring(S / 2 + rb, cy, rb, S)
        return unary_union([stem, bowl]), w

    def g_a(self):
        S, rb, cy, XH = self.S, self.rb, self.cy, self.XH
        w = S / 2 + 2 * rb + S / 2
        stem = _chisel_top(box(w - S, 0, w, XH), w - S, XH, S)
        bowl = _ring(S / 2 + rb, cy, rb, S)
        return unary_union([stem, bowl]), w

    def _arch(self, w):
        """n-arch of total width w in y-up space: two stems and a half ring."""
        S, XH = self.S, self.XH
        r = (w - S) / 2
        acy = XH + self.OV - S / 2 - r
        arch = _arc(S / 2 + r, acy, r, -2, 182, S)
        left = _stem_into_round(0, S, 0, None, S / 2 + r, acy, r + S / 2)
        right = _stem_into_round(w - S, w, 0, None, S / 2 + r, acy, r + S / 2)
        return arch, left, right, acy

    def g_n(self):
        S, XH = self.S, self.XH
        w = 2 * self.rb + S - 0.6
        arch, left, right, _ = self._arch(w)
        lstem = _chisel_top(box(0, 0, S, XH), 0, XH, S)
        return unary_union([arch, left, lstem, right]), w

    def g_u(self):
        g, w = self.g_n()
        # u is n turned around, but its stem tops get the same cut as every
        # other stem, so rebuild the tops instead of rotating the cut.
        S, XH = self.S, self.XH
        r = (w - S) / 2
        acy = -self.OV + S / 2 + r
        bowl = _arc(S / 2 + r, acy, r, 178, 362, S)
        lstem = _chisel_top(unary_union([box(0, acy, S, XH), _stem_into_round(0, S, None, acy, S / 2 + r, acy, r + S / 2, up=False)]), 0, XH, S)
        rstem = _chisel_top(box(w - S, 0, w, XH), w - S, XH, S)
        return unary_union([bowl, lstem, rstem]), w

    def g_r(self, end=58.0):
        """Stem plus an arm that ends where its radial cut lies on a steep
        line; `end` is the arm's last angle in degrees."""
        S, XH = self.S, self.XH
        r = self.rb * 0.95
        acy = XH + self.OV - S / 2 - r
        cx = S / 2 + r
        arm = _arc(cx, acy, r, end, 182, S)
        lstem = _chisel_top(box(0, 0, S, XH), 0, XH, S)
        g = unary_union([arm, _stem_into_round(0, S, 0, None, cx, acy, r + S / 2), lstem])
        right = g.bounds[2]
        return g, right

    def g_e(self, end=-30.0):
        """Round e. The open terminal ends at -30 degrees, so its cut lies
        on the brand's 30 degree line, descending to the right."""
        S, rb, cy = self.S, self.rb, self.cy
        cx = S / 2 + rb
        ring = unary_union([_arc(cx, cy, rb, 0, 181, S), _arc(cx, cy, rb, 179, 360 + end, S, n=120)])
        bar = box(S / 2, cy - S / 2 + 0.35, cx + rb + S / 2 - 0.01, cy + S / 2 + 0.35)
        bar = bar.intersection(Point(cx, cy).buffer(rb + S / 2 - 0.02, quad_segs=64))
        return unary_union([ring, bar]), S / 2 + 2 * rb + S / 2

    def glyphs(self):
        return {"b": self.g_b, "r": self.g_r, "a": self.g_a, "n": self.g_n,
                "d": self.g_d, "u": self.g_u, "e": self.g_e}

    def build(self, text="brandrune", kern=None):
        kern = kern or {}
        x = 0.0
        parts = []
        table = self.glyphs()
        prev = None
        for ch in text:
            g, adv = table[ch]()
            x += kern.get((prev, ch), 0.0)
            parts.append(affinity.translate(g, x, 0))
            x += adv + self.tracking
            prev = ch
        geom = unary_union(parts)
        geom = affinity.scale(geom, 1, -1, origin=(0, 0))   # to y-down
        geom = geom.simplify(0.015, preserve_topology=True)
        return geom
