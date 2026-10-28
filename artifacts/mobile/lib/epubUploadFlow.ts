export type FlowLock = { current: boolean };

/**
 * Runs one upload flow at a time and always releases the synchronous lock.
 * The lock closes the gap before React has rendered disabled controls.
 */
export async function runWithFlowLock<T>(
  lock: FlowLock,
  operation: () => Promise<T>,
): Promise<T | undefined> {
  if (lock.current) return undefined;

  lock.current = true;
  try {
    return await operation();
  } finally {
    lock.current = false;
  }
}

export async function continueAfterUploadConsent({
  saveConsent,
  waitForModalDismissal,
  closeModal,
  chooseFile,
}: {
  saveConsent: () => Promise<void>;
  waitForModalDismissal: () => Promise<void>;
  closeModal: () => void;
  chooseFile: () => Promise<void>;
}): Promise<void> {
  await saveConsent();
  const dismissed = waitForModalDismissal();
  closeModal();
  await dismissed;
  await chooseFile();
}
