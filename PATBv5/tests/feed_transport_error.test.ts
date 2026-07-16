import assert from "node:assert/strict";

import { classifyTransportError, reconnectDelayFor } from "../src/feed/transportError";

function run(): void {
    const weakKey = Object.assign(new Error("EE certificate key too weak"), {
        code: "ERR_SSL_EE_KEY_TOO_SMALL",
    });
    const classified = classifyTransportError(weakKey);
    assert.equal(classified.category, "tls_certificate_policy");
    assert.equal(classified.errorCode, "ERR_SSL_EE_KEY_TOO_SMALL");
    assert.equal(reconnectDelayFor("tls_certificate_policy", 1), 60_000);
    assert.equal(reconnectDelayFor("tls_certificate_policy", 5), 900_000);
    assert.equal(reconnectDelayFor("socket_error", 1), 250);
    assert.equal(reconnectDelayFor("socket_error", 99), 8_000);

    const trustError = classifyTransportError(Object.assign(new Error("unable to verify the first certificate"), {
        code: "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
    }));
    assert.equal(trustError.category, "tls_certificate");

    const ordinary = classifyTransportError(new Error("read ECONNRESET"));
    assert.equal(ordinary.category, "socket_error");
}

run();
