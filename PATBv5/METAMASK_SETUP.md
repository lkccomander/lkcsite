# Bot V4 MetaMask Account Setup

Bot v4 is a copy of bot v3 with a separate bot identity and telemetry ID. Its live account should use a different `.env` from v3.

## Choose the Correct Polymarket Wallet Mode

Polymarket documents three wallet modes:

- Deposit wallet API trading:
  - `POLYMARKET_SIGNATURE_TYPE=3`
  - `POLYMARKET_FUNDER_ADDRESS=` the deposit wallet address
  - Orders must use the deposit wallet as both maker and signer in the order payload.

- Polymarket.com account connected with MetaMask/Rabby/browser wallet:
  - `POLYMARKET_SIGNATURE_TYPE=2`
  - `PROXY_WALLET_ADDRESS=` the proxy wallet shown in Polymarket
  - This is a legacy Safe/proxy flow. If CLOB rejects it with "maker address not allowed", switch to the deposit wallet flow.

- Standalone MetaMask EOA:
  - `POLYMARKET_SIGNATURE_TYPE=0`
  - `PROXY_WALLET_ADDRESS=` the MetaMask EOA address
  - The EOA needs pUSD for trading and POL for gas.

For this bot, start from `.env.example`, create a local `.env`, and fill in only the new MetaMask account values. Do not copy v3's `.env`.

## Required Live Variables

```env
PAPER_TRADING=false
POLYMARKET_PRIVATE_KEY=0x...
POLYMARKET_SIGNATURE_TYPE=3
POLYMARKET_FUNDER_ADDRESS=0x...
POLYMARKET_API_KEY=
POLYMARKET_API_SECRET=
POLYMARKET_API_PASSPHRASE=
COLLATERAL_GUARD_ENABLED=true
COLLATERAL_GUARD_CONFIRMATION_BLOCKS=3
```

Keep `COLLATERAL_GUARD_ENABLED=true`. It stops this bot if pUSD leaves the configured funder wallet for an address outside the Polymarket trading-contract allowlist.

## Documentation Checked

- Polymarket Authentication: signature types and funder address
  https://docs.polymarket.com/api-reference/authentication
- Polymarket Deposit Wallets: POLY_1271 and deposit wallet flow
  https://docs.polymarket.com/trading/deposit-wallets
- Polymarket Trading Overview
  https://docs.polymarket.com/trading/overview
- Polymarket Contracts: pUSD and CTF Exchange contract addresses
  https://docs.polymarket.com/resources/contracts
