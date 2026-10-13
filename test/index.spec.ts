import { SELF } from "cloudflare:test";
import { Webhook } from "svix";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import worker from "../src/index";

const SECRET = `whsec_${btoa("test-webhook-secret-0123456789")}`;
const WEBHOOK_URL = "https://example.com/webhooks/resend";

const env = {
	RESEND_WEBHOOK_SECRET: SECRET,
	RESEND_API_KEY: "re_test",
	ALERT_TO: "me@example.com",
	ALERT_FROM: "Resend Alerts <alerts@example.com>",
};

function signedRequest(event: unknown, secret = SECRET): Request {
	const payload = JSON.stringify(event);
	const id = "msg_test";
	const timestamp = new Date();
	return new Request(WEBHOOK_URL, {
		method: "POST",
		headers: {
			"svix-id": id,
			"svix-timestamp": Math.floor(timestamp.getTime() / 1000).toString(),
			"svix-signature": new Webhook(secret).sign(id, timestamp, payload),
		},
		body: payload,
	});
}

function emailEvent(type: string, subject = "Welcome") {
	return {
		type,
		created_at: "2026-10-12T00:00:00.000Z",
		data: { to: ["bounced@resend.dev"], subject },
	};
}

describe("routing", () => {
	it("returns 404 for non-webhook paths", async () => {
		const response = await SELF.fetch("https://example.com/");
		expect(response.status).toBe(404);
	});

	it("returns 404 for GET on the webhook path", async () => {
		const response = await worker.fetch(new Request(WEBHOOK_URL), env);
		expect(response.status).toBe(404);
	});
});

describe("signature verification", () => {
	it("returns 401 when svix headers are missing", async () => {
		const request = new Request(WEBHOOK_URL, {
			method: "POST",
			body: JSON.stringify(emailEvent("email.bounced")),
		});
		const response = await worker.fetch(request, env);
		expect(response.status).toBe(401);
	});

	it("returns 401 when signed with the wrong secret", async () => {
		const wrongSecret = `whsec_${btoa("some-other-secret-0123456789")}`;
		const request = signedRequest(emailEvent("email.bounced"), wrongSecret);
		const response = await worker.fetch(request, env);
		expect(response.status).toBe(401);
	});
});

describe("alerts", () => {
	let fetchSpy: MockInstance<typeof fetch>;

	beforeEach(() => {
		fetchSpy = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValue(new Response('{"id":"email_123"}'));
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("sends an alert for a bounced email", async () => {
		const response = await worker.fetch(signedRequest(emailEvent("email.bounced")), env);

		expect(response.status).toBe(200);
		expect(fetchSpy).toHaveBeenCalledOnce();
		const [url, init] = fetchSpy.mock.calls[0];
		expect(url).toBe("https://api.resend.com/emails");
		expect(init?.headers).toMatchObject({ Authorization: "Bearer re_test" });
		const body = JSON.parse(init?.body as string);
		expect(body).toMatchObject({
			from: env.ALERT_FROM,
			to: env.ALERT_TO,
			subject: "[Resend alert] email.bounced → bounced@resend.dev",
		});
	});

	it.each(["email.failed", "email.complained", "email.delivery_delayed"])(
		"sends an alert for %s",
		async (type) => {
			const response = await worker.fetch(signedRequest(emailEvent(type)), env);
			expect(response.status).toBe(200);
			expect(fetchSpy).toHaveBeenCalledOnce();
		},
	);

	it.each(["email.sent", "email.delivered", "email.opened"])(
		"ignores %s",
		async (type) => {
			const response = await worker.fetch(signedRequest(emailEvent(type)), env);
			expect(response.status).toBe(200);
			expect(fetchSpy).not.toHaveBeenCalled();
		},
	);

	it("skips events for its own alert emails to avoid loops", async () => {
		const event = emailEvent("email.bounced", "[Resend alert] email.failed → x@example.com");
		const response = await worker.fetch(signedRequest(event), env);
		expect(response.status).toBe(200);
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it("returns 500 so Resend retries when the Resend API rejects the alert", async () => {
		fetchSpy.mockResolvedValue(new Response("invalid from", { status: 422 }));
		vi.spyOn(console, "error").mockImplementation(() => {});

		const response = await worker.fetch(signedRequest(emailEvent("email.bounced")), env);
		expect(response.status).toBe(500);
	});

	it("returns 500 so Resend retries when the alert request throws", async () => {
		fetchSpy.mockRejectedValue(new TypeError("network error"));
		vi.spyOn(console, "error").mockImplementation(() => {});

		const response = await worker.fetch(signedRequest(emailEvent("email.bounced")), env);
		expect(response.status).toBe(500);
	});
});
