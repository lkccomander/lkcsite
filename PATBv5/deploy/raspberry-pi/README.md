# Raspberry Pi Deployment For PATBv5

This folder recreates the old Raspberry Pi deployment pattern for `PATBv5`, updated for the current repo layout.

Recommended target:

- Raspberry Pi OS 64-bit
- Node.js 20 or newer
- `git`
- `build-essential`

Important repo layout note:

- `PATBv5` writes telemetry to `../polydb/telemetry` relative to the bot folder.
- On the Pi, keep the same workspace shape:

```text
/home/pi/lkcsite/
  PATBv5/
  polydb/
```

If you clone or copy only `PATBv5` by itself, telemetry will not land in the expected sibling `polydb` path.

## 1. Install system packages on the Pi

```bash
sudo apt update
sudo apt install -y git curl build-essential
```

Install Node.js 20:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

Verify:

```bash
node -v
npm -v
```

## 2. Copy or clone the workspace

Recommended structure:

```bash
cd ~
mkdir -p lkcsite
cd lkcsite
git clone <your-repo-url> .
```

If you are copying manually from Windows, keep at least:

```text
/home/pi/lkcsite/PATBv5
/home/pi/lkcsite/polydb
```

## 3. Install dependencies and build

```bash
cd ~/lkcsite/PATBv5
npm install
npm run build
```

## 4. Create runtime files

Create or edit:

```text
~/lkcsite/PATBv5/.env
```

Suggested paper-mode starting point:

```env
PAPER_TRADING=true
PAPER_STARTING_USD=100
BOT_ID=polymarket-bot-v5-pi
POLYMARKET_SIGNATURE_TYPE=2
RABBITHAT_SECRET_COMMAND=
RABBITHAT_SECRET_PREFIX=
RABBITHAT_ALLOW_DOTENV_SECRETS=false
PROXY_WALLET_ADDRESS=unused_in_paper_mode
COLLATERAL_GUARD_ENABLED=true
COLLATERAL_GUARD_POLL_MS=2500
COLLATERAL_GUARD_CONFIRMATION_BLOCKS=3
COLLATERAL_GUARD_MAX_BLOCK_RANGE=2
COLLATERAL_GUARD_ALLOWED_RECIPIENTS=
POLYGON_RPC_URL=https://polygon-bor-rpc.publicnode.com
```

Notes:

- In paper mode, live private-key signing is skipped.
- If you eventually want live mode on the Pi, use real process env or your secret command for secrets.
- `BOT_ID` is worth customizing so Pi telemetry is easy to identify.
- `NODE_EXE` is not needed on Linux.

Then review:

```text
~/lkcsite/PATBv5/trade.toml
```

## 5. Test manually once

```bash
cd ~/lkcsite/PATBv5
npm start
```

If it starts correctly, stop it with `Ctrl+C`.

## 6. Install the systemd service

Copy the service template:

```bash
sudo cp deploy/raspberry-pi/polymarket-bot-v5.service /etc/systemd/system/polymarket-bot-v5.service
```

If needed, edit:

- `User=pi`
- `WorkingDirectory=/home/pi/lkcsite/PATBv5`
- `Environment=PROJECT_ROOT=/home/pi/lkcsite/PATBv5`
- `ExecStart=/home/pi/lkcsite/PATBv5/deploy/raspberry-pi/run-bot.sh`

Then enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable polymarket-bot-v5
sudo systemctl start polymarket-bot-v5
```

## 7. Check status and logs

```bash
sudo systemctl status polymarket-bot-v5
journalctl -u polymarket-bot-v5 -f
```

Telemetry should land under:

```text
~/lkcsite/polydb/telemetry
```

## 8. Stop or restart

```bash
sudo systemctl stop polymarket-bot-v5
sudo systemctl restart polymarket-bot-v5
```

## Recommended overnight mode

For overnight collection, use:

- `PAPER_TRADING=true`
- a small `trade_usd`
- one stable `trade.toml` experiment at a time

## Suggested morning workflow

1. Check service logs.
2. Inspect telemetry under `~/lkcsite/polydb/telemetry`.
3. Sync the updated workspace back to your main machine if needed.
4. Run your normal validation and review flow.
