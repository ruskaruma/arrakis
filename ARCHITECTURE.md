# Arrakis — System Design & Architecture

## System Overview

```
                          +──────────────+
                          │   Dashboard  │  React 19 + Vite + Tailwind
                          │  :5173       │  Polls API every 5s
                          +──────┬───────+
                                 │ HTTP
                          +──────▼───────+
                          │   REST API   │  Express.js, :8080
                          │              │  Rate limiting, audit log
                          +──────┬───────+
                                 │ K8s API (CRD CRUD)
                   +─────────────▼─────────────+
                   │      Kubernetes API        │
                   │    (Store CRD: arrakis.io)  │
                   +─────────────┬─────────────+
                                 │ Watch + Periodic Sync
                          +──────▼───────+
                          │   Operator   │  TypeScript, @kubernetes/client-node
                          │              │  Reconciler state machine
                          │  :9091       │  Prometheus metrics + /healthz
                          +──────┬───────+
                                 │ For each store:
               +─────────────────▼─────────────────+
               │         Namespace: store-{id}      │
               │  ┌───────────┐  ┌───────────────┐  │
               │  │ WordPress │  │   MariaDB     │  │
               │  │ (Bitnami) │──│ (StatefulSet) │  │
               │  └───────────┘  └───────────────┘  │
               │  + ResourceQuota                   │
               │  + LimitRange                      │
               │  + NetworkPolicies (4)             │
               │  + Ingress ({id}.IP.nip.io)        │
               │  + PVC (persistent storage)        │
               +────────────────────────────────────+
```

## Components

**Operator** — Kubernetes controller that watches Store CRDs and reconciles desired state. Runs a watch stream for real-time events and a 30-second periodic sync as a safety net. Manages the full lifecycle: namespace creation, Helm install, WooCommerce configuration via WP-CLI, verification, and finalizer-based cleanup.

**API** — Thin REST layer over the Kubernetes API. Translates HTTP requests into CRD operations. Handles rate limiting (10 requests per 15 minutes on store creation), enforces a maximum of 10 concurrent stores, and writes structured audit logs for every create/delete action.

**Dashboard** — React single-page app that polls the API every 5 seconds. Displays store status, URLs, timestamps, and Kubernetes events. Provides create and delete actions with confirmation dialogs.

**Helm Charts** — Bitnami WordPress subchart with per-environment values files. The operator calls `helm upgrade --install --wait` to deploy stores, ensuring idempotent installs and atomic upgrades.

## CRD Design

```yaml
apiVersion: arrakis.io/v1alpha1
kind: Store
metadata:
  name: s86c8ba38        # 8-char hex ID from crypto.randomBytes(4)
  namespace: default       # CRDs live in default namespace
  finalizers:
    - arrakis.io/store-cleanup
spec:
  engine: woocommerce      # woocommerce | medusajs (Q2 2026)
  storeName: "My Fashion Store"  # optional, max 64 chars
  template: fashion        # general | fashion | food | electronics
  owner: "12345678"        # GitHub user ID, set by API from OAuth
status:
  phase: Ready             # Pending | Provisioning | Configuring | Verifying | Ready | Failed | Deleting
  url: http://s86c8ba38.54.206.104.15.nip.io/shop
  message: Store is running
  startedAt: 2026-02-11T15:00:00Z
  readyAt: 2026-02-11T15:01:14Z
  observedGeneration: 1
```

### Phase State Machine

```
                    ┌──────────┐
   Store created ──►│ Pending  │
                    └────┬─────┘
                         │ Add finalizer
                    ┌────▼─────────┐
                    │ Provisioning │ Create namespace, quota, policies, Helm install
                    └────┬─────────┘
                         │ All pods ready
                    ┌────▼─────────┐
                    │ Configuring  │ WP-CLI: install WooCommerce, seed template products, enable HPOS + COD
                    └────┬─────────┘
                         │ Setup complete
                    ┌────▼─────────┐
                    │  Verifying   │ HTTP 200 check + product count > 0
                    └────┬─────────┘
                         │ Verification passed
                    ┌────▼─────────┐
                    │    Ready     │ Store is live and serving traffic
                    └──────────────┘

   Any phase can transition to Failed (timeout, error, verification failure)
   deletionTimestamp triggers: any phase → Deleting → resource cleanup → CRD removed
```

### observedGeneration

The operator tracks `status.observedGeneration` to avoid unnecessary reconciles. When a Ready store's `metadata.generation` matches `status.observedGeneration`, the reconciler skips it entirely. This prevents redundant work when the CRD is updated without spec changes.

## Reconciliation Model

The operator uses dual-mode reconciliation:

**Watch stream** — Real-time Kubernetes watch on Store CRDs. Fires on ADDED/MODIFIED events. The watch callback is non-blocking: it calls `reconcile(store).catch(log)` and returns immediately, preventing slow reconciles from blocking the event stream.

**Periodic sync (30s)** — Lists all Store CRDs every 30 seconds and reconciles any that aren't in a terminal state (Ready/Failed) or have a deletion timestamp. This catches events missed due to watch disconnects, API server restarts, or operator crashes.

**Why dual-mode:** Watch alone is unreliable. Kubernetes watches can disconnect silently. The periodic sync acts as a consistency guarantee. This is the same pattern used by production controllers like the Kubernetes Deployment controller.

**Concurrency control:** An `activeReconciles` Set prevents duplicate reconciliation of the same store. A batch size of 5 (`MAX_CONCURRENT_RECONCILES`) prevents overwhelming the cluster during periodic sync.

## Tenant Isolation

Each store gets its own Kubernetes namespace (`store-{id}`) with four layers of isolation:

### ResourceQuota
```
requests.cpu: 500m          requests.memory: 1Gi
limits.cpu: 2               limits.memory: 3Gi
persistentvolumeclaims: 5
```
Prevents any single store from consuming unbounded cluster resources.

### LimitRange
```
Container defaults:  cpu: 500m, memory: 512Mi
Container requests:  cpu: 100m, memory: 128Mi
PVC max:            5Gi
```
Ensures every container has resource limits even if the Helm chart doesn't specify them.

### NetworkPolicies (4 per namespace)

| Policy | Purpose |
|---|---|
| `default-deny-ingress` | Deny all inbound traffic by default |
| `allow-traefik-ingress` | Allow traffic from the ingress controller (kube-system) |
| `allow-operator-ingress` | Allow operator namespace to reach pods (for WP-CLI exec) |
| `mariadb-restrict` | MariaDB only accepts connections from WordPress pods on port 3306 |

This implements defense-in-depth: even if an attacker compromises one store's WordPress pod, they cannot reach other stores' databases or services.

### Namespace labels
```yaml
app.kubernetes.io/managed-by: arrakis
arrakis.io/store-id: {storeId}
```

## Store Templates & HPOS

### Templates
Each store is seeded with template-specific products on creation. The `spec.template` field controls which product set is deployed:

| Template | Products |
|----------|----------|
| `general` | Arrakis Spice Blend ($42) |
| `fashion` | Desert Silk Robe ($89), Stillsuit Jacket ($149), Fremen Sandals ($59) |
| `food` | Spice Melange Tea ($24), Arrakeen Coffee Beans ($32), Sietch Bread Mix ($12) |
| `electronics` | Holtzman Shield Generator ($299), Ornithopter Navigation Module ($199), Thumper Device ($79) |

Product seeding is idempotent: `wp wc product list --format=count` checks if products already exist before creating.

### High-Performance Order Storage (HPOS)
Every store is configured with WooCommerce's HPOS — the major architectural change moving order data from WordPress `wp_posts`/`wp_postmeta` tables to dedicated `wp_wc_orders` / `wp_wc_orders_meta` tables. This enables:
- 5-10x faster order queries at scale
- Proper database indexing on order-specific columns
- Compatibility with WooCommerce's future direction (HPOS is now the default in WC 8.2+)

Enabled via two WP-CLI commands during the Configuring phase:
```
wp option update woocommerce_feature_custom_order_tables_enabled yes
wp option update woocommerce_custom_orders_table_enabled yes
```

## Security Posture

### Validating Admission Webhook
Server-side validation at the Kubernetes API level — defense-in-depth alongside API route validation:

- Engine must be a valid CRD enum value (`woocommerce` or `medusajs`)
- Blocked engines (`medusajs`) rejected before CRD is persisted
- Store name: max 64 characters, alphanumeric + spaces/hyphens/apostrophes only
- Template must be a valid enum value
- Webhook runs on port 9443 in the operator process, TLS via self-signed certs (`config/scripts/gen-webhook-certs.sh`)

This means invalid stores are rejected at three layers:
1. **CRD OpenAPI schema** — Kubernetes API server validates enum values
2. **Admission webhook** — Custom validation logic (name format, blocked engines)
3. **API route handler** — Express.js validates before creating CRD

### Authentication & Authorization
- GitHub OAuth via `passport-github2` with session-based auth (`express-session`)
- All `/api/*` routes protected by `isAuthenticated` middleware
- Per-user store ownership: `spec.owner` set from GitHub user ID at creation
- Store list/delete scoped to authenticated user's stores only
- `SKIP_AUTH=true` bypass for local development

### RBAC (Least Privilege)
The operator runs under a dedicated ServiceAccount (`arrakis-operator`) with a ClusterRole scoped to exactly the verbs it needs:

| Resource | Verbs |
|---|---|
| stores (CRD) | get, list, watch, patch |
| stores/status | patch |
| stores/finalizers | patch |
| namespaces | get, list, create, delete |
| pods | get, list |
| pods/exec | create |
| resourcequotas | create, get |
| limitranges | create, get |
| networkpolicies | create, get |
| events | list |
| deployments | get |

No wildcard permissions. No write access to resources outside its scope.

### Container Hardening (Operator Deployment)
```yaml
securityContext:
  runAsNonRoot: true
  allowPrivilegeEscalation: false
  readOnlyRootFilesystem: true
  capabilities:
    drop: [ALL]
```

### Secret Management
All secrets (WordPress admin password, MariaDB root/user passwords) are generated by the Bitnami Helm chart at deploy time and stored as Kubernetes Secrets in the store's namespace. No secrets exist in source code, environment variables, or configuration files.

### Audit Logging
Every store create and delete action is logged with a structured JSON entry containing timestamp, action, store ID, and client IP address. The operator emits structured JSON logs for every reconciliation event, enabling full traceability.

## Abuse Prevention

| Control | Implementation |
|---|---|
| Rate limiting | 10 store creation requests per 15 minutes (express-rate-limit) |
| Store quota | Maximum 10 concurrent stores (returns HTTP 429) |
| Provisioning timeout | 10-minute timeout, auto-fails stores stuck in Provisioning/Configuring |
| Resource caps | ResourceQuota + LimitRange per namespace |
| Audit trail | Structured JSON logs with IP, action, timestamp |

## Idempotency & Recovery

**Store creation is safe to retry:**
- Namespace creation: catches HTTP 409 (already exists) and continues
- Helm install: uses `upgrade --install` which is idempotent
- WooCommerce product: checks for existing product via `wp wc product list --search` before creating
- NetworkPolicies, ResourceQuota, LimitRange: all catch 409 and continue

**Operator crash recovery:**
- The 30-second periodic sync re-lists all CRDs and reconciles non-terminal stores
- No in-memory state is required for recovery; all state is in the CRD status
- Stores stuck in Provisioning/Configuring will either complete or timeout to Failed

**Clean deletion:**
- Finalizer (`arrakis.io/store-cleanup`) prevents the CRD from being garbage collected before resources are cleaned up
- Deletion order: update status → Helm uninstall → delete namespace → remove finalizer
- If the operator crashes during deletion, the periodic sync picks it up and retries

## Local vs Production

| Concern | Local (values-local.yaml) | Production (values-prod.yaml) |
|---|---|---|
| Cluster | k3d | k3s on VPS |
| Ingress controller | Traefik (k3d default) | nginx-ingress |
| TLS | None (HTTP) | cert-manager + Let's Encrypt |
| Storage class | local-path | Longhorn (distributed) |
| Storage size | 1Gi | 10Gi |
| WordPress replicas | 1 | 2 + PodDisruptionBudget |
| Pod anti-affinity | None | Preferred spread across nodes |
| Container security | Default | runAsNonRoot, drop ALL, readOnlyRootFilesystem |
| DNS | nip.io ({id}.127.0.0.1.nip.io) | Wildcard A record (*.stores.domain.com) |
| Resource requests | 50m CPU, 256Mi memory | 250m CPU, 512Mi memory |
| Liveness probes | Helm defaults | Tuned (initialDelay: 30s, period: 15s) |

The operator code is identical between environments. All differences are expressed through Helm values files, fulfilling the assignment requirement of "configuration changes only."

## Horizontal Scaling

### What scales horizontally
- **API server**: Stateless Express.js app. Scale via HPA on CPU utilization with 2-5 replicas.
- **Dashboard**: Static React build served by nginx. Scale arbitrarily.
- **Per-store WordPress**: Each store can scale to 2+ replicas with session affinity (values-prod.yaml already configures 2 replicas + PDB).

### What doesn't scale horizontally (and why)
- **Operator**: Single-leader pattern. Running multiple operator replicas would cause duplicate reconciles and race conditions on CRD status updates. Production approach: run 1 active + 1 standby with leader election (Kubernetes lease-based).

### Scaling provisioning throughput
- `MAX_CONCURRENT_RECONCILES = 5` limits parallel provisioning to prevent cluster overload
- Batched `Promise.allSettled()` processes stores in groups of 5 during periodic sync
- Future: pod pre-warming pool (pre-provision WordPress pods, claim on store create) would reduce provisioning from ~3 minutes to ~10 seconds

### HPA Configuration
HPA manifests are provided in `config/hpa-operator.yaml` and `config/hpa-api.yaml` targeting 70% CPU utilization.

## Upgrade & Rollback

### Store upgrades
The operator uses `helm upgrade --install --wait`, which is inherently an upgrade operation. To upgrade a store's WordPress version:

```bash
# Update chart version in Chart.yaml, then:
helm upgrade {storeId} helm-charts/woocommerce \
  --namespace store-{storeId} \
  --values helm-charts/woocommerce/values-local.yaml \
  --wait --timeout 10m
```

The `--wait` flag ensures the upgrade only succeeds if all pods become ready with the new version. If the upgrade fails, the old ReplicaSet remains active.

### Rollback
The HelmManager exposes a `rollback()` method:

```bash
# Rollback to previous revision:
helm rollback {storeId} --namespace store-{storeId} --timeout 5m

# Rollback to specific revision:
helm rollback {storeId} 1 --namespace store-{storeId} --timeout 5m
```

Helm maintains a revision history for each release. Rollback restores the previous chart version, values, and resources.

### CRD versioning
The CRD uses `v1alpha1` API version. When the schema evolves, a conversion webhook would handle `v1alpha1` → `v1beta1` migration while maintaining backward compatibility.

## MedusaJS Extensibility

The architecture supports multiple e-commerce engines through the `spec.engine` field:

```
Store CRD
  spec.engine: "woocommerce" | "medusajs"
         │
         ├── woocommerce → helm-charts/woocommerce/ + woocommerce-setup.ts + store-verifier.ts
         │
         └── medusajs     → helm-charts/medusajs/   + medusajs-setup.ts   + medusa-verifier.ts
```

Adding MedusaJS requires:
1. **Helm chart** (`helm-charts/medusajs/`) — MedusaJS server + PostgreSQL + Redis
2. **Setup module** (`medusajs-setup.ts`) — Seed products via Medusa Admin API or CLI
3. **Verifier** (`medusa-verifier.ts`) — HTTP health check + product API check
4. **Reconciler dispatch** — Add `if (store.spec.engine === 'medusajs')` branch (the reconciler already reads `spec.engine`)

The namespace isolation, ResourceQuota, LimitRange, NetworkPolicies, and finalizer cleanup are engine-agnostic. Only the Helm chart and setup/verification modules differ per engine.

The MedusaJS Helm chart in `helm-charts/medusajs/` includes complete Kubernetes templates (Deployment, Service, Ingress) with PostgreSQL and Redis subcharts. The operator includes `medusajs-setup.ts` documenting the setup sequence: database migrations, admin user creation, product seeding, and payment provider configuration.

## Tradeoffs & Alternatives Considered

### Raw @kubernetes/client-node vs dot-i/k8s-operator (framework)
**Chose:** Raw client-node. The operator framework (@dot-i/k8s-operator, 178 stars) provides watch abstraction and finalizer helpers, but our use case requires a multi-phase state machine with Helm integration, WP-CLI orchestration, and Prometheus metrics. The framework's event-queue model doesn't support our dual-mode reconciliation or batched concurrency control. Building on the raw client gives full control over the reconciliation loop.

### kubectl exec (WP-CLI) vs Kubernetes Jobs
**Chose:** kubectl exec. Jobs create additional pods that consume ResourceQuota, require cleanup, and add latency. Direct exec into the running WordPress pod is faster, simpler, and uses the same container that will serve traffic. The downside is coupling to the pod lifecycle, which is acceptable since we verify pod readiness before exec.

### Namespace-per-store vs label-based isolation
**Chose:** Namespace-per-store. Labels provide logical grouping but not security isolation. Namespaces provide: RBAC boundaries, NetworkPolicy scope, ResourceQuota enforcement, and clean teardown (delete namespace removes everything). The overhead of one namespace per store is negligible for the expected scale (tens to low hundreds of stores).

### --atomic vs --wait for Helm installs
**Chose:** --wait. The `--atomic` flag auto-uninstalls the release on failure, destroying PersistentVolumeClaims and data. `--wait` has identical success behavior but leaves failed releases in place with data intact, allowing diagnosis and retry without data loss.
