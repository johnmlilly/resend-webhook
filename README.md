# resend-webhook

Cloudflare Worker that receives [Resend](https://resend.com) webhooks and emails you when an email has a problem.

Alerts are sent for:

- `email.bounced`
- `email.failed`
- `email.complained`
- `email.delivery_delayed`

All other events are ignored. If an alert fails to send, the worker returns `500` so Resend retries the webhook.

## Setup

1. **Verify your domain in Resend** (Domains → Add domain, add the DNS records). The `ALERT_FROM` address must be on this domain. It doesn't need a real mailbox.

2. **Set secrets:**

   ```sh
   npx wrangler secret put RESEND_API_KEY         # Resend API key (sending access)
   npx wrangler secret put ALERT_FROM             # e.g. Resend Alerts <alerts@yourdomain.com>
   npx wrangler secret put ALERT_TO               # where alerts go
   npx wrangler secret put RESEND_WEBHOOK_SECRET  # whsec_... from step 4
   ```

3. **Deploy:**

   ```sh
   npm install
   npx wrangler deploy
   ```

4. **Add the webhook in Resend** (Webhooks → Add endpoint):
   - URL: `https://resend-webhook.<your-subdomain>.workers.dev/webhooks/resend` (the `/webhooks/resend` path is required; anything else returns 404)
   - Events: the four listed above
   - Copy the signing secret into `RESEND_WEBHOOK_SECRET`

## Test

Send an email through Resend to `bounced@resend.dev`:

```sh
curl -X POST https://api.resend.com/emails \
  -H "Authorization: Bearer $RESEND_KEY" \
  -H "Content-Type: application/json" \
  -d '{"from":"alerts@yourdomain.com","to":"bounced@resend.dev","subject":"bounce test","text":"test"}'
```

Watch requests live with `npx wrangler tail`.

## Development

```sh
npm test          # run tests
npx wrangler dev  # run locally
```

## Troubleshooting

| Symptom | Cause |
|---|---|
| No requests in `wrangler tail` | Email wasn't sent via Resend, or webhook isn't subscribed to the event |
| `404` | Webhook URL is missing `/webhooks/resend` |
| `401` | `RESEND_WEBHOOK_SECRET` doesn't match the endpoint's signing secret |
| `500` + `Resend API 403/422` | Domain not verified or `ALERT_FROM` missing or invalid |
| `200` but no email | Check spam |

Alert emails are skipped by the webhook (subject starts with `[Resend alert]`) to prevent loops.
