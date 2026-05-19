/**
 * __tests__/telemetry.test.ts — Telemetry module tests.
 */

import { describe, it } from "node:test";
import assert from "node:assert";
import { buildPayload, sendHeartbeat } from "../utils/telemetry.ts";

describe("telemetry", () => {
  describe("buildPayload", () => {
    it("creates payload with correct structure", () => {
      const payload = buildPayload("1.7.2", "full");
      
      assert.strictEqual(payload.version, "1.7.2");
      assert.strictEqual(payload.mode, "full");
      assert.ok(payload.agentId.startsWith("anon_"), "agentId should start with anon_");
      assert.ok(payload.agentId.length > 5, "agentId should have meaningful length");
    });

    it("generates stable agentId for same environment", () => {
      const payload1 = buildPayload("1.7.2", "full");
      const payload2 = buildPayload("1.7.2", "full");
      
      assert.strictEqual(payload1.agentId, payload2.agentId, "same machine should have same agentId");
    });

    it("supports lite mode", () => {
      const payload = buildPayload("1.7.2", "lite");
      
      assert.strictEqual(payload.mode, "lite");
    });
  });

  describe("sendHeartbeat", () => {
    it("sends heartbeat without throwing", async () => {
      const payload = buildPayload("1.7.2", "full");
      
      // Should not throw even with invalid URL
      await assert.doesNotReject(
        sendHeartbeat(payload, "http://localhost:99999/nonexistent")
      );
    });

    it("uses default URL when none provided", async () => {
      const payload = buildPayload("1.7.2", "full");
      
      // Should use default URL and not throw
      await assert.doesNotReject(sendHeartbeat(payload));
    });
  });
});
