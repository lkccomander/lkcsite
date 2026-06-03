#!/usr/bin/env python3
from __future__ import annotations

import os
import queue
import re
import subprocess
import sys
import threading
import webbrowser
import json
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

try:
    import customtkinter as ctk
except ModuleNotFoundError as exc:  # pragma: no cover - runtime guard for local desktop env
    import tkinter as tk
    from tkinter import messagebox

    root = tk.Tk()
    root.withdraw()
    messagebox.showerror(
        "customtkinter Missing",
        "This desktop app requires the 'customtkinter' package.\n\n"
        "Install it in the Python environment you use to launch this app, then run it again.\n"
        "Example:\n"
        "pip install customtkinter",
    )
    raise SystemExit(1) from exc


ROOT = Path(__file__).resolve().parent
ENV_PATH = ROOT / ".env"
LOG_PATH = ROOT / "log.md"
TELEMETRY_DB_PATH = ROOT.parent / "polydb" / "telemetry" / "events.jsonl"
TELEMETRY_SESSIONS_DIR = ROOT.parent / "polydb" / "telemetry" / "sessions"
MANUAL_TRADE_REQUEST_PATH = ROOT / "manual-trade-request.json"

APP_TITLE = "PATBv5 Desktop Control"
APP_GEOMETRY = "1280x860"
MAX_LOG_LINES = 2000
APP_VERSION = "v5.10"
SPINNER_FRAMES = ["|", "/", "-", "\\"]
OUTPUT_TAG_STYLES = {
    "default": {"foreground": "#e5e7eb"},
    "gui": {"foreground": "#7dd3fc"},
    "pipeline": {"foreground": "#fbbf24"},
    "bot": {"foreground": "#a78bfa"},
    "success": {"foreground": "#4ade80"},
    "warning": {"foreground": "#fb923c"},
    "error": {"foreground": "#f87171"},
    "trade": {"foreground": "#22c55e"},
    "trade_up": {"foreground": "#34d399"},
    "trade_down": {"foreground": "#f472b6"},
    "market": {"foreground": "#60a5fa"},
    "portfolio": {"foreground": "#f9a8d4"},
    "telemetry": {"foreground": "#c4b5fd"},
    "legend_label": {"foreground": "#94a3b8"},
    "legend_up": {"foreground": "#22c55e"},
    "legend_down": {"foreground": "#ef4444"},
    "legend_flat": {"foreground": "#f8fafc"},
    "legend_none": {"foreground": "#111827", "background": "#e5e7eb"},
    "trend_up": {"foreground": "#22c55e"},
    "trend_down": {"foreground": "#ef4444"},
    "trend_flat": {"foreground": "#f8fafc"},
    "position_up": {"foreground": "#22c55e"},
    "position_down": {"foreground": "#ef4444"},
    "position_none": {"foreground": "#e5e7eb"},
}
INLINE_COLOR_PATTERNS = [
    (re.compile(r"trend=UP\s+\S+"), "trend_up"),
    (re.compile(r"trend=DOWN\s+\S+"), "trend_down"),
    (re.compile(r"trend=FLAT\s+\S+"), "trend_flat"),
    (re.compile(r"position=UP\s+\S+"), "position_up"),
    (re.compile(r"position=DOWN\s+\S+"), "position_down"),
    (re.compile(r"position=NONE\s+\S+"), "position_none"),
]


def load_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values

    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip()
    return values


def get_bot_id() -> str:
    env_values = load_env_file(ENV_PATH)
    return env_values.get("BOT_ID") or env_values.get("BOT_INSTANCE_ID") or "polymarket-bot-v5"


def update_env_value(path: Path, key: str, value: str) -> None:
    if path.exists():
        lines = path.read_text(encoding="utf-8").splitlines()
    else:
        lines = []

    updated = False
    rewritten: list[str] = []
    for line in lines:
        stripped = line.strip()
        if stripped and not stripped.startswith("#") and "=" in line:
            existing_key = line.split("=", 1)[0].strip()
            if existing_key == key:
                rewritten.append(f"{key}={value}")
                updated = True
                continue
        rewritten.append(line)

    if not updated:
        rewritten.append(f"{key}={value}")

    path.write_text("\n".join(rewritten) + "\n", encoding="utf-8")


class BotV5Gui(ctk.CTk):
    def __init__(self) -> None:
        super().__init__()
        self.title(APP_TITLE)
        self.geometry(APP_GEOMETRY)
        self.minsize(1080, 720)

        ctk.set_appearance_mode("dark")
        ctk.set_default_color_theme("blue")

        self.output_queue: queue.Queue[str] = queue.Queue()
        self.bot_process: subprocess.Popen[str] | None = None
        self.pipeline_running = False
        self.log_line_count = 0
        self.paper_mode_var = ctk.BooleanVar(value=self._read_paper_mode())
        self.spinner_index = 0
        self.spinner_context = "Idle"

        self.status_var = ctk.StringVar(value="Idle")
        self.pid_var = ctk.StringVar(value="PID: n/a")
        self.command_var = ctk.StringVar(value=f"Command: {self._command_preview()}")
        self.repo_var = ctk.StringVar(value=f"Repo: {ROOT}")
        self.telemetry_var = ctk.StringVar(value=f"Telemetry: {TELEMETRY_DB_PATH}")
        self.mode_var = ctk.StringVar(value=self._mode_text())
        self.bot_id_var = ctk.StringVar(value=f"Bot ID: {get_bot_id()}")
        self.version_var = ctk.StringVar(value=f"Version: {APP_VERSION}")
        self.spinner_var = ctk.StringVar(value="Spinner: ready")

        self.protocol("WM_DELETE_WINDOW", self._on_close)
        self._build_ui()
        self.after(100, self._drain_output)
        self._append_system_message(f"PATBv5 desktop app ready. Version {APP_VERSION}")
        self._append_system_message("Desktop control is connected to the current Node/TypeScript PATBv5 runtime.")
        self._append_system_message("Use Start Bot here or launch_patbv5_cli_and_review.bat if you want the batch wrapper flow.")
        self._append_system_message(f"Working directory: {ROOT}")
        self._append_system_message(f"Telemetry DB: {TELEMETRY_DB_PATH}")
        self._append_system_message(f"Initial mode from .env: {self._mode_text()}")
        self._set_pipeline_state(True)
        self.after(120, self._tick_spinner)
        threading.Thread(target=self._startup_pipeline, daemon=True).start()

    def _build_ui(self) -> None:
        self.grid_columnconfigure(0, weight=1)
        self.grid_rowconfigure(1, weight=1)

        header = ctk.CTkFrame(self, corner_radius=18)
        header.grid(row=0, column=0, sticky="nsew", padx=18, pady=(18, 10))
        header.grid_columnconfigure(0, weight=1)

        title = ctk.CTkLabel(
            header,
            text="Polymarket Arbitrage Trading Bot V5",
            font=ctk.CTkFont(size=28, weight="bold"),
        )
        title.grid(row=0, column=0, sticky="w", padx=18, pady=(16, 2))

        subtitle = ctk.CTkLabel(
            header,
            text=f"Desktop launcher {APP_VERSION} with live CLI telemetry and operator-triggered trade requests.",
            font=ctk.CTkFont(size=14),
            text_color=("gray20", "gray75"),
        )
        subtitle.grid(row=1, column=0, sticky="w", padx=18, pady=(0, 12))

        controls = ctk.CTkFrame(header, fg_color="transparent")
        controls.grid(row=2, column=0, sticky="ew", padx=18, pady=(0, 16))
        controls.grid_columnconfigure(7, weight=1)

        self.start_button = ctk.CTkButton(controls, text="Start Bot", command=self.start_bot, width=120)
        self.start_button.grid(row=0, column=0, padx=(0, 10), pady=4)

        self.stop_button = ctk.CTkButton(
            controls,
            text="Stop Bot",
            command=self.stop_bot,
            width=120,
            fg_color="#7f1d1d",
            hover_color="#991b1b",
            state="disabled",
        )
        self.stop_button.grid(row=0, column=1, padx=(0, 10), pady=4)

        clear_button = ctk.CTkButton(controls, text="Clear Output", command=self.clear_output, width=120)
        clear_button.grid(row=0, column=2, padx=(0, 10), pady=4)

        log_button = ctk.CTkButton(controls, text="Open log.md", command=self.open_log, width=120)
        log_button.grid(row=0, column=3, padx=(0, 10), pady=4)

        telemetry_button = ctk.CTkButton(
            controls,
            text="Open Telemetry",
            command=self.open_telemetry,
            width=140,
        )
        telemetry_button.grid(row=0, column=4, padx=(0, 10), pady=4)

        manual_up_button = ctk.CTkButton(
            controls,
            text="Trade On Demand UP",
            command=lambda: self.request_manual_trade("UP"),
            width=140,
            fg_color="#7f1d1d",
            hover_color="#991b1b",
        )
        manual_up_button.grid(row=0, column=5, padx=(0, 10), pady=4)

        manual_down_button = ctk.CTkButton(
            controls,
            text="Trade On Demand DOWN",
            command=lambda: self.request_manual_trade("DOWN"),
            width=155,
            fg_color="#14532d",
            hover_color="#166534",
        )
        manual_down_button.grid(row=0, column=6, padx=(0, 10), pady=4)

        project_button = ctk.CTkButton(
            controls,
            text="Open Project",
            command=self.open_project_folder,
            width=130,
        )
        project_button.grid(row=0, column=7, padx=(0, 10), pady=4)

        self.paper_switch = ctk.CTkSwitch(
            controls,
            text="Paper Mode",
            variable=self.paper_mode_var,
            command=self.toggle_paper_mode,
        )
        self.paper_switch.grid(row=0, column=8, padx=(0, 12), pady=4, sticky="w")

        status_chip = ctk.CTkLabel(
            controls,
            textvariable=self.status_var,
            corner_radius=999,
            padx=16,
            pady=8,
            fg_color="#1f2937",
        )
        status_chip.grid(row=0, column=9, sticky="e", pady=4)

        info = ctk.CTkFrame(self, corner_radius=18)
        info.grid(row=1, column=0, sticky="nsew", padx=18, pady=(0, 18))
        info.grid_columnconfigure(0, weight=1)
        info.grid_rowconfigure(1, weight=1)

        meta = ctk.CTkFrame(info, fg_color="transparent")
        meta.grid(row=0, column=0, sticky="ew", padx=18, pady=(16, 10))
        meta.grid_columnconfigure(0, weight=1)

        ctk.CTkLabel(meta, textvariable=self.pid_var, anchor="w", font=ctk.CTkFont(size=13)).grid(
            row=0, column=0, sticky="ew", pady=(0, 6)
        )
        ctk.CTkLabel(meta, textvariable=self.command_var, anchor="w", font=ctk.CTkFont(size=13)).grid(
            row=1, column=0, sticky="ew", pady=6
        )
        ctk.CTkLabel(meta, textvariable=self.repo_var, anchor="w", font=ctk.CTkFont(size=13)).grid(
            row=2, column=0, sticky="ew", pady=6
        )
        ctk.CTkLabel(meta, textvariable=self.telemetry_var, anchor="w", font=ctk.CTkFont(size=13)).grid(
            row=3, column=0, sticky="ew", pady=(6, 0)
        )
        ctk.CTkLabel(meta, textvariable=self.mode_var, anchor="w", font=ctk.CTkFont(size=13, weight="bold")).grid(
            row=4, column=0, sticky="ew", pady=(6, 0)
        )
        ctk.CTkLabel(meta, textvariable=self.bot_id_var, anchor="w", font=ctk.CTkFont(size=13)).grid(
            row=5, column=0, sticky="ew", pady=(6, 0)
        )
        ctk.CTkLabel(meta, textvariable=self.version_var, anchor="w", font=ctk.CTkFont(size=13)).grid(
            row=6, column=0, sticky="ew", pady=(6, 0)
        )
        ctk.CTkLabel(meta, textvariable=self.spinner_var, anchor="w", font=ctk.CTkFont(size=13)).grid(
            row=7, column=0, sticky="ew", pady=(6, 0)
        )

        self.output = ctk.CTkTextbox(
            info,
            wrap="word",
            font=("Cascadia Code", 13),
            corner_radius=14,
        )
        self.output.grid(row=1, column=0, sticky="nsew", padx=18, pady=(0, 18))
        self._configure_output_tags()
        self.output.insert("end", "CLI telemetry will appear here when the bot starts.\n", "default")
        self.output.configure(state="disabled")

    def _command_preview(self) -> str:
        npm_cmd = "npm.cmd" if os.name == "nt" else "npm"
        return f"{npm_cmd} start"

    def _creationflags(self) -> int:
        if os.name == "nt":
            return subprocess.CREATE_NO_WINDOW
        return 0

    def _set_pipeline_state(self, running: bool) -> None:
        self.pipeline_running = running
        self.status_var.set("Updating" if running else ("Running" if self.bot_process and self.bot_process.poll() is None else "Idle"))
        self.start_button.configure(state="disabled" if running or (self.bot_process and self.bot_process.poll() is None) else "normal")
        self.paper_switch.configure(state="disabled" if running or (self.bot_process and self.bot_process.poll() is None) else "normal")
        self.spinner_context = "Updating dependencies/build" if running else ("Bot running" if self.bot_process and self.bot_process.poll() is None else "Idle")

    def _latest_mtime(self, paths: list[Path]) -> float:
        latest = 0.0
        for path in paths:
            if path.exists():
                latest = max(latest, path.stat().st_mtime)
        return latest

    def _latest_tree_mtime(self, root: Path, pattern: str) -> float:
        latest = 0.0
        if not root.exists():
            return latest
        for path in root.rglob(pattern):
            if path.is_file():
                latest = max(latest, path.stat().st_mtime)
        return latest

    def _needs_npm_install(self) -> bool:
        node_modules = ROOT / "node_modules"
        package_lock = ROOT / "package-lock.json"
        package_json = ROOT / "package.json"
        if not node_modules.exists():
            return True
        if not (node_modules / ".package-lock.json").exists():
            return True
        deps_mtime = self._latest_mtime([package_json, package_lock])
        installed_mtime = self._latest_mtime([node_modules / ".package-lock.json", node_modules])
        return deps_mtime > installed_mtime

    def _needs_build(self) -> bool:
        dist_index = ROOT / "dist" / "index.js"
        if not dist_index.exists():
            return True
        source_mtime = max(
            self._latest_tree_mtime(ROOT / "src", "*.ts"),
            self._latest_mtime([ROOT / "tsconfig.json", ROOT / "package.json"]),
        )
        return source_mtime > dist_index.stat().st_mtime

    def _run_pipeline_command(self, label: str, args: list[str]) -> int:
        env = os.environ.copy()
        self.output_queue.put(f"[pipeline] {label}: {' '.join(args)}\n")
        self.spinner_context = label
        try:
            proc = subprocess.Popen(
                args,
                cwd=str(ROOT),
                env=env,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                encoding="utf-8",
                errors="replace",
                creationflags=self._creationflags(),
            )
        except FileNotFoundError:
            self.output_queue.put(f"[pipeline] failed to launch: {args[0]}\n")
            return 127

        assert proc.stdout is not None
        for line in proc.stdout:
            self.output_queue.put(f"[pipeline] {line}")
        return proc.wait()

    def _startup_pipeline(self) -> None:
        npm_cmd = "npm.cmd" if os.name == "nt" else "npm"
        self.output_queue.put(f"[pipeline] startup check beginning for {APP_VERSION}\n")
        steps_run = 0

        if self._needs_npm_install():
            steps_run += 1
            code = self._run_pipeline_command("installing dependencies", [npm_cmd, "install"])
            if code != 0:
                self.output_queue.put(f"[pipeline] npm install failed with code {code}\n")
                self.after(0, lambda: self._set_pipeline_state(False))
                return
        else:
            self.output_queue.put("[pipeline] dependencies are up to date\n")

        if self._needs_build():
            steps_run += 1
            code = self._run_pipeline_command("building dist", [npm_cmd, "run", "build"])
            if code != 0:
                self.output_queue.put(f"[pipeline] npm run build failed with code {code}\n")
                self.after(0, lambda: self._set_pipeline_state(False))
                return
        else:
            self.output_queue.put("[pipeline] dist build is up to date\n")

        if steps_run == 0:
            self.output_queue.put("[pipeline] no updates were needed\n")
        else:
            self.output_queue.put(f"[pipeline] update cycle complete; steps run={steps_run}\n")

        self.after(0, lambda: self._set_pipeline_state(False))
        self.output_queue.put("[pipeline] spinner settled; startup checks finished\n")

    def _read_paper_mode(self) -> bool:
        env_values = load_env_file(ENV_PATH)
        value = env_values.get("PAPER_TRADING", "false").strip().lower()
        return value in {"1", "true", "yes", "on"}

    def _mode_text(self) -> str:
        return f"Launch mode: {'PAPER' if self.paper_mode_var.get() else 'LIVE'}"

    def _persist_paper_mode(self) -> None:
        update_env_value(ENV_PATH, "PAPER_TRADING", "true" if self.paper_mode_var.get() else "false")
        self.mode_var.set(self._mode_text())
        self.bot_id_var.set(f"Bot ID: {get_bot_id()}")

    def toggle_paper_mode(self) -> None:
        self._persist_paper_mode()
        self._append_system_message(f"Saved PAPER_TRADING={'true' if self.paper_mode_var.get() else 'false'} to {ENV_PATH}")

    def _append_output(self, text: str) -> None:
        self.output.configure(state="normal")
        pieces = text.splitlines(keepends=True)
        if not pieces:
            pieces = [text]
        for piece in pieces:
            if not self._append_special_line(piece):
                self._append_segmented_line(piece)
        self.output.see("end")
        self.log_line_count += text.count("\n")
        if self.log_line_count > MAX_LOG_LINES:
            overflow = self.log_line_count - MAX_LOG_LINES
            self.output.delete("1.0", f"{overflow + 1}.0")
            self.log_line_count = MAX_LOG_LINES
        self.output.configure(state="disabled")

    def _append_system_message(self, message: str) -> None:
        self._append_output(f"[gui] {message}\n")

    def _configure_output_tags(self) -> None:
        textbox = self.output._textbox
        textbox.configure(bg="#0b1220", insertbackground="#e5e7eb")
        for tag_name, style in OUTPUT_TAG_STYLES.items():
            textbox.tag_config(tag_name, **style)
        textbox.tag_config("legend_emoji", font=("Segoe UI Emoji", 13))
        textbox.tag_config("legend_label_emoji", font=("Segoe UI Emoji", 13), foreground="#94a3b8")

    def _append_special_line(self, text: str) -> bool:
        stripped = text.rstrip("\n")
        if stripped == "Trend legend: UP 🟢 | DOWN 🔴 | FLAT ⚪":
            self._append_legend_segments(
                [
                    ("Trend legend: ", "legend_label"),
                    ("UP ", "legend_up"),
                    ("↑", "legend_up", "legend_emoji"),
                    (" | ", "legend_label"),
                    ("DOWN ", "legend_down"),
                    ("↓", "legend_down", "legend_emoji"),
                    (" | ", "legend_label"),
                    ("FLAT ", "legend_flat"),
                    ("→", "legend_flat", "legend_emoji"),
                ],
                text.endswith("\n"),
            )
            return True
        if stripped == "Position legend: UP 🟩 | DOWN 🟥 | NONE ⬛":
            self._append_legend_segments(
                [
                    ("Position legend: ", "legend_label"),
                    ("UP ", "legend_up"),
                    ("↑", "legend_up", "legend_emoji"),
                    (" | ", "legend_label"),
                    ("DOWN ", "legend_down"),
                    ("↓", "legend_down", "legend_emoji"),
                    (" | ", "legend_label"),
                    ("NONE ", "legend_flat"),
                    ("→", "legend_none", "legend_emoji"),
                ],
                text.endswith("\n"),
            )
            return True
        return False

    def _append_legend_segments(self, segments: list[tuple[str, str] | tuple[str, str, str]], include_newline: bool) -> None:
        for segment in segments:
            if len(segment) == 2:
                value, tag = segment
                self.output.insert("end", value, tag)
            else:
                value, primary_tag, extra_tag = segment
                self.output.insert("end", value, (primary_tag, extra_tag))
        if include_newline:
            self.output.insert("end", "\n", "default")

    def _append_segmented_line(self, text: str) -> None:
        line = text[:-1] if text.endswith("\n") else text
        base_tag = self._resolve_output_tag(line)
        cursor = 0

        while cursor < len(line):
            next_match: re.Match[str] | None = None
            next_tag = base_tag
            for pattern, tag in INLINE_COLOR_PATTERNS:
                match = pattern.search(line, cursor)
                if match is None:
                    continue
                if next_match is None or match.start() < next_match.start():
                    next_match = match
                    next_tag = tag

            if next_match is None:
                self.output.insert("end", line[cursor:], base_tag)
                break

            if next_match.start() > cursor:
                self.output.insert("end", line[cursor:next_match.start()], base_tag)
            self.output.insert("end", next_match.group(0), next_tag)
            cursor = next_match.end()

        if text.endswith("\n"):
            self.output.insert("end", "\n", "default")

    def _resolve_output_tag(self, text: str) -> str:
        line = text.strip()
        lower = line.lower()
        up_hint = any(token in lower for token in (" up ", "up=", " up|", "| up", "side=up", "position: up", "trend: up", "outcomes=up", "buy up", "sell up"))
        down_hint = any(token in lower for token in (" down ", "down=", " down|", "| down", "side=down", "position: down", "trend: down", "outcomes=down", "buy down", "sell down"))

        if not line:
            return "default"
        if line.startswith("[gui]"):
            return "gui"
        if line.startswith("[pipeline]"):
            if any(token in lower for token in ("failed", "error", "traceback", "exception")):
                return "error"
            if any(token in lower for token in ("complete", "up to date", "no updates", "finished")):
                return "success"
            return "pipeline"
        if line.startswith("[bot]"):
            if "exited with code 0" in lower or "started" in lower:
                return "success"
            if "exited with code" in lower:
                return "warning"
            return "bot"

        if any(token in lower for token in ("traceback", "exception", "cannot find module", "unauthorized", "fatal", "failed", "error:")):
            return "error"
        if any(token in lower for token in ("rejected", "fallback", "stale", "ignored", "terminate requested", "skipping", "warning")):
            return "warning"
        if any(token in lower for token in ("buy", "sell", "take_profit", "stop_loss", "forced_exit", "manual_exit", "emergency_exit")):
            if up_hint and not down_hint:
                return "trade_up"
            if down_hint and not up_hint:
                return "trade_down"
            return "trade"
        if line.startswith("Market ") or line.startswith("Resolved ") or line.startswith("Window:") or line.startswith("Trend legend:"):
            if up_hint and not down_hint:
                return "trade_up"
            if down_hint and not up_hint:
                return "trade_down"
            return "market"
        if line.startswith("Portfolio ") or line.startswith("Position legend:") or line.startswith("Position "):
            if up_hint and not down_hint:
                return "trade_up"
            if down_hint and not up_hint:
                return "trade_down"
            return "portfolio"
        if line.startswith("Telemetry ") or line.startswith("Session:") or line.startswith("Repo:"):
            return "telemetry"
        if any(token in lower for token in ("filled", "connected", "complete", "ready", "saved paper_trading")):
            return "success"
        return "default"

    def _tick_spinner(self) -> None:
        active = self.pipeline_running or (self.bot_process is not None and self.bot_process.poll() is None)
        if active:
            frame = SPINNER_FRAMES[self.spinner_index % len(SPINNER_FRAMES)]
            self.spinner_index += 1
            self.spinner_var.set(f"Spinner: {frame} {self.spinner_context}")
        else:
            self.spinner_var.set("Spinner: ready")
        self.after(120, self._tick_spinner)

    def _drain_output(self) -> None:
        while True:
            try:
                line = self.output_queue.get_nowait()
            except queue.Empty:
                break
            self._append_output(line)
        self.after(100, self._drain_output)

    def _set_running_state(self, running: bool) -> None:
        self.start_button.configure(state="disabled" if running or self.pipeline_running else "normal")
        self.stop_button.configure(state="normal" if running else "disabled")
        self.paper_switch.configure(state="disabled" if running or self.pipeline_running else "normal")
        self.status_var.set("Running" if running else ("Updating" if self.pipeline_running else "Idle"))

    def _launch_reader(self, process: subprocess.Popen[str]) -> None:
        def reader() -> None:
            assert process.stdout is not None
            self.output_queue.put("[bot] started\n")
            self.spinner_context = "Streaming live CLI telemetry"
            for line in process.stdout:
                self.output_queue.put(line)
            code = process.wait()
            self.output_queue.put(f"[bot] exited with code {code}\n")
            self.bot_process = None
            self.after(0, lambda: self.pid_var.set("PID: n/a"))
            self.after(0, lambda: self._set_running_state(False))

        threading.Thread(target=reader, daemon=True).start()

    def start_bot(self) -> None:
        if self.pipeline_running:
            self._append_system_message("Start ignored because the startup update pipeline is still running.")
            return
        if self.bot_process and self.bot_process.poll() is None:
            self._append_system_message("Start ignored because the bot is already running.")
            return

        npm_cmd = "npm.cmd" if os.name == "nt" else "npm"
        args = [npm_cmd, "start"]
        env = os.environ.copy()
        self._persist_paper_mode()
        env["PAPER_TRADING"] = "true" if self.paper_mode_var.get() else "false"

        try:
            process = subprocess.Popen(
                args,
                cwd=str(ROOT),
                env=env,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                encoding="utf-8",
                errors="replace",
                creationflags=self._creationflags(),
            )
        except FileNotFoundError:
            self._append_system_message(
                f"Failed to launch '{npm_cmd}'. Make sure Node.js/npm is installed and available in this environment."
            )
            return

        self.bot_process = process
        self.pid_var.set(f"PID: {process.pid}")
        self._set_running_state(True)
        self.spinner_context = "Starting bot process"
        self._append_system_message(
            f"Launching bot with: {' '.join(args)} | mode={'PAPER' if self.paper_mode_var.get() else 'LIVE'}"
        )
        self._append_system_message("Spinner active while the bot is loading and waiting for telemetry.")
        self._launch_reader(process)

    def stop_bot(self) -> None:
        if not self.bot_process or self.bot_process.poll() is not None:
            self._append_system_message("Stop ignored because the bot is not running.")
            self._set_running_state(False)
            return

        self._append_system_message("Terminate requested.")
        self.spinner_context = "Stopping bot process"
        self.bot_process.terminate()

    def clear_output(self) -> None:
        self.output.configure(state="normal")
        self.output.delete("1.0", "end")
        self.output.configure(state="disabled")
        self.log_line_count = 0
        self._append_system_message("Output cleared.")

    def open_log(self) -> None:
        if LOG_PATH.exists():
            webbrowser.open(LOG_PATH.resolve().as_uri())
        else:
            self._append_system_message(f"log.md not found at {LOG_PATH}")

    def open_telemetry(self) -> None:
        target = TELEMETRY_DB_PATH if TELEMETRY_DB_PATH.exists() else TELEMETRY_SESSIONS_DIR
        webbrowser.open(target.resolve().as_uri())

    def open_project_folder(self) -> None:
        webbrowser.open(ROOT.resolve().as_uri())

    def request_manual_trade(self, side_value: str) -> None:
        if not self.bot_process or self.bot_process.poll() is not None:
            self._append_system_message("Trade on demand is available only while the bot is running.")
            return

        if side_value not in {"UP", "DOWN"}:
            self._append_system_message(f"Trade on demand cancelled. Unsupported side={side_value}.")
            return

        runtime_mode = "PAPER" if self.paper_mode_var.get() else "LIVE"
        if runtime_mode == "LIVE":
            confirm_dialog = ctk.CTkInputDialog(
                text=f"LIVE mode is armed. Type LIVE {side_value} to confirm this real order request.",
                title="Confirm Live Trade",
            )
            confirmation = (confirm_dialog.get_input() or "").strip().upper()
            if confirmation != f"LIVE {side_value}":
                self._append_system_message("Live trade on demand cancelled.")
                return

        if MANUAL_TRADE_REQUEST_PATH.exists():
            self._append_system_message("A manual trade request is already pending. Wait for the bot to consume it.")
            return

        now = datetime.now(timezone.utc)
        request = {
            "id": str(uuid4()),
            "requestedAt": now.isoformat(timespec="milliseconds").replace("+00:00", "Z"),
            "side": side_value,
            "source": "botv5_gui",
            "mode": runtime_mode,
        }
        MANUAL_TRADE_REQUEST_PATH.write_text(json.dumps(request, separators=(",", ":")) + "\n", encoding="utf-8")
        self._append_system_message(
            f"Manual trade request queued | side={side_value} | mode={runtime_mode} | file={MANUAL_TRADE_REQUEST_PATH.name}"
        )

    def _on_close(self) -> None:
        if self.bot_process and self.bot_process.poll() is None:
            self._append_system_message("Window closing. Terminating running bot process.")
            self.bot_process.terminate()
        self.destroy()


def main() -> int:
    app = BotV5Gui()
    app.mainloop()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
