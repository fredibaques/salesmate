export type RecordedRequest = { method: string; url: string; headers: Record<string, string>; body: unknown };

/**
 * Minimal fetch double: routes are matched by "METHOD url-prefix" and return
 * JSON. Every request is recorded for assertions.
 */
export function mockFetch(routes: Record<string, (req: RecordedRequest) => unknown>) {
  const requests: RecordedRequest[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    let body: unknown = init?.body;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
        // form or raw body
      }
    } else if (body instanceof URLSearchParams) {
      body = Object.fromEntries(body.entries());
    }
    const req = { method, url, headers, body };
    requests.push(req);
    const key = Object.keys(routes)
      .filter((k) => {
        const [m, prefix] = k.split(" ");
        return m === method && url.startsWith(prefix);
      })
      .sort((a, b) => b.length - a.length)[0];
    if (!key)
      return new Response(JSON.stringify({ error: `no route for ${method} ${url}` }), { status: 404 });
    const result = routes[key](req);
    if (result instanceof Response) return result;
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  return { fetch: impl, requests };
}
