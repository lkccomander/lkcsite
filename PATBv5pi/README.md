# PATBv5 Pi Overlay

This folder is a Raspberry Pi handoff package for the existing `PATBv5` bot.

It does not include the whole bot. It includes the Pi-specific files needed to:

- run headless
- avoid the Windows PowerShell secret flow
- start in paper mode first

## Contents

- `scripts/get_secret_env.sh`
- `scripts/pi_run.sh`
- `scripts/pi_paper_run.sh` — paper-only launcher; it forces `PAPER_TRADING=true`
- `docs/raspberry-pi.md`
- `.env.pi.example`
- `apply-to-bot.sh`
- `patbv5-paper.service` — systemd unit for the paper-only launcher

## Intended use

Copy this `PATBv5pi` folder to the Pi, then apply it onto the real bot folder, for example:

```bash
cd ~/PATBv5pi
chmod +x apply-to-bot.sh scripts/get_secret_env.sh scripts/pi_run.sh
./apply-to-bot.sh /home/pi/PATBv5
```

Then copy the example env:

```bash
cp .env.pi.example /home/pi/PATBv5/.env
```

After that, edit `/home/pi/PATBv5/.env` as needed and start from the main bot folder.

For the latency comparison, install the paper-only service:

```bash
sudo cp /home/pi/PATBv5/deploy/raspberry-pi/patbv5-paper.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now patbv5-paper
```

The Pi writes its own telemetry under `/home/pi/PATBv5/polydb/telemetry` with
`botId=polymarket-bot-v5-pi-paper`. Do not use `scripts/pi_run.sh` for this
comparison; it is a general launcher and does not force paper mode.
