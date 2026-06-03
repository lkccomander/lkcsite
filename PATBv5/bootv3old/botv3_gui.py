#!/usr/bin/env python3
import os
import queue
import subprocess
import sys
import threading
import tkinter as tk
import webbrowser
import json
from collections import deque
from pathlib import Path
from tkinter import filedialog, messagebox, ttk


ROOT = Path(__file__).resolve().parent
ENV_PATH = ROOT / ".env"
EXAMPLE_ENV_PATH = ROOT / ".env.example"
LOG_PATH = ROOT / "log.md"
CONNECTIVITY_SCRIPT = ROOT / "scripts" / "check_polymarket_connectivity.py"
DERIVE_CREDS_SCRIPT = ROOT / "scripts" / "derive_polymarket_api_creds.py"
TELEMETRY_DB_PATH = ROOT.parent / "polydb" / "telemetry" / "events.jsonl"
SIGNAL_EVENT_TYPES = {"trade.signal_accepted", "trade.signal_rejected"}
BOT_ID = "polymarket-bot-v3"
SIGNAL_REFRESH_MS = 1000
SIGNAL_HISTORY_LINES = 400
MAX_SIGNAL_ROWS = 300
SECRET_ENV_KEYS = {
    "POLYMARKET_PRIVATE_KEY",
    "POLYMARKET_API_KEY",
    "POLYMARKET_API_SECRET",
    "POLYMARKET_API_PASSPHRASE",
}
ALLOW_DOTENV_SECRETS_KEY = "RABBITHAT_ALLOW_DOTENV_SECRETS"


def allow_dotenv_secrets(values: dict[str, str]) -> bool:
    return values.get(ALLOW_DOTENV_SECRETS_KEY, "").strip().lower() in {"1", "true", "yes", "on"}


def load_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values

    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        values[key] = value
    return values


def save_env_file(path: Path, values: dict[str, str]) -> None:
    ordered_keys = [
        "PAPER_TRADING",
        "PAPER_STARTING_USD",
        "POLYMARKET_SIGNATURE_TYPE",
        "RABBITHAT_SECRET_COMMAND",
        "RABBITHAT_SECRET_PREFIX",
        ALLOW_DOTENV_SECRETS_KEY,
        "POLYMARKET_PRIVATE_KEY",
        "PROXY_WALLET_ADDRESS",
        "POLYMARKET_API_KEY",
        "POLYMARKET_API_SECRET",
        "POLYMARKET_API_PASSPHRASE",
        "NODE_EXE",
    ]
    existing = load_env_file(path)
    existing.update(values)
    write_dotenv_secrets = allow_dotenv_secrets(existing)
    lines = [
        f"{key}={existing.get(key, '')}"
        for key in ordered_keys
        if write_dotenv_secrets or key not in SECRET_ENV_KEYS
    ]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


class BotGui:
    def __init__(self, root: tk.Tk) -> None:
        self.root = root
        self.root.title("Polymarket Bot V3 Control")
        self.root.geometry("980x760")

        self.output_queue: queue.Queue[str] = queue.Queue()
        self.bot_process: subprocess.Popen[str] | None = None
        self.connectivity_process: subprocess.Popen[str] | None = None
        self.signal_file_offset = 0
        self.signal_rows: deque[str] = deque()

        self.vars = {
            "PAPER_TRADING": tk.StringVar(),
            "PAPER_STARTING_USD": tk.StringVar(),
            "POLYMARKET_SIGNATURE_TYPE": tk.StringVar(),
            "POLYMARKET_PRIVATE_KEY": tk.StringVar(),
            "PROXY_WALLET_ADDRESS": tk.StringVar(),
            "POLYMARKET_API_KEY": tk.StringVar(),
            "POLYMARKET_API_SECRET": tk.StringVar(),
            "POLYMARKET_API_PASSPHRASE": tk.StringVar(),
            "NODE_EXE": tk.StringVar(),
        }

        self._build_ui()
        self.load_current_env()
        self.root.after(150, self._drain_output)
        self._load_signal_history()
        self.root.after(SIGNAL_REFRESH_MS, self._poll_signal_feed)

    def _build_ui(self) -> None:
        frame = ttk.Frame(self.root, padding=12)
        frame.pack(fill="both", expand=True)

        header = ttk.Label(
            frame,
            text="Polymarket Bot V3 Manual Auth Control",
            font=("Segoe UI", 14, "bold"),
        )
        header.pack(anchor="w")

        subtitle = ttk.Label(
            frame,
            text="Enter wallet and optional manual API credentials, save .env, test connectivity, then start the bot.",
        )
        subtitle.pack(anchor="w", pady=(4, 10))

        notebook = ttk.Notebook(frame)
        notebook.pack(fill="both", expand=True)

        control_tab = ttk.Frame(notebook, padding=4)
        signals_tab = ttk.Frame(notebook, padding=4)
        notebook.add(control_tab, text="Control")
        notebook.add(signals_tab, text="Signals")

        form = ttk.Frame(control_tab)
        form.pack(fill="x")
        form.columnconfigure(1, weight=1)

        fields = [
            ("Paper Trading", "PAPER_TRADING"),
            ("Paper Starting USD", "PAPER_STARTING_USD"),
            ("Signature Type", "POLYMARKET_SIGNATURE_TYPE"),
            ("Private Key", "POLYMARKET_PRIVATE_KEY"),
            ("Proxy Wallet", "PROXY_WALLET_ADDRESS"),
            ("API Key", "POLYMARKET_API_KEY"),
            ("API Secret", "POLYMARKET_API_SECRET"),
            ("API Passphrase", "POLYMARKET_API_PASSPHRASE"),
            ("Node Exe", "NODE_EXE"),
        ]

        for row, (label_text, key) in enumerate(fields):
            ttk.Label(form, text=label_text).grid(row=row, column=0, sticky="w", padx=(0, 10), pady=4)
            if key == "PAPER_TRADING":
                combo = ttk.Combobox(
                    form,
                    textvariable=self.vars[key],
                    values=["true", "false"],
                    state="readonly",
                )
                combo.grid(row=row, column=1, sticky="ew", pady=4)
            elif key == "POLYMARKET_SIGNATURE_TYPE":
                combo = ttk.Combobox(
                    form,
                    textvariable=self.vars[key],
                    values=["0", "1", "2"],
                    state="readonly",
                )
                combo.grid(row=row, column=1, sticky="ew", pady=4)
            else:
                entry = ttk.Entry(form, textvariable=self.vars[key])
                entry.grid(row=row, column=1, sticky="ew", pady=4)
                if key == "NODE_EXE":
                    ttk.Button(form, text="Browse", command=self.pick_node_exe).grid(row=row, column=2, padx=(8, 0), pady=4)

        button_row = ttk.Frame(control_tab)
        button_row.pack(fill="x", pady=(12, 10))

        ttk.Button(button_row, text="Load Env", command=self.load_current_env).pack(side="left")
        ttk.Button(button_row, text="Save Env", command=self.save_current_env).pack(side="left", padx=(8, 0))
        ttk.Button(button_row, text="Clear API Creds", command=self.clear_api_creds).pack(side="left", padx=(8, 0))
        ttk.Button(button_row, text="Derive API Creds", command=self.derive_api_creds).pack(side="left", padx=(8, 0))
        ttk.Button(button_row, text="Run Connectivity Check", command=self.run_connectivity_check).pack(side="left", padx=(8, 0))
        ttk.Button(button_row, text="Open log.md", command=self.open_log).pack(side="left", padx=(8, 0))
        ttk.Button(button_row, text="Start Bot", command=self.start_bot).pack(side="left", padx=(8, 0))
        ttk.Button(button_row, text="Stop Bot", command=self.stop_bot).pack(side="left", padx=(8, 0))

        output_label = ttk.Label(control_tab, text="Output")
        output_label.pack(anchor="w")

        self.output = tk.Text(control_tab, wrap="word", height=28)
        self.output.pack(fill="both", expand=True)

        signal_header = ttk.Frame(signals_tab)
        signal_header.pack(fill="x", pady=(0, 8))
        ttk.Label(
            signal_header,
            text="Decision Signal Feed",
            font=("Segoe UI", 11, "bold"),
        ).pack(side="left")
        ttk.Button(signal_header, text="Reload", command=self._reload_signal_feed).pack(side="right")

        signal_subtitle = ttk.Label(
            signals_tab,
            text="Shows recent and live-updating trade.signal_accepted / trade.signal_rejected telemetry for bot v3.",
        )
        signal_subtitle.pack(anchor="w", pady=(0, 8))

        columns = ("timestamp", "event_type", "side", "price", "reason", "market")
        self.signal_tree = ttk.Treeview(
            signals_tab,
            columns=columns,
            show="headings",
            height=24,
        )
        headings = {
            "timestamp": ("Time", 170),
            "event_type": ("Event", 150),
            "side": ("Side", 90),
            "price": ("Price", 80),
            "reason": ("Reason", 220),
            "market": ("Market", 180),
        }
        for key, (label, width) in headings.items():
            self.signal_tree.heading(key, text=label)
            self.signal_tree.column(key, width=width, anchor="w", stretch=key in {"reason", "market"})

        signal_scroll = ttk.Scrollbar(signals_tab, orient="vertical", command=self.signal_tree.yview)
        self.signal_tree.configure(yscrollcommand=signal_scroll.set)
        self.signal_tree.pack(side="left", fill="both", expand=True)
        signal_scroll.pack(side="right", fill="y")

    def append_output(self, text: str) -> None:
        self.output.insert("end", text)
        self.output.see("end")

    def _drain_output(self) -> None:
        try:
            while True:
                item = self.output_queue.get_nowait()
                self.append_output(item)
        except queue.Empty:
            pass
        self.root.after(150, self._drain_output)

    def _tail_lines(self, path: Path, line_count: int) -> list[str]:
        if not path.exists():
            return []
        with path.open("rb") as handle:
            handle.seek(0, os.SEEK_END)
            position = handle.tell()
            buffer = b""
            lines_found = 0
            chunk_size = 8192
            while position > 0 and lines_found <= line_count:
                read_size = min(chunk_size, position)
                position -= read_size
                handle.seek(position)
                buffer = handle.read(read_size) + buffer
                lines_found = buffer.count(b"\n")
            return buffer.decode("utf-8", errors="replace").splitlines()[-line_count:]

    def _extract_signal_row(self, raw_line: str) -> tuple[str, str, str, str, str, str] | None:
        try:
            event = json.loads(raw_line)
        except json.JSONDecodeError:
            return None

        if event.get("botId") != BOT_ID or event.get("type") not in SIGNAL_EVENT_TYPES:
            return None

        payload = event.get("payload") or {}
        side = str(
            payload.get("side")
            or payload.get("preferredSide")
            or payload.get("requestedSide")
            or ""
        )
        price_value = payload.get("executionPrice")
        if price_value is None:
            price_value = payload.get("preferredPrice")
        if price_value is None:
            price_value = payload.get("signalPrice")
        price = ""
        if isinstance(price_value, (int, float)):
            price = f"{price_value:.3f}".rstrip("0").rstrip(".")
        elif price_value is not None:
            price = str(price_value)

        reason = str(payload.get("reason") or "")
        market = str(payload.get("marketSlug") or event.get("sessionId") or "")
        timestamp = str(event.get("timestamp") or "")
        event_type = str(event.get("type") or "")
        return (timestamp, event_type, side, price, reason, market)

    def _append_signal_line(self, raw_line: str) -> None:
        row = self._extract_signal_row(raw_line)
        if row is None:
            return
        item_id = self.signal_tree.insert("", "end", values=row)
        self.signal_rows.append(item_id)
        while len(self.signal_rows) > MAX_SIGNAL_ROWS:
            old_id = self.signal_rows.popleft()
            if self.signal_tree.exists(old_id):
                self.signal_tree.delete(old_id)
        if self.signal_rows:
            self.signal_tree.see(self.signal_rows[-1])

    def _load_signal_history(self) -> None:
        self.signal_tree.delete(*self.signal_tree.get_children())
        self.signal_rows.clear()
        if not TELEMETRY_DB_PATH.exists():
            self.output_queue.put(f"Signal feed file not found yet: {TELEMETRY_DB_PATH}\n")
            self.signal_file_offset = 0
            return

        for raw_line in self._tail_lines(TELEMETRY_DB_PATH, SIGNAL_HISTORY_LINES):
            self._append_signal_line(raw_line)

        self.signal_file_offset = TELEMETRY_DB_PATH.stat().st_size

    def _reload_signal_feed(self) -> None:
        self._load_signal_history()
        self.output_queue.put("Reloaded signal feed from telemetry history\n")

    def _poll_signal_feed(self) -> None:
        try:
            if TELEMETRY_DB_PATH.exists():
                current_size = TELEMETRY_DB_PATH.stat().st_size
                if current_size < self.signal_file_offset:
                    self._load_signal_history()
                elif current_size > self.signal_file_offset:
                    with TELEMETRY_DB_PATH.open("r", encoding="utf-8", errors="replace") as handle:
                        handle.seek(self.signal_file_offset)
                        for raw_line in handle:
                            self._append_signal_line(raw_line)
                        self.signal_file_offset = handle.tell()
        except OSError as error:
            self.output_queue.put(f"Signal feed poll failed: {error}\n")
        self.root.after(SIGNAL_REFRESH_MS, self._poll_signal_feed)

    def load_current_env(self) -> None:
        source = ENV_PATH if ENV_PATH.exists() else EXAMPLE_ENV_PATH
        values = load_env_file(source)
        for key, var in self.vars.items():
            if key in SECRET_ENV_KEYS and not allow_dotenv_secrets(values):
                var.set("")
            else:
                var.set(values.get(key, ""))
        self.output_queue.put(f"Loaded non-secret values from {source}\n")

    def save_current_env(self) -> None:
        values = {key: var.get().strip() for key, var in self.vars.items()}
        save_env_file(ENV_PATH, values)
        self.output_queue.put(f"Saved non-secret .env settings to {ENV_PATH}\n")
        messagebox.showinfo("Saved", f"Saved non-secret environment settings to\n{ENV_PATH}")

    def clear_api_creds(self) -> None:
        self.vars["POLYMARKET_API_KEY"].set("")
        self.vars["POLYMARKET_API_SECRET"].set("")
        self.vars["POLYMARKET_API_PASSPHRASE"].set("")
        self.save_current_env()
        self.output_queue.put("Cleared manual API credentials from the form and .env\n")

    def pick_node_exe(self) -> None:
        selected = filedialog.askopenfilename(
            title="Select node.exe",
            filetypes=[("Node executable", "node.exe"), ("Executables", "*.exe"), ("All files", "*.*")],
        )
        if selected:
            self.vars["NODE_EXE"].set(selected)

    def _run_subprocess(self, label: str, args: list[str], cwd: Path, env: dict[str, str], on_complete) -> subprocess.Popen[str]:
        creationflags = 0
        if os.name == "nt":
            creationflags = subprocess.CREATE_NO_WINDOW

        proc = subprocess.Popen(
            args,
            cwd=str(cwd),
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            creationflags=creationflags,
        )

        def reader() -> None:
            assert proc.stdout is not None
            self.output_queue.put(f"\n[{label}] started\n")
            for line in proc.stdout:
                self.output_queue.put(f"[{label}] {line}")
            code = proc.wait()
            self.output_queue.put(f"[{label}] exited with code {code}\n")
            on_complete(proc, code)

        threading.Thread(target=reader, daemon=True).start()
        return proc

    def build_runtime_env(self) -> dict[str, str]:
        self.save_current_env()
        env = os.environ.copy()
        env.update({key: var.get().strip() for key, var in self.vars.items()})
        return env

    def run_connectivity_check(self) -> None:
        if self.connectivity_process and self.connectivity_process.poll() is None:
            messagebox.showwarning("Connectivity Check", "Connectivity check is already running.")
            return

        env = self.build_runtime_env()
        python_exe = sys.executable
        args = [python_exe, str(CONNECTIVITY_SCRIPT)]

        def on_complete(_proc: subprocess.Popen[str], _code: int) -> None:
            self.connectivity_process = None

        self.connectivity_process = self._run_subprocess(
            "connectivity",
            args,
            ROOT,
            env,
            on_complete,
        )

    def derive_api_creds(self) -> None:
        env = self.build_runtime_env()
        python_exe = sys.executable
        args = [python_exe, str(DERIVE_CREDS_SCRIPT)]

        creationflags = 0
        if os.name == "nt":
            creationflags = subprocess.CREATE_NO_WINDOW

        self.output_queue.put("\n[derive] starting API credential derivation\n")
        proc = subprocess.run(
            args,
            cwd=str(ROOT),
            env=env,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            creationflags=creationflags,
        )

        stdout = proc.stdout.strip()
        stderr = proc.stderr.strip()

        if stdout:
            self.output_queue.put(f"[derive] {stdout}\n")
        if stderr:
            self.output_queue.put(f"[derive] {stderr}\n")

        if proc.returncode != 0:
            messagebox.showerror(
                "Derive API Creds Failed",
                "Failed to derive credentials.\n\n"
                "Most likely causes are Cloudflare blocking the auth request,\n"
                "missing private key, or wrong funder address.",
            )
            return

        try:
            payload = json.loads(stdout)
        except json.JSONDecodeError:
            messagebox.showerror("Derive API Creds Failed", "Derivation did not return valid JSON.")
            return

        self.vars["PROXY_WALLET_ADDRESS"].set(payload.get("funder", self.vars["PROXY_WALLET_ADDRESS"].get().strip()))
        self.vars["POLYMARKET_API_KEY"].set(payload.get("apiKey", ""))
        self.vars["POLYMARKET_API_SECRET"].set(payload.get("secret", ""))
        self.vars["POLYMARKET_API_PASSPHRASE"].set(payload.get("passphrase", ""))
        self.save_current_env()
        messagebox.showinfo(
            "API Credentials Saved",
            "Derived Polymarket API credentials and kept them out of .env unless RABBITHAT_ALLOW_DOTENV_SECRETS=true.",
        )

    def start_bot(self) -> None:
        if self.bot_process and self.bot_process.poll() is None:
            messagebox.showwarning("Bot Running", "The bot is already running.")
            return

        env = self.build_runtime_env()
        npm_cmd = "npm.cmd" if os.name == "nt" else "npm"
        args = [npm_cmd, "run", "dev"]

        def on_complete(_proc: subprocess.Popen[str], _code: int) -> None:
            self.bot_process = None

        self.bot_process = self._run_subprocess("bot", args, ROOT, env, on_complete)

    def stop_bot(self) -> None:
        if not self.bot_process or self.bot_process.poll() is not None:
            messagebox.showinfo("Stop Bot", "The bot is not currently running.")
            return
        self.bot_process.terminate()
        self.output_queue.put("[bot] terminate requested\n")

    def open_log(self) -> None:
        if LOG_PATH.exists():
            webbrowser.open(LOG_PATH.resolve().as_uri())
        else:
            messagebox.showinfo("Open log.md", f"log.md does not exist yet:\n{LOG_PATH}")


def main() -> int:
    root = tk.Tk()
    BotGui(root)
    root.mainloop()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
