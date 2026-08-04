export function createShutdownCoordinator(
  runShutdown: (reason: string) => Promise<void>,
): (reason: string) => Promise<void> {
  let inFlight: Promise<void> | null = null;
  return (reason: string) => {
    if (!inFlight) inFlight = runShutdown(reason);
    return inFlight;
  };
}
