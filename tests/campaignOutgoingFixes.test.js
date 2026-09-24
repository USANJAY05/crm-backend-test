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
});
