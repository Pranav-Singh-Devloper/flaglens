"""Concept animations for the FlagLens video, rendered with Manim Community at 1920x1080, 60 fps.

    sh scripts/manim.sh      (renders every scene into public/manim/)
"""
from manim import *

BG = "#0B1020"
PANEL = "#141A2E"
TEXT = "#E6E8F0"
MUTED = "#8A90A6"
ACCENT = "#7C6CFF"
ON = "#2ECC71"
OFF = "#5B6278"
WARN = "#F5A524"
BAD = "#FF5D5D"
SANS = "Inter"
MONO = "Menlo"

config.background_color = BG

FLAGS = ["new_checkout", "banner_text", "rate_limit", "button_color", "dark_mode", "maintenance", "legacy_search"]
ENVS = ["Development", "Staging", "Production"]
STATES = [
    [1, 1, 0],
    [1, 1, 1],
    [1, 1, 1],
    [1, 1, 1],
    [1, 1, 1],
    [0, 0, 0],
    [0, 0, 0],
]


def label(text, size=28, color=TEXT, weight=NORMAL, font=SANS):
    return Text(text, font=font, font_size=size, color=color, weight=weight)


class StatesScene(Scene):
    """7 flags x 3 environments = 21 states to check by hand ... collapsing into one CodeLens line."""

    def construct(self):
        cell_w, cell_h = 1.55, 0.62
        x0 = -0.2
        y0 = 2.35
        headers = VGroup(*[label(e, 24, MUTED).move_to([x0 + i * (cell_w + 0.35) + 1.6, y0 + 0.75, 0]) for i, e in enumerate(ENVS)])
        names = VGroup(*[label(f, 24, TEXT, font=MONO).move_to([-4.6, y0 - r * (cell_h + 0.14), 0], aligned_edge=LEFT) for r, f in enumerate(FLAGS)])
        for n in names:
            n.align_to([-5.0, 0, 0], LEFT)
        cells = VGroup()
        for r, row in enumerate(STATES):
            for c, on in enumerate(row):
                box = RoundedRectangle(corner_radius=0.14, width=cell_w, height=cell_h, stroke_width=0, fill_color=PANEL, fill_opacity=1)
                dot = Dot(radius=0.11, color=ON if on else OFF)
                if not on:
                    dot = Circle(radius=0.1, color=OFF, stroke_width=4)
                txt = label("on" if on else "off", 22, ON if on else MUTED)
                content = VGroup(dot, txt).arrange(RIGHT, buff=0.16)
                g = VGroup(box, content)
                content.move_to(box)
                g.move_to([x0 + c * (cell_w + 0.35) + 1.6, y0 - r * (cell_h + 0.14), 0])
                cells.add(g)

        self.play(LaggedStart(*[FadeIn(h, shift=DOWN * 0.15) for h in headers], lag_ratio=0.15), run_time=0.6)
        self.play(LaggedStart(*[FadeIn(n, shift=RIGHT * 0.2) for n in names], lag_ratio=0.08), run_time=0.8)
        self.play(LaggedStart(*[GrowFromCenter(c) for c in cells], lag_ratio=0.035), run_time=1.6)

        count = VGroup(
            label("7 flags", 40, TEXT, BOLD),
            label("×", 40, MUTED),
            label("3 environments", 40, TEXT, BOLD),
            label("=", 40, MUTED),
            label("21 states", 40, WARN, BOLD),
        ).arrange(RIGHT, buff=0.3).to_edge(DOWN, buff=0.55)
        self.play(FadeIn(count, shift=UP * 0.2), run_time=0.6)
        sub = label("to check by hand, in the dashboard, one environment at a time", 26, MUTED).next_to(count, DOWN, buff=0.2)
        self.play(FadeIn(sub), run_time=0.4)
        self.wait(1.4)

        # Collapse: the whole grid becomes the single line FlagLens shows above the code.
        lens = VGroup(
            label("⚑ new_checkout", 30, ACCENT, font=MONO),
            label("Development", 28, MUTED), Dot(radius=0.09, color=ON), label("on", 28, ON),
            label("·", 28, MUTED),
            label("Staging", 28, MUTED), Dot(radius=0.09, color=ON), label("on", 28, ON),
            label("·", 28, MUTED),
            label("Production", 28, MUTED), Circle(radius=0.085, color=OFF, stroke_width=4), label("off", 28, MUTED),
        ).arrange(RIGHT, buff=0.18)
        code = label("if (flags.isFeatureEnabled('new_checkout')) {", 32, TEXT, font=MONO)
        block = VGroup(lens, code).arrange(DOWN, aligned_edge=LEFT, buff=0.22).move_to(ORIGIN)
        self.play(
            FadeOut(sub),
            FadeOut(count),
            FadeOut(headers),
            FadeOut(names),
            *[c.animate.scale(0.15).move_to(lens.get_center()).set_opacity(0) for c in cells],
            run_time=0.9,
        )
        self.play(FadeIn(code, shift=UP * 0.1), run_time=0.4)
        self.play(LaggedStart(*[FadeIn(m, shift=DOWN * 0.1) for m in lens], lag_ratio=0.05), run_time=0.9)
        tag = label("one glance, every environment, right where the code is", 28, MUTED).next_to(block, DOWN, buff=0.7)
        self.play(FadeIn(tag), run_time=0.5)
        self.wait(1.6)


class DriftScene(Scene):
    """Staging 100 vs Production 50: the 2 A.M. bug."""

    def construct(self):
        title = label("rate_limit_per_minute", 34, TEXT, font=MONO).to_edge(UP, buff=0.6)
        self.play(FadeIn(title, shift=DOWN * 0.15), run_time=0.5)
        scale = 0.03
        base = -2.7
        bars = VGroup()
        specs = [("Staging", 100, ON), ("Production", 50, BAD)]
        for i, (name, v, col) in enumerate(specs):
            x = -2.4 + i * 4.8
            bar = RoundedRectangle(corner_radius=0.16, width=2.2, height=0.01, stroke_width=0, fill_color=col, fill_opacity=0.9).move_to([x, base, 0], aligned_edge=DOWN)
            target = RoundedRectangle(corner_radius=0.16, width=2.2, height=v * scale, stroke_width=0, fill_color=col, fill_opacity=0.9).move_to([x, base, 0], aligned_edge=DOWN)
            n = label(name, 30, MUTED).move_to([x, base - 0.45, 0])
            tr = ValueTracker(0)
            # Text-based counter (Manim's Integer needs LaTeX). It rides on top of the growing bar.
            val = always_redraw(lambda t=tr, x=x, v=v: label(str(int(round(t.get_value()))), 64, TEXT, BOLD).move_to([x, base + t.get_value() * scale + 0.5, 0]))
            bars.add(VGroup(bar, target, n, val))
            bars[-1].tracker = tr
            bars[-1].value = v
        self.play(*[FadeIn(b[2]) for b in bars], run_time=0.3)
        anims = []
        for b in bars:
            bar, target = b[0], b[1]
            anims += [Transform(bar, target), b.tracker.animate.set_value(b.value)]
        self.add(*[b[3] for b in bars])
        self.play(*anims, run_time=1.2, rate_func=smooth)
        neq = label("≠", 120, WARN, BOLD).move_to([0, base + 1.3, 0])
        self.play(GrowFromCenter(neq), run_time=0.45)
        self.play(Indicate(neq, color=WARN, scale_factor=1.15), run_time=0.6)
        badge = VGroup(
            RoundedRectangle(corner_radius=0.3, width=6.9, height=0.8, stroke_color=WARN, stroke_width=3, fill_color=BG, fill_opacity=1),
            label("⚠  drift: Staging ≠ Production", 30, WARN, BOLD),
        )
        badge[1].move_to(badge[0])
        badge.next_to(title, DOWN, buff=0.3)
        self.play(FadeIn(badge, scale=0.9), run_time=0.45)
        self.wait(1.6)


class StaleScene(Scene):
    """The stale-flag rule FlagLens computes locally."""

    def construct(self):
        title = VGroup(label("dark_mode", 36, TEXT, font=MONO), label("· is it still needed?", 32, MUTED)).arrange(RIGHT, buff=0.25).to_edge(UP, buff=0.45)
        self.play(FadeIn(title, shift=DOWN * 0.15), run_time=0.5)
        left, right = -4.2, 4.8
        lanes = VGroup()
        for i, e in enumerate(ENVS):
            y = 2.0 - i * 0.8
            name = label(e, 26, MUTED).move_to([-5.6, y, 0])
            track = Line([left, y, 0], [right, y, 0], color=PANEL, stroke_width=26)
            lanes.add(VGroup(name, track))
        self.play(LaggedStart(*[FadeIn(l) for l in lanes], lag_ratio=0.15), run_time=0.6)
        tracker = ValueTracker(0)
        fills = VGroup()
        for i in range(3):
            y = 2.0 - i * 0.8
            fills.add(always_redraw(lambda y=y: Line([left, y, 0], [left + 0.001 + (right - left) * tracker.get_value(), y, 0], color=ON, stroke_width=26)))
        days = always_redraw(lambda: label(f"ON everywhere · unchanged {int(47 * tracker.get_value())} days", 30, TEXT, BOLD).move_to([0.3, -0.3, 0]))
        self.add(fills, days)
        self.play(tracker.animate.set_value(1), run_time=2.0, rate_func=linear)
        rules = VGroup(
            label("✓  same state in every environment", 28, ON),
            label("✓  no segment overrides or variants", 28, ON),
            label("✓  not tagged permanent", 28, ON),
            label("✓  unchanged for longer than the threshold", 28, ON),
        ).arrange(DOWN, aligned_edge=LEFT, buff=0.12).move_to([0, -1.75, 0])
        self.play(days.animate.set_opacity(0.0), run_time=0.3)
        self.remove(days)
        self.add(label("ON everywhere · unchanged 47 days", 30, TEXT, BOLD).move_to([0.3, -0.3, 0]))
        self.play(LaggedStart(*[FadeIn(r, shift=RIGHT * 0.2) for r in rules], lag_ratio=0.35), run_time=1.6)
        verdict = VGroup(
            RoundedRectangle(corner_radius=0.3, width=8.9, height=0.85, stroke_width=0, fill_color=ACCENT, fill_opacity=1),
            label("stale  →  remove the flag and its dead code", 30, WHITE, BOLD),
        )
        verdict[1].move_to(verdict[0])
        verdict.next_to(rules, DOWN, buff=0.25)
        self.play(FadeIn(verdict, scale=0.92), run_time=0.45)
        self.wait(1.6)
