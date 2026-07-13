import { spawn, type StdioOptions } from "child_process";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

export interface IsolatedTestResult {
    exitCode: number;
    signal: NodeJS.Signals | null;
    telemetryRoot: string;
}

export async function runIsolatedTest(
    target: string,
    args: string[] = [],
    stdio: StdioOptions = "inherit"
): Promise<IsolatedTestResult> {
    const telemetryRoot = await mkdtemp(join(tmpdir(), "patbv5-test-telemetry-"));
    const tsxCli = require.resolve("tsx/cli");
    const child = spawn(process.execPath, [tsxCli, target, ...args], {
        cwd: process.cwd(),
        env: {
            ...process.env,
            TELEMETRY_ROOT: telemetryRoot,
            BOT_TELEMETRY_ROOT: telemetryRoot,
        },
        stdio,
    });

    const forwardSignal = (signal: NodeJS.Signals) => {
        if (!child.killed) {
            child.kill(signal);
        }
    };
    const onSigint = () => forwardSignal("SIGINT");
    const onSigterm = () => forwardSignal("SIGTERM");
    process.once("SIGINT", onSigint);
    process.once("SIGTERM", onSigterm);

    try {
        const result = await new Promise<{ exitCode: number; signal: NodeJS.Signals | null }>((resolve, reject) => {
            child.once("error", reject);
            child.once("close", (exitCode, signal) => {
                resolve({ exitCode: exitCode ?? 1, signal });
            });
        });
        return { ...result, telemetryRoot };
    } finally {
        process.removeListener("SIGINT", onSigint);
        process.removeListener("SIGTERM", onSigterm);
        await rm(telemetryRoot, { recursive: true, force: true });
    }
}

async function main(): Promise<void> {
    const [target, ...args] = process.argv.slice(2);
    if (!target) {
        throw new Error("Usage: tsx scripts/run_isolated_test.ts <test-target> [...args]");
    }

    const result = await runIsolatedTest(target, args);
    if (result.signal) {
        console.error(`Test process terminated by ${result.signal}`);
    }
    process.exitCode = result.exitCode;
}

if (require.main === module) {
    main().catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });
}
