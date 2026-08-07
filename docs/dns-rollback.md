# robbit.uz DNS — state before pointing the apex at Cloudflare Pages

Captured 2026-08-07 from the Cloudflare zone `robbit.uz`
(account `Robbituz@gmail.com`, zone id path `7594b17d9db4da040b8ce39a5b14fece/robbit.uz`).

## What was changed

Only these two names were repointed to the `robbit` Pages project:

| Name | Old type | Old content | Old proxy |
| --- | --- | --- | --- |
| `robbit.uz` | A | `99.83.190.102` | Proxied |
| `robbit.uz` | A | `75.2.70.75` | Proxied |
| `www.robbit.uz` | CNAME | `proxy-ssl.webflow.com` | Proxied |

Both apex IPs belong to AWS and were Webflow's shared load balancers; the site
was a Webflow project. At the time of the change it answered **403 Forbidden
(openresty) on every path** (`/`, `/blog`, `/filiallar`, `/blogpost/...`), so no
working page was replaced.

## What was deliberately left alone

| Name | Type | Content | Why |
| --- | --- | --- | --- |
| `admin.robbit.uz` | A | `95.217.173.51` (Proxied) | Live — answered HTTP 200 |
| `api.robbit.uz` | A | `95.217.173.51` (Proxied) | Live API |
| `robbit.uz` | MX | `emx.mail.ru` (10), `smtp.google.com` (20) | Email delivery |
| `robbit.uz` | TXT | SPF ×2, `mailru-domain`, Google + MS verification | Email auth / ownership |
| `_dmarc`, `mailru._domainkey` | TXT | DMARC and DKIM | Email auth |
| `_webflow` | TXT | one-time-verification | Webflow ownership proof |
| `_cpanel-dcv-test-record` | TXT | cPanel DCV | Legacy host verification |

## Rollback

1. Cloudflare → Workers & Pages → `robbit` → Custom domains → remove
   `robbit.uz` and `www.robbit.uz`.
2. Recreate the three records in the first table exactly as listed (proxied).
3. Republish the Webflow site so it stops returning 403.

## Note

There were two conflicting SPF records on the apex (`v=spf1 redirect=_spf.mail.ru`
and `v=spf1 +a +mx +ip4:185.196.212.52 ~all`). Cloudflare flags this: more than
one SPF record is invalid per RFC 7208 and makes SPF fail, which hurts
deliverability. Unrelated to this change, but worth fixing — keep one.
