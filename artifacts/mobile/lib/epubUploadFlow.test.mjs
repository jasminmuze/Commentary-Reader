import assert from "node:assert/strict";
import test from "node:test";
import {
  continueAfterUploadConsent,
  runWithFlowLock,
} from "./epubUploadFlow.ts";

test("first consent closes the modal before opening the picker", async () => {
  const events = [];
  let dismissModal;
  const flow = runWithFlowLock({ current: false }, () =>
    continueAfterUploadConsent({
      saveConsent: async () => events.push("consent-saved"),
      waitForModalDismissal: () =>
        new Promise((resolve) => {
          dismissModal = () => {
            events.push("modal-dismissed");
            resolve();
          };
        }),
      closeModal: () => events.push("modal-closing"),
      chooseFile: async () => {
        events.push("picker-opened");
        events.push("epub-uploaded");
        events.push("library-entry-added");
      },
    }),
  );

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ["consent-saved", "modal-closing"]);
  dismissModal();
  await flow;
  assert.deepEqual(events, [
    "consent-saved",
    "modal-closing",
    "modal-dismissed",
    "picker-opened",
    "epub-uploaded",
    "library-entry-added",
  ]);
});

test("picker cancellation releases the lock so the user can retry", async () => {
  const lock = { current: false };
  let pickerCalls = 0;

  await runWithFlowLock(lock, async () => {
    pickerCalls += 1;
    return; // DocumentPicker canceled; this is a normal completion.
  });

  assert.equal(lock.current, false);
  await runWithFlowLock(lock, async () => {
    pickerCalls += 1;
  });
  assert.equal(pickerCalls, 2);
});

test("picker and upload errors release the lock so each can be retried", async () => {
  for (const failedStep of ["picker", "upload", "library registration"]) {
    const lock = { current: false };
    let attempts = 0;

    await assert.rejects(
      runWithFlowLock(lock, async () => {
        attempts += 1;
        throw new Error(`${failedStep} failed`);
      }),
      new RegExp(`${failedStep} failed`),
    );
    assert.equal(lock.current, false);

    await runWithFlowLock(lock, async () => {
      attempts += 1;
      await continueAfterUploadConsent({
        saveConsent: async () => {},
        waitForModalDismissal: async () => {},
        closeModal: () => {},
        chooseFile: async () => {},
      });
    });
    assert.equal(attempts, 2);
    assert.equal(lock.current, false);
  }
});

test("failed consent persistence does not close the modal or open the picker", async () => {
  const events = [];
  await assert.rejects(
    continueAfterUploadConsent({
      saveConsent: async () => {
        events.push("save");
        throw new Error("storage unavailable");
      },
      waitForModalDismissal: async () => events.push("wait"),
      closeModal: () => events.push("close"),
      chooseFile: async () => events.push("picker"),
    }),
    /storage unavailable/,
  );
  assert.deepEqual(events, ["save"]);
});
