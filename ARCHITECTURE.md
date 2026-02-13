# Arrakis — Architecture

## System Overview

```mermaid
graph TB
    User([User]) -->|GitHub OAuth| Dash["Dashboard<br/>React 19 + Vite + Tailwind<br/>:5173"]
    Dash -->|REST / poll 5s| API["REST API<br/>Express.js<br/>:8080"]
    API -->|CRD CRUD| K8s["Kubernetes API Server"]
    K8s -->|validates| WH["Admission Webhook<br/>:9443 TLS"]
    K8s -->|watch stream| OP["Operator<br/>@kubernetes/client-node"]
    K8s -->|30s periodic sync| OP
    OP -->|leader election| Lease["Lease<br/>coordination.k8s.io"]
    OP -->|helm upgrade --install| Store1["store-s1a2b3c4<br/>WordPress + MariaDB<br/>+ Quota + Policies"]
    OP -->|helm upgrade --install| Store2["store-s86c8ba3<br/>WordPress + MariaDB<br/>+ Quota + Policies"]
    OP -->|wp-cli exec| Store1
    OP -->|wp-cli exec| Store2
```

Three components. The **API** is a thin translation layer — it takes HTTP requests, writes CRDs, and returns. The **Operator** watches CRDs and reconciles desired state by provisioning namespaces, installing Helm charts, configuring WooCommerce via WP-CLI, and verifying health. The **Dashboard** polls the API and renders store status, events, and actions.

## CRD Schema

```yaml
apiVersion: arrakis.io/v1alpha1
kind: Store
metadata:
  name: s86c8ba38                    # 8-char hex ID
  finalizers: [arrakis.io/store-cleanup]
spec:
  engine: woocommerce                # woocommerce | medusajs (planned)
  storeName: "My Fashion Store"      # optional display name
  template: fashion                  # 7 templates available
  owner: "12345678"                  # GitHub user ID
  version: "1.1.0"                   # optional, triggers upgrade
  helmValues: {}                     # optional Helm --set overrides
status:
  phase: Ready                       # see state machine below
  url: http://s86c8ba38.127.0.0.1.nip.io/shop
  observedGeneration: 1              # prevents redundant reconciles
  helmRevision: 2                    # current Helm release revision
  rollbackRevision: 0                # set > 0 to trigger rollback
```

## Phase State Machine

```mermaid
stateDiagram-v2
    [*] --> Pending: Store created
    Pending --> Provisioning: Add finalizer, create namespace
    Provisioning --> Configuring: All pods ready
    Configuring --> Verifying: WP-CLI setup complete
    Verifying --> Ready: HTTP 200 + products exist

    Ready --> Upgrading: spec changed (generation > observed)
    Ready --> RollingBack: rollbackRevision set
    Upgrading --> Ready: helm upgrade succeeded
    Upgrading --> Ready: upgrade failed, auto-rollback succeeded
    Upgrading --> Failed: upgrade + auto-rollback both failed
    RollingBack --> Ready: helm rollback succeeded
    RollingBack --> Failed: rollback failed

    Provisioning --> Failed: timeout (10min) or error
    Configuring --> Failed: timeout or error
    Verifying --> Failed: verification failed
    Failed --> Pending: retry requested

    Ready --> Deleting: deletionTimestamp set
    Pending --> Deleting: deletionTimestamp set
    Failed --> Deleting: deletionTimestamp set
    Deleting --> [*]: namespace + helm cleaned up, finalizer removed
```

The operator tracks `status.observedGeneration` — when a Ready store's `metadata.generation` matches, the reconciler skips it entirely, avoiding redundant work.

## Reconciliation Model

```mermaid
graph TB
    subgraph "Dual-Mode Reconciliation"
        Watch["Watch Stream<br/>Real-time ADDED/MODIFIED events"]
        Sync["Periodic Sync (30s)<br/>Lists all CRDs, reconciles non-terminal"]
    end

    Watch --> Reconcile
    Sync --> Reconcile

    Reconcile["reconcile(store)"]
    Reconcile --> Guard{"activeReconciles<br/>has storeId?"}
    Guard -->|yes| Skip[Skip]
    Guard -->|no| Lock["Add to activeReconciles"]
    Lock --> Phase{"Check phase +<br/>deletionTimestamp"}

    Phase -->|deletion| Delete["Helm uninstall → delete NS → remove finalizer"]
    Phase -->|rollbackRevision > 0| Rollback["helm rollback → Ready or Failed"]
    Phase -->|generation > observed| Upgrade["helm upgrade → Ready or auto-rollback"]
    Phase -->|not Ready| Provision["Namespace → Helm → WP-CLI → Verify → Ready"]
```

**Why dual-mode?** Watch alone is unreliable — Kubernetes watches disconnect silently. The 30s sync re-lists all CRDs and reconciles anything stuck. Same pattern as the upstream Kubernetes Deployment controller.

**Concurrency:** `activeReconciles` Set prevents duplicate reconciliation. `MAX_CONCURRENT_RECONCILES = 5` batches periodic sync to avoid overwhelming the cluster.

## 1. Production Deployment

```mermaid
graph LR
    subgraph "Local (k3d)"
        L_Ingress["Traefik (k3d default)"]
        L_Storage["local-path (1Gi)"]
        L_DNS["nip.io wildcard"]
        L_TLS["None (HTTP)"]
        L_Replicas["1 WordPress replica"]
    end

    subgraph "Production (k3s VPS)"
        P_Ingress["nginx-ingress"]
        P_Storage["Longhorn distributed (10Gi)"]
        P_DNS["Wildcard A record (*.domain.com)"]
        P_TLS["cert-manager + Let's Encrypt"]
        P_Replicas["2 replicas + PDB"]
    end
```

All differences are expressed through Helm values files (`values-local.yaml` vs `values-prod.yaml`) — the operator code is identical between environments. Production adds:

- **nginx-ingress** instead of Traefik for production-grade load balancing
- **cert-manager** with Let's Encrypt for automatic TLS certificate provisioning
- **Longhorn** for distributed, replicated storage (10Gi per store vs 1Gi local)
- **2 WordPress replicas** with `PodDisruptionBudget` and pod anti-affinity for node spread
- **`readOnlyRootFilesystem: true`** in container security context
- **Wildcard DNS** — `*.yourdomain.com` A record pointing to VPS IP; each store gets `{id}.yourdomain.com`

Deployed on AWS EC2 (ap-southeast-2, c7i-flex.large) running k3s, accessible at [`arrakis.ruskaruma.me`](http://arrakis.ruskaruma.me:3000).

## 2. Multi-Tenant Isolation

```mermaid
graph TB
    subgraph "store-{id} namespace"
        WP["WordPress Pod"]
        DB["MariaDB Pod"]
        PVC["PVC (storage)"]

        subgraph "ResourceQuota"
            RQ["CPU: 500m req / 2 limit<br/>Memory: 1Gi req / 3Gi limit<br/>PVCs: max 5"]
        end

        subgraph "LimitRange"
            LR["Default: 500m CPU, 512Mi mem<br/>Request: 100m CPU, 128Mi mem<br/>PVC max: 5Gi"]
        end

        subgraph "NetworkPolicies (8)"
            NP1["default-deny-ingress"]
            NP2["allow-traefik-ingress"]
            NP3["allow-operator-ingress"]
            NP4["mariadb-restrict (WP only, port 3306)"]
            NP5["default-deny-egress"]
            NP6["allow-dns-egress (UDP/TCP 53)"]
            NP7["allow-internal-egress"]
            NP8["allow-https-egress (port 443)"]
        end
    end
```

Each store gets a dedicated namespace with four layers of isolation:

- **ResourceQuota** — hard caps on CPU, memory, and PVC count per namespace
- **LimitRange** — default container limits and max PVC size, even if Helm chart doesn't specify
- **8 NetworkPolicies** — deny-by-default on both ingress and egress, with explicit allows for ingress controller, operator exec, DNS, internal pod traffic, and HTTPS outbound only
- **Namespace labels** — `arrakis.io/store-id` and `app.kubernetes.io/managed-by: arrakis` for identification

A compromised WordPress pod cannot reach other stores' databases, exfiltrate data over non-HTTPS ports, or communicate with internal services outside its namespace.

## 3. Idempotency & Recovery

```mermaid
graph TB
    Create["Store creation attempt"] --> NS{"Namespace exists?"}
    NS -->|yes| Helm{"Helm release exists?"}
    NS -->|no| CreateNS["Create namespace (409 → skip)"]
    CreateNS --> ApplyQuota["Apply quota + policies (409 → skip)"]
    ApplyQuota --> Helm

    Helm -->|deployed| Pods{"Pods ready?"}
    Helm -->|failed, rev > 1| RollbackHelm["helm rollback"]
    Helm -->|failed, rev 1| CleanHelm["helm uninstall → retry"]
    Helm -->|not found| Install["helm upgrade --install (idempotent)"]
    Install --> Pods
    RollbackHelm --> Pods
    CleanHelm --> Pods

    Pods -->|yes| WPSetup["WP-CLI setup<br/>(checks existing products before seeding)"]
    Pods -->|no| Wait["Wait, update status"]

    WPSetup --> Verify["HTTP 200 + product count > 0"]
    Verify -->|pass| Ready["Ready"]
    Verify -->|fail| Error["Error → retry (up to 3)"]
```

- **Namespace creation** catches HTTP 409 (already exists) and continues
- **Helm install** uses `upgrade --install` which is idempotent
- **Product seeding** checks `wp wc product list --format=count` before creating
- **All K8s resources** (quota, policies, limit range, secrets) catch 409 on create
- **Status updates** retry on 409 conflict (up to 3 attempts)
- **Operator crash recovery** — the 30s periodic sync re-lists all CRDs and reconciles anything non-terminal. No in-memory state needed; all state lives in CRD status.
- **Retry-before-fail** — errors increment `retryCount`, store resets to Pending for full re-provisioning. After 3 consecutive failures → permanent `Failed`.
- **Clean deletion** — finalizer prevents CRD garbage collection until: Helm uninstall → namespace delete → finalizer removed.

## 4. Abuse Prevention

```mermaid
graph LR
    Req([Request]) --> RL{"Rate limit<br/>10 / 15min"}
    RL -->|exceeded| R429[429 Too Many Requests]
    RL -->|ok| Auth{"Authenticated?"}
    Auth -->|no| R401[401 Unauthorized]
    Auth -->|yes| Quota{"Stores < 10?"}
    Quota -->|no| R429b[429 Max stores]
    Quota -->|yes| Create["Create CRD"]
    Create --> Webhook{"Admission webhook<br/>valid?"}
    Webhook -->|no| R403[403 Rejected]
    Webhook -->|yes| Reconcile["Operator reconciles"]
    Reconcile --> Timeout{"10min<br/>timeout?"}
    Timeout -->|yes| Failed["Failed + logged"]
    Timeout -->|no| Ready["Ready"]
```

| Control | Implementation |
|---|---|
| Rate limiting | 10 store creation requests per 15 minutes (`express-rate-limit`) |
| Per-user store quota | Maximum 10 concurrent stores per authenticated user (HTTP 429) |
| Provisioning timeout | 10-minute timeout → auto-fails stores stuck in Provisioning/Configuring |
| Resource caps | ResourceQuota + LimitRange per namespace |
| 3-layer validation | CRD OpenAPI schema → admission webhook → API route handler |
| Audit trail | Structured JSON logs with IP, action, timestamp; queryable via `GET /api/audit` |

## 5. Observability

```mermaid
graph TB
    subgraph "Operator Events"
        E1["PhaseTransition → Normal"]
        E2["HelmInstall → Normal"]
        E3["UpgradeFailed → Warning"]
        E4["AutoRollback → Warning"]
        E5["ProvisionTimeout → Warning"]
        E6["RetryReconcile → Warning"]
    end

    subgraph "Surfaces"
        CLI["kubectl describe store {id}"]
        Dash["Dashboard event timeline"]
        Audit["GET /api/audit"]
        Stats["GET /api/stats"]
        Metrics["GET /api/stores/:id/metrics"]
    end

    E1 --> CLI
    E1 --> Dash
    E3 --> CLI
    E3 --> Dash
```

- **Kubernetes Events** — operator emits 13 event types (Normal + Warning) on every phase transition, install, upgrade, rollback, timeout, and retry. Visible via `kubectl describe store` and the dashboard.
- **Store-level event timeline** — dashboard shows events per store with timestamps, type, and message.
- **Audit log** — ring buffer of last 1000 actions (create, delete, retry, credential access) with IP and timestamp. Queryable via `GET /api/audit`.
- **Stats endpoint** — `GET /api/stats` returns store count by phase and average provisioning duration.
- **Resource metrics** — `GET /api/stores/:id/metrics` returns per-pod CPU, memory, and storage from the K8s metrics API.
- **Structured logging** — operator logs structured JSON with log code, message, and store ID context for every operation.
- **Clear failure reporting** — `status.message` contains the specific error message, retry count, and whether it was a timeout, verification failure, or Helm error.
- **Health endpoint** — operator `:9091/healthz` reports watch stream health and process uptime for liveness probes.

## 6. Security Hardening

```mermaid
graph TB
    subgraph "Authentication & Authorization"
        OAuth["GitHub OAuth<br/>(passport-github2)"]
        Session["express-session<br/>(httpOnly, secure in prod)"]
        Owner["Per-user ownership<br/>(spec.owner from GitHub ID)"]
    end

    subgraph "Admission Control"
        CRD_Schema["CRD OpenAPI schema validation"]
        Webhook["Validating admission webhook<br/>(engine, name, template, version)"]
        Route["API route validation<br/>(before CRD creation)"]
    end

    subgraph "RBAC (Least Privilege)"
        SA["ServiceAccount: arrakis-operator"]
        CR["ClusterRole: exact verbs per resource<br/>No wildcards"]
    end

    subgraph "Container Hardening"
        NonRoot["runAsNonRoot: true"]
        NoCaps["capabilities: drop ALL"]
        NoEscalate["allowPrivilegeEscalation: false"]
        ReadOnly["readOnlyRootFilesystem (prod)"]
    end

    subgraph "Network Isolation"
        DenyIngress["default-deny-ingress"]
        DenyEgress["default-deny-egress"]
        MariaDB["MariaDB: WP-only on 3306"]
    end
```

**RBAC** — operator runs under `arrakis-operator` ServiceAccount with a ClusterRole scoped to exact verbs per resource. No wildcards. No write access outside its scope.

**3-layer validation** — invalid stores are rejected at CRD schema (K8s API server), admission webhook (custom logic), and API route handler (Express validation).

**Container hardening** — all containers run as non-root, drop all capabilities, and disallow privilege escalation. Production adds read-only root filesystem.

**Network policies** — 8 policies per namespace implement deny-by-default ingress and egress. MariaDB only accepts connections from WordPress pods on port 3306.

**Secret management** — all secrets (WordPress admin password, MariaDB passwords, WC API keys) are generated at deploy time and stored as Kubernetes Secrets. No secrets in source code.

**Session security** — production requires `SESSION_SECRET` env var (exit on missing), cookies are `httpOnly` and `secure` in production.

## 7. Scaling

```mermaid
graph TB
    subgraph "Horizontal Scaling"
        API_HPA["API HPA<br/>1-5 replicas<br/>70% CPU target"]
        OP_HPA["Operator HPA<br/>1-3 replicas<br/>70% CPU target"]
        WP_Scale["WordPress<br/>2 replicas (prod)<br/>+ PDB"]
    end

    subgraph "Leader Election"
        Leader["Leader instance<br/>Runs watch + sync"]
        Standby1["Standby<br/>Webhook + healthz only"]
        Standby2["Standby<br/>Webhook + healthz only"]
        Lease["K8s Lease<br/>15s duration<br/>10s renew"]
    end

    Leader -->|renews| Lease
    Standby1 -->|monitors| Lease
    Standby2 -->|monitors| Lease
    Lease -->|leader fails| Standby1
```

- **API** — stateless Express.js, scales horizontally via HPA (1-5 replicas on CPU).
- **Dashboard** — static React build, scales arbitrarily.
- **Operator** — Lease-based leader election (`coordination.k8s.io`). Only the leader runs watch + sync. Standby replicas serve the admission webhook and health endpoint. Failover within 15 seconds.
- **Concurrency controls** — `MAX_CONCURRENT_RECONCILES = 5` batches periodic sync with `Promise.allSettled()`. `activeReconciles` Set prevents duplicate reconciliation.
- **Per-store WordPress** — 2 replicas in production with PodDisruptionBudget and pod anti-affinity for node spread.

## 8. Upgrades & Rollback

```mermaid
sequenceDiagram
    participant User
    participant API
    participant K8s as K8s API
    participant Op as Operator
    participant Helm

    Note over User,Helm: Upgrade Flow
    User->>API: POST /stores/{id}/upgrade {version: "1.1.0"}
    API->>K8s: PATCH spec.version (bumps generation)
    K8s->>Op: MODIFIED event (generation > observedGeneration)
    Op->>Op: Set phase = Upgrading
    Op->>Helm: helm upgrade --wait --timeout 10m
    alt success
        Helm-->>Op: exit 0
        Op->>K8s: phase = Ready, helmRevision++
    else failure
        Helm-->>Op: exit 1
        Op->>Helm: helm rollback (auto)
        alt rollback ok
            Helm-->>Op: exit 0
            Op->>K8s: phase = Ready (with warning)
        else rollback fails
            Op->>K8s: phase = Failed
        end
    end

    Note over User,Helm: Rollback Flow
    User->>API: POST /stores/{id}/rollback {revision: 1}
    API->>K8s: PATCH status.rollbackRevision = 1
    K8s->>Op: MODIFIED event
    Op->>Op: Clear rollbackRevision, set phase = RollingBack
    Op->>Helm: helm rollback {id} 1
    alt success
        Op->>K8s: phase = Ready, new helmRevision
    else failure
        Op->>K8s: phase = Failed
    end
```

**CRD-driven upgrades** — API patches `spec.version` or `spec.helmValues`, bumping `metadata.generation`. Operator detects `generation > observedGeneration` on Ready stores, runs `helm upgrade --wait`. On failure, auto-rollbacks to the previous revision.

**Real Helm rollback** — `POST /stores/:id/rollback` sets `status.rollbackRevision` on the CRD. Operator picks it up with highest priority, clears the field to prevent re-triggering, runs `helm rollback` to the target revision.

**Revision history** — `GET /stores/:id/revisions` returns Helm release history. Dashboard shows a revision table with rollback buttons.

**Failed release recovery** — during provisioning, operator checks `helm status`. Revision > 1 with failed status → rollback. Revision 1 failed → uninstall and retry from scratch.

**Retry** — `POST /stores/:id/retry` resets to Pending with `retryCount=0` for a fresh provisioning attempt.

## Request Flow

```mermaid
sequenceDiagram
    participant User
    participant Dash as Dashboard
    participant API
    participant K8s as K8s API
    participant WH as Webhook
    participant Op as Operator
    participant Helm
    participant WP as WordPress Pod

    User->>Dash: Click "Create Store"
    Dash->>API: POST /api/stores {engine, template}
    API->>API: Validate + check quota
    API->>K8s: Create Store CRD
    K8s->>WH: Admission review
    WH-->>K8s: Allowed
    K8s-->>API: Created
    API-->>Dash: 201 {id, phase: Pending}

    K8s->>Op: Watch event: ADDED
    Op->>K8s: Add finalizer
    Op->>K8s: Create namespace + quota + policies
    Op->>Helm: helm upgrade --install --wait
    Note over Helm: Deploys WordPress + MariaDB
    Helm-->>Op: Release deployed

    Op->>WP: wp plugin install woocommerce --activate
    Op->>WP: wp wc product create (template products)
    Op->>WP: wp option update (HPOS, COD, homepage)
    Op->>WP: Generate WC API keys → K8s Secret

    Op->>WP: HTTP GET /shop (health check)
    Op->>WP: wp wc product list --format=count (> 0)
    Op->>K8s: phase = Ready, url = http://{id}.domain/shop

    Dash->>API: GET /api/stores (poll)
    API-->>Dash: [{phase: Ready, url: ...}]
    Dash-->>User: Store is live!
```

## Tradeoffs & Alternatives

| Decision | Chose | Alternative | Rationale |
|---|---|---|---|
| State management | CRD + operator reconciliation | Direct provisioning from API | Crash recovery is free, kubectl is a first-class client, upgrades are CRD patches |
| Isolation model | Namespace per store | Label-based isolation | Namespaces give real RBAC, NetworkPolicy, and ResourceQuota boundaries |
| Helm install flag | `--wait` | `--atomic` | `--atomic` deletes failed releases (and PVCs/data); `--wait` preserves them for retry |
| WP-CLI execution | `kubectl exec` into running pod | Kubernetes Jobs | Jobs consume quota, need cleanup, add latency; exec is faster and simpler |
| Watch reliability | Watch + 30s periodic sync | Watch only | Watches disconnect silently; sync is the consistency guarantee |
| Leader election | K8s Lease API | etcd lock / external coordinator | Native K8s primitive, no external dependencies, 15s failover |
| Dashboard updates | 5s polling | WebSocket / SSE | Polling is simpler, works through proxies/load balancers, acceptable latency for this use case |
