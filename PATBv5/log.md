# Polymarket Connectivity Log

- Checked at: `2026-05-09T17:18:07.873646+00:00`
- Root: `C:\Projects\lkcsite\polymarket-arbitrage-trading-botv4`
- Env file: `C:\Projects\lkcsite\polymarket-arbitrage-trading-botv4\.env`

## Environment

- `PAPER_TRADING`: `true`
- `POLYMARKET_SIGNATURE_TYPE`: `2`
- `POLYMARKET_PRIVATE_KEY`: `(missing)`
- `SIGNER_ADDRESS`: `(unknown)`
- `PROXY_WALLET_ADDRESS`: `***redacted***`
- `POLYMARKET_API_KEY`: `(missing)`
- `POLYMARKET_API_SECRET`: `(missing)`
- `POLYMARKET_API_PASSPHRASE`: `(missing)`
- `NODE_EXE`: `C:\Program Files\nodejs\node.exe`

## Public Connectivity

- Status: success (`HTTP 200`)
- Response: `1778347088`

## Authenticated Connectivity

- Status: failed
- Error: `POLYMARKET_PRIVATE_KEY or PROXY_WALLET_ADDRESS is missing from the secret provider, process environment, or non-secret config`

## Diagnosis

- `browser_session`: `unknown`
- `public_api`: `reachable`
- `authenticated_bot_access`: `not_tested_missing_credentials`
- `likely_issue`: `missing_env_configuration`

## Connectivity Test - 2026-05-09T17:20:24Z
# =====================================================

- Checked at: `2026-05-09T17:20:24Z`
- Root: `/mnt/c/Projects/lkcsite/polymarket-arbitrage-trading-botv4`
- Env file: `/mnt/c/Projects/lkcsite/polymarket-arbitrage-trading-botv4/.env`

### Environment

- `PAPER_TRADING`: `true`
- `POLYMARKET_SIGNATURE_TYPE`: `2`
- `POLYMARKET_PRIVATE_KEY`: `***redacted***`
- `SIGNER_ADDRESS`: `0x43d03F6a32E6B24a28AF6C1BA0cAF63F29afD3Ea`
- `PROXY_WALLET_ADDRESS`: `***redacted***`
- `POLYMARKET_API_KEY`: `(missing)`
- `POLYMARKET_API_SECRET`: `(missing)`
- `POLYMARKET_API_PASSPHRASE`: `(missing)`
- `NODE_EXE`: `/mnt/c/Program Files/nodejs/node.exe`

### Public Connectivity

- Status: success (`HTTP 200`)
- Response: `1778347235`

### Authenticated Connectivity

- Status: failed
- Error: `[CLOB Client] request error {"status":400,"statusText":"Bad Request","data":{"error":"Could not derive api key!"},"config":{"transitional":{"silentJSONParsing":true,"forcedJSONParsing":true,"clarifyTimeoutError":false,"legacyInterceptorReqResOrdering":true},"adapter":["xhr","http","fetch"],"transformRequest":[null],"transformResponse":[null],"timeout":0,"xsrfCookieName":"XSRF-TOKEN","xsrfHeaderName":"X-XSRF-TOKEN","maxContentLength":-1,"maxBodyLength":-1,"env":{},"headers":{"Accept":"*/*","Content-Type":"application/json","POLY_ADDRESS":"0x43d03F6a32E6B24a28AF6C1BA0cAF63F29afD3Ea","POLY_SIGNATURE":"***redacted***","POLY_TIMESTAMP":"1778347247","POLY_NONCE":"0","User-Agent":"@polymarket/clob-client","Connection":"keep-alive","Accept-Encoding":"gzip"},"method":"get","url":"https://clob.polymarket.com/auth/derive-api-key","allowAbsoluteUrls":true}}
TypeError [ERR_INVALID_ARG_TYPE]: The first argument must be of type string or an instance of Buffer, ArrayBuffer, or Array or an Array-like Object. Received undefined
    at Buffer.from (node:buffer:335:9)
    at buildPolyHmacSignature (C:\Projects\lkcsite\polymarket-arbitrage-trading-botv4\node_modules\@polymarket\clob-client-v2\dist\index.cjs:269:31)
    at createL2Headers (C:\Projects\lkcsite\polymarket-arbitrage-trading-botv4\node_modules\@polymarket\clob-client-v2\dist\index.cjs:302:15)
    at process.processTicksAndRejections (node:internal/process/task_queues:103:5)
    at async ClobClient.getApiKeys (C:\Projects\lkcsite\polymarket-arbitrage-trading-botv4\node_modules\@polymarket\clob-client-v2\dist\index.cjs:1707:21)
    at async [eval]:75:19`

### Diagnosis

- `browser_session`: `unknown`
- `public_api`: `reachable`
- `authenticated_bot_access`: `failed`
- `likely_issue`: `non_cloudflare_auth_or_runtime_error`

### Errors

#### Error 1

```text
Traceback (most recent call last):
  File "/mnt/c/Projects/lkcsite/polymarket-arbitrage-trading-botv4/scripts/check_polymarket_connectivity.py", line 470, in main
    report["auth_check"] = run_authenticated_check()
                           ^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/mnt/c/Projects/lkcsite/polymarket-arbitrage-trading-botv4/scripts/check_polymarket_connectivity.py", line 241, in run_authenticated_check
    raise RuntimeError(proc.stderr.strip() or proc.stdout.strip() or f"node exit code {proc.returncode}")
RuntimeError: [CLOB Client] request error {"status":400,"statusText":"Bad Request","data":{"error":"Could not derive api key!"},"config":{"transitional":{"silentJSONParsing":true,"forcedJSONParsing":true,"clarifyTimeoutError":false,"legacyInterceptorReqResOrdering":true},"adapter":["xhr","http","fetch"],"transformRequest":[null],"transformResponse":[null],"timeout":0,"xsrfCookieName":"XSRF-TOKEN","xsrfHeaderName":"X-XSRF-TOKEN","maxContentLength":-1,"maxBodyLength":-1,"env":{},"headers":{"Accept":"*/*","Content-Type":"application/json","POLY_ADDRESS":"0x43d03F6a32E6B24a28AF6C1BA0cAF63F29afD3Ea","POLY_SIGNATURE":"***redacted***","POLY_TIMESTAMP":"1778347247","POLY_NONCE":"0","User-Agent":"@polymarket/clob-client","Connection":"keep-alive","Accept-Encoding":"gzip"},"method":"get","url":"https://clob.polymarket.com/auth/derive-api-key","allowAbsoluteUrls":true}}
TypeError [ERR_INVALID_ARG_TYPE]: The first argument must be of type string or an instance of Buffer, ArrayBuffer, or Array or an Array-like Object. Received undefined
    at Buffer.from (node:buffer:335:9)
    at buildPolyHmacSignature (C:\Projects\lkcsite\polymarket-arbitrage-trading-botv4\node_modules\@polymarket\clob-client-v2\dist\index.cjs:269:31)
    at createL2Headers (C:\Projects\lkcsite\polymarket-arbitrage-trading-botv4\node_modules\@polymarket\clob-client-v2\dist\index.cjs:302:15)
    at process.processTicksAndRejections (node:internal/process/task_queues:103:5)
    at async ClobClient.getApiKeys (C:\Projects\lkcsite\polymarket-arbitrage-trading-botv4\node_modules\@polymarket\clob-client-v2\dist\index.cjs:1707:21)
    at async [eval]:75:19
```

## Connectivity Test - 2026-05-09T17:34:04Z
# =====================================================

- Checked at: `2026-05-09T17:34:04Z`
- Root: `C:\Projects\lkcsite\polymarket-arbitrage-trading-botv4`
- Env file: `C:\Projects\lkcsite\polymarket-arbitrage-trading-botv4\.env`

### Environment

- `PAPER_TRADING`: `true`
- `POLYMARKET_SIGNATURE_TYPE`: `2`
- `POLYMARKET_PRIVATE_KEY`: `(missing)`
- `SIGNER_ADDRESS`: `(unknown)`
- `PROXY_WALLET_ADDRESS`: `***redacted***`
- `POLYMARKET_API_KEY`: `(missing)`
- `POLYMARKET_API_SECRET`: `(missing)`
- `POLYMARKET_API_PASSPHRASE`: `(missing)`
- `NODE_EXE`: `C:\Program Files\nodejs\node.exe`

### Public Connectivity

- Status: success (`HTTP 200`)
- Response: `1778348044`

### Authenticated Connectivity

- Status: failed
- Error: `POLYMARKET_PRIVATE_KEY or PROXY_WALLET_ADDRESS is missing from the secret provider, process environment, or non-secret config`

### Diagnosis

- `browser_session`: `unknown`
- `public_api`: `reachable`
- `authenticated_bot_access`: `not_tested_missing_credentials`
- `likely_issue`: `missing_env_configuration`


## Connectivity Test - 2026-05-09T17:35:37Z
# =====================================================

- Checked at: `2026-05-09T17:35:37Z`
- Root: `C:\Projects\lkcsite\polymarket-arbitrage-trading-botv4`
- Env file: `C:\Projects\lkcsite\polymarket-arbitrage-trading-botv4\.env`

### Environment

- `PAPER_TRADING`: `true`
- `POLYMARKET_SIGNATURE_TYPE`: `2`
- `POLYMARKET_PRIVATE_KEY`: `(missing)`
- `SIGNER_ADDRESS`: `(unknown)`
- `PROXY_WALLET_ADDRESS`: `***redacted***`
- `POLYMARKET_API_KEY`: `(missing)`
- `POLYMARKET_API_SECRET`: `(missing)`
- `POLYMARKET_API_PASSPHRASE`: `(missing)`
- `NODE_EXE`: `C:\Program Files\nodejs\node.exe`

### Public Connectivity

- Status: success (`HTTP 200`)
- Response: `1778348137`

### Authenticated Connectivity

- Status: failed
- Error: `POLYMARKET_PRIVATE_KEY or PROXY_WALLET_ADDRESS is missing from the secret provider, process environment, or non-secret config`

### Diagnosis

- `browser_session`: `unknown`
- `public_api`: `reachable`
- `authenticated_bot_access`: `not_tested_missing_credentials`
- `likely_issue`: `missing_env_configuration`


## Connectivity Test - 2026-05-09T17:43:37Z
# =====================================================

- Checked at: `2026-05-09T17:43:37Z`
- Root: `/mnt/c/Projects/lkcsite/polymarket-arbitrage-trading-botv4`
- Env file: `/mnt/c/Projects/lkcsite/polymarket-arbitrage-trading-botv4/.env`

### Environment

- `PAPER_TRADING`: `true`
- `POLYMARKET_SIGNATURE_TYPE`: `2`
- `POLYMARKET_PRIVATE_KEY`: `***redacted***`
- `SIGNER_ADDRESS`: `0x43d03F6a32E6B24a28AF6C1BA0cAF63F29afD3Ea`
- `PROXY_WALLET_ADDRESS`: `***redacted***`
- `POLYMARKET_API_KEY`: `***redacted***`
- `POLYMARKET_API_SECRET`: `***redacted***`
- `POLYMARKET_API_PASSPHRASE`: `***redacted***`
- `NODE_EXE`: `/mnt/c/Program Files/nodejs/node.exe`

### Public Connectivity

- Status: success (`HTTP 200`)
- Response: `1778348631`

### Authenticated Connectivity

- Status: success
- Signer address: `0x43d03F6a32E6B24a28AF6C1BA0cAF63F29afD3Ea`
- Funder address: `0x366256036425D2893656b40583B205ab78090e48`
- Server time: `1778348644`
- Derived API key: `***redacted***`
- Auth source: `manual_env`
- API keys count: `0`
- Closed only: `{"error": "Unauthorized/Invalid api key", "status": 401}`
- Collateral balance: ``
- Collateral allowance: ``

### Diagnosis

- `browser_session`: `unknown`
- `public_api`: `reachable`
- `authenticated_bot_access`: `ok`
- `likely_issue`: `none`

## Connectivity Test - 2026-05-09T17:46:05Z
# =====================================================

- Checked at: `2026-05-09T17:46:05Z`
- Root: `C:\Projects\lkcsite\polymarket-arbitrage-trading-botv4`
- Env file: `C:\Projects\lkcsite\polymarket-arbitrage-trading-botv4\.env`

### Environment

- `PAPER_TRADING`: `true`
- `POLYMARKET_SIGNATURE_TYPE`: `2`
- `POLYMARKET_PRIVATE_KEY`: `(missing)`
- `SIGNER_ADDRESS`: `(unknown)`
- `PROXY_WALLET_ADDRESS`: `***redacted***`
- `POLYMARKET_API_KEY`: `(missing)`
- `POLYMARKET_API_SECRET`: `(missing)`
- `POLYMARKET_API_PASSPHRASE`: `(missing)`
- `NODE_EXE`: `C:\Program Files\nodejs\node.exe`

### Public Connectivity

- Status: success (`HTTP 200`)
- Response: `1778348766`

### Authenticated Connectivity

- Status: failed
- Error: `POLYMARKET_PRIVATE_KEY or PROXY_WALLET_ADDRESS is missing from the secret provider, process environment, or non-secret config`

### Diagnosis

- `browser_session`: `unknown`
- `public_api`: `reachable`
- `authenticated_bot_access`: `not_tested_missing_credentials`
- `likely_issue`: `missing_env_configuration`


## Connectivity Test - 2026-05-09T17:49:39Z
# =====================================================

- Checked at: `2026-05-09T17:49:39Z`
- Root: `C:\Projects\lkcsite\polymarket-arbitrage-trading-botv4`
- Env file: `C:\Projects\lkcsite\polymarket-arbitrage-trading-botv4\.env`

### Environment

- `PAPER_TRADING`: `true`
- `POLYMARKET_SIGNATURE_TYPE`: `2`
- `POLYMARKET_PRIVATE_KEY`: `(missing)`
- `SIGNER_ADDRESS`: `(unknown)`
- `PROXY_WALLET_ADDRESS`: `***redacted***`
- `POLYMARKET_API_KEY`: `(missing)`
- `POLYMARKET_API_SECRET`: `(missing)`
- `POLYMARKET_API_PASSPHRASE`: `(missing)`
- `NODE_EXE`: `C:\Program Files\nodejs\node.exe`

### Public Connectivity

- Status: success (`HTTP 200`)
- Response: `1778348979`

### Authenticated Connectivity

- Status: failed
- Error: `POLYMARKET_PRIVATE_KEY or PROXY_WALLET_ADDRESS is missing from the secret provider, process environment, or non-secret config`

### Diagnosis

- `browser_session`: `unknown`
- `public_api`: `reachable`
- `authenticated_bot_access`: `not_tested_missing_credentials`
- `likely_issue`: `missing_env_configuration`


## Connectivity Test - 2026-05-09T17:54:45Z
# =====================================================

- Checked at: `2026-05-09T17:54:45Z`
- Root: `/mnt/c/Projects/lkcsite/polymarket-arbitrage-trading-botv4`
- Env file: `/mnt/c/Projects/lkcsite/polymarket-arbitrage-trading-botv4/.env`

### Environment

- `PAPER_TRADING`: `true`
- `POLYMARKET_SIGNATURE_TYPE`: `2`
- `POLYMARKET_PRIVATE_KEY`: `***redacted***`
- `SIGNER_ADDRESS`: `0x43d03F6a32E6B24a28AF6C1BA0cAF63F29afD3Ea`
- `PROXY_WALLET_ADDRESS`: `***redacted***`
- `POLYMARKET_API_KEY`: `***redacted***`
- `POLYMARKET_API_SECRET`: `***redacted***`
- `POLYMARKET_API_PASSPHRASE`: `***redacted***`
- `NODE_EXE`: `/mnt/c/Program Files/nodejs/node.exe`

### Public Connectivity

- Status: success (`HTTP 200`)
- Response: `1778349295`

### Authenticated Connectivity

- Status: success
- Signer address: `0x43d03F6a32E6B24a28AF6C1BA0cAF63F29afD3Ea`
- Funder address: `0x366256036425D2893656b40583B205ab78090e48`
- Server time: `1778349306`
- Derived API key: `***redacted***`
- Auth source: `manual_env`
- API keys count: `0`
- Closed only: `{"error": "Unauthorized/Invalid api key", "status": 401}`
- Collateral balance: ``
- Collateral allowance: ``

### Diagnosis

- `browser_session`: `unknown`
- `public_api`: `reachable`
- `authenticated_bot_access`: `ok`
- `likely_issue`: `none`

## Connectivity Test - 2026-05-09T18:10:35Z
# =====================================================

- Checked at: `2026-05-09T18:10:35Z`
- Root: `/mnt/c/Projects/lkcsite/polymarket-arbitrage-trading-botv4`
- Env file: `/mnt/c/Projects/lkcsite/polymarket-arbitrage-trading-botv4/.env`

### Environment

- `PAPER_TRADING`: `true`
- `POLYMARKET_SIGNATURE_TYPE`: `2`
- `POLYMARKET_PRIVATE_KEY`: `***redacted***`
- `SIGNER_ADDRESS`: `0x43d03F6a32E6B24a28AF6C1BA0cAF63F29afD3Ea`
- `PROXY_WALLET_ADDRESS`: `***redacted***`
- `POLYMARKET_API_KEY`: `***redacted***`
- `POLYMARKET_API_SECRET`: `***redacted***`
- `POLYMARKET_API_PASSPHRASE`: `***redacted***`
- `NODE_EXE`: `/mnt/c/Program Files/nodejs/node.exe`

### API Connectivity

- Overall: `success`
- `Gamma API`: `success`
  - URL: `https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=1`
  - HTTP: `200`
  - Response: `list[1] first(id=540817, question=New Rihanna Album before GTA VI?, conditionId=0x1fad72fae204143ff1c3035e99e7c0f65ea8d5cd9bd1070987bd1a3316f772be)`
- `Data API`: `success`
  - URL: `https://data-api.polymarket.com/trades?limit=1`
  - HTTP: `200`
  - Response: `list[1] first(conditionId=0xf662d562eef5be363225ad9aaf8639d14f9d1ffcf6345d06553b8b0ec9acdc65, proxyWallet=0xa9ee0fb31cdb5965e6a37e4d6e47f91cdca9ebcb, side=SELL)`
- `CLOB API`: `success`
  - URL: `https://clob.polymarket.com/time`
  - HTTP: `200`
  - Response: `1778350245`

### Authenticated Connectivity

- Status: success
- Signer address: `0x43d03F6a32E6B24a28AF6C1BA0cAF63F29afD3Ea`
- Funder address: `0x366256036425D2893656b40583B205ab78090e48`
- Server time: `1778350256`
- Derived API key: `***redacted***`
- Auth source: `manual_env`
- API keys count: `0`
- Closed only: `{"error": "Unauthorized/Invalid api key", "status": 401}`
- Collateral balance: ``
- Collateral allowance: ``

### Diagnosis

- `browser_session`: `unknown`
- `public_api`: `reachable`
- `authenticated_bot_access`: `ok`
- `likely_issue`: `none`

## Connectivity Test - 2026-05-09T18:16:31Z
# =====================================================

- Checked at: `2026-05-09T18:16:31Z`
- Root: `/mnt/c/Projects/lkcsite/polymarket-arbitrage-trading-botv4`
- Env file: `/mnt/c/Projects/lkcsite/polymarket-arbitrage-trading-botv4/.env`

### Environment

- `PAPER_TRADING`: `true`
- `POLYMARKET_SIGNATURE_TYPE`: `2`
- `POLYMARKET_PRIVATE_KEY`: `***redacted***`
- `SIGNER_ADDRESS`: `0x43d03F6a32E6B24a28AF6C1BA0cAF63F29afD3Ea`
- `PROXY_WALLET_ADDRESS`: `***redacted***`
- `POLYMARKET_API_KEY`: `***redacted***`
- `POLYMARKET_API_SECRET`: `***redacted***`
- `POLYMARKET_API_PASSPHRASE`: `***redacted***`
- `NODE_EXE`: `/mnt/c/Program Files/nodejs/node.exe`

### API Connectivity

- Overall: `success`
- `Gamma API`: `success`
  - URL: `https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=1`
  - HTTP: `200`
  - Response: `list[1] first(id=540817, question=New Rihanna Album before GTA VI?, conditionId=0x1fad72fae204143ff1c3035e99e7c0f65ea8d5cd9bd1070987bd1a3316f772be)`
- `Data API`: `success`
  - URL: `https://data-api.polymarket.com/trades?limit=1`
  - HTTP: `200`
  - Response: `list[1] first(conditionId=0xfb3f785d0197fafbf2eb886df0a92fa135c9d00142298d9bd230a4e313157e94, proxyWallet=0x3564777c9912f28af0144625c7438f7b794ec023, side=BUY)`
- `CLOB API`: `success`
  - URL: `https://clob.polymarket.com/time`
  - HTTP: `200`
  - Response: `1778350600`

### Authenticated Connectivity

- Status: success
- Signer address: `0x43d03F6a32E6B24a28AF6C1BA0cAF63F29afD3Ea`
- Funder address: `0x366256036425D2893656b40583B205ab78090e48`
- Server time: `1778350610`
- Derived API key: `***redacted***`
- Auth source: `manual_env`
- API keys count: `0`
- Closed only: `{"error": "Unauthorized/Invalid api key", "status": 401}`
- Collateral balance: ``
- Collateral allowance: ``

### Verbose Details

- Verbose: `true`
- Secret source: `secret_command`
- Node modules: `/mnt/c/Projects/lkcsite/polymarket-arbitrage-trading-botv4/node_modules`
- `Gamma API` expectation=`non_empty_list` elapsedMs=`442` bytes=`6436`
- `Data API` expectation=`list` elapsedMs=`351` bytes=`739`
- `CLOB API` expectation=`int_like` elapsedMs=`296` bytes=`10`
- Auth node path: `/mnt/c/Program Files/nodejs/node.exe`
- Auth elapsedMs: `10431`

### Diagnosis

- `browser_session`: `unknown`
- `public_api`: `reachable`
- `authenticated_bot_access`: `ok`
- `likely_issue`: `none`

## Connectivity Test - 2026-05-09T18:17:43Z
# =====================================================

- Checked at: `2026-05-09T18:17:43Z`
- Root: `C:\Projects\lkcsite\polymarket-arbitrage-trading-botv4`
- Env file: `C:\Projects\lkcsite\polymarket-arbitrage-trading-botv4\.env`

### Environment

- `PAPER_TRADING`: `true`
- `POLYMARKET_SIGNATURE_TYPE`: `2`
- `POLYMARKET_PRIVATE_KEY`: `(missing)`
- `SIGNER_ADDRESS`: `(unknown)`
- `PROXY_WALLET_ADDRESS`: `***redacted***`
- `POLYMARKET_API_KEY`: `(missing)`
- `POLYMARKET_API_SECRET`: `(missing)`
- `POLYMARKET_API_PASSPHRASE`: `(missing)`
- `NODE_EXE`: `C:\Program Files\nodejs\node.exe`

### API Connectivity

- Overall: `success`
- `Gamma API`: `success`
  - URL: `https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=1`
  - HTTP: `200`
  - Response: `list[1] first(id=540817, question=New Rihanna Album before GTA VI?, conditionId=0x1fad72fae204143ff1c3035e99e7c0f65ea8d5cd9bd1070987bd1a3316f772be)`
- `Data API`: `success`
  - URL: `https://data-api.polymarket.com/trades?limit=1`
  - HTTP: `200`
  - Response: `list[1] first(conditionId=0xfb3f785d0197fafbf2eb886df0a92fa135c9d00142298d9bd230a4e313157e94, proxyWallet=0x3564777c9912f28af0144625c7438f7b794ec023, side=BUY)`
- `CLOB API`: `success`
  - URL: `https://clob.polymarket.com/time`
  - HTTP: `200`
  - Response: `1778350663`

### Authenticated Connectivity

- Status: failed
- Error: `POLYMARKET_PRIVATE_KEY or PROXY_WALLET_ADDRESS is missing from the secret provider, process environment, or non-secret config`

### Verbose Details

- Verbose: `true`
- Secret source: `secret_command`
- Node modules: `C:\Projects\lkcsite\polymarket-arbitrage-trading-botv4\node_modules`
- `Gamma API` expectation=`non_empty_list` elapsedMs=`222` bytes=`6436`
- `Data API` expectation=`list` elapsedMs=`92` bytes=`739`
- `CLOB API` expectation=`int_like` elapsedMs=`231` bytes=`10`

### Diagnosis

- `browser_session`: `unknown`
- `public_api`: `reachable`
- `authenticated_bot_access`: `not_tested_missing_credentials`
- `likely_issue`: `missing_env_configuration`


## Connectivity Test - 2026-05-09T18:42:17Z
# =====================================================

- Checked at: `2026-05-09T18:42:17Z`
- Root: `C:\Projects\lkcsite\polymarket-arbitrage-trading-botv4`
- Env file: `C:\Projects\lkcsite\polymarket-arbitrage-trading-botv4\.env`

### Environment

- `PAPER_TRADING`: `true`
- `POLYMARKET_SIGNATURE_TYPE`: `2`
- `POLYMARKET_PRIVATE_KEY`: `(missing)`
- `SIGNER_ADDRESS`: `(unknown)`
- `PROXY_WALLET_ADDRESS`: `***redacted***`
- `POLYMARKET_API_KEY`: `(missing)`
- `POLYMARKET_API_SECRET`: `(missing)`
- `POLYMARKET_API_PASSPHRASE`: `(missing)`
- `NODE_EXE`: `C:\Program Files\nodejs\node.exe`

### API Connectivity

- Overall: `success`
- `Gamma API`: `success`
  - URL: `https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=1`
  - HTTP: `200`
  - Response: `list[1] first(id=540817, question=New Rihanna Album before GTA VI?, conditionId=0x1fad72fae204143ff1c3035e99e7c0f65ea8d5cd9bd1070987bd1a3316f772be)`
- `Data API`: `success`
  - URL: `https://data-api.polymarket.com/trades?limit=1`
  - HTTP: `200`
  - Response: `list[1] first(conditionId=0x09148e8a5260a4c40aceb29badc45845fe08330497756bfcc1017c478c28bb65, proxyWallet=0xc5753c8aaff5b1a1645be807ff53058124281002, side=BUY)`
- `CLOB API`: `success`
  - URL: `https://clob.polymarket.com/time`
  - HTTP: `200`
  - Response: `1778352138`

### Authenticated Connectivity

- Status: failed
- Error: `POLYMARKET_PRIVATE_KEY or PROXY_WALLET_ADDRESS is missing from the secret provider, process environment, or non-secret config`

### Verbose Details

- Verbose: `true`
- Secret source: `secret_command`
- Node modules: `C:\Projects\lkcsite\polymarket-arbitrage-trading-botv4\node_modules`
- `Gamma API` expectation=`non_empty_list` elapsedMs=`334` bytes=`6381`
- `Data API` expectation=`list` elapsedMs=`313` bytes=`858`
- `CLOB API` expectation=`int_like` elapsedMs=`242` bytes=`10`

### Diagnosis

- `browser_session`: `unknown`
- `public_api`: `reachable`
- `authenticated_bot_access`: `not_tested_missing_credentials`
- `likely_issue`: `missing_env_configuration`


## Connectivity Test - 2026-05-09T19:02:01Z
# =====================================================

- Checked at: `2026-05-09T19:02:01Z`
- Root: `C:\Projects\lkcsite\polymarket-arbitrage-trading-botv4`
- Env file: `C:\Projects\lkcsite\polymarket-arbitrage-trading-botv4\.env`

### Environment

- `PAPER_TRADING`: `true`
- `POLYMARKET_SIGNATURE_TYPE`: `2`
- `POLYMARKET_PRIVATE_KEY`: `***redacted***`
- `SIGNER_ADDRESS`: `0x43d03F6a32E6B24a28AF6C1BA0cAF63F29afD3Ea`
- `PROXY_WALLET_ADDRESS`: `***redacted***`
- `POLYMARKET_API_KEY`: `***redacted***`
- `POLYMARKET_API_SECRET`: `***redacted***`
- `POLYMARKET_API_PASSPHRASE`: `***redacted***`
- `NODE_EXE`: `C:\Program Files\nodejs\node.exe`

### API Connectivity

- Overall: `success`
- `Gamma API`: `success`
  - URL: `https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=1`
  - HTTP: `200`
  - Response: `list[1] first(id=540817, question=New Rihanna Album before GTA VI?, conditionId=0x1fad72fae204143ff1c3035e99e7c0f65ea8d5cd9bd1070987bd1a3316f772be)`
- `Data API`: `success`
  - URL: `https://data-api.polymarket.com/trades?limit=1`
  - HTTP: `200`
  - Response: `list[1] first(conditionId=0x00e9547880b83985ec5c0fe3ed720f7f0c5f9cd9c2c883577f4439b309227718, proxyWallet=0x18d317d3e44e7563db166454941d87fa614bb84f, side=BUY)`
- `CLOB API`: `success`
  - URL: `https://clob.polymarket.com/time`
  - HTTP: `200`
  - Response: `1778353331`

### Authenticated Connectivity

- Status: success
- Signer address: `0x43d03F6a32E6B24a28AF6C1BA0cAF63F29afD3Ea`
- Funder address: `0x366256036425D2893656b40583B205ab78090e48`
- Server time: `1778353341`
- Derived API key: `***redacted***`
- Auth source: `manual_env`
- API keys count: `0`
- Closed only: `{"error": "Unauthorized/Invalid api key", "status": 401}`
- Collateral balance: ``
- Collateral allowance: ``

### Verbose Details

- Verbose: `true`
- Secret source: `secret_command`
- Node modules: `C:\Projects\lkcsite\polymarket-arbitrage-trading-botv4\node_modules`
- `Gamma API` expectation=`non_empty_list` elapsedMs=`403` bytes=`6348`
- `Data API` expectation=`list` elapsedMs=`226` bytes=`735`
- `CLOB API` expectation=`int_like` elapsedMs=`220` bytes=`10`
- Auth node path: `C:\Program Files\nodejs\node.exe`
- Auth elapsedMs: `10539`

### Diagnosis

- `browser_session`: `unknown`
- `public_api`: `reachable`
- `authenticated_bot_access`: `ok`
- `likely_issue`: `none`


## Connectivity Test - 2026-05-09T19:02:55Z
# =====================================================

- Checked at: `2026-05-09T19:02:55Z`
- Root: `C:\Projects\lkcsite\polymarket-arbitrage-trading-botv4`
- Env file: `C:\Projects\lkcsite\polymarket-arbitrage-trading-botv4\.env`

### Environment

- `PAPER_TRADING`: `true`
- `POLYMARKET_SIGNATURE_TYPE`: `2`
- `POLYMARKET_PRIVATE_KEY`: `***redacted***`
- `SIGNER_ADDRESS`: `0x43d03F6a32E6B24a28AF6C1BA0cAF63F29afD3Ea`
- `PROXY_WALLET_ADDRESS`: `***redacted***`
- `POLYMARKET_API_KEY`: `***redacted***`
- `POLYMARKET_API_SECRET`: `***redacted***`
- `POLYMARKET_API_PASSPHRASE`: `***redacted***`
- `NODE_EXE`: `C:\Program Files\nodejs\node.exe`

### API Connectivity

- Overall: `success`
- `Gamma API`: `success`
  - URL: `https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=1`
  - HTTP: `200`
  - Response: `list[1] first(id=540817, question=New Rihanna Album before GTA VI?, conditionId=0x1fad72fae204143ff1c3035e99e7c0f65ea8d5cd9bd1070987bd1a3316f772be)`
- `Data API`: `success`
  - URL: `https://data-api.polymarket.com/trades?limit=1`
  - HTTP: `200`
  - Response: `list[1] first(conditionId=0x00e9547880b83985ec5c0fe3ed720f7f0c5f9cd9c2c883577f4439b309227718, proxyWallet=0x18d317d3e44e7563db166454941d87fa614bb84f, side=BUY)`
- `CLOB API`: `success`
  - URL: `https://clob.polymarket.com/time`
  - HTTP: `200`
  - Response: `1778353386`

### Authenticated Connectivity

- Status: success
- Signer address: `0x43d03F6a32E6B24a28AF6C1BA0cAF63F29afD3Ea`
- Funder address: `0x366256036425D2893656b40583B205ab78090e48`
- Server time: `1778353399`
- Derived API key: `***redacted***`
- Auth source: `manual_env`
- API keys count: `0`
- Closed only: `{"error": "Unauthorized/Invalid api key", "status": 401}`
- Collateral balance: ``
- Collateral allowance: ``

### Verbose Details

- Verbose: `true`
- Secret source: `secret_command`
- Node modules: `C:\Projects\lkcsite\polymarket-arbitrage-trading-botv4\node_modules`
- `Gamma API` expectation=`non_empty_list` elapsedMs=`348` bytes=`6348`
- `Data API` expectation=`list` elapsedMs=`106` bytes=`735`
- `CLOB API` expectation=`int_like` elapsedMs=`278` bytes=`10`
- Auth node path: `C:\Program Files\nodejs\node.exe`
- Auth elapsedMs: `13185`

### Diagnosis

- `browser_session`: `unknown`
- `public_api`: `reachable`
- `authenticated_bot_access`: `ok`
- `likely_issue`: `none`


## Connectivity Test - 2026-05-09T19:04:17Z
# =====================================================

- Checked at: `2026-05-09T19:04:17Z`
- Root: `C:\Projects\lkcsite\polymarket-arbitrage-trading-botv4`
- Env file: `C:\Projects\lkcsite\polymarket-arbitrage-trading-botv4\.env`

### Overall Result

- Status: `pass`
- Valid preflight: `yes`
- Public APIs: `pass`
- Authenticated CLOB: `pass`

### Environment

- `PAPER_TRADING`: `true`
- `POLYMARKET_SIGNATURE_TYPE`: `2`
- `POLYMARKET_PRIVATE_KEY`: `***redacted***`
- `SIGNER_ADDRESS`: `0x43d03F6a32E6B24a28AF6C1BA0cAF63F29afD3Ea`
- `PROXY_WALLET_ADDRESS`: `***redacted***`
- `POLYMARKET_API_KEY`: `***redacted***`
- `POLYMARKET_API_SECRET`: `***redacted***`
- `POLYMARKET_API_PASSPHRASE`: `***redacted***`
- `NODE_EXE`: `C:\Program Files\nodejs\node.exe`

### API Connectivity

- Overall: `success`
- `Gamma API`: `success`
  - URL: `https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=1`
  - HTTP: `200`
  - Response: `list[1] first(id=540817, question=New Rihanna Album before GTA VI?, conditionId=0x1fad72fae204143ff1c3035e99e7c0f65ea8d5cd9bd1070987bd1a3316f772be)`
- `Data API`: `success`
  - URL: `https://data-api.polymarket.com/trades?limit=1`
  - HTTP: `200`
  - Response: `list[1] first(conditionId=0x00e9547880b83985ec5c0fe3ed720f7f0c5f9cd9c2c883577f4439b309227718, proxyWallet=0x18d317d3e44e7563db166454941d87fa614bb84f, side=BUY)`
- `CLOB API`: `success`
  - URL: `https://clob.polymarket.com/time`
  - HTTP: `200`
  - Response: `1778353469`

### Authenticated Connectivity

- Status: success
- Signer address: `0x43d03F6a32E6B24a28AF6C1BA0cAF63F29afD3Ea`
- Funder address: `0x366256036425D2893656b40583B205ab78090e48`
- Server time: `1778353489`
- Derived API key: `***redacted***`
- Auth source: `manual_env`
- API keys count: `0`
- Closed only: `{"error": "Unauthorized/Invalid api key", "status": 401}`
- Collateral balance: ``
- Collateral allowance: ``

### Verbose Details

- Verbose: `true`
- Secret source: `secret_command`
- Node modules: `C:\Projects\lkcsite\polymarket-arbitrage-trading-botv4\node_modules`
- `Gamma API` expectation=`non_empty_list` elapsedMs=`225` bytes=`6348`
- `Data API` expectation=`list` elapsedMs=`140` bytes=`735`
- `CLOB API` expectation=`int_like` elapsedMs=`414` bytes=`10`
- Auth node path: `C:\Program Files\nodejs\node.exe`
- Auth elapsedMs: `20483`

### Diagnosis

- `browser_session`: `unknown`
- `public_api`: `reachable`
- `authenticated_bot_access`: `ok`
- `likely_issue`: `none`


## Connectivity Test - 2026-05-09T19:15:34Z
# =====================================================

- Checked at: `2026-05-09T19:15:34Z`
- Root: `/mnt/c/Projects/lkcsite/polymarket-arbitrage-trading-botv4`
- Env file: `/mnt/c/Projects/lkcsite/polymarket-arbitrage-trading-botv4/.env`

### Overall Result

- Status: `pass`
- Valid preflight: `yes`
- Public APIs: `pass`
- Authenticated CLOB: `pass`

### Environment

- `PAPER_TRADING`: `false`
- `POLYMARKET_SIGNATURE_TYPE`: `2`
- `POLYMARKET_PRIVATE_KEY`: `***redacted***`
- `SIGNER_ADDRESS`: `0x43d03F6a32E6B24a28AF6C1BA0cAF63F29afD3Ea`
- `PROXY_WALLET_ADDRESS`: `***redacted***`
- `POLYMARKET_API_KEY`: `***redacted***`
- `POLYMARKET_API_SECRET`: `***redacted***`
- `POLYMARKET_API_PASSPHRASE`: `***redacted***`
- `NODE_EXE`: `/mnt/c/Program Files/nodejs/node.exe`

### API Connectivity

- Overall: `success`
- `Gamma API`: `success`
  - URL: `https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=1`
  - HTTP: `200`
  - Response: `list[1] first(id=540817, question=New Rihanna Album before GTA VI?, conditionId=0x1fad72fae204143ff1c3035e99e7c0f65ea8d5cd9bd1070987bd1a3316f772be)`
- `Data API`: `success`
  - URL: `https://data-api.polymarket.com/trades?limit=1`
  - HTTP: `200`
  - Response: `list[1] first(conditionId=0xed2b27cf6f1dc265a4889b2b68be11b8cf85c40de0d755e1b88fd3299cc542a4, proxyWallet=0x1e82e3eb816aaf755ac9b44bc9d98f01b08aaf92, side=BUY)`
- `CLOB API`: `success`
  - URL: `https://clob.polymarket.com/time`
  - HTTP: `200`
  - Response: `1778354152`

### Authenticated Connectivity

- Status: success
- Signer address: `0x43d03F6a32E6B24a28AF6C1BA0cAF63F29afD3Ea`
- Funder address: `0x366256036425D2893656b40583B205ab78090e48`
- Server time: `{'error': 'read ECONNRESET'}`
- Derived API key: `***redacted***`
- Auth source: `manual_env`
- API keys count: `0`
- Closed only: `{"error": "Unauthorized/Invalid api key", "status": 401}`
- Collateral balance: ``
- Collateral allowance: ``

### Verbose Details

- Verbose: `true`
- Secret source: `secret_command`
- Node modules: `/mnt/c/Projects/lkcsite/polymarket-arbitrage-trading-botv4/node_modules`
- `Gamma API` expectation=`non_empty_list` elapsedMs=`631` bytes=`6335`
- `Data API` expectation=`list` elapsedMs=`654` bytes=`843`
- `CLOB API` expectation=`int_like` elapsedMs=`372` bytes=`10`
- Auth node path: `/mnt/c/Program Files/nodejs/node.exe`
- Auth elapsedMs: `31316`

### Diagnosis

- `browser_session`: `unknown`
- `public_api`: `reachable`
- `authenticated_bot_access`: `ok`
- `likely_issue`: `none`

## Connectivity Test - 2026-05-09T19:17:47Z
# =====================================================

- Checked at: `2026-05-09T19:17:47Z`
- Root: `/mnt/c/Projects/lkcsite/polymarket-arbitrage-trading-botv4`
- Env file: `/mnt/c/Projects/lkcsite/polymarket-arbitrage-trading-botv4/.env`

### Overall Result

- Status: `fail`
- Valid preflight: `no`
- Public APIs: `pass`
- Authenticated CLOB: `fail`

### Environment

- `PAPER_TRADING`: `false`
- `POLYMARKET_SIGNATURE_TYPE`: `2`
- `POLYMARKET_PRIVATE_KEY`: `***redacted***`
- `SIGNER_ADDRESS`: `0x43d03F6a32E6B24a28AF6C1BA0cAF63F29afD3Ea`
- `PROXY_WALLET_ADDRESS`: `***redacted***`
- `POLYMARKET_API_KEY`: `***redacted***`
- `POLYMARKET_API_SECRET`: `***redacted***`
- `POLYMARKET_API_PASSPHRASE`: `***redacted***`
- `NODE_EXE`: `/mnt/c/Program Files/nodejs/node.exe`

### API Connectivity

- Overall: `success`
- `Gamma API`: `success`
  - URL: `https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=1`
  - HTTP: `200`
  - Response: `list[1] first(id=540817, question=New Rihanna Album before GTA VI?, conditionId=0x1fad72fae204143ff1c3035e99e7c0f65ea8d5cd9bd1070987bd1a3316f772be)`
- `Data API`: `success`
  - URL: `https://data-api.polymarket.com/trades?limit=1`
  - HTTP: `200`
  - Response: `list[1] first(conditionId=0xed2b27cf6f1dc265a4889b2b68be11b8cf85c40de0d755e1b88fd3299cc542a4, proxyWallet=0x1e82e3eb816aaf755ac9b44bc9d98f01b08aaf92, side=BUY)`
- `CLOB API`: `success`
  - URL: `https://clob.polymarket.com/time`
  - HTTP: `200`
  - Response: `1778354282`

### Authenticated Connectivity

- Status: failed
- Error: `Authenticated CLOB validation failed`

- Validation errors:
  - `closedOnly returned an error response: {'error': 'Unauthorized/Invalid api key', 'status': 401}`
  - `collateral returned an error response: {'error': 'Unauthorized/Invalid api key', 'status': 401}`

### Verbose Details

- Verbose: `true`
- Secret source: `secret_command`
- Node modules: `/mnt/c/Projects/lkcsite/polymarket-arbitrage-trading-botv4/node_modules`
- `Gamma API` expectation=`non_empty_list` elapsedMs=`842` bytes=`6335`
- `Data API` expectation=`list` elapsedMs=`621` bytes=`843`
- `CLOB API` expectation=`int_like` elapsedMs=`686` bytes=`10`

### Diagnosis

- `browser_session`: `unknown`
- `public_api`: `reachable`
- `authenticated_bot_access`: `failed`
- `likely_issue`: `authenticated_clob_validation_failed`

## Connectivity Test - 2026-05-09T19:29:29Z
# =====================================================

- Checked at: `2026-05-09T19:29:29Z`
- Root: `/mnt/c/Projects/lkcsite/polymarket-arbitrage-trading-botv4`
- Env file: `/mnt/c/Projects/lkcsite/polymarket-arbitrage-trading-botv4/.env`

### Overall Result

- Status: `fail`
- Valid preflight: `no`
- Public APIs: `pass`
- Authenticated CLOB: `fail`

### Environment

- `PAPER_TRADING`: `false`
- `POLYMARKET_SIGNATURE_TYPE`: `3`
- `POLYMARKET_PRIVATE_KEY`: `***redacted***`
- `SIGNER_ADDRESS`: `0x43d03F6a32E6B24a28AF6C1BA0cAF63F29afD3Ea`
- `PROXY_WALLET_ADDRESS`: `***redacted***`
- `POLYMARKET_API_KEY`: `***redacted***`
- `POLYMARKET_API_SECRET`: `***redacted***`
- `POLYMARKET_API_PASSPHRASE`: `***redacted***`
- `NODE_EXE`: `/mnt/c/Program Files/nodejs/node.exe`

### API Connectivity

- Overall: `success`
- `Gamma API`: `success`
  - URL: `https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=1`
  - HTTP: `200`
  - Response: `list[1] first(id=540817, question=New Rihanna Album before GTA VI?, conditionId=0x1fad72fae204143ff1c3035e99e7c0f65ea8d5cd9bd1070987bd1a3316f772be)`
- `Data API`: `success`
  - URL: `https://data-api.polymarket.com/trades?limit=1`
  - HTTP: `200`
  - Response: `list[1] first(conditionId=0x816e76cf8283a7befd45eab7fe552715cfbfdfaac6d4312304407e3bc5719d72, proxyWallet=0xc95eaf9e92eb694bbc9c928e36cceeaf1d16102a, side=BUY)`
- `CLOB API`: `success`
  - URL: `https://clob.polymarket.com/time`
  - HTTP: `200`
  - Response: `1778354989`

### Authenticated Connectivity

- Status: failed
- Error: `Authenticated CLOB validation failed`

- Validation errors:
  - `closedOnly returned an error response: {'error': 'Unauthorized/Invalid api key', 'status': 401}`
  - `collateral returned an error response: {'error': 'Unauthorized/Invalid api key', 'status': 401}`

### Verbose Details

- Verbose: `true`
- Secret source: `secret_command`
- Node modules: `/mnt/c/Projects/lkcsite/polymarket-arbitrage-trading-botv4/node_modules`
- `Gamma API` expectation=`non_empty_list` elapsedMs=`614` bytes=`6310`
- `Data API` expectation=`list` elapsedMs=`397` bytes=`829`
- `CLOB API` expectation=`int_like` elapsedMs=`850` bytes=`10`

### Diagnosis

- `browser_session`: `unknown`
- `public_api`: `reachable`
- `authenticated_bot_access`: `failed`
- `likely_issue`: `authenticated_clob_validation_failed`

## Connectivity Test - 2026-05-09T19:35:08Z
# =====================================================

- Checked at: `2026-05-09T19:35:08Z`
- Root: `/mnt/c/Projects/lkcsite/polymarket-arbitrage-trading-botv4`
- Env file: `/mnt/c/Projects/lkcsite/polymarket-arbitrage-trading-botv4/.env`

### Overall Result

- Status: `fail`
- Valid preflight: `no`
- Public APIs: `pass`
- Authenticated CLOB: `fail`

### Environment

- `PAPER_TRADING`: `false`
- `POLYMARKET_SIGNATURE_TYPE`: `3`
- `POLYMARKET_PRIVATE_KEY`: `***redacted***`
- `SIGNER_ADDRESS`: `(unknown)`
- `POLYMARKET_FUNDER_ADDRESS`: `(missing)`
- `PROXY_WALLET_ADDRESS` legacy: `***redacted***`
- `POLYMARKET_API_KEY`: `***redacted***`
- `POLYMARKET_API_SECRET`: `***redacted***`
- `POLYMARKET_API_PASSPHRASE`: `***redacted***`
- `NODE_EXE`: `/mnt/c/Program Files/nodejs/node.exe`

### API Connectivity

- Overall: `success`
- `Gamma API`: `success`
  - URL: `https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=1`
  - HTTP: `200`
  - Response: `list[1] first(id=540817, question=New Rihanna Album before GTA VI?, conditionId=0x1fad72fae204143ff1c3035e99e7c0f65ea8d5cd9bd1070987bd1a3316f772be)`
- `Data API`: `success`
  - URL: `https://data-api.polymarket.com/trades?limit=1`
  - HTTP: `200`
  - Response: `list[1] first(conditionId=0xea37927afde20f92dc612abf6f1ea46cc00a4aaf28a98393f3571393363f2ceb, proxyWallet=0x78fbff0af5bc9f6b3b5b7a3949f5beb6ae8809b0, side=SELL)`
- `CLOB API`: `success`
  - URL: `https://clob.polymarket.com/time`
  - HTTP: `200`
  - Response: `1778355324`

### Authenticated Connectivity

- Status: failed
- Error: `POLYMARKET_PRIVATE_KEY or POLYMARKET_FUNDER_ADDRESS/DEPOSIT_WALLET_ADDRESS is missing from the secret provider, process environment, or non-secret config`

### Verbose Details

- Verbose: `true`
- Secret source: `secret_command`
- Node modules: `/mnt/c/Projects/lkcsite/polymarket-arbitrage-trading-botv4/node_modules`
- `Gamma API` expectation=`non_empty_list` elapsedMs=`614` bytes=`6336`
- `Data API` expectation=`list` elapsedMs=`561` bytes=`720`
- `CLOB API` expectation=`int_like` elapsedMs=`338` bytes=`10`

### Diagnosis

- `browser_session`: `unknown`
- `public_api`: `reachable`
- `authenticated_bot_access`: `not_tested_missing_credentials`
- `likely_issue`: `missing_env_configuration`

## Connectivity Test - 2026-05-09T19:38:29Z
# =====================================================

- Checked at: `2026-05-09T19:38:29Z`
- Root: `/mnt/c/Projects/lkcsite/polymarket-arbitrage-trading-botv4`
- Env file: `/mnt/c/Projects/lkcsite/polymarket-arbitrage-trading-botv4/.env`

### Overall Result

- Status: `fail`
- Valid preflight: `no`
- Public APIs: `pass`
- Authenticated CLOB: `fail`

### Environment

- `PAPER_TRADING`: `false`
- `POLYMARKET_SIGNATURE_TYPE`: `3`
- `POLYMARKET_PRIVATE_KEY`: `***redacted***`
- `SIGNER_ADDRESS`: `0x43d03F6a32E6B24a28AF6C1BA0cAF63F29afD3Ea`
- `POLYMARKET_FUNDER_ADDRESS`: `***redacted***`
- `PROXY_WALLET_ADDRESS` legacy: `***redacted***`
- `POLYMARKET_API_KEY`: `***redacted***`
- `POLYMARKET_API_SECRET`: `***redacted***`
- `POLYMARKET_API_PASSPHRASE`: `***redacted***`
- `NODE_EXE`: `/mnt/c/Program Files/nodejs/node.exe`

### API Connectivity

- Overall: `success`
- `Gamma API`: `success`
  - URL: `https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=1`
  - HTTP: `200`
  - Response: `list[1] first(id=540817, question=New Rihanna Album before GTA VI?, conditionId=0x1fad72fae204143ff1c3035e99e7c0f65ea8d5cd9bd1070987bd1a3316f772be)`
- `Data API`: `success`
  - URL: `https://data-api.polymarket.com/trades?limit=1`
  - HTTP: `200`
  - Response: `list[1] first(conditionId=0xea37927afde20f92dc612abf6f1ea46cc00a4aaf28a98393f3571393363f2ceb, proxyWallet=0x78fbff0af5bc9f6b3b5b7a3949f5beb6ae8809b0, side=SELL)`
- `CLOB API`: `success`
  - URL: `https://clob.polymarket.com/time`
  - HTTP: `200`
  - Response: `1778355523`

### Authenticated Connectivity

- Status: failed
- Error: `Authenticated CLOB validation failed`

- Validation errors:
  - `serverTime is not a valid integer response`
  - `closedOnly returned an error response: {'error': 'Unauthorized/Invalid api key', 'status': 401}`
  - `collateral returned an error response: {'error': 'Unauthorized/Invalid api key', 'status': 401}`

### Verbose Details

- Verbose: `true`
- Secret source: `secret_command`
- Node modules: `/mnt/c/Projects/lkcsite/polymarket-arbitrage-trading-botv4/node_modules`
- `Gamma API` expectation=`non_empty_list` elapsedMs=`541` bytes=`6359`
- `Data API` expectation=`list` elapsedMs=`206` bytes=`720`
- `CLOB API` expectation=`int_like` elapsedMs=`284` bytes=`10`

### Diagnosis

- `browser_session`: `unknown`
- `public_api`: `reachable`
- `authenticated_bot_access`: `failed`
- `likely_issue`: `authenticated_clob_validation_failed`

## Connectivity Test - 2026-05-09T20:39:58Z
# =====================================================

- Checked at: `2026-05-09T20:39:58Z`
- Root: `C:\Projects\lkcsite\polymarket-arbitrage-trading-botv4`
- Env file: `C:\Projects\lkcsite\polymarket-arbitrage-trading-botv4\.env`

### Overall Result

- Status: `fail`
- Valid preflight: `no`
- Public APIs: `pass`
- Authenticated CLOB: `fail`

### Environment

- `PAPER_TRADING`: `false`
- `POLYMARKET_SIGNATURE_TYPE`: `3`
- `POLYMARKET_PRIVATE_KEY`: `***redacted***`
- `SIGNER_ADDRESS`: `0xD8BA74FB293468820c7Da4Bda48b9d84eD63642D`
- `POLYMARKET_FUNDER_ADDRESS`: `***redacted***`
- `PROXY_WALLET_ADDRESS` legacy: `***redacted***`
- `POLYMARKET_API_KEY`: `***redacted***`
- `POLYMARKET_API_SECRET`: `***redacted***`
- `POLYMARKET_API_PASSPHRASE`: `***redacted***`
- `NODE_EXE`: `C:\Program Files\nodejs\node.exe`

### API Connectivity

- Overall: `success`
- `Gamma API`: `success`
  - URL: `https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=1`
  - HTTP: `200`
  - Response: `list[1] first(id=540817, question=New Rihanna Album before GTA VI?, conditionId=0x1fad72fae204143ff1c3035e99e7c0f65ea8d5cd9bd1070987bd1a3316f772be)`
- `Data API`: `success`
  - URL: `https://data-api.polymarket.com/trades?limit=1`
  - HTTP: `200`
  - Response: `list[1] first(conditionId=0xd2a0aa8a9aa9a782b3f2da9341e9b2897626940d38be75e4a11f2d3da7ef2423, proxyWallet=0x562a11bcd7354ea82a09ed803cb1739d60862ad4, side=BUY)`
- `CLOB API`: `success`
  - URL: `https://clob.polymarket.com/time`
  - HTTP: `200`
  - Response: `1778359208`

### Authenticated Connectivity

- Status: failed
- Error: `Authenticated CLOB validation failed`

- Validation errors:
  - `closedOnly returned an error response: {'error': 'Unauthorized/Invalid api key', 'status': 401}`
  - `collateral returned an error response: {'error': 'Unauthorized/Invalid api key', 'status': 401}`

### Verbose Details

- Verbose: `true`
- Secret source: `secret_command`
- Node modules: `C:\Projects\lkcsite\polymarket-arbitrage-trading-botv4\node_modules`
- `Gamma API` expectation=`non_empty_list` elapsedMs=`484` bytes=`6324`
- `Data API` expectation=`list` elapsedMs=`318` bytes=`736`
- `CLOB API` expectation=`int_like` elapsedMs=`340` bytes=`10`

### Diagnosis

- `browser_session`: `unknown`
- `public_api`: `reachable`
- `authenticated_bot_access`: `failed`
- `likely_issue`: `authenticated_clob_validation_failed`


## Connectivity Test - 2026-05-09T20:52:46Z
# =====================================================

- Checked at: `2026-05-09T20:52:46Z`
- Root: `/mnt/c/Projects/lkcsite/polymarket-arbitrage-trading-botv4`
- Env file: `/mnt/c/Projects/lkcsite/polymarket-arbitrage-trading-botv4/.env`

### Overall Result

- Status: `pass`
- Valid preflight: `yes`
- Public APIs: `pass`
- Authenticated CLOB: `pass`

### Environment

- `PAPER_TRADING`: `false`
- `POLYMARKET_SIGNATURE_TYPE`: `3`
- `POLYMARKET_PRIVATE_KEY`: `***redacted***`
- `SIGNER_ADDRESS`: `0xD8BA74FB293468820c7Da4Bda48b9d84eD63642D`
- `POLYMARKET_FUNDER_ADDRESS`: `***redacted***`
- `PROXY_WALLET_ADDRESS` legacy: `***redacted***`
- `POLYMARKET_API_KEY`: `***redacted***`
- `POLYMARKET_API_SECRET`: `***redacted***`
- `POLYMARKET_API_PASSPHRASE`: `***redacted***`
- `NODE_EXE`: `/mnt/c/Program Files/nodejs/node.exe`

### API Connectivity

- Overall: `success`
- `Gamma API`: `success`
  - URL: `https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=1`
  - HTTP: `200`
  - Response: `list[1] first(id=540817, question=New Rihanna Album before GTA VI?, conditionId=0x1fad72fae204143ff1c3035e99e7c0f65ea8d5cd9bd1070987bd1a3316f772be)`
- `Data API`: `success`
  - URL: `https://data-api.polymarket.com/trades?limit=1`
  - HTTP: `200`
  - Response: `list[1] first(conditionId=0x0b4cc3b739e1dfe5d73274740e7308b6fb389c5af040c3a174923d928d134bee, proxyWallet=0x6032181b1bbbd74f4f6ffa3d1808c7e4bd1bfde9, side=BUY)`
- `CLOB API`: `success`
  - URL: `https://clob.polymarket.com/time`
  - HTTP: `200`
  - Response: `1778359978`

### Authenticated Connectivity

- Status: success
- Signer address: `0xD8BA74FB293468820c7Da4Bda48b9d84eD63642D`
- Funder address: `0x366256036425D2893656b40583B205ab78090e48`
- Server time: `1778359991`
- Derived API key: `***redacted***`
- Auth source: `manual_env`
- API keys count: `1`
- Closed only: `{"closed_only": false}`
- Collateral balance: `30000000`
- Collateral allowance: `3/3 spender allowances nonzero`

### Verbose Details

- Verbose: `true`
- Secret source: `secret_command`
- Node modules: `/mnt/c/Projects/lkcsite/polymarket-arbitrage-trading-botv4/node_modules`
- `Gamma API` expectation=`non_empty_list` elapsedMs=`628` bytes=`6444`
- `Data API` expectation=`list` elapsedMs=`417` bytes=`789`
- `CLOB API` expectation=`int_like` elapsedMs=`363` bytes=`10`
- Auth node path: `/mnt/c/Program Files/nodejs/node.exe`
- Auth elapsedMs: `12897`

### Diagnosis

- `browser_session`: `unknown`
- `public_api`: `reachable`
- `authenticated_bot_access`: `ok`
- `likely_issue`: `none`

## Connectivity Test - 2026-05-09T20:55:20Z
# =====================================================

- Checked at: `2026-05-09T20:55:20Z`
- Root: `C:\Projects\lkcsite\polymarket-arbitrage-trading-botv4`
- Env file: `C:\Projects\lkcsite\polymarket-arbitrage-trading-botv4\.env`

### Overall Result

- Status: `pass`
- Valid preflight: `yes`
- Public APIs: `pass`
- Authenticated CLOB: `pass`

### Environment

- `PAPER_TRADING`: `false`
- `POLYMARKET_SIGNATURE_TYPE`: `3`
- `POLYMARKET_PRIVATE_KEY`: `***redacted***`
- `SIGNER_ADDRESS`: `0xD8BA74FB293468820c7Da4Bda48b9d84eD63642D`
- `POLYMARKET_FUNDER_ADDRESS`: `***redacted***`
- `PROXY_WALLET_ADDRESS` legacy: `***redacted***`
- `POLYMARKET_API_KEY`: `***redacted***`
- `POLYMARKET_API_SECRET`: `***redacted***`
- `POLYMARKET_API_PASSPHRASE`: `***redacted***`
- `NODE_EXE`: `C:\Program Files\nodejs\node.exe`

### API Connectivity

- Overall: `success`
- `Gamma API`: `success`
  - URL: `https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=1`
  - HTTP: `200`
  - Response: `list[1] first(id=540817, question=New Rihanna Album before GTA VI?, conditionId=0x1fad72fae204143ff1c3035e99e7c0f65ea8d5cd9bd1070987bd1a3316f772be)`
- `Data API`: `success`
  - URL: `https://data-api.polymarket.com/trades?limit=1`
  - HTTP: `200`
  - Response: `list[1] first(conditionId=0x0b4cc3b739e1dfe5d73274740e7308b6fb389c5af040c3a174923d928d134bee, proxyWallet=0x6032181b1bbbd74f4f6ffa3d1808c7e4bd1bfde9, side=BUY)`
- `CLOB API`: `success`
  - URL: `https://clob.polymarket.com/time`
  - HTTP: `200`
  - Response: `1778360130`

### Authenticated Connectivity

- Status: success
- Signer address: `0xD8BA74FB293468820c7Da4Bda48b9d84eD63642D`
- Funder address: `0x366256036425D2893656b40583B205ab78090e48`
- Server time: `1778360139`
- Derived API key: `***redacted***`
- Auth source: `manual_env`
- API keys count: `1`
- Closed only: `{"closed_only": false}`
- Collateral balance: `30000000`
- Collateral allowance: `3/3 spender allowances nonzero`

### Verbose Details

- Verbose: `true`
- Secret source: `secret_command`
- Node modules: `C:\Projects\lkcsite\polymarket-arbitrage-trading-botv4\node_modules`
- `Gamma API` expectation=`non_empty_list` elapsedMs=`270` bytes=`6444`
- `Data API` expectation=`list` elapsedMs=`112` bytes=`789`
- `CLOB API` expectation=`int_like` elapsedMs=`257` bytes=`10`
- Auth node path: `C:\Program Files\nodejs\node.exe`
- Auth elapsedMs: `10045`

### Diagnosis

- `browser_session`: `unknown`
- `public_api`: `reachable`
- `authenticated_bot_access`: `ok`
- `likely_issue`: `none`


## Connectivity Test - 2026-05-09T23:00:47Z
# =====================================================

- Checked at: `2026-05-09T23:00:47Z`
- Root: `C:\Projects\lkcsite\polymarket-arbitrage-trading-botv4`
- Env file: `C:\Projects\lkcsite\polymarket-arbitrage-trading-botv4\.env`

### Overall Result

- Status: `pass`
- Valid preflight: `yes`
- Public APIs: `pass`
- Authenticated CLOB: `pass`

### Environment

- `PAPER_TRADING`: `false`
- `POLYMARKET_SIGNATURE_TYPE`: `3`
- `POLYMARKET_PRIVATE_KEY`: `***redacted***`
- `SIGNER_ADDRESS`: `0xD8BA74FB293468820c7Da4Bda48b9d84eD63642D`
- `POLYMARKET_FUNDER_ADDRESS`: `***redacted***`
- `PROXY_WALLET_ADDRESS` legacy: `***redacted***`
- `POLYMARKET_API_KEY`: `***redacted***`
- `POLYMARKET_API_SECRET`: `***redacted***`
- `POLYMARKET_API_PASSPHRASE`: `***redacted***`
- `NODE_EXE`: `C:\Program Files\nodejs\node.exe`

### API Connectivity

- Overall: `success`
- `Gamma API`: `success`
  - URL: `https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=1`
  - HTTP: `200`
  - Response: `list[1] first(id=540817, question=New Rihanna Album before GTA VI?, conditionId=0x1fad72fae204143ff1c3035e99e7c0f65ea8d5cd9bd1070987bd1a3316f772be)`
- `Data API`: `success`
  - URL: `https://data-api.polymarket.com/trades?limit=1`
  - HTTP: `200`
  - Response: `list[1] first(conditionId=0x3852722139943e302f425e79597d8f9c73c843655f6d1c18541f1df38542f089, proxyWallet=0x1a6f9c14f95caecafb7a9512c901294571538df2, side=BUY)`
- `CLOB API`: `success`
  - URL: `https://clob.polymarket.com/time`
  - HTTP: `200`
  - Response: `1778367658`

### Authenticated Connectivity

- Status: success
- Signer address: `0xD8BA74FB293468820c7Da4Bda48b9d84eD63642D`
- Funder address: `0x366256036425D2893656b40583B205ab78090e48`
- Server time: `1778367668`
- Derived API key: `***redacted***`
- Auth source: `manual_env`
- API keys count: `1`
- Closed only: `{"closed_only": false}`
- Collateral balance: `15026398`
- Collateral allowance: `3/3 spender allowances nonzero`

### Verbose Details

- Verbose: `true`
- Secret source: `secret_command`
- Node modules: `C:\Projects\lkcsite\polymarket-arbitrage-trading-botv4\node_modules`
- `Gamma API` expectation=`non_empty_list` elapsedMs=`458` bytes=`6509`
- `Data API` expectation=`list` elapsedMs=`319` bytes=`884`
- `CLOB API` expectation=`int_like` elapsedMs=`325` bytes=`10`
- Auth node path: `C:\Program Files\nodejs\node.exe`
- Auth elapsedMs: `10947`

### Diagnosis

- `browser_session`: `unknown`
- `public_api`: `reachable`
- `authenticated_bot_access`: `ok`
- `likely_issue`: `none`

