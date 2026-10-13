import { Webhook } from "svix";

interface Env {
  RESEND_WEBHOOK_SECRET: string;
  RESEND_API_KEY: string;
  ALERT_TO: string;
  ALERT_FROM: string;
}

const ALERT_EVENTS = new Set([
  "email.bounced",
  "email.failed",
  "email.complained",
  "email.delivery_delayed",
]);

const ALERT_PREFIX = "[Resend alert]";

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    if (req.method !== "POST" || url.pathname !== "/webhooks/resend") {
      return new Response("Not found", { status: 404 });
    }

    const payload = await req.text();
    let event: { type: string; created_at: string; data: Record<string, any> };

    try {
      // svix >= 2.8 verify() only throws on a bad signature; it no longer returns the parsed payload
      new Webhook(env.RESEND_WEBHOOK_SECRET).verify(payload, {
        "svix-id": req.headers.get("svix-id") ?? "",
        "svix-timestamp": req.headers.get("svix-timestamp") ?? "",
        "svix-signature": req.headers.get("svix-signature") ?? "",
      });
      event = JSON.parse(payload);
    } catch {
      return new Response("Invalid signature", { status: 401 });
    }

    // Skip our own alert emails to avoid loops
    const subject: string = event.data?.subject ?? "";
    if (ALERT_EVENTS.has(event.type) && !subject.startsWith(ALERT_PREFIX)) {
      ctx.waitUntil(sendAlert(env, event));
    }

    return new Response("ok");
  },
};

async function sendAlert(
  env: Env,
  event: { type: string; created_at: string; data: Record<string, any> }
) {
  const to = [event.data?.to].flat().join(", ");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.ALERT_FROM,
      to: env.ALERT_TO,
      subject: `${ALERT_PREFIX} ${event.type} → ${to}`,
      text: JSON.stringify(event, null, 2),
    }),
  });
  if (!res.ok) console.error("Alert send failed", res.status, await res.text());
}