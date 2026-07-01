# HORNET — Networking & Deployment (READ THIS)

This explains **why the subscription link works locally but not on a real phone**,
and how to make it production-ready.

## TL;DR

| Environment | Subscription link | Real VPN traffic |
|-------------|-------------------|------------------|
| **Local machine** (this repo now) | Works only for devices **on the same Wi‑Fi/LAN** | Only over LAN; not from mobile data |
| **VPS with public IP** | Works everywhere | Yes — this is production |

Set `BASE_URL` to a **publicly reachable** address and the whole system generates
correct links automatically:

```
BASE_URL=https://your-domain.com        # production
BASE_URL=http://<your-LAN-IP>:3000      # local testing (auto-set by ./start.sh)
```

Every subscription link is built as `${BASE_URL}/sub/<uuid>` — change `BASE_URL`
and every link updates. No code changes needed.

## Why a local machine cannot be a public VPN server

1. **Private IP / NAT.** Your machine has a private address (e.g. `172.x.x.x`,
   `192.168.x.x`). These are not routable on the internet. A phone on mobile
   data has no path to a `172.x` address — it only works for devices on the
   **same LAN**.
2. **No public IP.** Home/office internet almost never gives your machine a
   directly reachable public IP; you're behind the ISP's NAT (often CGNAT).
3. **ISP firewall / blocked inbound ports.** Inbound connections (especially to
   443) are commonly blocked or filtered for residential lines.
4. **Dynamic IP.** Even if reachable, home IPs change periodically, breaking
   every previously distributed subscription link.
5. **Extra local complications here.** This machine also routes egress through
   **CloudflareWARP** and has **no sudo** (so port 443 and system Xray aren't
   available) — the local tunnel therefore runs on **port 8443** as a dev-only
   setup.

**Conclusion: the local system is for development/testing only.**

## Production requirements (VPS)

- A VPS with a **public static IP** (and ideally a **domain**).
- Open inbound **443** (and your chosen ports).
- **TLS/Reality** on port 443 (Reality is the modern, censorship-resistant
  default; it needs a real reachable `dest` and works best on 443).
- Run the production node-agent (`infra/node-agent/agent.js`) with Xray managed
  by systemd, or point a node at the panel and let it provision.
- Set `BASE_URL=https://your-domain.com` (put the app behind the bundled Caddy
  reverse proxy — `docker compose --profile proxy up -d` — for automatic TLS).

Once `BASE_URL` is a public HTTPS URL and a real node serves 443, the exact same
subscription links work in v2rayNG / Hiddify / Shadowrocket from anywhere.

## Local testing checklist (with `./start.sh`)

1. Phone and PC on the **same Wi‑Fi**.
2. Run `./start.sh` — it auto-detects the LAN IP, writes `BASE_URL`, seeds the
   node, and starts Xray + agent.
3. In the bot, get a config → open the link in v2rayNG/Hiddify.
4. If it doesn't connect: the phone can't reach `<LAN-IP>:8443` (different
   network, AP isolation, or firewall). This is a network limitation, not a bug —
   move to a VPS for real use.
