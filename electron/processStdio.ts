/**
 * A detached dev launcher can close the inherited terminal while Electron is
 * still handling one last renderer event. Node emits the resulting EIO/EPIPE
 * asynchronously on the stdio stream; without a listener that event becomes
 * an uncaught exception. Logging is best-effort, so a broken sink must not
 * bring down the application (the parent-process watchdog still reaps an
 * orphaned dev instance).
 */
type ProcessStdioStream = {
  on(event: "error", listener: (error: unknown) => void): unknown;
};

type ProcessStdioStreams = {
  stdout: ProcessStdioStream;
  stderr: ProcessStdioStream;
};

export function installProcessStdioErrorGuards(
  streams: ProcessStdioStreams = { stdout: process.stdout, stderr: process.stderr },
): void {
  const absorbStreamError = (_error: unknown): void => undefined;
  streams.stdout.on("error", absorbStreamError);
  streams.stderr.on("error", absorbStreamError);
}
