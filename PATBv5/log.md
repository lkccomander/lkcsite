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

## Paper Trading Session Review - 2026-07-28

- Telemetry session: `C:\Projects\lkcsite\polydb\telemetry\sessions\2026-07-28T01-49-42-875Z__5f3eb9ee-5fc7-415f-834e-554c395a23ad.jsonl`
- Mode: `PAPER`; strategy: `trade_5x_close31_paper`.
- Observed period: `2026-07-28T01:49:44Z` to `2026-07-28T16:15:39Z`; the session was still emitting events when reviewed.
- Markets processed: `174`; entries and completed exits: `20` each (no open paper position observed).
- Balance: `$201.20` initial → `$197.56` latest; realized P&L: `-$3.64` (`-1.81%`).
- Exits: `10` take-profits for `+$7.10` total and `10` stop-losses for `-$10.74` total.
- Signal filtering: `98,194` rejections. Main reasons were `up_bias_filter` (`31,478`), `entry_price_window` (`19,515`), `entry_time_ratio` (`9,400`), `spread_too_wide` (`8,702`), and `down_blocked_neutral_momentum` (`6,547`).
- Feed resilience: `311` disconnect/reconnect cycles, `1,329` fallbacks, `3,723` fallback recoveries, and `50` feed errors (including REST-fallback timeouts). Trades were still completed using websocket decisions.

### Follow-up

- Keep this run in paper mode. Before changing entry thresholds or enabling live trading, export the completed session metrics and compare trade outcomes by side, entry price, hold time, and feed state; the current 20-trade sample is too small and negative to justify loosening filters.
- Investigate the feed instability separately: correlate `feed.error`, fallback, and reconnect events with rejected or losing trades, then address timeouts/reconnect behavior if a material relationship appears.

### Per-trade analysis

- `UP`: `14` trades, `7` wins / `7` losses, realized P&L `-$3.26`.
- `DOWN`: `6` trades, `3` wins / `3` losses, realized P&L `-$0.38`.
- Take-profit outcomes averaged `+$0.71` (`+$7.10 / 10`), while stop-loss outcomes averaged `-$1.07` (`-$10.74 / 10`). At those payoffs, break-even requires roughly a `60.2%` win rate; the observed win rate was `50%`.
- Only `3/20` completed trades had a nonzero fallback count. Their combined P&L was `+$0.44` (two winners, one loser), so this sample does not support blaming fallback/reconnect events for the negative result.
- No live-trading change is justified. Prioritize testing a better reward-to-risk structure (smaller stop loss and/or a larger take-profit) in a separate paper configuration, while keeping the current configuration as the control.

## Consolidated PAPER Review - 2026-07-29

Sessions:

- `2026-07-28T01-49-42-875Z__5f3eb9ee-5fc7-415f-834e-554c395a23ad.jsonl`: `175` markets selected, `20` completed trades, `-$3.64` P&L, and `$5.89` maximum peak-to-trough drawdown. The last balance checkpoint was `$197.56`. There is no `bot.shutdown` event; normal trading telemetry stops at `2026-07-28T16:15:39Z`, while delayed `trade.shadow_pnl` settlement events continue afterward.
- `2026-07-29T19-03-54-747Z__f3e07433-7022-4210-a9ef-de13df7d4097.jsonl`: `56` markets selected, `16` completed trades, `+$2.15` P&L, and `$3.53` maximum peak-to-trough drawdown. It shut down normally by `SIGINT` with a final balance of `$198.11`.

### Combined trade results

- `231` markets selected and `36` completed trades (`36` buys / `36` sells).
- P&L: `-$1.49`; `19` wins / `17` losses; win rate `52.78%`.
- Gross wins: `+$15.96`; gross losses: `-$17.45`; profit factor `0.91`.
- Average win: `+$0.84`; average loss: `-$1.03`; expectancy: `-$0.041` per trade.
- All `36` sells report `feeUsd=0`, so the consolidated PAPER result is optimistic relative to any execution that incurs costs.
- `6/36` trades had a nonzero fallback count and together produced `+$0.55`; the sample still does not identify feed fallback as the source of the negative expectancy.

### Side split and experiment decision

- `DOWN`: `15` trades, `9` wins / `6` losses, P&L `+$1.85`, profit factor `1.33`, expectancy `+$0.123` per trade, observed win rate `60.0%` versus approximately `52.95%` required to break even.
- `UP`: `21` trades, `10` wins / `11` losses, P&L `-$3.34`, profit factor `0.72`, expectancy `-$0.159` per trade, observed win rate `47.62%` versus approximately `55.83%` required to break even.
- Do not change the global `stop_loss_offset=0.13`; that would also alter the currently profitable DOWN side.
- Selected next experiment: a separate DOWN-only PAPER profile based on `trade_5x_close31_paper`, changing only `paper_disable_up_entries=true`. Keep take profit, stop loss, entry filters, and feed gates unchanged, and preserve the current profile as the control.
- Minimum evaluation gate: collect at least `50` completed DOWN trades, require positive expectancy after modeled fees/slippage and profit factor above `1.0`, and compare drawdown against the unchanged control before considering another adjustment. No LIVE promotion is authorized by this sample.

### DOWN-only PAPER profile implemented - 2026-07-29

- Added the inactive strategy/profile `trade_5x_close31_down_paper`.
- The active strategy remains `trade_5x_close31_paper`, so this change does not alter the running control.
- The experiment is a parsed copy of the control and differs only in `paper_disable_up_entries=true`; `stop_loss_offset=0.13`, take profit, entry filters, feed gates, and all other settings remain identical.
- Added runtime routing for the new strategy and a regression test that loads both profiles, proves that only the UP-disable flag differs, and parses a temporary configuration with the experiment selected.
- Validation passed: `strategy_profiles`, `entry_ratio`, `entry_timing`, and `feedgate` tests; TypeScript build also passed.
- Operational next step: during a planned PAPER-only start, explicitly select `trade_5x_close31_down_paper`, confirm UP signals are rejected as `paper_up_entries_disabled`, and collect at least `50` completed DOWN trades before evaluating the gate above. Do not promote to LIVE.

Codebase-map note: the installed Graphify `0.8.37` does not accept backend `nvidia`, but the backend-free update ultimately refreshed the report and graph from current commit `1724acc5`.

### Manual PAPER launcher correction - 2026-07-29

- The operator selected `trade_5x_close31_down_paper` and retained `PAPER_TRADING=true`.
- The first manual `run_bot.ps1` attempt stopped before build/start because the launcher explicitly passed empty `Mode` and `RequestedMode` values into PowerShell `ValidateSet` parameters.
- Corrected `run_bot.ps1` to bind those parameters only for complete controlled launches. Manual launches now omit them and resolve the mode authoritatively from `.env`; partial controlled launches still fail closed.
- Validation passed: PowerShell parse, manual-mode smoke check (`controlled=False`, `mode=PAPER`, `source=ENV_FILE`), controlled-launcher regression suite, and run-bot session-summary suite.

## PAPER versus LIVE realism audit - 2026-07-30

- Current overall realism estimate for reproducing LIVE P&L: **35/100**.
- Market data, signals, strategy filters, and timing are relatively realistic: approximately **80/100**.
- Execution and P&L simulation are weak: approximately **20/100**.
- Across the July 28-30 sessions there were `36` closed PAPER trades and `72` simulated legs. Every leg was reported as a complete maker fill after `139-234 ms` (average `182.6 ms`), with no partial fills, rejects, or cancellations.
- All `72` legs reported `makerMode=true`, `feeUsd=0`, and zero rebate. However, `35/36` entries were priced at the then-best ask and therefore were marketable/taker-like rather than proven maker fills.
- PAPER estimates maker queue position only from spread and guarantees a complete fill after a short delay unless feed age, RTT, or spread crosses a simple rejection threshold. It does not model L2 depth, queue volume ahead, trade-through, partial fills, order submission failures, price movement while resting, or adverse selection.
- The exit assumption is especially optimistic: `16/17` stop-loss exits were resting or inside the spread rather than immediately marketable, but PAPER marked every one as filled. A comparable LIVE exit could remain pending while the market continues moving against the position.
- Polymarket charges zero fee only when an order actually provides maker liquidity. GTC orders may rest or fill partially, and orders that consume liquidity are taker executions subject to the market's current fee parameters.
- The combined PAPER result was already `-$1.49`; it is not evidence of a reproducible LIVE edge. Keep the bot in PAPER mode and use the run to evaluate stability, signal frequency, direction, and feed quality—not LIVE-equivalent profitability.

### TODO before considering LIVE

- [ ] Keep collecting PAPER telemetry and perform the next formal review after approximately `100` closed trades; retain the existing minimum gate of `50` completed DOWN trades for the DOWN-only experiment.
- [ ] Replace guaranteed maker fills with an L2-aware model using displayed depth, queue ahead, subsequent trades/book depletion, and price revalidation.
- [ ] Model partial fills, unfilled GTC orders, cancellations, rejects, submission latency, repricing, and adverse selection.
- [ ] Determine maker/taker status from the simulated execution rather than the requested `makerMode` flag.
- [ ] Load current fee parameters per market and apply taker fees only when liquidity is consumed; model maker rebates separately and conservatively.
- [ ] Add tests and telemetry for the cases above, then recalibrate PAPER against controlled, minimal-risk LIVE observations before any promotion decision.
- [ ] Do not authorize LIVE solely from PAPER P&L or win rate.

References:

- Polymarket fees: https://docs.polymarket.com/trading/fees
- Polymarket order behavior: https://docs.polymarket.com/trading/orders/overview

## PAPER telemetry lifecycle verification — 2026-08-11

- Session: `0c73aac5-d77a-4a75-a50c-0f35654e1e64`; strategy: `trade_5x_close31_down_paper_relaxed`; mode: `PAPER`.
- The session terminated cleanly and intentionally: `feed.summary` recorded `shutdown_SIGTERM`, followed by `bot.shutdown` with `reason=SIGTERM` and `endingBalance=$84.41`. This is not evidence of a crash or an unflushed shutdown.
- The final `recent_ws_fallback` rejection was correct. A `stale_snapshot` fallback occurred at `00:04:30.486Z`; the candidate entry was evaluated `4,039 ms` later, while `recentWsFallbackCooldownMs=5,000`. The decision was therefore rejected with about `961 ms` of cooldown still remaining.
- Feed condition at shutdown was otherwise healthy: `5,793` websocket ticks, `0` REST ticks, no disconnects, average latency `88.16 ms`, average RTT `178.96 ms`, and one stale-snapshot fallback. The fallback protection acted as designed; it was not sustained transport failure.
- The file was not yet visible on the network telemetry share when verified. The pasted terminal telemetry is complete enough to validate the lifecycle and gate behavior.

## Profitability plan review - 2026-08-15

- Primary objective remains real profitability, not merely improving the PAPER curve.
- Recent Pi-session review showed a material balance drawdown from approximately `$101.28` to `$86.91` across the long-running PAPER session, with realized exits skewing toward `stop_loss` rather than `take_profit`.
- That result does not satisfy the standing evaluation gate from `2026-07-29`: positive expectancy after modeled fees/slippage, profit factor above `1.0`, and enough completed DOWN trades before considering another adjustment.
- The session also does not justify LIVE promotion. Stability improved in many windows, but repeated websocket fallback and stale-snapshot bursts still occurred, and the realized P&L remained negative.

### Working priorities

- [ ] Improve PAPER execution realism first so profitability signals are less likely to be simulator artifacts.
- [ ] Reduce bad entries and stop-loss frequency before increasing aggressiveness or loosening gates.
- [ ] Keep stability and profitability as separate tracked goals: transport health must remain acceptable, but positive expectancy is the real promotion gate.
- [ ] Require profitability reviews to report at minimum: completed trades, win rate, average win, average loss, expectancy, profit factor, and drawdown versus control.
- [ ] Leave the current PAPER session running unchanged through the next observation window and review it tomorrow for acceptance ratio, trade frequency, side mix, realized P&L, and drawdown before changing filters again.

### Immediate profitability plan

- [ ] Rework PAPER fills to model queue ahead, depth, partial fills, missed fills, and adverse movement while resting.
- [ ] Reclassify executions as maker or taker from simulated behavior rather than requested intent, and apply conservative fees accordingly.
- [ ] Analyze realized losers by side, entry price bucket, momentum state, MC convergence bucket, and feed condition to isolate the highest-damage entry patterns.
- [ ] Preserve a control profile and test changes in isolated PAPER experiments rather than editing the baseline in place.
- [ ] Do not move to production until a fresh PAPER cohort demonstrates positive expectancy, profit factor greater than `1.0`, controlled drawdown, and acceptable feed behavior over a meaningful sample.

### Executable checklist

#### Phase 1 — Make PAPER harder to fool

- [ ] Add a telemetry field that records whether each PAPER entry or exit was immediately marketable at decision time.
- [ ] Record displayed bid, ask, mid, and spread at order placement and at simulated fill time for every `paper_trade.buy` and `paper_trade.sell`.
- [ ] Add simulated outcomes for `full_fill`, `partial_fill`, `missed_fill`, `cancelled`, and `repriced_fill` instead of always resolving to a complete fill.
- [ ] Persist simulated queue-ahead and depth-consumed estimates on PAPER fills so trade review can separate strong fills from optimistic fills.
- [ ] Determine maker/taker status from simulated execution outcome and write explicit `executionRole=maker|taker` telemetry.
- [ ] Apply nonzero taker fees whenever liquidity is consumed; keep maker rebates conservative and optional.
- [ ] Add regression tests covering partial fills, missed stop-loss exits, and price-moving-away while a GTC order is resting.

#### Phase 2 — Find where the losses come from

- [ ] Build a trade review script that groups realized P&L by `side`, `sell reason`, `entry price bucket`, `seconds before close`, `momentum direction`, `momentum confidence bucket`, `MC convergence bucket`, and `feed fallback presence`.
- [ ] Add a loser-focused report section: top loss buckets, average loser, median loser, worst loser, and count of losses after fallback or reconnect windows.
- [ ] Compare `UP` and `DOWN` expectancy separately on the active relaxed profile.
- [ ] Compute reward-to-risk by bucket: average winner divided by average loser, not just win rate.
- [ ] Flag patterns where stop-loss exits cluster in a specific entry-price band or low-confidence momentum band.

#### Phase 3 — Change strategy safely

- [ ] Keep the current profile as control and create separate experiment profiles for each hypothesis instead of stacking changes in one config.
- [ ] Test one hypothesis at a time, starting with the highest-damage loser bucket from Phase 2.
- [ ] Candidate hypothesis order:
- [ ] Tighten or block weak entry-price bands that produce repeated stop losses.
- [ ] Raise minimum momentum confidence for the losing side/bucket only if data shows weak alignment.
- [ ] Raise minimum MC convergence only if accepted losing trades cluster near threshold.
- [ ] Shorten stop-loss patience only if PAPER realism changes show exits are too late, not merely because P&L is red.
- [ ] Expand take-profit only if winners are frequent enough and current exits are consistently truncating good trades.

#### Phase 4 — Promotion gate

- [ ] Do not consider production until a fresh cohort shows at least `50` completed trades for the active experiment and positive expectancy after modeled fees.
- [ ] Require profit factor `> 1.0`, controlled drawdown versus control, and no evidence that the result depends on optimistic fills.
- [ ] Require feed stability to remain within the configured fallback gates during the same cohort.
- [ ] Run the same report against control and experiment before selecting the next production candidate.

## 2026-08-16 05:14 UTC

### Progress note

- Reviewed the latest telemetry session `d38f9c3c-87a3-4c34-9cfa-bfec06c4af5d` and confirmed the bot was healthy enough to run but produced `0` accepted entries, `0` orders, and `0` executed trades.
- Confirmed the main blockers in the latest session were entry gating rather than crashes: `directional_momentum_required`, `entry_price_window`, `down_blocked_neutral_momentum`, `entry_latency_gate`, and `max_feed_age_ms`.
- Reviewed the latest session-review HTML reports and found a reporting issue: per-window `rttP95` was effectively unusable because windows were defaulting to `0` unless the summary payload carried p95 directly.
- Updated report generation so per-window `rttP95` is derived from raw `feed.rtt` samples when available.
- Updated the report UI to clarify that fallback totals are raw fallback-event counts, not final feed-summary state, and to show when report source files come from an external telemetry root.
- Preserved the old `trade_5x_close31_down_paper_relaxed` profile as a legacy traced profile instead of overwriting it.
- Created and activated a new tracing-friendly paper-learning strategy: `trade_5x_close31_down_paper_learning`.
- Added strategy version metadata in `polydb/evaluation/strategy_versions/trade_5x_close31_down_paper_learning_v001.json`.

### Active learning profile

- Active strategy in `trade.toml` is now `trade_5x_close31_down_paper_learning`.
- Learning-profile deltas versus legacy relaxed profile:
- wider entry window: `entry_price_ratio = [0.08, 0.46]`
- wider price bounds: `0.40` to `0.90`
- looser feed tolerances: latency `500ms`, RTT `750ms`, entry age `900ms`, max feed age `650ms`
- wider spread gate: `0.04`
- `DOWN` no longer blocks neutral momentum
- `UP` no longer requires directional momentum or MC-direction agreement
- softer `UP` BTC momentum thresholds: delta `0.0003`, confidence `0.20`, MC convergence `0.65`

### Constraints hit today

- Could not run the Node/TS report test suite end-to-end from this environment because the Windows/WSL bridge failed during command execution.
- Static code and diff review completed, but runtime verification of regenerated reports remains pending.

### Resume here tomorrow

- Regenerate session-review reports using the new report parser/template changes and confirm that per-window `P95 RTT` is populated meaningfully.
- Run a fresh PAPER session under `trade_5x_close31_down_paper_learning`.
- Review whether accepted entries, orders, and completed paper trades start appearing.
- Compare new telemetry against the legacy relaxed profile to verify that higher trade throughput is being achieved without completely destroying selectivity.

## 2026-08-17

### Pending

- [ ] Run a fresh PAPER validation session on `trade_5x_close31_down_paper_learning` after the latest telemetry fixes.
- [ ] Confirm new sessions record non-`unknown` `gitCommit`, `gitBranch`, and `botBuildVersionId` in `versionContext`.
- [ ] Verify `feed.tick` telemetry volume is materially reduced after the new central throttle.
- [ ] Confirm the feed degradation guard aborts pathological long-running degraded sessions instead of letting them run for many hours.
- [ ] Review the first post-fix session for `feed.summary` and any `feed_degradation_abort` evidence.
- [ ] Add the next telemetry-noise reduction pass for `trade.signal_rejected`, ideally by aggregation or controlled sampling.
- [ ] Tighten handling for `subscription_missing` and `stale_snapshot`, since both still show up as dominant fallback reasons in recent sessions.
- [ ] Re-run `npm run build` and keep the project compiling clean after each follow-up fix batch.

### Live/Paper forensic review - 2026-08-17

- Reviewed PAPER session `930ec601-45fe-4de0-96ea-971c912e93ad` from Monday, August 17, 2026. The session ended positive in PAPER, but the main conclusion was not "promote to LIVE"; it was that the large entry filters (`up_bias_filter`, `entry_time_ratio`, `min_fee_adjusted_edge`, `entry_price_window`) all rejected sets of trades with negative aggregate shadow P&L.
- Reviewed LIVE session `1a49c37f-2822-4db0-a6ca-38c44c28b1c5` from Monday, August 17, 2026. It closed slightly positive overall, but exposed a critical execution-state issue: an order was `matched` at the provider, the bot timed out waiting for token balance confirmation, and only later recovered the real open position via `trade.position_resolved` with `reason=entry_timeout_balance_detected`.
- The first LIVE trade was profitable, but its success does not clear the system for scale because the position-reconciliation path was not safe enough for unattended promotion.
- The second LIVE trade was a normal losing `DOWN` trade that hit `stop_loss`; this confirms the current profile still accepts some weak or ambiguous `DOWN` entries in live conditions.

### Operating conclusion - 2026-08-17

- The current bottleneck is epistemic and operational at the same time: not enough stable-sample evidence of edge, plus at least one unresolved LIVE execution bug.
- Do not scale LIVE until the fill-reconciliation path is hardened and a frozen configuration produces a clean sample.
- Keep the strategy simplification idea on the table, but execution correctness comes first.

### Seven-day rescue plan - starting Monday, August 17, 2026

#### Day 1 - Freeze baseline and stop contaminating samples

- [ ] Freeze one exact strategy/configuration snapshot for evaluation and record its config hash, strategy version id, build version id, and git commit in the log before any further validation runs.
- [ ] Treat any strategy/filter change before the next clean cohort as a cohort reset.
- [ ] Confirm new sessions record non-`unknown` `gitCommit`, `gitBranch`, and `botBuildVersionId` in `versionContext`.
- [ ] Re-run `npm run build` and keep the project compiling clean after each follow-up fix batch.

#### Day 2 - Fix LIVE entry reconciliation before more real-money exposure

- [ ] Reproduce and trace the `entry_timeout_balance_detected` path from LIVE session `1a49c37f-2822-4db0-a6ca-38c44c28b1c5`.
- [ ] Make the post-fill state machine treat provider `matched/filled` status plus delayed balance visibility as a first-class reconciliation flow rather than an ambiguous timeout.
- [ ] Add telemetry that records: provider order status poll results, balance-check attempts, time-to-balance-visibility, and final reconciliation outcome for every live entry.
- [ ] Add regression coverage for "provider matched before token balance appears" so an open position cannot be temporarily misclassified as flat.
- [ ] Next patch after introducing `ENTRY_RECONCILING`: extract the duplicated LIVE entry-timeout handling for `UP` and `DOWN` into one helper, then add richer reconciliation telemetry (`balanceCheckAttempts`, `firstProviderMatchedAt`, `timeToBalanceVisibilityMs`, `reconciliationOutcome`).

#### Day 3 - Validate transport and degraded-session controls

- [ ] Verify `feed.tick` telemetry volume is materially reduced after the new central throttle.
- [ ] Confirm the feed degradation guard aborts pathological long-running degraded sessions instead of letting them run for many hours.
- [ ] Review the first post-fix session for `feed.summary` and any `feed_degradation_abort` evidence.
- [ ] Tighten handling for `subscription_missing` and `stale_snapshot`, since both still show up as dominant fallback reasons in recent sessions.
- [ ] Add the next telemetry-noise reduction pass for `trade.signal_rejected`, ideally by aggregation or controlled sampling.

#### Day 4 - Repair the momentum signal instead of routing around it

- [ ] Audit why momentum stays `NEUTRAL` almost all the time under current thresholds and verify the candle inputs, lookback alignment, and bucket math.
- [ ] Produce one explicit before/after diagnostic for momentum on real telemetry: delta1m, delta5m, confidence, vol ratio, and final direction on sampled trades.
- [ ] Do not rely on disabled guards like "allow neutral momentum" as a substitute for fixing the module if the math itself is wrong.

#### Day 5 - Rebuild PAPER realism and keep the cohort clean

- [ ] Run a fresh PAPER validation session on `trade_5x_close31_down_paper_learning` only after the execution and telemetry fixes above are in place.
- [ ] Continue the existing realism work: queue ahead, depth, partial fills, missed fills, adverse movement while resting, and maker/taker classification from simulated behavior.
- [ ] Keep the current profile as the frozen control while collecting the first clean post-fix cohort.

#### Day 6 - Measure edge correctly

- [ ] Build or refresh the trade review report so it outputs: completed trades, win rate, average win, average loss, expectancy, profit factor, drawdown, hold-time distribution, and feed-quality-at-entry splits.
- [ ] Add explicit loser-bucket analysis by side, entry price bucket, momentum state, MC convergence bucket, and feed condition.
- [ ] Separate technical failures from market failures: losses caused by execution/reconciliation issues must not be mixed into strategy-edge conclusions.

#### Day 7 - Decide what to do next

- [ ] Decide whether the frozen profile is good enough to keep gathering a full cohort, or whether simplification should start immediately after execution is proven safe.
- [ ] If simplification is needed, start from a reduced filter set instead of adding more knobs: preserve `entry_price_window`, a basic feed-health gate, and the minimum `DOWN` quality gate that survives the report evidence.
- [ ] Do not scale LIVE position size unless the execution path is clean and the frozen cohort shows positive expectancy after realistic fees/slippage.

### Promotion gate update - 2026-08-17

- LIVE can continue only in minimal-risk diagnostic mode while Days 1-3 are being completed; do not treat it as scalable production.
- Do not authorize scaled LIVE from single-session P&L, win rate, or one successful `DOWN` capture.
- The next real promotion decision requires both:
- a clean execution/reconciliation path in live conditions
- a stable PAPER or micro-LIVE cohort under a frozen configuration with positive expectancy after realistic execution assumptions

### Carry-forward tasks folded into the rescue plan

- Existing compile-check, version-context, feed-summary, degradation-guard, telemetry-noise, and fallback-handling tasks remain active and are now part of the seven-day plan above rather than separate disconnected TODOs.

