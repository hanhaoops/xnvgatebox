// The only public Cloudflare Worker entrypoint for xnvgatebox.
// Route modules stay in worker/control/worker.mjs so they remain unit-testable.
import { handleRequest } from '../control/worker.mjs';

export { handleRequest };
export default { fetch: handleRequest };
