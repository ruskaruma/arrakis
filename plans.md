# Arrakis Feature Roadmap

## Status Legend
- DONE = shipped and tested
- WIP = in progress
- PLANNED = prioritized, not started
- FUTURE = nice-to-have, post-deadline

---

## Core Platform (DONE)

| Feature | Status | Notes |
|---------|--------|-------|
| Kubernetes operator (TypeScript) | DONE | Watch + 30s periodic sync, state machine reconciler |
| CRD `arrakis.io/v1alpha1` Store | DONE | Phases: Pending→Provisioning→Configuring→Verifying→Ready/Failed/Deleting |
| Namespace-per-store isolation | DONE | ResourceQuota, LimitRange, 4 NetworkPolicies |
| Helm-based WooCommerce provisioning | DONE | Bitnami WordPress subchart, upgrade --install --wait |
| WP-CLI configuration pipeline | DONE | WooCommerce activate, HPOS enable, COD payment, products seed |
| Store templates (fashion/food/electronics/general) | DONE | Themed product seeding per template |
| Store naming | DONE | User-provided store names in CRD spec |
| Finalizer cleanup | DONE | Helm uninstall + namespace delete on store deletion |
| nip.io wildcard DNS | DONE | `{storeId}.127.0.0.1.nip.io` local, `{storeId}.<ip>.nip.io` prod |
| Prometheus metrics | DONE | 4 custom metrics + default Node.js metrics on :9091 |
| Structured JSON logging | DONE | All operator logs are structured JSON |

## REST API (DONE)

| Feature | Status | Notes |
|---------|--------|-------|
| Express.js API server | DONE | Port 8080, CORS, JSON body parser |
| GitHub OAuth authentication | DONE | passport-github2, express-session |
| Per-user store ownership | DONE | `spec.owner` from GitHub user ID, filtered list |
| Store CRUD endpoints | DONE | POST/GET/DELETE /api/stores |
| Store events endpoints | DONE | GET /api/stores/:id/events, GET /api/events |
| Rate limiting | DONE | 10 requests per 15 min on store creation |
| Max 10 stores per user | DONE | Enforced in POST /api/stores |
| Audit logging | DONE | JSON audit log for create/delete actions |
| SKIP_AUTH bypass | DONE | For local development without GitHub OAuth |
| Health endpoint | DONE | GET /health |

## Dashboard (DONE)

| Feature | Status | Notes |
|---------|--------|-------|
| React 18 + Vite + Tailwind | DONE | Clean minimal design |
| GitHub OAuth login page | DONE | Sign in with GitHub button |
| Store cards with live status | DONE | Phase pills, phase step indicators |
| Live provisioning timer | DONE | ElapsedTimer counting up during provisioning |
| "Provisioned in Xm Ys" | DONE | Shows total provision duration for Ready stores |
| Create store modal | DONE | Name input, template picker (2x2 grid), engine select |
| Store deletion with confirmation | DONE | Inline Yes/No confirmation, error display |
| Copy URL to clipboard | DONE | Clipboard API with checkmark feedback |
| Activity log (all events) | DONE | Collapsible, auto-refresh, warning badges |
| Per-store events panel | DONE | Expandable events in each StoreCard |
| Empty state | DONE | Logo + CTA when no stores exist |
| User avatar + logout | DONE | GitHub avatar in header |

## Security & Isolation (DONE)

| Feature | Status | Notes |
|---------|--------|-------|
| RBAC least-privilege | DONE | ClusterRole with minimal permissions |
| Container hardening | DONE | runAsNonRoot, drop ALL caps, readOnlyRootFilesystem (prod) |
| NetworkPolicies (4 per store) | DONE | Default deny, DNS allow, ingress allow, inter-pod allow |
| ResourceQuota per namespace | DONE | CPU/memory limits per store |
| LimitRange per namespace | DONE | Default container limits |
| Validating admission webhook | DONE | Validates engine, template, storeName at K8s API level |
| 10-minute provision timeout | DONE | Stores stuck >10m marked Failed |

## Infrastructure (DONE)

| Feature | Status | Notes |
|---------|--------|-------|
| k3d local cluster setup | DONE | Single-command cluster create |
| AWS EC2 deployment | DONE | c7i-flex.large, k3s, 54.206.104.15 |
| values-local.yaml | DONE | Traefik, local-path, 1Gi, 1 replica |
| values-prod.yaml | DONE | nginx, Longhorn, cert-manager TLS, 10Gi, 2 replicas |
| HPA manifests | DONE | Operator 1-3, API 1-5 replicas |
| Operator deployment manifest | DONE | K8s Deployment + Service |

## Documentation (DONE)

| Feature | Status | Notes |
|---------|--------|-------|
| ARCHITECTURE.md | DONE | ~350 lines, system design, tradeoffs, scaling |
| README.md | DONE | Setup, usage, API reference, tech stack |
| CRD with OpenAPI validation | DONE | Full spec/status schema |

## MedusaJS Extensibility (DONE — architecture only)

| Feature | Status | Notes |
|---------|--------|-------|
| Engine dispatch in reconciler | DONE | Switch on spec.engine |
| Helm chart skeleton | DONE | Chart.yaml + values + templates (deployment/service/ingress) |
| Setup module stub | DONE | medusajs-setup.ts with documented future plan |
| 501 response in API | DONE | "Coming Q2 2026" |
| Dashboard "Coming Q2 2026" label | DONE | Disabled in CreateStoreModal |

---

## Planned Improvements (Priority Order)

### P0 — Demo Impact (before Feb 13)

1. **Stats bar on dashboard** — PLANNED
   - Aggregate metrics above store grid: total/ready/provisioning/failed
   - Average provision time
   - Powers demo narrative

2. **WP-Admin link on store cards** — PLANNED
   - Direct link to WordPress admin panel for store owners
   - Shows the merchant flow: create store → manage products → serve customers

3. **`/api/stats` endpoint** — PLANNED
   - Returns aggregate store metrics for dashboard stats bar
   - Total stores, by-phase breakdown, avg provision time

### P1 — Monitoring & Observability

4. **Grafana + Prometheus stack** — PLANNED
   - Install kube-prometheus-stack via Helm
   - ServiceMonitor for operator metrics on :9091
   - Custom Arrakis dashboard: provision rate, phase distribution, error rate, latency percentiles
   - Pre-built K8s dashboards (ID 315, 13332) for cluster overview
   - How: `helm install kube-prometheus-stack prometheus-community/kube-prometheus-stack -n monitoring --create-namespace`
   - Access: port-forward Grafana on :3001, default admin/prom-operator

5. **Per-tenant resource metrics** — PLANNED
   - `GET /api/stores/:id/metrics` endpoint
   - CPU/memory usage from K8s metrics API
   - PVC storage used vs allocated
   - Pod count and readiness

6. **Alerting rules** — PLANNED
   - PrometheusRule YAML for: store stuck in Provisioning >5m, high reconcile error rate, operator pod restart
   - Slack/webhook alert channel

### P2 — Product Management (Merchant Flow)

7. **WooCommerce REST API proxy** — PLANNED
   - `GET/POST /api/stores/:id/products` — proxy to WC REST API
   - Auth: generate WC API key during store setup, store in K8s Secret
   - Product CRUD: name, description, price, images, categories
   - How: WooCommerce REST API v3 at `{storeUrl}/wp-json/wc/v3/products`

8. **Product management UI** — FUTURE
   - Dashboard page: list products, add product (name, price, image upload), edit, delete
   - Image upload: multipart/form-data → WC media endpoint → attach to product
   - Effort: 4-6 hours (significant, post-deadline)

### P3 — Platform Features

9. **Slack webhook notifications** — PLANNED
   - `SLACK_WEBHOOK_URL` env var
   - Notify on: store Ready, store Failed, store Deleted
   - 30 lines in operator, high demo value

10. **OpenAPI/Swagger docs** — PLANNED
    - `GET /api/docs` endpoint using swagger-ui-express
    - Auto-generated from route definitions
    - Effort: 1 hour

11. **Audit log viewer in dashboard** — FUTURE
    - Dedicated page showing all audit events with filters
    - Requires persisting audit log (currently stdout only)

12. **Store hibernation (scale to 0)** — FUTURE
    - `PATCH /api/stores/:id/hibernate` — scale WordPress to 0 replicas
    - `PATCH /api/stores/:id/wake` — scale back to 1
    - Saves cluster resources, interesting for demo
    - Effort: 2-3 hours

13. **Store cloning** — FUTURE
    - `POST /api/stores/:id/clone` — create new store from existing
    - Copy products, settings via WP-CLI export/import
    - Effort: 3-4 hours

14. **CLI tool** — FUTURE
    - `arrakis create --name "My Store" --template fashion`
    - `arrakis list`, `arrakis delete`, `arrakis logs`
    - Effort: 2-3 hours

### P4 — Production Hardening

15. **Pod pre-warming pool** — FUTURE
    - Keep N warm WordPress pods ready
    - Assign to new stores instead of cold-starting Helm
    - Could cut provision time from 90s to 15s
    - Effort: 6-8 hours (significant architecture change)

16. **Blue-green deployments** — FUTURE
    - Upgrade stores with zero downtime
    - New namespace → verify → swap ingress → delete old
    - Effort: 4-6 hours

17. **mTLS between services** — FUTURE
    - Linkerd or Istio service mesh
    - Effort: 4 hours + ongoing complexity

---

## Buyer Flow (How It Works)

The platform serves three roles:
1. **Platform Admin** — manages the Arrakis platform itself
2. **Store Owner (Merchant)** — creates stores, manages products via WP-Admin
3. **Buyer (Customer)** — visits store URL, browses products, places orders

Current buyer flow:
- Store URL (`{storeId}.127.0.0.1.nip.io/shop`) is a fully functional WooCommerce storefront
- Buyers browse products, add to cart, checkout with Cash on Delivery
- No Arrakis account needed — buyers interact directly with the WooCommerce store
- Store owners manage orders via WP-Admin (`/wp-admin`)

---

## Line Count Tracking

| Component | Files | Lines | Last Updated |
|-----------|-------|-------|-------------|
| Operator | 8 | ~1,200 | Feb 11, 2026 |
| API | 5 | ~450 | Feb 11, 2026 |
| Dashboard | 8 | ~900 | Feb 11, 2026 |
| Config (YAML) | 10 | ~400 | Feb 11, 2026 |
| Helm Charts | 8 | ~300 | Feb 11, 2026 |
| **Total** | **39** | **~3,250** | |
