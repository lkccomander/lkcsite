import { runFeedReadiness } from "../src/feed/readiness";

async function main(): Promise<void> {
    const result = await runFeedReadiness();
    for (const check of result.checks) {
        const status = check.ok ? "PASS" : "FAIL";
        console.log(`${status} ${check.name} ${check.endpoint} — ${check.message}`);
    }
    process.exitCode = result.ok ? 0 : 1;
}

void main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
