// Stand-in for https://deno.land/std@0.190.0/http/server.ts: keeps the handler instead of listening.
type Handler = (req: Request) => Response | Promise<Response>;
const holder = globalThis as { __edgeHandler?: Handler };

export function serve(handler: Handler): void {
  holder.__edgeHandler = handler;
}

export function servedHandler(): Handler {
  if (!holder.__edgeHandler) throw new Error('serve() was not called');
  return holder.__edgeHandler;
}
