# Report Machine launcher

## Objective

Add a PowerShell launcher named `report machine.ps1` at the repository root. Running it opens the PATBv5 report server in a separate, persistent PowerShell window.

## Behavior

1. Resolve the repository root from the launcher's own location.
2. Resolve the working directory as `<repository root>\PATBv5`.
3. Fail with a clear message if that directory does not exist.
4. Start a separate PowerShell process with `-NoExit`.
5. In the new process, change to the PATBv5 directory and execute `npm.cmd run report:serve`.
6. Leave the new window open so the server output remains visible and the user can stop it with `Ctrl+C`.

## Error handling

The launcher must stop before opening a new window when `PATBv5` is missing. Errors from npm remain visible in the separate PowerShell window.

## Validation

Parse the script with PowerShell's parser, then run it and confirm that a separate PowerShell process starts with the expected PATBv5 working directory and report command.

## Scope

No package scripts, report-server code, browser automation, or existing launcher files will be changed.
