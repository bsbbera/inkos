/*
 * Signing in with a Claude or ChatGPT subscription, from the Connections screen.
 *
 * pi owns the OAuth flow; this only carries it over HTTP. pi announces a URL
 * (or a device code) and then waits, either for its own local callback server
 * or for a code the person pastes. Both halves are a request each:
 *
 *   POST /login        start, answer with the URL as soon as pi has one
 *   POST /login/code   hand over a pasted code
 *   GET  /login        where it got to
 *   DELETE /login      sign out
 *
 * One flow per provider at a time; a second POST returns the one in progress.
 */
import type { Hono } from "hono";
import {
  isViaProvider, setConnectVia, subscriptionLogin, subscriptionLogout, type ViaProvider,
} from "@actalk/quire-core";

interface LoginFlow {
  state: "waiting" | "done" | "error";
  url?: string;
  userCode?: string;
  message?: string;
  error?: string;
  /** Set while pi is waiting on a pasted code. */
  submit?: (code: string) => void;
  /** Set while pi is waiting on a choice, e.g. Anthropic's browser or copy-code login. */
  choice?: { readonly message: string; readonly options: ReadonlyArray<{ readonly id: string; readonly label: string }> };
  choose?: (id: string) => void;
  abort: AbortController;
}

export function registerSubscriptionLogin(app: Hono, onChange: (id: ViaProvider) => Promise<unknown>): void {
  const flows = new Map<ViaProvider, LoginFlow>();
  const view = (f: LoginFlow) => ({
    state: f.state, url: f.url, userCode: f.userCode, message: f.message, error: f.error,
    awaitingCode: Boolean(f.submit),
    ...(f.choice ? { choice: f.choice } : {}),
  });

  app.post("/api/v1/connections/:id/login", async (c) => {
    const id = c.req.param("id");
    if (!isViaProvider(id)) return c.json({ error: "This provider has no subscription sign-in." }, 400);
    const running = flows.get(id);
    if (running?.state === "waiting") return c.json(view(running));

    const flow: LoginFlow = { state: "waiting", abort: new AbortController() };
    flows.set(id, flow);
    let announced!: () => void;
    const ready = new Promise<void>((r) => { announced = r; });

    void subscriptionLogin(id, {
      signal: flow.abort.signal,
      notify: (e) => {
        if (e.type === "auth_url") { flow.url = e.url; flow.message = e.instructions; announced(); }
        else if (e.type === "device_code") { flow.url = e.verificationUri; flow.userCode = e.userCode; announced(); }
        else flow.message = e.message;
      },
      prompt: (p) => {
        if (p.type === "select") {
          // A choice goes to the screen as buttons; the answer comes back on /login/code.
          flow.choice = { message: p.message, options: p.options.map((o) => ({ id: o.id, label: o.label })) };
          announced();
          return new Promise<string>((resolve) => {
            flow.choose = (id) => { flow.choice = undefined; flow.choose = undefined; resolve(id); };
          });
        }
        if (p.type !== "manual_code") {
          // A typed secret or free text is never asked of a person here: an API
          // key has its own field on the row.
          return Promise.reject(new Error(`sign-in asked for ${p.type}, which this screen cannot answer`));
        }
        announced();
        return new Promise<string>((resolve, reject) => {
          flow.submit = (code) => { flow.submit = undefined; resolve(code); };
          // pi's own callback server got there first: the paste is no longer needed.
          p.signal?.addEventListener("abort", () => { flow.submit = undefined; reject(p.signal?.reason); }, { once: true });
        });
      },
    }).then(async () => {
      flow.state = "done";
      await setConnectVia(id, "subscription");
      await onChange(id);
    }).catch((e) => {
      flow.state = "error";
      flow.error = e instanceof Error ? e.message : String(e);
      announced();
    });

    await Promise.race([ready, new Promise((r) => setTimeout(r, 15_000))]);
    return c.json(view(flow));
  });

  app.post("/api/v1/connections/:id/login/code", async (c) => {
    const flow = flows.get(c.req.param("id") as ViaProvider);
    const { code, choice } = await c.req.json<{ code?: string; choice?: string }>().catch(() => ({ code: undefined, choice: undefined }));
    if (choice && flow?.choose) {
      if (!flow.choice?.options.some((o) => o.id === choice)) return c.json({ error: "Not one of the choices offered." }, 400);
      flow.choose(choice);
      // pi moves on to its sign-in page; give it a moment to announce the link.
      await new Promise((r) => setTimeout(r, 1500));
      return c.json(view(flow));
    }
    if (!flow?.submit) return c.json({ error: "No sign-in is waiting for a code." }, 409);
    if (!code?.trim()) return c.json({ error: "Paste the code the sign-in page showed." }, 400);
    flow.submit(code.trim());
    return c.json(view(flow));
  });

  app.get("/api/v1/connections/:id/login", (c) => {
    const flow = flows.get(c.req.param("id") as ViaProvider);
    return c.json(flow ? view(flow) : { state: "none" });
  });

  app.delete("/api/v1/connections/:id/login", async (c) => {
    const id = c.req.param("id");
    if (!isViaProvider(id)) return c.json({ error: "This provider has no subscription sign-in." }, 400);
    flows.get(id)?.abort.abort();
    flows.delete(id);
    await subscriptionLogout(id);
    await setConnectVia(id, "api-key");
    await onChange(id);
    return c.json({ ok: true });
  });
}
