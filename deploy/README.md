# Hosted demo

Two containers behind the host's shared edge proxy:

- `interval-web` (Caddy) serves the built site and proxies `/api/*`. It joins the external `public_proxy` network, so the edge can reach it by name.
- `interval-api` (Node 22, built-ins only) stays on the project's internal network. It reads its Qloo credentials from `INTERVAL_ENV_FILE` and keeps state in `INTERVAL_CACHE_DIR`.

Neither the credentials nor the cache belong in the repository. The cache holds `qloo.sqlite` (cached Qloo responses, the quota ledger, runs and recorded agent answers), `snapshots/`, `baselines/comparison.json` and `probes/genre-baseline.json`, copied privately from a working checkout.

```bash
INTERVAL_ENV_FILE=/path/to/qloo.env INTERVAL_CACHE_DIR=/path/to/cache docker compose -f deploy/compose.yaml up -d --build
```

Edge route, following the host's other proxied sites:

```
interval.example.com {
	import cloudflare_only
	encode zstd gzip
	reverse_proxy interval-web:80 {
		header_up X-Forwarded-For {http.request.header.CF-Connecting-IP}
	}
}
```

Live agent answers: add `-f deploy/compose.hermes.yaml`, with `HERMES_NETWORK` (the Docker network the Hermes gateway is on), a fresh `HERMES_BUDGET_ID` and `HERMES_BUDGET_CALLS`. Without it the agent panel says live answers are unavailable, and recorded answers still replay.

`QLOO_OFFLINE=1` serves saved Qloo evidence only. Imports then score only acts and pairs already in the cache, and the import page says so.
