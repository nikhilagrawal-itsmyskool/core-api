#!/usr/bin/env python3
# CP-SAT pipeline - STAGE 2 poller (Python): detect + solve.
#
# Scans the artifact root (this cpsat/ directory) for runs the Node dump worker has
# prepared: a folder <runId>/ with solver-input.json + meta.json but no solution.json
# yet. For each, it runs solve_cpsat.py to produce solution.json in the same folder.
# If CP-SAT finds no solution (infeasible / times out -> solve_cpsat exits non-zero),
# it writes solve-error.json instead so the Node import worker can mark the run failed.
#
# Stays DB-free on purpose: it only reads/writes files and shells out to the solver.
# In AWS this poller is replaced by an S3 ObjectCreated trigger on solver-input.json.
#
# Usage:
#   python3 modules/timetable/cpsat/poller.py [--dir <root>] [--time 120] [--interval 5] [--once]
#
# Requires ortools (pip3 install ortools) for solve_cpsat.py.

import argparse
import json
import os
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
SOLVER = os.path.join(HERE, "solve_cpsat.py")

INPUT_FILE = "solver-input.json"
META_FILE = "meta.json"
SOLUTION_FILE = "solution.json"
ERROR_FILE = "solve-error.json"
SOLVING_MARKER = ".solving"


def clear_stale_markers(root):
    # This poller is the only solver, single-threaded, so any leftover .solving marker
    # is from a previous crash - clear it so the run is retried.
    for name in os.listdir(root):
        d = os.path.join(root, name)
        marker = os.path.join(d, SOLVING_MARKER)
        if os.path.isdir(d) and os.path.exists(marker):
            try:
                os.remove(marker)
            except OSError:
                pass


def pending_runs(root):
    out = []
    try:
        names = os.listdir(root)
    except FileNotFoundError:
        return out
    for name in names:
        d = os.path.join(root, name)
        if not os.path.isdir(d):
            continue
        has_input = os.path.exists(os.path.join(d, INPUT_FILE)) and os.path.exists(os.path.join(d, META_FILE))
        done = os.path.exists(os.path.join(d, SOLUTION_FILE)) or os.path.exists(os.path.join(d, ERROR_FILE))
        solving = os.path.exists(os.path.join(d, SOLVING_MARKER))
        if has_input and not done and not solving:
            out.append((name, d))
    return out


def solve_one(run_id, d, time_budget, workers):
    marker = os.path.join(d, SOLVING_MARKER)
    with open(marker, "w") as f:
        f.write(str(time.time()))
    try:
        cmd = [
            sys.executable, SOLVER,
            "--in", os.path.join(d, INPUT_FILE),
            "--out", os.path.join(d, SOLUTION_FILE),
            "--time", str(time_budget),
            "--workers", str(workers),
        ]
        print(f"[cpsat-poller] solving run {run_id} (time={time_budget}s)...", flush=True)
        proc = subprocess.run(cmd, capture_output=True, text=True)
        # solve_cpsat.py logs progress/status to stderr; surface a tail for visibility.
        tail = "\n".join(proc.stderr.strip().splitlines()[-6:]) if proc.stderr else ""
        if proc.returncode == 0 and os.path.exists(os.path.join(d, SOLUTION_FILE)):
            print(f"[cpsat-poller] run {run_id} solved.\n{tail}", flush=True)
            render_exports(run_id, d)
        else:
            reason = (tail.splitlines()[-1] if tail else f"solver exited {proc.returncode}")
            with open(os.path.join(d, ERROR_FILE), "w") as f:
                json.dump({"reason": reason, "status": "no_solution", "returncode": proc.returncode}, f, indent=2)
            print(f"[cpsat-poller] run {run_id} NO SOLUTION: {reason}", flush=True)
    finally:
        try:
            os.remove(marker)
        except OSError:
            pass


# After a solve, render the human-readable exports (consolidated master xlsx +
# per-class/teacher/master pdf) into the run folder so the download endpoint can serve
# them. Best-effort: needs openpyxl (xls) and reportlab (pdf); if a renderer is missing
# or fails, log and carry on — the solve + DB import are unaffected.
def render_exports(run_id, d):
    for script in ("render_xls.py", "render_pdf.py"):
        try:
            p = subprocess.run(
                [sys.executable, os.path.join(HERE, script), "--run-dir", d],
                capture_output=True, text=True,
            )
            if p.returncode != 0:
                last = (p.stderr.strip().splitlines() or ["(no output)"])[-1]
                print(f"[cpsat-poller] {script} failed for {run_id}: {last}", flush=True)
        except Exception as e:  # noqa: BLE001
            print(f"[cpsat-poller] {script} error for {run_id}: {e}", flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", default=os.environ.get("CPSAT_ARTIFACT_DIR", HERE))
    ap.add_argument("--time", type=float, default=float(os.environ.get("CPSAT_SOLVE_TIME", "120")))
    ap.add_argument("--workers", type=int, default=int(os.environ.get("CPSAT_WORKERS", "8")))
    ap.add_argument("--interval", type=float, default=5.0)
    ap.add_argument("--once", action="store_true", help="process the current backlog and exit")
    args = ap.parse_args()

    print(f"[cpsat-poller] scanning {args.dir} every {args.interval}s (time budget {args.time}s)", flush=True)
    clear_stale_markers(args.dir)
    while True:
        for run_id, d in pending_runs(args.dir):
            solve_one(run_id, d, args.time, args.workers)
        if args.once:
            break
        time.sleep(args.interval)


if __name__ == "__main__":
    main()
