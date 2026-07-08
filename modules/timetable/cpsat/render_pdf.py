#!/usr/bin/env python3
"""
Render a CP-SAT timetable run to a readable PDF — per-class, per-teacher, and master
(whole-school, per-day) grids, with real names/codes (not UUIDs).

Reads from a run folder (cpsat/<run-id>/):
    solution.json      the solved placements          (the content)
    solver-input.json  grid + labels + class/teacher list
    registration.json  per-class 0th-period rows (class teacher; not in solution.json)

A cell is filled in priority order:
    registration entry  ->  solved teaching placement  ->  non-teaching grid label  ->  blank

Usage:
    python3 render_pdf.py --run-dir cpsat/<run-id>            # writes <run-dir>/timetable.pdf
    python3 render_pdf.py --in solver-input.json --solution solution.json \
                          --registration registration.json --out timetable.pdf

Requires: reportlab  (pip install reportlab)
"""
import argparse
import json
import os
import re
from collections import defaultdict

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import (
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

DAY_NAMES = {1: "Mon", 2: "Tue", 3: "Wed", 4: "Thu", 5: "Fri", 6: "Sat", 7: "Sun"}

_ROMAN = {"I": 1, "II": 2, "III": 3, "IV": 4, "V": 5,
          "VI": 6, "VII": 7, "VIII": 8, "IX": 9, "X": 10, "XI": 11, "XII": 12}


def _class_sort_key(label: str):
    """Sort 'XI-A (Science)' after 'X-A', not between 'IV-B' and 'V-A'."""
    m = re.match(r"^(XII|XI|IX|VIII|VII|VI|IV|III|II|X|V|I)", label)
    grade = _ROMAN.get(m.group(1), 0) if m else 0
    rest = label[m.end():] if m else label
    return (grade, rest)

TITLE = ParagraphStyle("title", fontName="Helvetica-Bold", fontSize=12, spaceAfter=4)
SUB = ParagraphStyle("sub", fontName="Helvetica", fontSize=8, textColor=colors.grey, spaceAfter=6)
CELL = ParagraphStyle("cell", fontName="Helvetica", fontSize=7, leading=8, alignment=1)
CELL_HDR = ParagraphStyle("hdr", fontName="Helvetica-Bold", fontSize=7, leading=8, alignment=1)
CELL_FIX = ParagraphStyle("fix", fontName="Helvetica-Oblique", fontSize=6.5, leading=7,
                          alignment=1, textColor=colors.grey)


def classes_of(p):
    ids = p.get("classIds") or []
    return ids if len(ids) > 0 else [p["classId"]]


def short_subject(sub_labels, sid):
    """Return full label e.g. 'Mathematics (041-MATHS)'; fall back to id prefix."""
    return sub_labels.get(sid) or sid[:5]


def short_teacher(tch_labels, tid):
    if tid is None:
        return ""
    return tch_labels.get(tid) or tid[:4]


def para(text, style=CELL):
    return Paragraph((text or "").replace("\n", "<br/>"), style)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--run-dir", dest="run_dir", help="folder with solver-input/solution/registration json")
    ap.add_argument("--in", dest="inp", help="solver-input.json (default <run-dir>/solver-input.json)")
    ap.add_argument("--solution", dest="sol", help="solution.json (default <run-dir>/solution.json)")
    ap.add_argument("--registration", dest="reg", help="registration.json (default <run-dir>/registration.json)")
    ap.add_argument("--out", dest="out", help="output pdf (default <run-dir>/timetable.pdf)")
    args = ap.parse_args()

    rd = args.run_dir
    inp = args.inp or (os.path.join(rd, "solver-input.json") if rd else None)
    sol = args.sol or (os.path.join(rd, "solution.json") if rd else None)
    reg = args.reg or (os.path.join(rd, "registration.json") if rd else None)
    out = args.out or (os.path.join(rd, "timetable.pdf") if rd else "timetable.pdf")
    if not inp or not sol:
        ap.error("need --run-dir, or both --in and --solution")

    with open(inp) as f:
        payload = json.load(f)
    data = payload.get("input", payload)
    labels = payload.get("labels", {})
    meta = payload.get("meta", {})
    cls_l = labels.get("class", {})
    sub_l = labels.get("subject", {})
    tch_l = labels.get("teacher", {})

    with open(sol) as f:
        placements = json.load(f)
    registration = []
    if reg and os.path.exists(reg):
        with open(reg) as f:
            registration = json.load(f)

    grid = data["grid"]
    days = sorted(d["dayOfWeek"] for d in grid["days"])
    # (day, seq) -> slotType ; slotId -> (day, seq)
    slot_type = {}
    slot_loc = {}
    seqs_by_day = defaultdict(list)
    for d in grid["days"]:
        dow = d["dayOfWeek"]
        for s in d["slots"]:
            slot_type[(dow, s["sequence"])] = s["slotType"]
            slot_loc[s["slotId"]] = (dow, s["sequence"])
            seqs_by_day[dow].append(s["sequence"])
    all_seqs = sorted({seq for seqs in seqs_by_day.values() for seq in seqs})

    # ---- fill lookups -------------------------------------------------------
    # class view: (class, day, seq) -> text ; teacher view: (teacher, day, seq) -> text
    by_class = {}
    by_teacher = defaultdict(list)   # (teacher, day, seq) -> [booking text, ...] (deliberate double-bookings stack)
    active_teachers = set()
    for p in placements:
        d = p["dayOfWeek"]
        for k in range(p["size"]):
            seq = p["startSequence"] + k
            # class cell: subject(code)·teacher per offering, stacked
            cls_txt = "\n".join(
                short_subject(sub_l, o["subjectId"])
                + (f"\n{short_teacher(tch_l, o.get('teacherId'))}" if o.get("teacherId") else "")
                for o in p["offerings"]
            )
            for c in classes_of(p):
                by_class[(c, d, seq)] = cls_txt
            # teacher cell: subject(code) + class names this teacher takes here
            for o in p["offerings"]:
                tid = o.get("teacherId")
                if not tid:
                    continue
                active_teachers.add(tid)
                cnames = ", ".join(cls_l.get(c, c) for c in classes_of(p))
                by_teacher[(tid, d, seq)].append(f"{short_subject(sub_l, o['subjectId'])}\n{cnames}")

    # registration (per class): class teacher, no subject
    for e in registration:
        loc = slot_loc.get(e["timeSlotId"])
        if not loc:
            continue
        d, seq = loc
        tid = e["teacherId"]
        by_class[(e["classId"], d, seq)] = f"REG\n{short_teacher(tch_l, tid)}"
        active_teachers.add(tid)
        by_teacher[(tid, d, seq)].append(f"REG\n{cls_l.get(e['classId'], e['classId'])}")

    # Flatten the per-teacher accumulators: single booking renders as before; two or
    # more deliberate bookings at one slot stack, separated by a blank line so each is
    # explicit (e.g. Music & Dance III-A / Music & Dance III-B).
    by_teacher = {k: "\n\n".join(v) for k, v in by_teacher.items()}

    # ---- render -------------------------------------------------------------
    story = []
    title = f"Timetable — {meta.get('runId', '')}".strip(" —")
    story.append(Paragraph(title or "Timetable", TITLE))
    story.append(Paragraph(
        f"{meta.get('classCount', len(cls_l))} classes · {meta.get('lessonCount', len(placements))} lessons · "
        f"{len(placements)} placements · config {meta.get('configId', '?')}", SUB))

    def fixed_label(t):
        return {"break": "BREAK", "lunch": "LUNCH", "assembly": "ASSEMBLY",
                "reserved": "RESERVED", "activity": "ACTIVITY",
                "registration": "REG"}.get(t, t.upper())

    def grid_table(header, rows, text_fn, day_fn):
        """rows: [(row_label, row_key)]. text_fn(row_key, seq)->content.
        day_fn(row_key)->day used to resolve the grid slot type (fixed day for the
        master view, the row's own day for per-class/per-teacher)."""
        head = [para(header, CELL_HDR)] + [para(f"P{seq}", CELL_HDR) for seq in all_seqs]
        table = [head]
        styles = [
            ("GRID", (0, 0), (-1, -1), 0.4, colors.grey),
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#2c3e50")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("BACKGROUND", (0, 1), (0, -1), colors.HexColor("#ecf0f1")),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("TOPPADDING", (0, 0), (-1, -1), 2),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
        ]
        for r_i, (rlabel, key) in enumerate(rows, start=1):
            d = day_fn(key)
            line = [para(rlabel, CELL_HDR)]
            for c_i, seq in enumerate(all_seqs, start=1):
                st = slot_type.get((d, seq))
                if st is None:
                    line.append(para("", CELL))  # this day is shorter — no slot here
                elif st != "teaching":
                    txt = text_fn(key, seq)  # registration fills here; else label the fixed slot
                    if txt:
                        line.append(para(txt, CELL))
                    else:
                        line.append(para(fixed_label(st), CELL_FIX))
                        styles.append(("BACKGROUND", (c_i, r_i), (c_i, r_i), colors.HexColor("#f7f7f7")))
                else:
                    line.append(para(text_fn(key, seq), CELL))
            table.append(line)
        n = len(all_seqs)
        usable = landscape(A4)[0] - 20 * mm
        label_w = 26 * mm
        col_w = (usable - label_w) / max(1, n)
        t = Table(table, colWidths=[label_w] + [col_w] * n, repeatRows=1)
        t.setStyle(TableStyle(styles))
        return t

    # MASTER — one page per day (rows = classes, cols = periods, day fixed per page)
    class_ids = sorted(cls_l.keys(), key=lambda c: _class_sort_key(cls_l.get(c, c))) or data.get("classIds", [])
    for d in days:
        story.append(Paragraph(f"Master — {DAY_NAMES.get(d, 'Day ' + str(d))}", TITLE))
        rows = [(cls_l.get(c, c), c) for c in class_ids]
        story.append(grid_table(
            "Class", rows,
            text_fn=lambda c, seq, d=d: by_class.get((c, d, seq), ""),
            day_fn=lambda c, d=d: d))
        story.append(PageBreak())

    # PER CLASS — one page each (rows = days, cols = periods)
    for c in class_ids:
        story.append(Paragraph(f"Class: {cls_l.get(c, c)}", TITLE))
        rows = [(DAY_NAMES.get(d, str(d)), d) for d in days]
        story.append(grid_table(
            "Day", rows,
            text_fn=lambda day, seq, c=c: by_class.get((c, day, seq), ""),
            day_fn=lambda day: day))
        story.append(PageBreak())

    # PER TEACHER — one page each (only teachers who actually appear)
    teacher_ids = sorted([t for t in tch_l if t in active_teachers] or list(active_teachers),
                         key=lambda t: tch_l.get(t, t))
    for t in teacher_ids:
        story.append(Paragraph(f"Teacher: {tch_l.get(t, t)}", TITLE))
        rows = [(DAY_NAMES.get(d, str(d)), d) for d in days]
        story.append(grid_table(
            "Day", rows,
            text_fn=lambda day, seq, t=t: by_teacher.get((t, day, seq), ""),
            day_fn=lambda day: day))
        story.append(PageBreak())

    doc = SimpleDocTemplate(out, pagesize=landscape(A4),
                            leftMargin=10 * mm, rightMargin=10 * mm,
                            topMargin=10 * mm, bottomMargin=10 * mm)
    doc.build(story)
    print(f"wrote {out}: master ({len(days)} days), {len(class_ids)} class pages, {len(teacher_ids)} teacher pages")


if __name__ == "__main__":
    main()
