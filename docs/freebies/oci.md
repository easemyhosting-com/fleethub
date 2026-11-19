# Oracle Cloud (OCI) free tier

<!-- Generated from src/lib/catalog/freebies by `npm run docs:freebies`. Edit the data, not this file. -->

Provider statements only, not measured usage. Search and filter these entries in FleetHub at `/freebies`.

| ID | Service | Category | Free limit | Scope | Home region only | Status | Verified | Source |
|---|---|---|---|---|---|---|---|---|
| `oci.compute-a1` | Compute A1.Flex (Arm) | compute | 1,500 OCPU-hours and 9,000 GB-hours per month, which is 2 OCPU and 12 GB running continuously: one VM, or two 1-OCPU VMs. | per tenancy | yes | verified | 2026-11-20 | [link](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm) |
| `oci.compute-e2-micro` | Compute VM.Standard.E2.1.Micro (AMD) | compute | Two VMs, each 1/8 OCPU burstable, 1 GB RAM, 50 Mbps internet. Both must be in one availability domain. | per tenancy | yes | verified | 2026-11-20 | [link](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm) |
| `oci.block-volume` | Block and boot volumes | storage | 200 GB combined boot and block volume storage, plus 5 volume backups. | per tenancy | yes | verified | 2026-11-20 | [link](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm) |
| `oci.object-storage` | Object Storage (Standard, Infrequent Access, Archive) | storage | Always-Free-only accounts: 20 GB combined across Standard, Infrequent Access and Archive, plus 50,000 API requests per month. Paid or trial accounts: 10 GB each tier. | per tenancy | not stated | verified | 2026-11-20 | [link](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm) |
| `oci.autonomous-database` | Autonomous AI Database (ATP, ADW, JSON, APEX) | database | Two serverless databases, each 1 OCPU, 20 GB storage, up to 30 simultaneous sessions. | per tenancy | yes | verified | 2026-11-20 | [link](https://docs.oracle.com/en-us/iaas/autonomous-database-serverless/doc/autonomous-always-free.html) |
| `oci.mysql-heatwave` | MySQL HeatWave | database | One standalone DB system with single-node HeatWave, 50 GB storage and 50 GB backup. | per tenancy | yes | verified | 2026-11-20 | [link](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm) |
| `oci.nosql` | NoSQL Database | database | 133 million reads and 133 million writes per month, 3 tables of 25 GB each. | per tenancy | yes | verified | 2026-11-20 | [link](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm) |
| `oci.flexible-load-balancer` | Flexible Load Balancer | networking | One load balancer at 10 Mbps with 16 listeners, 16 hostnames, 16 backend sets and 1,024 backends. | per tenancy | yes | verified | 2026-11-20 | [link](https://docs.oracle.com/en-us/iaas/Content/Balance/Tasks/managingloadbalancer_topic-Creating_Load_Balancers.htm) |
| `oci.network-load-balancer` | Network Load Balancer | networking | One layer-4 load balancer with 50 listeners and 50 backend sets. Preserves the client IP; no bandwidth cap is listed. | per tenancy | not stated | verified | 2026-11-20 | [link](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm) |
| `oci.vcn-vpn` | VCN and Site-to-Site VPN | networking | Two virtual cloud networks and 50 IPSec connections. | per tenancy | not stated | verified | 2026-11-20 | [link](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm) |
| `oci.outbound-data` | Outbound data transfer | networking | 10 TB outbound per month. | per tenancy | not stated | verified | 2026-11-20 | [link](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm) |
| `oci.vault` | Vault and Key Management | security | Unlimited software keys, 20 HSM key versions, 150 secrets with 40 versions each. Virtual private vault is not included. | per tenancy | not stated | verified | 2026-11-20 | [link](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm) |
| `oci.certificates` | Certificates | security | 5 certificate authorities and 150 certificates. | per tenancy | not stated | verified | 2026-11-20 | [link](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm) |
| `oci.bastion` | Bastion | security | No charge for the service. Service limits allow 5 bastions per region and 20 sessions per bastion. Sessions are short-lived. | per region | not stated | verified | 2026-11-20 | [link](https://docs.oracle.com/en-us/iaas/Content/General/service-limits/default.htm) |
| `oci.monitoring` | Monitoring and Alarms | observability | 500 million ingestion and 1 billion retrieval datapoints per month. | per tenancy | not stated | verified | 2026-11-20 | [link](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm) |
| `oci.logging` | Logging | observability | 10 GB per month, stated in the VCN Flow Logs section as shared across OCI Logging. | per tenancy | not stated | verified | 2026-11-20 | [link](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm) |
| `oci.apm` | Application Performance Monitoring | observability | 1,000 tracing events per hour and 10 synthetic monitor runs per hour. | per tenancy | not stated | verified | 2026-11-20 | [link](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm) |
| `oci.notifications` | Notifications | messaging | 1 million HTTPS deliveries and 1,000 email deliveries per month. HTTPS covers chat webhooks. | per tenancy | not stated | verified | 2026-11-20 | [link](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm) |
| `oci.email-delivery` | Email Delivery | email | 3,000 emails per month. | per tenancy | not stated | verified | 2026-11-20 | [link](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm) |
| `oci.connector-hub` | Connector Hub | observability | Two service connectors. | per tenancy | not stated | verified | 2026-11-20 | [link](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm) |
| `oci.resource-manager` | Resource Manager (Terraform) | devtools | 100 stacks, 2 concurrent jobs of up to 24 hours each, 1 private endpoint. | per tenancy | not stated | verified | 2026-11-20 | [link](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm) |
| `oci.container-registry` | Container Registry (OCIR) | devtools | No service charge. Images are billed as Object Storage Standard. | per tenancy | not stated | marketing | 2026-11-20 | [link](https://www.oracle.com/cloud/cloud-native/container-registry/) |
| `oci.functions` | Functions | serverless | 2 million invocations and 400,000 GB-seconds per month. | per tenancy | not stated | marketing | 2026-11-20 | [link](https://www.oracle.com/cloud/cloud-native/functions/) |
| `oci.queue` | Queue | messaging | First 1 million requests per month free. A request is 64 KB; larger messages count as several requests. | per tenancy | not stated | verified | 2026-11-20 | [link](https://www.oracle.com/cloud/price-list/) |
| `oci.devops` | DevOps | devtools | No charge for running pipelines. Deployment pipelines to OCI compute are free. | per tenancy | not stated | verified | 2026-11-20 | [link](https://www.oracle.com/cloud/price-list/) |
| `oci.api-gateway-streaming` | API Gateway, Streaming | devtools | No Always Free allowance found. Both are priced per use on the price list. Treat as not free. | per tenancy | not stated | unverified | 2026-11-20 | [link](https://docs.oracle.com/en-us/iaas/Content/General/service-limits/default.htm) |

## Caveats and suggested uses

### Compute A1.Flex (Arm) (`oci.compute-a1`)

- **reclamation:** Idle Always Free VMs can be stopped: CPU p95, network and (A1 only) memory all under 20% for 7 days. Oracle emails first. Pay-as-you-go accounts are exempt.
- **shared quota:** Boot volumes draw from the 200 GB block storage allowance. Shares with `oci.block-volume`.
- **Uses:** Single-node Kubernetes or Docker host for small services; Self-hosted CI runner on Arm.
- **Fit tags:** small-vm-host

### Compute VM.Standard.E2.1.Micro (AMD) (`oci.compute-e2-micro`)

- **reclamation:** Idle Always Free VMs can be stopped: CPU p95, network and (A1 only) memory all under 20% for 7 days. Oracle emails first. Pay-as-you-go accounts are exempt.
- **Uses:** External uptime probe; VPN or mesh exit node.
- **Fit tags:** uptime-probe

### Block and boot volumes (`oci.block-volume`)

- **shared quota:** Boot volumes of every Always Free VM count toward the same 200 GB; the 5 backups are shared by boot and block volumes. Shares with `oci.compute-a1`.
- **Uses:** Data volume for a VM host; Pre-change volume snapshots (within the 5-backup cap).
- **Fit tags:** small-vm-host

### Object Storage (Standard, Infrequent Access, Archive) (`oci.object-storage`)

- **home region:** Oracle states Always Free resources are free in the tenancy's home region; this service's own section adds no region rule. Create it in the home region to be safe.
- **other:** Container Registry images are billed at the Object Storage Standard rate. Oracle does not say whether they draw from this 20 GB, so budget for it.
- **other:** On an Always-Free-only account, writes fail past 20 GB rather than bill. Multipart uploads count toward the request allowance. Archive restores take at least an hour.
- **other:** If a Free Trial ends with more than 20 GB stored, Oracle deletes all objects. Get under 20 GB, or upgrade, before the trial ends.
- **Uses:** Encrypted off-host database dumps with a retention rule; Small static artifacts.
- **Fit tags:** offsite-backups

### Autonomous AI Database (ATP, ADW, JSON, APEX) (`oci.autonomous-database`)

- **reclamation:** Stopped automatically after 7 days without connections or CPU use. A database that stays stopped or inactive for 90 cumulative days may be permanently deleted; start it to reset the count.
- **coupling:** Oracle-specific engine with a 30-session cap. Keep it off request paths of services hosted elsewhere.
- **Uses:** Scratch or analytics database; APEX prototypes.
- **Fit tags:** scratch-database

### MySQL HeatWave (`oci.mysql-heatwave`)

- **coupling:** A database in a different place from its service adds a network round-trip and a failure dependency.
- **Uses:** Scratch MySQL for tests or analytics.
- **Fit tags:** scratch-database

### NoSQL Database (`oci.nosql`)

- **home region:** Historically offered only in the Phoenix region; check availability in your home region.
- **Uses:** Key-value side store for experiments.
- **Fit tags:** scratch-database

### Flexible Load Balancer (`oci.flexible-load-balancer`)

- **home region:** The free 10 Mbps applies in the home region; load balancers elsewhere bill normally.
- **other:** 10 Mbps is too slow for most web traffic.
- **Uses:** Low-traffic internal HTTP routing.

### Network Load Balancer (`oci.network-load-balancer`)

- **home region:** Oracle states Always Free resources are free in the tenancy's home region; this service's own section adds no region rule. Create it in the home region to be safe.
- **Uses:** Stable public IP in front of a VM so the instance can be rebuilt.
- **Fit tags:** ingress-ip

### VCN and Site-to-Site VPN (`oci.vcn-vpn`)

- **Uses:** Private network for Always Free resources.

### Outbound data transfer (`oci.outbound-data`)

- **egress:** Egress above 10 TB per month is billed on paid accounts.
- **blocked port:** Outbound TCP 25 is blocked by default. Use port 587 for Email Delivery.
- **Uses:** Serving downloads or offsite backup pulls.

### Vault and Key Management (`oci.vault`)

- **Uses:** Break-glass copies of recovery keys, read only during restore.
- **Fit tags:** break-glass-secrets

### Certificates (`oci.certificates`)

- **Uses:** Private CA for internal TLS.
- **Fit tags:** tls-certificates

### Bastion (`oci.bastion`)

- **Uses:** Break-glass SSH path when the usual access route is down.
- **Fit tags:** admin-access

### Monitoring and Alarms (`oci.monitoring`)

- **Uses:** Alarm when an Always Free VM stops, so reclamation is noticed early.
- **Fit tags:** metrics-alarms

### Logging (`oci.logging`)

- **shared quota:** VCN flow logs and other OCI log sources share the 10 GB.
- **Uses:** Audit or flow log retention.
- **Fit tags:** log-archive

### Application Performance Monitoring (`oci.apm`)

- **Uses:** Low-frequency synthetic checks.
- **Fit tags:** uptime-probe

### Notifications (`oci.notifications`)

- **other:** Email deliveries are free up to 1,000 per month across email subscriptions; use Email Delivery for bulk mail.
- **Uses:** Alert fan-out to chat webhooks.
- **Fit tags:** alert-push

### Email Delivery (`oci.email-delivery`)

- **blocked port:** Submit on SMTP port 587; port 25 is blocked.
- **other:** Needs SPF and DKIM on the sending domain. High bounce rates can suspend the sender; throttle repeat alerts.
- **Uses:** Alert and transactional email sender.
- **Fit tags:** alert-email

### Connector Hub (`oci.connector-hub`)

- **Uses:** Move logs to Object Storage or Notifications.
- **Fit tags:** log-archive

### Resource Manager (Terraform) (`oci.resource-manager`)

- **Uses:** Managed Terraform runs for OCI resources.
- **Fit tags:** iac-runner

### Container Registry (OCIR) (`oci.container-registry`)

- **other:** Image storage is billed at the Object Storage Standard rate. Whether it draws from the free 20 GB is not documented; assume it may.
- **Uses:** Pull fallback for a few critical base images.
- **Fit tags:** image-mirror

### Functions (`oci.functions`)

- **coupling:** Placing a function on another host's request path couples the two.
- **Uses:** Event handlers for OCI alarms or object events.
- **Fit tags:** event-functions

### Queue (`oci.queue`)

- **Uses:** Low-volume work queue.

### DevOps (`oci.devops`)

- **other:** CI build runners bill for the OCPU and memory they use.
- **Uses:** Deployment pipelines to OCI compute.
- **Fit tags:** iac-runner
