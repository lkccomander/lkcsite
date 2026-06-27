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

Create `.env` for non-secret config, for example:

```dotenv
PAPER_TRADING=1
UI_SERVER_ENABLED=0
RABBITHAT_SECRET_COMMAND=/home/pi/lkcsite/PATBv5/scripts/get_secret_env.sh
PI_SECRETS_FILE=/home/pi/lkcsite/PATBv5/.env.pi.secrets
POLYGON_RPC_URL=https://your-rpc-url
POLYMARKET_SIGNATURE_TYPE=3
POLYMARKET_FUNDER_ADDRESS=0xYourDepositWallet
COLLATERAL_GUARD_ENABLED=1
```

Create `.env.pi.secrets` for secrets:

```dotenv
POLYMARKET_PRIVATE_KEY=0x...
POLYMARKET_API_KEY=...
POLYMARKET_API_SECRET=...
POLYMARKET_API_PASSPHRASE=...
```

## First boot

Run paper mode first:

```bash
chmod +x scripts/get_secret_env.sh scripts/pi_run.sh
./scripts/pi_run.sh
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
WorkingDirectory=/home/pi/lkcsite/PATBv5
Environment=NODE_ENV=production
ExecStart=/home/pi/lkcsite/PATBv5/scripts/pi_run.sh
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

## Expected limitations

- live trading should wait until paper mode is stable on the Pi
- the React UI should be treated as optional
- review scripts that depend on Windows shares or PowerShell should stay off the Pi

## Suggested rollout

1. Boot the Pi in paper mode only.
2. Verify market feed stability and telemetry writes.
3. Verify Polymarket auth and Polygon RPC connectivity.
4. Only then consider enabling live trading.
