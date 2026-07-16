import assert from "node:assert/strict";

import { runFeedReadiness, type FeedReadinessProbes, type TlsProbeResult } from "../src/feed/readiness";

const validTls: TlsProbeResult = {
    authorized: true,
    protocol: "TLSv1.3",
    cipher: "TLS_AES_256_GCM_SHA384",
    issuer: "Google Trust Services",
    validTo: "Sep 30 10:50:18 2026 GMT",
    bits: 256,
};

async function run(): Promise<void> {
    const passingProbes: FeedReadinessProbes = {
        tls: async () => validTls,
        websocket: async () => ({ opened: true }),
    };
    const passing = await runFeedReadiness(passingProbes);
    assert.equal(passing.ok, true);
    assert.equal(passing.checks.length, 3);
    assert.ok(passing.checks.every((check) => check.ok));

    const failingProbes: FeedReadinessProbes = {
        tls: async () => {
            throw Object.assign(new Error("EE certificate key too weak"), {
                code: "ERR_SSL_EE_KEY_TOO_SMALL",
            });
        },
        websocket: async () => ({ opened: false, error: "not attempted" }),
    };
    const failing = await runFeedReadiness(failingProbes);
    assert.equal(failing.ok, false);
    assert.equal(failing.checks[0].category, "tls_certificate_policy");
    assert.match(failing.checks[0].message, /key too weak/i);
}

void run().then(
    () => process.exit(0),
    (error) => {
        console.error(error);
        process.exit(1);
    },
);
