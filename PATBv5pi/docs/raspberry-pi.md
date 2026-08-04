# Raspberry Pi Port

This bot is a reasonable fit for a Raspberry Pi as a headless Node process.
The safest first target is:

- paper mode
- no local UI
- Linux file-based secret loading

## Recommended target

- Raspberry Pi 5 with 8 GB RAM preferred
- Raspberry Pi 4 with 4 GB RAM can work for paper mode
- 64-bit Raspberry Pi OS
- Node.js 20 or newer

## What already ports cleanly

- core bot runtime in `src/index.ts`
- websocket market feed in `src/feed/marketFeed.ts`
- Polymarket and Polygon integrations in `src/services/*`
- telemetry JSONL output

## What is Windows-specific today

- PowerShell SecretStore helpers in `scripts/*.ps1`
- Samba copy flow used by some review scripts
- browser-opening helpers for local UI/report flows

Those parts are not required for a Pi headless runtime.

## Pi runtime strategy

Use these files on the Pi:

- `scripts/get_secret_env.sh`
- `scripts/pi_run.sh`

The Linux secret script lets the existing `RABBITHAT_SECRET_COMMAND` flow keep working without PowerShell.

## Install steps

1. Install system packages:

```bash
sudo apt update
sudo apt install -y git build-essential python3
```

2. Install Node 20.

3. Copy the repo to the Pi.

4. Install dependencies:

```bash
cd PATBv5
npm install
```

5. Build:

```bash
npm run build
```

## Config files

Create `.env` for non-secret config. The `PATBv5pi` folder includes `.env.pi.example`.

For paper mode, no live API credentials are required.
Set `TELEMETRY_ROOT=/home/pi/PATBv5/polydb/telemetry` so telemetry always stays under the bot folder.
The paper-session client uses `pi_paper_run.sh`, which forces paper mode in the
process environment before the bot reads `.env`.

## First boot

Run paper mode first:

```bash
chmod +x scripts/get_secret_env.sh scripts/pi_paper_run.sh
./scripts/pi_paper_run.sh
```

## Systemd service example

Create `/etc/systemd/system/patbv5.service`:

```ini
[Unit]
Description=Polymarket Bot V5
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/PATBv5
Environment=NODE_ENV=production
Environment=TELEMETRY_ROOT=/home/pi/PATBv5/polydb/telemetry
Environment=PAPER_TRADING=true
Environment=BOT_ID=polymarket-bot-v5-pi-paper
ExecStart=/home/pi/PATBv5/scripts/pi_paper_run.sh
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable patbv5
sudo systemctl start patbv5
sudo journalctl -u patbv5 -f
```

## Suggested rollout

1. Boot the Pi in paper mode only.
2. Verify market feed stability and telemetry writes.
3. Verify Polymarket auth and Polygon RPC connectivity.
4. Only then consider enabling live trading.
