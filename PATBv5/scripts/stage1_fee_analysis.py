#!/usr/bin/env python3
"""
Stage 1: Telemetry Analysis on PostgreSQL
=========================================

V2 adaptation of the original SQLite-oriented research script.
Instead of building a separate SQLite database, this script reads the
current telemetry already imported into the `rabbithat` PostgreSQL database
and materializes Stage 1 analysis tables back into that same database.

Outputs:
  - stage1_sessions
  - stage1_trades
  - stage1_market_snapshots
  - stage1_market_windows
  - stage1_market_outcomes
  - stage1_fee_analysis

Usage:
  python stage1_fee_analysis.py
  python stage1_fee_analysis.py --bot-id polymarket-bot-v2
  python stage1_fee_analysis.py --all-bots --include-legacy
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
from collections import defaultdict
from datetime import datetime
from pathlib import Path

from secret_utils import load_env_file, read_optional_secret


WORKSPACE_ROOT = Path(__file__).resolve().parents[2]
POLYDB_POSTGRES_ROOT = WORKSPACE_ROOT / "polydb" / "postgres"
ENV_PATH = POLYDB_POSTGRES_ROOT / ".env"

DEFAULT_WINDOWS_PSQL = r"C:\Program Files\PostgreSQL\18\bin\psql.exe"
DEFAULT_WSL_PSQL = "/mnt/c/Program Files/PostgreSQL/18/bin/psql.exe"

SCHEMA_SQL = """
create table if not exists stage1_sessions (
    session_id text primary key,
    bot_id text,
    strategy text,
    mode text,
    start_balance numeric(18, 6),
    end_balance numeric(18, 6),
    return_pct numeric(10, 4),
    reported_realized_pnl numeric(18, 6),
    started_at timestamptz,
    ended_at timestamptz
);

create table if not exists stage1_trades (
    trade_id bigserial primary key,
    session_id text not null,
    bot_id text,
    market_slug text,
    side text,
    token_id text,
    price_entry numeric(18, 6),
    usd_risked numeric(18, 6),
    shares numeric(18, 12),
    fee_usd_entry numeric(18, 6),
    fee_usd_exit numeric(18, 6),
    fee_pct_entry numeric(18, 12),
    price_exit numeric(18, 6),
    proceeds_exit numeric(18, 6),
    ts_buy timestamptz,
    ts_sell timestamptz,
    window_end bigint,
    secs_before_close numeric(18, 6),
    gross_pnl numeric(18, 6),
    net_pnl numeric(18, 6)
);

create table if not exists stage1_market_snapshots (
    snap_id bigserial primary key,
    session_id text not null,
    bot_id text,
    market_slug text,
    balance numeric(18, 6),
    reason text,
    ts timestamptz
);

create table if not exists stage1_market_windows (
    session_id text not null,
    market_slug text not null,
    bot_id text,
    window_start bigint,
    window_end bigint,
    ts_selected timestamptz,
    primary key (session_id, market_slug)
);

create table if not exists stage1_fee_analysis (
    session_id text primary key,
    bot_id text,
    total_gross_pnl numeric(18, 6),
    total_fee_usd numeric(18, 6),
    total_net_pnl numeric(18, 6),
    trade_count integer,
    avg_entry_price numeric(18, 6),
    avg_fee_pct numeric(18, 12)
);

create table if not exists stage1_market_outcomes (
    market_slug text not null,
    side text not null,
    bot_id text,
    session_count integer,
    trade_count integer,
    win_count integer,
    loss_count integer,
    flat_count integer,
    avg_entry_price numeric(18, 6),
    avg_secs_before_close numeric(18, 6),
    total_usd_risked numeric(18, 6),
    total_gross_pnl numeric(18, 6),
    total_fee_usd numeric(18, 6),
    total_net_pnl numeric(18, 6),
    avg_gross_pnl numeric(18, 6),
    avg_net_pnl numeric(18, 6),
    primary key (market_slug, side, bot_id)
);

create index if not exists stage1_trades_session_idx on stage1_trades (session_id);
create index if not exists stage1_trades_bot_idx on stage1_trades (bot_id);
create index if not exists stage1_trades_slug_idx on stage1_trades (market_slug);
create index if not exists stage1_market_snapshots_session_idx on stage1_market_snapshots (session_id);
create index if not exists stage1_market_windows_bot_idx on stage1_market_windows (bot_id);
create index if not exists stage1_market_outcomes_bot_idx on stage1_market_outcomes (bot_id);
"""


def is_windows() -> bool:
    return os.name == "nt"


def default_psql_path() -> str:
    return DEFAULT_WINDOWS_PSQL if is_windows() else DEFAULT_WSL_PSQL


def env_value(name: str, default: str) -> str:
    return os.environ.get(name, default).strip()


def psql_path() -> str:
    return os.environ.get("POSTGRES_PSQL_PATH", "").strip() or default_psql_path()


def pg_env() -> dict:
    child_env = os.environ.copy()
    password = read_optional_secret("POSTGRES_PASSWORD")
    if password:
        child_env["PGPASSWORD"] = password
    return child_env


def parse_iso(ts_str: str | None) -> datetime | None:
    if not ts_str:
        return None
    try:
        return datetime.fromisoformat(str(ts_str).replace("Z", "+00:00"))
    except Exception:
        return None


def parse_ts_millis(ts_str: str | None) -> int:
    dt = parse_iso(ts_str)
    return int(dt.timestamp() * 1000) if dt else 0


def round2(value: float) -> float:
    return round(value + 1e-9, 2)


def sql_quote(value) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    text = str(value).replace("'", "''")
    return f"'{text}'"


def query_json(sql: str):
    args = [
        psql_path(),
        "-h",
        env_value("POSTGRES_HOST", "localhost"),
        "-p",
        env_value("POSTGRES_PORT", "5432"),
        "-U",
        env_value("POSTGRES_USER", "postgres"),
        "-d",
        env_value("POSTGRES_DB", "rabbithat"),
        "-At",
        "-c",
        sql,
    ]
    proc = subprocess.run(args, capture_output=True, text=True, env=pg_env())
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or f"psql exit code {proc.returncode}")
    raw = proc.stdout.strip()
    return json.loads(raw) if raw else None


def run_sql(sql_text: str) -> None:
    with tempfile.NamedTemporaryFile("w", suffix=".sql", delete=False, encoding="utf-8") as handle:
        handle.write(sql_text)
        temp_sql_path = handle.name

    try:
        args = [
            psql_path(),
            "-h",
            env_value("POSTGRES_HOST", "localhost"),
            "-p",
            env_value("POSTGRES_PORT", "5432"),
            "-U",
            env_value("POSTGRES_USER", "postgres"),
            "-d",
            env_value("POSTGRES_DB", "rabbithat"),
            "-v",
            "ON_ERROR_STOP=1",
            "-f",
            temp_sql_path,
        ]
        proc = subprocess.run(args, capture_output=True, text=True, env=pg_env())
        if proc.returncode != 0:
            raise RuntimeError(proc.stderr.strip() or f"psql exit code {proc.returncode}")
    finally:
        try:
            os.unlink(temp_sql_path)
        except OSError:
            pass


def taker_fee_usd(price: float, trade_usd: float) -> float:
    if price <= 0 or price >= 1:
        return 0.0
    return trade_usd * 0.072 * (1 - price)


def taker_fee_pct(price: float) -> float:
    if price <= 0 or price >= 1:
        return 0.0
    return 0.072 * (1 - price)


def load_events(bot_id: str | None, include_legacy: bool) -> list[dict]:
    filters: list[str] = []
    if bot_id:
        filters.append(f"derived_bot_id = {sql_quote(bot_id)}")
    if not include_legacy:
        filters.append("coalesce(session_id, 'legacy-no-session') <> 'legacy-no-session'")
    where = f"where {' and '.join(filters)}" if filters else ""
    sql = f"""
    select coalesce(json_agg(row_to_json(t)), '[]'::json)
    from (
      select
        id,
        event_type,
        event_timestamp,
        derived_bot_id as bot_id,
        session_id,
        session_started_at,
        payload
      from (
        select
          id,
          event_type,
          event_timestamp,
          coalesce(
            raw_event->>'botId',
            payload->>'botId',
            case
              when lower(coalesce(payload->>'botName', '')) like '%v2%' then 'polymarket-bot-v2'
              when event_type = 'bot.startup' then 'polymarket-bot-v1-legacy'
              else null
            end
          ) as derived_bot_id,
          session_id,
          session_started_at,
          payload
        from telemetry_events
      ) events
      {where}
      order by event_timestamp asc, id asc
    ) t;
    """
    rows = query_json(sql)
    return rows if isinstance(rows, list) else []


def load_imported_sessions(bot_id: str | None, include_legacy: bool) -> list[dict]:
    filters: list[str] = []
    if bot_id:
        filters.append(f"derived_bot_id = {sql_quote(bot_id)}")
    if not include_legacy:
        filters.append("coalesce(session_id, 'legacy-no-session') <> 'legacy-no-session'")
    where = f"where {' and '.join(filters)}" if filters else ""
    sql = f"""
    select coalesce(json_agg(row_to_json(t)), '[]'::json)
    from (
      select
        session_id,
        derived_bot_id as bot_id,
        strategy,
        mode,
        start_balance,
        ending_balance,
        return_pct,
        realized_trade_pnl,
        session_started_at
      from (
        select
          s.session_id,
          coalesce(
            startup.inferred_bot_id,
            case
              when s.strategy is not null then 'polymarket-bot-v1-legacy'
              else null
            end
          ) as derived_bot_id,
          s.strategy,
          s.mode,
          s.start_balance,
          s.ending_balance,
          s.return_pct,
          s.realized_trade_pnl,
          s.session_started_at
        from sessions s
        left join (
          select
            session_id,
            coalesce(
              raw_event->>'botId',
              payload->>'botId',
              case
                when lower(coalesce(payload->>'botName', '')) like '%v2%' then 'polymarket-bot-v2'
                when event_type = 'bot.startup' then 'polymarket-bot-v1-legacy'
                else null
              end
            ) as inferred_bot_id
          from telemetry_events
          where event_type = 'bot.startup'
        ) startup on startup.session_id = s.session_id
      ) sessions_with_bot
      {where}
      order by session_started_at asc nulls last, session_id asc
    ) t;
    """
    rows = query_json(sql)
    return rows if isinstance(rows, list) else []


class Stage1Analyzer:
    def __init__(self, bot_id: str | None, imported_sessions: list[dict], debug_session_id: str | None = None):
        self.bot_id = bot_id
        self.debug_session_id = debug_session_id
        self.sessions: dict[str, dict] = {}
        self.market_windows: list[dict] = []
        self.market_snapshots: list[dict] = []
        self.trades: list[dict] = []
        self.market_outcomes: list[dict] = []
        self.fee_analysis: list[dict] = []
        self.debug_event_counts: dict[str, int] = defaultdict(int)
        self.debug_trade_counts = {
            "paired": 0,
            "buy_only": 0,
            "sell_only": 0,
        }
        self._seed_sessions(imported_sessions)

    def _seed_sessions(self, imported_sessions: list[dict]) -> None:
        for row in imported_sessions:
            self.sessions[row["session_id"]] = {
                "session_id": row["session_id"],
                "bot_id": row.get("bot_id"),
                "strategy": row.get("strategy"),
                "mode": row.get("mode"),
                "start_balance": row.get("start_balance"),
                "end_balance": row.get("ending_balance"),
                "return_pct": row.get("return_pct"),
                "reported_realized_pnl": row.get("realized_trade_pnl"),
                "started_at": row.get("session_started_at"),
                "ended_at": None,
            }

    def session_row(self, session_id: str, bot_id: str | None) -> dict:
        row = self.sessions.get(session_id)
        if row is None:
            row = {
                "session_id": session_id,
                "bot_id": bot_id,
                "strategy": None,
                "mode": None,
                "start_balance": None,
                "end_balance": None,
                "return_pct": None,
                "reported_realized_pnl": None,
                "started_at": None,
                "ended_at": None,
            }
            self.sessions[session_id] = row
        elif bot_id and not row.get("bot_id"):
            row["bot_id"] = bot_id
        return row

    def analyze(self, events: list[dict]) -> None:
        open_buys: dict[str, dict] = {}
        latest_window_by_session: dict[str, dict] = {}

        for event in events:
            event_type = event.get("event_type")
            session_id = event.get("session_id") or "legacy-no-session"
            bot_id = event.get("bot_id")
            payload = event.get("payload") or {}
            timestamp = str(event.get("event_timestamp") or "")

            if self.debug_session_id and session_id == self.debug_session_id:
                self.debug_event_counts[str(event_type)] += 1

            session = self.session_row(session_id, bot_id)

            if event_type == "bot.startup":
                session["strategy"] = payload.get("strategy")
                session["mode"] = payload.get("mode")
                session["start_balance"] = payload.get("paperStartingUsd")
                session["started_at"] = timestamp

            elif event_type == "bot.shutdown":
                session["end_balance"] = payload.get("endingBalance")
                session["ended_at"] = timestamp

            elif event_type == "market.selected":
                window = {
                    "session_id": session_id,
                    "bot_id": bot_id,
                    "market_slug": payload.get("slug"),
                    "window_start": payload.get("windowStart"),
                    "window_end": payload.get("windowEnd"),
                    "ts_selected": timestamp,
                }
                latest_window_by_session[session_id] = window
                self.market_windows.append(window)

            elif event_type == "paper_balance.checkpoint":
                self.market_snapshots.append(
                    {
                        "session_id": session_id,
                        "bot_id": bot_id,
                        "market_slug": payload.get("slug"),
                        "balance": payload.get("balance"),
                        "reason": payload.get("reason"),
                        "ts": timestamp,
                    }
                )
                session["end_balance"] = payload.get("balance")

            elif event_type == "paper_trade.buy":
                token_id = payload.get("tokenId") or ""
                price = float(payload.get("price") or 0)
                usd = float(payload.get("usd") or 0)
                ts_buy_ms = parse_ts_millis(timestamp)
                latest_window = latest_window_by_session.get(session_id)
                window_end = latest_window.get("window_end") if latest_window else None
                secs_before_close = None
                if window_end is not None and ts_buy_ms:
                    secs_before_close = (float(window_end) * 1000 - ts_buy_ms) / 1000.0

                open_buys[f"{session_id}:{token_id}"] = {
                    "session_id": session_id,
                    "bot_id": bot_id,
                    "market_slug": latest_window.get("market_slug") if latest_window else None,
                    "side": payload.get("side"),
                    "token_id": token_id,
                    "price_entry": price,
                    "usd_risked": usd,
                    "shares": float(payload.get("shares") or 0),
                    "fee_usd_entry": taker_fee_usd(price, usd),
                    "fee_pct_entry": taker_fee_pct(price),
                    "ts_buy": timestamp,
                    "window_end": window_end,
                    "secs_before_close": secs_before_close,
                }

            elif event_type == "paper_trade.sell":
                token_id = payload.get("tokenId") or ""
                key = f"{session_id}:{token_id}"
                buy = open_buys.pop(key, None)
                price_exit = float(payload.get("price") or 0)
                proceeds = float(payload.get("proceeds") or 0)

                if buy:
                    fee_exit = taker_fee_usd(price_exit, proceeds)
                    gross_pnl = proceeds - float(buy["usd_risked"])
                    net_pnl = gross_pnl - float(buy["fee_usd_entry"]) - fee_exit
                    if self.debug_session_id and session_id == self.debug_session_id:
                        self.debug_trade_counts["paired"] += 1
                    self.trades.append(
                        {
                            **buy,
                            "price_exit": price_exit,
                            "proceeds_exit": proceeds,
                            "ts_sell": timestamp,
                            "fee_usd_exit": fee_exit,
                            "gross_pnl": gross_pnl,
                            "net_pnl": net_pnl,
                        }
                    )
                else:
                    if self.debug_session_id and session_id == self.debug_session_id:
                        self.debug_trade_counts["sell_only"] += 1
                    self.trades.append(
                        {
                            "session_id": session_id,
                            "bot_id": bot_id,
                            "market_slug": latest_window_by_session.get(session_id, {}).get("market_slug"),
                            "side": payload.get("side"),
                            "token_id": token_id,
                            "price_entry": None,
                            "usd_risked": None,
                            "shares": None,
                            "fee_usd_entry": None,
                            "fee_pct_entry": None,
                            "ts_buy": None,
                            "window_end": None,
                            "secs_before_close": None,
                            "price_exit": price_exit,
                            "proceeds_exit": proceeds,
                            "ts_sell": timestamp,
                            "fee_usd_exit": taker_fee_usd(price_exit, proceeds),
                            "gross_pnl": None,
                            "net_pnl": None,
                        }
                    )

        for buy in open_buys.values():
            if self.debug_session_id and buy.get("session_id") == self.debug_session_id:
                self.debug_trade_counts["buy_only"] += 1
            self.trades.append(
                {
                    **buy,
                    "price_exit": None,
                    "proceeds_exit": None,
                    "ts_sell": None,
                    "fee_usd_exit": None,
                    "gross_pnl": None,
                    "net_pnl": None,
                }
            )

        for session in self.sessions.values():
            if session["start_balance"] not in {None, 0} and session["end_balance"] is not None:
                session["return_pct"] = round2(
                    ((float(session["end_balance"]) - float(session["start_balance"])) / float(session["start_balance"])) * 100
                )

        grouped_trades: dict[str, list[dict]] = defaultdict(list)
        for trade in self.trades:
            grouped_trades[trade["session_id"]].append(trade)

        for session_id, trades in grouped_trades.items():
            priced_trades = [trade for trade in trades if trade.get("price_entry") is not None]
            if not priced_trades:
                continue
            total_gross = sum(float(trade.get("gross_pnl") or 0) for trade in priced_trades)
            total_fees = sum(float(trade.get("fee_usd_entry") or 0) + float(trade.get("fee_usd_exit") or 0) for trade in priced_trades)
            total_net = sum(float(trade.get("net_pnl") or 0) for trade in priced_trades)
            self.fee_analysis.append(
                {
                    "session_id": session_id,
                    "bot_id": self.sessions.get(session_id, {}).get("bot_id"),
                    "total_gross_pnl": total_gross,
                    "total_fee_usd": total_fees,
                    "total_net_pnl": total_net,
                    "trade_count": len(priced_trades),
                    "avg_entry_price": sum(float(trade["price_entry"]) for trade in priced_trades) / len(priced_trades),
                    "avg_fee_pct": sum(float(trade["fee_pct_entry"]) for trade in priced_trades) / len(priced_trades),
                }
            )

        grouped_markets: dict[tuple[str, str, str | None], list[dict]] = defaultdict(list)
        for trade in self.trades:
            if trade.get("price_entry") is None:
                continue
            market_slug = trade.get("market_slug")
            side = trade.get("side")
            if not market_slug or not side:
                continue
            grouped_markets[(str(market_slug), str(side), trade.get("bot_id"))].append(trade)

        for (market_slug, side, bot_id), trades in grouped_markets.items():
            session_ids = {str(trade["session_id"]) for trade in trades if trade.get("session_id")}
            win_count = sum(1 for trade in trades if float(trade.get("net_pnl") or 0) > 0)
            loss_count = sum(1 for trade in trades if float(trade.get("net_pnl") or 0) < 0)
            flat_count = len(trades) - win_count - loss_count
            total_gross = sum(float(trade.get("gross_pnl") or 0) for trade in trades)
            total_fees = sum(float(trade.get("fee_usd_entry") or 0) + float(trade.get("fee_usd_exit") or 0) for trade in trades)
            total_net = sum(float(trade.get("net_pnl") or 0) for trade in trades)
            self.market_outcomes.append(
                {
                    "market_slug": market_slug,
                    "side": side,
                    "bot_id": bot_id,
                    "session_count": len(session_ids),
                    "trade_count": len(trades),
                    "win_count": win_count,
                    "loss_count": loss_count,
                    "flat_count": flat_count,
                    "avg_entry_price": sum(float(trade.get("price_entry") or 0) for trade in trades) / len(trades),
                    "avg_secs_before_close": sum(float(trade.get("secs_before_close") or 0) for trade in trades if trade.get("secs_before_close") is not None) / max(1, sum(1 for trade in trades if trade.get("secs_before_close") is not None)),
                    "total_usd_risked": sum(float(trade.get("usd_risked") or 0) for trade in trades),
                    "total_gross_pnl": total_gross,
                    "total_fee_usd": total_fees,
                    "total_net_pnl": total_net,
                    "avg_gross_pnl": total_gross / len(trades),
                    "avg_net_pnl": total_net / len(trades),
                }
            )

    def persist(self) -> None:
        statements = ["begin;", SCHEMA_SQL]
        statements.extend(
            [
                "delete from stage1_fee_analysis;",
                "delete from stage1_market_outcomes;",
                "delete from stage1_trades;",
                "delete from stage1_market_snapshots;",
                "delete from stage1_market_windows;",
                "delete from stage1_sessions;",
            ]
        )

        for row in self.sessions.values():
            statements.append(
                "insert into stage1_sessions (session_id, bot_id, strategy, mode, start_balance, end_balance, return_pct, reported_realized_pnl, started_at, ended_at) values ({session_id}, {bot_id}, {strategy}, {mode}, {start_balance}, {end_balance}, {return_pct}, {reported_realized_pnl}, {started_at}, {ended_at});".format(
                    session_id=sql_quote(row["session_id"]),
                    bot_id=sql_quote(row["bot_id"]),
                    strategy=sql_quote(row["strategy"]),
                    mode=sql_quote(row["mode"]),
                    start_balance=sql_quote(row["start_balance"]),
                    end_balance=sql_quote(row["end_balance"]),
                    return_pct=sql_quote(row["return_pct"]),
                    reported_realized_pnl=sql_quote(row["reported_realized_pnl"]),
                    started_at=sql_quote(row["started_at"]),
                    ended_at=sql_quote(row["ended_at"]),
                )
            )

        for row in self.market_windows:
            statements.append(
                "insert into stage1_market_windows (session_id, market_slug, bot_id, window_start, window_end, ts_selected) values ({session_id}, {market_slug}, {bot_id}, {window_start}, {window_end}, {ts_selected}) on conflict (session_id, market_slug) do update set bot_id = excluded.bot_id, window_start = excluded.window_start, window_end = excluded.window_end, ts_selected = excluded.ts_selected;".format(
                    session_id=sql_quote(row["session_id"]),
                    market_slug=sql_quote(row["market_slug"]),
                    bot_id=sql_quote(row["bot_id"]),
                    window_start=sql_quote(row["window_start"]),
                    window_end=sql_quote(row["window_end"]),
                    ts_selected=sql_quote(row["ts_selected"]),
                )
            )

        for row in self.market_snapshots:
            statements.append(
                "insert into stage1_market_snapshots (session_id, bot_id, market_slug, balance, reason, ts) values ({session_id}, {bot_id}, {market_slug}, {balance}, {reason}, {ts});".format(
                    session_id=sql_quote(row["session_id"]),
                    bot_id=sql_quote(row["bot_id"]),
                    market_slug=sql_quote(row["market_slug"]),
                    balance=sql_quote(row["balance"]),
                    reason=sql_quote(row["reason"]),
                    ts=sql_quote(row["ts"]),
                )
            )

        for row in self.trades:
            statements.append(
                "insert into stage1_trades (session_id, bot_id, market_slug, side, token_id, price_entry, usd_risked, shares, fee_usd_entry, fee_usd_exit, fee_pct_entry, price_exit, proceeds_exit, ts_buy, ts_sell, window_end, secs_before_close, gross_pnl, net_pnl) values ({session_id}, {bot_id}, {market_slug}, {side}, {token_id}, {price_entry}, {usd_risked}, {shares}, {fee_usd_entry}, {fee_usd_exit}, {fee_pct_entry}, {price_exit}, {proceeds_exit}, {ts_buy}, {ts_sell}, {window_end}, {secs_before_close}, {gross_pnl}, {net_pnl});".format(
                    session_id=sql_quote(row["session_id"]),
                    bot_id=sql_quote(row["bot_id"]),
                    market_slug=sql_quote(row["market_slug"]),
                    side=sql_quote(row["side"]),
                    token_id=sql_quote(row["token_id"]),
                    price_entry=sql_quote(row["price_entry"]),
                    usd_risked=sql_quote(row["usd_risked"]),
                    shares=sql_quote(row["shares"]),
                    fee_usd_entry=sql_quote(row["fee_usd_entry"]),
                    fee_usd_exit=sql_quote(row["fee_usd_exit"]),
                    fee_pct_entry=sql_quote(row["fee_pct_entry"]),
                    price_exit=sql_quote(row["price_exit"]),
                    proceeds_exit=sql_quote(row["proceeds_exit"]),
                    ts_buy=sql_quote(row["ts_buy"]),
                    ts_sell=sql_quote(row["ts_sell"]),
                    window_end=sql_quote(row["window_end"]),
                    secs_before_close=sql_quote(row["secs_before_close"]),
                    gross_pnl=sql_quote(row["gross_pnl"]),
                    net_pnl=sql_quote(row["net_pnl"]),
                )
            )

        for row in self.fee_analysis:
            statements.append(
                "insert into stage1_fee_analysis (session_id, bot_id, total_gross_pnl, total_fee_usd, total_net_pnl, trade_count, avg_entry_price, avg_fee_pct) values ({session_id}, {bot_id}, {total_gross_pnl}, {total_fee_usd}, {total_net_pnl}, {trade_count}, {avg_entry_price}, {avg_fee_pct});".format(
                    session_id=sql_quote(row["session_id"]),
                    bot_id=sql_quote(row["bot_id"]),
                    total_gross_pnl=sql_quote(row["total_gross_pnl"]),
                    total_fee_usd=sql_quote(row["total_fee_usd"]),
                    total_net_pnl=sql_quote(row["total_net_pnl"]),
                    trade_count=sql_quote(row["trade_count"]),
                    avg_entry_price=sql_quote(row["avg_entry_price"]),
                    avg_fee_pct=sql_quote(row["avg_fee_pct"]),
                )
            )

        for row in self.market_outcomes:
            statements.append(
                "insert into stage1_market_outcomes (market_slug, side, bot_id, session_count, trade_count, win_count, loss_count, flat_count, avg_entry_price, avg_secs_before_close, total_usd_risked, total_gross_pnl, total_fee_usd, total_net_pnl, avg_gross_pnl, avg_net_pnl) values ({market_slug}, {side}, {bot_id}, {session_count}, {trade_count}, {win_count}, {loss_count}, {flat_count}, {avg_entry_price}, {avg_secs_before_close}, {total_usd_risked}, {total_gross_pnl}, {total_fee_usd}, {total_net_pnl}, {avg_gross_pnl}, {avg_net_pnl});".format(
                    market_slug=sql_quote(row["market_slug"]),
                    side=sql_quote(row["side"]),
                    bot_id=sql_quote(row["bot_id"]),
                    session_count=sql_quote(row["session_count"]),
                    trade_count=sql_quote(row["trade_count"]),
                    win_count=sql_quote(row["win_count"]),
                    loss_count=sql_quote(row["loss_count"]),
                    flat_count=sql_quote(row["flat_count"]),
                    avg_entry_price=sql_quote(row["avg_entry_price"]),
                    avg_secs_before_close=sql_quote(row["avg_secs_before_close"]),
                    total_usd_risked=sql_quote(row["total_usd_risked"]),
                    total_gross_pnl=sql_quote(row["total_gross_pnl"]),
                    total_fee_usd=sql_quote(row["total_fee_usd"]),
                    total_net_pnl=sql_quote(row["total_net_pnl"]),
                    avg_gross_pnl=sql_quote(row["avg_gross_pnl"]),
                    avg_net_pnl=sql_quote(row["avg_net_pnl"]),
                )
            )

        statements.append("commit;")
        run_sql("\n".join(statements) + "\n")

    def print_report(self) -> None:
        print("\n" + "=" * 72)
        print("STAGE 1 ANALYSIS — Fee-Adjusted PnL by Session")
        print("=" * 72)
        if self.bot_id:
            print(f"Bot filter: {self.bot_id}")
            print("-" * 72)
        print(f"{'Session':<38} {'Gross':>8} {'Fees':>7} {'Net PnL':>8} {'Trades':>7}")
        print("-" * 72)

        totals = {"gross": 0.0, "fees": 0.0, "net": 0.0, "trades": 0}
        fee_by_session = {row["session_id"]: row for row in self.fee_analysis}

        ordered_sessions = sorted(
            self.sessions.values(),
            key=lambda row: (row.get("started_at") or "", row["session_id"]),
        )

        for session in ordered_sessions:
            fee_row = fee_by_session.get(session["session_id"], {})
            gross = float(fee_row.get("total_gross_pnl") or 0)
            fees = float(fee_row.get("total_fee_usd") or 0)
            net = float(fee_row.get("total_net_pnl") or 0)
            trade_count = int(fee_row.get("trade_count") or 0)
            print(f"  {session['session_id'][:36]:<36} {gross:>+8.2f} {fees:>7.3f} {net:>+8.2f} {trade_count:>7}")
            totals["gross"] += gross
            totals["fees"] += fees
            totals["net"] += net
            totals["trades"] += trade_count

        print("-" * 72)
        print(f"  {'TOTAL':<36} {totals['gross']:>+8.2f} {totals['fees']:>7.3f} {totals['net']:>+8.2f} {totals['trades']:>7}")

        print("\n" + "=" * 72)
        print("ENTRY TIMING DISTRIBUTION (secs before window close)")
        print("=" * 72)
        buckets = {
            "unknown": [],
            "<10s  (last-second)": [],
            "10-30s": [],
            "30-60s": [],
            ">60s": [],
        }
        for trade in self.trades:
            if trade.get("price_entry") is None:
                continue
            secs = trade.get("secs_before_close")
            if secs is None:
                bucket = "unknown"
            elif secs < 10:
                bucket = "<10s  (last-second)"
            elif secs < 30:
                bucket = "10-30s"
            elif secs < 60:
                bucket = "30-60s"
            else:
                bucket = ">60s"
            buckets[bucket].append(trade)

        print(f"  {'Bucket':<22} {'Trades':>7} {'Avg Gross':>10} {'Avg Net':>10}")
        print("-" * 54)
        for bucket, trades in sorted(buckets.items(), key=lambda item: len(item[1]), reverse=True):
            if trades:
                avg_gross = sum(float(trade.get("gross_pnl") or 0) for trade in trades) / len(trades)
                avg_net = sum(float(trade.get("net_pnl") or 0) for trade in trades) / len(trades)
                gross_label = f"{avg_gross:+10.3f}"
                net_label = f"{avg_net:+10.3f}"
            else:
                gross_label = "       n/a"
                net_label = "       n/a"
            print(f"  {bucket:<22} {len(trades):>7} {gross_label:>10} {net_label:>10}")

        print("\n" + "=" * 72)
        print("FEE CURVE: cost at observed entry prices")
        print("=" * 72)
        print(f"  {'Price':>8}  {'Fee % of trade':>16}  {'Fee on $2 trade':>16}")
        print("-" * 46)
        for price in [0.50, 0.60, 0.70, 0.75, 0.80, 0.85, 0.90, 0.95]:
            pct = taker_fee_pct(price) * 100
            usd = taker_fee_usd(price, 2.0)
            print(f"  {price:>8.2f}  {pct:>15.4f}%  ${usd:>15.5f}")

        print("\n" + "=" * 72)
        print("TOP MARKET OUTCOMES BY NET PNL")
        print("=" * 72)
        top_markets = sorted(
            self.market_outcomes,
            key=lambda row: (float(row.get("total_net_pnl") or 0), float(row.get("total_gross_pnl") or 0)),
            reverse=True,
        )[:10]
        print(f"  {'Market':<26} {'Side':<6} {'Trades':>6} {'Wins':>5} {'Net':>9} {'Avg Net':>9}")
        print("-" * 72)
        for row in top_markets:
            market_label = str(row["market_slug"])[:26]
            print(
                f"  {market_label:<26} {str(row['side']):<6} {int(row['trade_count']):>6} {int(row['win_count']):>5} "
                f"{float(row['total_net_pnl']):>+9.3f} {float(row['avg_net_pnl']):>+9.3f}"
            )

        print("\nTables saved in Postgres:")
        print("  stage1_sessions")
        print("  stage1_trades")
        print("  stage1_market_snapshots")
        print("  stage1_market_windows")
        print("  stage1_market_outcomes")
        print("  stage1_fee_analysis")

        if self.debug_session_id:
            self.print_debug_session()

    def print_debug_session(self) -> None:
        session = self.sessions.get(self.debug_session_id)
        session_trades = [trade for trade in self.trades if trade.get("session_id") == self.debug_session_id]
        priced_trades = [trade for trade in session_trades if trade.get("price_entry") is not None]

        print("\n" + "=" * 72)
        print(f"DEBUG SESSION — {self.debug_session_id}")
        print("=" * 72)
        print(f"Imported session present: {'yes' if session else 'no'}")
        if session:
            print(f"Session bot_id: {session.get('bot_id')}")
            print(f"Session strategy: {session.get('strategy')}")
            print(f"Session mode: {session.get('mode')}")
            print(f"Session started_at: {session.get('started_at')}")
            print(f"Session ended_at: {session.get('ended_at')}")
        print(f"Event counts: {dict(sorted(self.debug_event_counts.items()))}")
        print(f"Trade counts: {self.debug_trade_counts}")
        print(f"Trades built for session: {len(session_trades)}")
        print(f"Priced trades for session: {len(priced_trades)}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Build Stage 1 fee analysis tables from PostgreSQL telemetry.")
    parser.add_argument("--bot-id", default="polymarket-bot-v2", help="Bot filter. Defaults to polymarket-bot-v2.")
    parser.add_argument("--all-bots", action="store_true", help="Analyze all bots instead of defaulting to V2 only.")
    parser.add_argument("--include-legacy", action="store_true", help="Include legacy-no-session telemetry in the analysis.")
    parser.add_argument("--debug-session", help="Print detailed load/pairing diagnostics for a single session ID.")
    args = parser.parse_args()

    load_env_file(ENV_PATH)

    selected_bot_id = None if args.all_bots else args.bot_id

    events = load_events(selected_bot_id, args.include_legacy)
    if not events:
        print("No telemetry events found for the selected filter.")
        return 0

    imported_sessions = load_imported_sessions(selected_bot_id, args.include_legacy)
    analyzer = Stage1Analyzer(selected_bot_id, imported_sessions, args.debug_session)
    analyzer.analyze(events)
    analyzer.persist()
    analyzer.print_report()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
