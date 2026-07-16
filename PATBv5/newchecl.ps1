cd C:\Projects\lkcsite\PATBv5

$latest = Get-ChildItem ..\polydb\telemetry\sessions\*.jsonl |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1

$latest.FullName

npm run analyze:trades -- --telemetry-file "$($latest.FullName)"
npm run validate:signals -- --telemetry-file "$($latest.FullName)"
npm run report -- --file "$($latest.FullName)" --tail 250000cd C:\Projects\lkcsite\PATBv5

$latest = Get-ChildItem ..\polydb\telemetry\sessions\*.jsonl |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1

$latest.FullName

npm run analyze:trades -- --telemetry-file "$($latest.FullName)"
npm run validate:signals -- --telemetry-file "$($latest.FullName)"
npm run report -- --file "$($latest.FullName)" --tail 250000
