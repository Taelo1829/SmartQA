const SSE_HEADERS: HeadersInit = {
  'content-type': 'text/event-stream; charset=utf-8',
  'cache-control': 'no-cache, no-transform',
  connection: 'keep-alive',
  'x-accel-buffering': 'no',
};

/**
 * Minimal SSE responder. The handler receives `send` and returns a cleanup
 * function that runs when the client disconnects.
 */
export function sseStream(handler: (send: (payload: unknown, event?: string) => void) => () => void): Response {
  const encoder = new TextEncoder();
  let cleanup: (() => void) | null = null;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const send = (payload: unknown, event?: string) => {
        if (closed) return;
        try {
          const frame = `${event ? `event: ${event}\n` : ''}data: ${JSON.stringify(payload)}\n\n`;
          controller.enqueue(encoder.encode(frame));
        } catch {
          closed = true;
        }
      };
      cleanup = handler(send);
    },
    cancel() {
      cleanup?.();
      cleanup = null;
    },
  });
  return new Response(stream, { headers: SSE_HEADERS });
}
