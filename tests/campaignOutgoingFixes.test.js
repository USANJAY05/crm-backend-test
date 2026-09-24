// tests/campaignOutgoingFixes.test.js
const { resolvePostCallOutcome } = require("../src/telephony/callFinalizer");
const { syncDialerProviderCallSid } = require("../src/telephony/vobizProxy");

describe("Campaign Outgoing Fixes", () => {
  describe("vobizProxy syntax and exports", () => {
    test("syncDialerProviderCallSid is defined as an async function", () => {
      expect(typeof syncDialerProviderCallSid).toBe("function");
      expect(syncDialerProviderCallSid.constructor.name).toBe("AsyncFunction");
    });
  });

  describe("resolvePostCallOutcome callback and retry handling", () => {
    test("schedules callback when caller requested callback on attempt 1", () => {
      const outcome = resolvePostCallOutcome({
        followUp: {
          callbackRequested: true,
          callbackTime: new Date(Date.now() + 3600000).toISOString(),
          querySummary: "Client in a meeting",
        },
        postCallSummary: null,
        isMachineDetected: false,
        attemptNumber: 1,
        retryContext: { taskId: "task-1", leadId: "lead-1" },
      });

      expect(outcome.finalStatus).toBe("Callback Scheduled");
      expect(outcome.callbackRequested).toBe(true);
      expect(outcome.enquiryRequested).toBe(false);
      expect(outcome.retryFieldsToSave.retryStatus).toBe("pending");
      expect(outcome.retryFieldsToSave.attemptNumber).toBe(1);
      expect(outcome.retryFieldsToSave.nextRetryAt).toBeDefined();
    });

    test("exhausts callback retries when attemptNumber >= MAX_RETRY_ATTEMPTS (3) and creates enquiry", () => {
      const outcome = resolvePostCallOutcome({
        followUp: {
          callbackRequested: true,
          callbackTime: new Date(Date.now() + 3600000).toISOString(),
          querySummary: "Customer busy driving",
        },
        postCallSummary: null,
        isMachineDetected: false,
        attemptNumber: 3,
        retryContext: { taskId: "task-1", leadId: "lead-1" },
      });

      expect(outcome.finalStatus).toBe("Completed");
      expect(outcome.callbackRequested).toBe(false);
      expect(outcome.enquiryRequested).toBe(true);
      expect(outcome.retryFieldsToSave.retryStatus).toBe("exhausted");
      expect(outcome.retryFieldsToSave.attemptNumber).toBe(3);
      expect(outcome.retryFieldsToSave.nextRetryAt).toBeNull();
      expect(outcome.enquirySummary).toBe("Customer busy driving");
    });

    test("creates enquiry directly when caller asks unanswerable question without callback", () => {
      const outcome = resolvePostCallOutcome({
        followUp: {
          callbackRequested: false,
          followUpPromised: true,
          querySummary: "Needs specialized loan terms",
        },
        postCallSummary: null,
        isMachineDetected: false,
        attemptNumber: 1,
        retryContext: null,
      });

      expect(outcome.finalStatus).toBe("Completed");
      expect(outcome.callbackRequested).toBe(false);
      expect(outcome.enquiryRequested).toBe(true);
      expect(outcome.enquirySummary).toBe("Needs specialized loan terms");
    });
  });

  describe("Telephony Outbound Provider Abstraction", () => {
    const telephony = require("../src/telephony/registry");

    test("vobiz provider is registered and supports outbound calling", () => {
      expect(telephony.supportsOutbound("vobiz")).toBe(true);
      expect(telephony.supportsOutbound("Vobiz.ai")).toBe(true);
    });

    test("unregistered or stream-only provider returns false for supportsOutbound", () => {
      expect(telephony.supportsOutbound("gemini")).toBe(false); // browser test stream only, no outbound dial
      expect(telephony.supportsOutbound("unregistered_provider")).toBe(false);
      expect(telephony.supportsOutbound(null)).toBe(false);
    });

    test("dynamically registered new provider (e.g. twilio) automatically supports outbound dialing and hangup", async () => {
      const mockDial = jest.fn().mockResolvedValue({ success: true, callSid: "mock_call_123" });
      const mockHangup = jest.fn().mockResolvedValue({ success: true });

      telephony.register({
        name: "mock-twilio",
        label: "Mock Twilio Provider",
        wsPaths: ["/mock-twilio/stream"],
        handleUpgrade: () => {},
        getRouter: () => require("express").Router(),
        triggerOutboundCall: mockDial,
        hangupCall: mockHangup,
      });

      expect(telephony.supportsOutbound("mock-twilio")).toBe(true);
      expect(telephony.supportsOutbound("Mock Twilio Provider")).toBe(true);

      const res = await telephony.triggerOutboundCall("mock-twilio", "org-1", "+919876543210", { attemptNumber: 1 });
      expect(res.callSid).toBe("mock_call_123");
      expect(mockDial).toHaveBeenCalledWith("org-1", "+919876543210", { attemptNumber: 1 });

      await telephony.hangupCall("mock-twilio", "mock_call_123", "org-1");
      expect(mockHangup).toHaveBeenCalledWith("mock_call_123", "org-1");
    });
  });
});

