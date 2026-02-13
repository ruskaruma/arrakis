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
                          │  :9091       │  /healthz (watch health + uptime)
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
               │  + NetworkPolicies (8)             │
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
  template: fashion        # general | fashion | food | electronics | beauty | sports | books
  owner: "12345678"        # GitHub user ID, set by API from OAuth
  version: "1.1.0"         # optional, triggers upgrade when changed
  helmValues: {}           # optional, additional Helm --set overrides
status:
  phase: Ready             # Pending | Provisioning | Configuring | Verifying | Ready | Failed | Deleting | Upgrading | RollingBack
  url: http://s86c8ba38.54.206.104.15.nip.io/shop
  message: Store is running
  startedAt: 2026-02-11T15:00:00Z
  readyAt: 2026-02-11T15:01:14Z
  observedGeneration: 1
  helmRevision: 2          # current Helm release revision
  lastUpgradedAt: 2026-02-12T10:00:00Z
  rollbackRevision: 0      # set > 0 to trigger rollback, reconciler clears on pickup
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
   spec changed ──► │    Ready     │ Store is live and serving traffic
   (generation++)   └──┬────┬──────┘
                       │    │
         spec change ──┘    └── status.rollbackRevision set
                       │              │
                  ┌────▼──────┐  ┌────▼────────┐
                  │ Upgrading │  │ RollingBack │
                  └────┬──────┘  └────┬────────┘
                       │              │
              success ─┤              ├─ success → Ready
              failure ─┤              └─ failure → Failed
                       │
            auto-rollback → Ready (with warning)
            rollback fails → Failed
```

   Any phase can transition to Failed (timeout, error, verification failure)
   deletionTimestamp triggers: any phase → Deleting → resource cleanup → CRD removed

### observedGeneration

The operator tracks `status.observedGeneration` to avoid unnecessary reconciles. When a Ready store's `metadata.generation` matches `status.observedGeneration`, the reconciler skips it entirely. This prevents redundant work when the CRD is updated without spec changes.

## Reconciliation Model

The operator uses dual-mode reconciliation:

**Watch stream** — Real-time Kubernetes watch on Store CRDs. Fires on ADDED/MODIFIED events. The watch callback is non-blocking: it calls `reconcile(store).catch(log)` and returns immediately, preventing slow reconciles from blocking the event stream.

**Periodic sync (30s)** — Lists all Store CRDs every 30 seconds and reconciles any that aren't in a terminal state or have a deletion timestamp. Failed stores with retryCount < 3 are included in the sync, enabling automatic retry of transient failures. This catches events missed due to watch disconnects, API server restarts, or operator crashes.

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

### NetworkPolicies (8 per namespace)

**Ingress Policies:**

| Policy | Purpose |
|---|---|
| `default-deny-ingress` | Deny all inbound traffic by default |
| `allow-traefik-ingress` | Allow traffic from the ingress controller (kube-system) |
| `allow-operator-ingress` | Allow operator namespace to reach pods (for WP-CLI exec) |
| `mariadb-restrict` | MariaDB only accepts connections from WordPress pods on port 3306 |

**Egress Policies:**

| Policy | Purpose |
|---|---|
| `default-deny-egress` | Deny all outbound traffic by default |
| `allow-dns-egress` | Allow DNS resolution via kube-system (UDP/TCP 53) |
| `allow-internal-egress` | Allow pod-to-pod communication within the namespace |
| `allow-https-egress` | Allow HTTPS (port 443) for WordPress plugin updates and API calls |

This implements defense-in-depth on both ingress and egress: even if an attacker compromises one store's WordPress pod, they cannot reach other stores' databases, exfiltrate data over non-HTTPS ports, or communicate with internal cluster services outside their namespace.

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
| `beauty` | Spice Essence Perfume ($68), Desert Rose Skin Oil ($45), Sietch Mineral Soap ($18) |
| `sports` | Sandworm Rider Harness ($185), Fremen Combat Training Kit ($120), Desert Running Sandals ($75) |
| `books` | The Collected Sayings of Muad'Dib ($32), Ecology of Dune ($28), The Orange Catholic Bible ($55) |

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
| events | list, create |
| secrets | create, get |
| leases (coordination.k8s.io) | get, create, update |
| deployments | get |

No wildcard permissions. No write access to resources outside its scope. Events create is used for K8s event emission during reconciliation. Leases support leader election for operator HA.

### Container Hardening (All Environments)
Applied in both `values-local.yaml` and `values-prod.yaml`:
```yaml
containerSecurityContext:
  runAsNonRoot: true
  allowPrivilegeEscalation: false
  capabilities:
    drop: [ALL]
```
Production adds `readOnlyRootFilesystem: true` and a PodDisruptionBudget.

### Secret Management
All secrets (WordPress admin password, MariaDB root/user passwords) are generated by the Bitnami Helm chart at deploy time and stored as Kubernetes Secrets in the store's namespace. No secrets exist in source code, environment variables, or configuration files.

### Audit Logging
Every store action (create, delete, retry, credential access) is logged with a structured JSON entry containing timestamp, action, store ID, and client IP address. The audit log is persisted in a ring buffer (last 1000 entries) and queryable via `GET /api/audit`. The operator emits structured JSON logs and Kubernetes Events for every reconciliation phase transition, enabling full traceability via both `kubectl describe store` and the dashboard events panel.

### Kubernetes Events (Operator)

| Event Reason | Type | When |
|---|---|---|
| `PhaseTransition` | Normal | Store enters Configuring, Verifying, Ready, or Deleting phase |
| `HelmInstall` | Normal | Helm release installed successfully |
| `HelmRollback` | Warning | Failed upgrade rolled back to previous revision |
| `HelmCleanup` | Warning | Failed first install removed for retry |
| `UpgradeStarted` | Normal | CRD-driven Helm upgrade initiated |
| `UpgradeSucceeded` | Normal | Helm upgrade completed successfully |
| `UpgradeFailed` | Warning | Helm upgrade failed |
| `AutoRollback` | Warning | Auto-rolled back after failed upgrade |
| `RollbackStarted` | Normal | Manual rollback to target revision initiated |
| `RollbackSucceeded` | Normal | Rollback completed successfully |
| `RollbackFailed` | Warning | Rollback to target revision failed |
| `ProvisionTimeout` | Warning | Store stuck in Provisioning/Configuring > 10 minutes |
| `RetryReconcile` | Warning | Reconciliation failed, retrying (1-3 attempts) |

Events are visible via `kubectl describe store <id>` and the dashboard events panel.

### Health Check

The operator serves a health endpoint at `:9091/healthz` (implemented in `operator/src/metrics.ts`). It reports watch stream health status and process uptime, enabling Kubernetes liveness probes to detect a degraded operator.

## Abuse Prevention

| Control | Implementation |
|---|---|
| Rate limiting | 10 store creation requests per 15 minutes (express-rate-limit) |
| Store quota | Maximum 10 concurrent stores (returns HTTP 429) |
| Provisioning timeout | 10-minute timeout, auto-fails stores stuck in Provisioning/Configuring |
| Resource caps | ResourceQuota + LimitRange per namespace |
| Audit trail | Structured JSON logs with IP, action, timestamp + queryable via `GET /api/audit` |

## Idempotency & Recovery

**Store creation is safe to retry:**
- Namespace creation: catches HTTP 409 (already exists) and continues
- Helm install: uses `upgrade --install` which is idempotent
- WooCommerce product: checks for existing product via `wp wc product list --search` before creating
- NetworkPolicies, ResourceQuota, LimitRange: all catch 409 and continue
- Status updates: retry on HTTP 409 conflict (up to 3 attempts)

**Retry-before-fail (3 retries):**
- Errors during reconciliation increment `status.retryCount`
- On retry (retryCount < 3), the store phase resets to `Pending` and the full provisioning flow re-runs from the beginning
- After 3 consecutive failures, the store transitions to `Failed` permanently
- Failed stores with retryCount < 3 are included in the periodic sync, ensuring automatic retry even if the watch stream misses the event
- The retry endpoint (`POST /api/stores/:id/retry`) resets a Failed store to Pending with retryCount=0, allowing a fresh start from the dashboard

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
| Container security | runAsNonRoot, drop ALL | + readOnlyRootFilesystem, PDB |
| DNS | nip.io ({id}.127.0.0.1.nip.io) | Wildcard A record (*.stores.domain.com) |
| Resource requests | 50m CPU, 256Mi memory | 250m CPU, 512Mi memory |
| Liveness probes | Helm defaults | Tuned (initialDelay: 30s, period: 15s) |

The operator code is identical between environments. All differences are expressed through Helm values files, fulfilling the assignment requirement of "configuration changes only."

## Horizontal Scaling

### What scales horizontally
- **API server**: Stateless Express.js app. Scale via HPA on CPU utilization with 2-5 replicas.
- **Dashboard**: Static React build served by nginx. Scale arbitrarily.
- **Per-store WordPress**: Each store can scale to 2+ replicas with session affinity (values-prod.yaml already configures 2 replicas + PDB).

### Operator (leader-elected)
- **Leader election**: Kubernetes Lease-based leader election (`coordination.k8s.io/v1`). Only the leader runs the watch stream and periodic sync. Standby replicas monitor the lease and take over within 15 seconds if the leader fails.
- **HPA**: `config/hpa-operator.yaml` scales 1-3 replicas at 70% CPU. Only the leader reconciles; standbys serve metrics and the admission webhook (stateless).
- **Identity**: Each operator instance identifies by `hostname-pid`, written to the Lease's `holderIdentity` field.

### Scaling provisioning throughput
- `MAX_CONCURRENT_RECONCILES = 5` limits parallel provisioning to prevent cluster overload
- Batched `Promise.allSettled()` processes stores in groups of 5 during periodic sync
- Future: pod pre-warming pool (pre-provision WordPress pods, claim on store create) would reduce provisioning from ~3 minutes to ~10 seconds

### HPA Configuration
HPA manifests are provided in `config/hpa-operator.yaml` and `config/hpa-api.yaml` targeting 70% CPU utilization.

## Upgrade & Rollback

### CRD-Driven Upgrades
Upgrades are triggered by patching `spec.version` or `spec.helmValues` on the Store CRD. This bumps `metadata.generation`. The reconciler detects `generation > observedGeneration` on Ready stores and runs `handleUpgrade()`:

1. Sets phase to `Upgrading`
2. Runs `helm upgrade --wait --timeout 10m` with the new `--set` values
3. On success: phase → `Ready`, updates `helmRevision` and `lastUpgradedAt`
4. On failure: **auto-rollback** via `helm rollback` → `Ready` with warning message. If rollback also fails → `Failed`
5. Sets `observedGeneration = generation` in all cases to prevent infinite retry loops

```bash
# Via API:
curl -X POST http://localhost:8080/api/stores/{id}/upgrade \
  -H "Content-Type: application/json" \
  -d '{"version": "1.1.0", "helmValues": {"wordpress.replicaCount": "2"}}'
```

### Real Helm Rollback
Rollback is triggered by setting `status.rollbackRevision` on the CRD (via `POST /api/stores/:id/rollback`). The reconciler picks it up with highest priority (checked before all other phases):

1. Clears `rollbackRevision` immediately to prevent re-triggering
2. Sets phase to `RollingBack`
3. Runs `helm rollback` to the target revision
4. On success: phase → `Ready` with new `helmRevision`
5. On failure: phase → `Failed`

```bash
# Rollback to a specific revision:
curl -X POST http://localhost:8080/api/stores/{id}/rollback \
  -H "Content-Type: application/json" \
  -d '{"revision": 1}'

# Rollback to previous revision (omit body):
curl -X POST http://localhost:8080/api/stores/{id}/rollback
```

### Revision History
`GET /api/stores/:id/revisions` spawns `helm history` directly (read-only, safe). The dashboard displays a revision history table with "Rollback" buttons on non-current revisions.

### Failed Release Recovery
The reconciler also detects failed Helm releases during initial provisioning via `helm status -o json`:
- **Upgrade failure** (revision > 1): Calls `helm rollback` to restore the previous good revision. Emits a `HelmRollback` K8s Event.
- **First install failure** (revision 1): Calls `helm uninstall` to clean up the broken release, then retries from scratch on the next reconcile cycle. Emits a `HelmCleanup` K8s Event.

### Retry
`POST /api/stores/:id/retry` resets a Failed store to `Pending` with `retryCount=0`. The operator re-runs the full provisioning flow. The dashboard exposes this as a "Retry" button on failed store cards.

### CRD versioning
The CRD uses `v1alpha1` API version. When the schema evolves, a conversion webhook would handle `v1alpha1` → `v1beta1` migration while maintaining backward compatibility.

## MedusaJS Extensibility (Planned — Q2 2026)

The CRD schema accepts `spec.engine: "medusajs"` and the admission webhook blocks it with a 501 response. The API route handler also returns 501. No MedusaJS reconciliation logic exists yet.

Adding MedusaJS requires:
1. **Helm chart** (`helm-charts/medusajs/`) — MedusaJS server + PostgreSQL + Redis
2. **Setup module** — Implement product seeding via Medusa Admin API (currently `medusajs-setup.ts` is a stub that throws)
3. **Verifier** — HTTP health check + product API check
4. **Reconciler dispatch** — Add engine branching in the reconciler (currently WooCommerce-only)

The namespace isolation, ResourceQuota, LimitRange, NetworkPolicies, and finalizer cleanup are engine-agnostic. Only the Helm chart and setup/verification modules would differ per engine.

## Tradeoffs & Alternatives Considered

### Raw @kubernetes/client-node vs dot-i/k8s-operator (framework)
**Chose:** Raw client-node. The operator framework (@dot-i/k8s-operator, 178 stars) provides watch abstraction and finalizer helpers, but our use case requires a multi-phase state machine with Helm integration, WP-CLI orchestration, and CRD-driven upgrades. The framework's event-queue model doesn't support our dual-mode reconciliation or batched concurrency control. Building on the raw client gives full control over the reconciliation loop.

### kubectl exec (WP-CLI) vs Kubernetes Jobs
**Chose:** kubectl exec. Jobs create additional pods that consume ResourceQuota, require cleanup, and add latency. Direct exec into the running WordPress pod is faster, simpler, and uses the same container that will serve traffic. The downside is coupling to the pod lifecycle, which is acceptable since we verify pod readiness before exec.

### Namespace-per-store vs label-based isolation
**Chose:** Namespace-per-store. Labels provide logical grouping but not security isolation. Namespaces provide: RBAC boundaries, NetworkPolicy scope, ResourceQuota enforcement, and clean teardown (delete namespace removes everything). The overhead of one namespace per store is negligible for the expected scale (tens to low hundreds of stores).

### --atomic vs --wait for Helm installs
**Chose:** --wait. The `--atomic` flag auto-uninstalls the release on failure, destroying PersistentVolumeClaims and data. `--wait` has identical success behavior but leaves failed releases in place with data intact, allowing diagnosis and retry without data loss.
