# ProfitHarbor AI

Source for [profitharborai.com](https://profitharborai.com), served by GitHub Pages from the repository root.

- `index.html` and the `ph-*.js` scripts: the main app and marketing page
- `lead.html`: public lead form for approved campaigns
- `lead-wizard.js`, `ph-leads-client.js`: Lead Intelligence campaign controls
- `worker/leads-api.mjs`: Cloudflare Worker behind the leads API
- `docs/CAMPAIGN_LAUNCH.md`: campaign launch checklist

## Checks

```
node tools/check-syntax.cjs
node --test tests/*.test.cjs
```

The database test needs PostgreSQL tools, located through `PH_PG_BIN`.
