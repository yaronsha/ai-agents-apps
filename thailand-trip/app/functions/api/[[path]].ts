// Pages Function: the app calls /api/* on its own address, and this hands the call to the
// worker through a service binding. Keeping one address means the Cloudflare Access sign-in
// cookie covers the API too (Safari would drop it on a call to another domain), and Access
// adds the signed Cf-Access-Jwt-Assertion header that the worker checks.

interface Env {
  WORKER?: { fetch(req: Request): Promise<Response> };
}

export const onRequest = async ({ request, env }: { request: Request; env: Env }): Promise<Response> => {
  const url = new URL(request.url);
  // The app sends the browser here when the sign-in ran out. This page is not cached by the
  // service worker, so the visit reaches Access, which signs in again and comes back here.
  if (url.pathname === "/api/login") return Response.redirect(new URL("/", url).toString(), 302);
  if (!env.WORKER) return Response.json({ error: "חסר חיבור לשרת (service binding WORKER)" }, { status: 500 });
  return env.WORKER.fetch(new Request(request));
};
