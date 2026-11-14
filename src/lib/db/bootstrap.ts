import { createHash } from "node:crypto";
import { queryClient } from "./client";

export async function bootstrapDatabase() {
  try {
    // 1. Create tables if not exist
    await queryClient`
      CREATE TABLE IF NOT EXISTS identities (
        id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `;

    await queryClient`
      CREATE TABLE IF NOT EXISTS identity_contacts (
        id TEXT PRIMARY KEY,
        identity_id TEXT NOT NULL REFERENCES identities(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        value TEXT NOT NULL,
        is_primary BOOLEAN NOT NULL DEFAULT false,
        is_verified BOOLEAN NOT NULL DEFAULT false,
        label TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `;

    await queryClient`
      CREATE TABLE IF NOT EXISTS secret_refs (
        id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        infisical_project TEXT NOT NULL DEFAULT 'fleet',
        environment TEXT NOT NULL DEFAULT 'prod',
        path TEXT NOT NULL,
        keys JSONB NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'verified',
        last_verified_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `;

    await queryClient`
      CREATE TABLE IF NOT EXISTS provider_accounts (
        id TEXT PRIMARY KEY,
        identity_id TEXT REFERENCES identities(id),
        kind TEXT NOT NULL,
        label TEXT NOT NULL,
        owner_email TEXT NOT NULL,
        login_email TEXT,
        role TEXT NOT NULL DEFAULT 'member',
        is_protected BOOLEAN NOT NULL DEFAULT false,
        secret_ref_id TEXT REFERENCES secret_refs(id),
        health TEXT NOT NULL DEFAULT 'ok',
        health_detail TEXT,
        meta JSONB DEFAULT '{}',
        notes TEXT,
        enabled BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `;

    // Alter table in case provider_accounts existed from prior migrations
    await queryClient`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'provider_accounts' AND column_name = 'identity_id') THEN
          ALTER TABLE provider_accounts ADD COLUMN identity_id TEXT REFERENCES identities(id);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'provider_accounts' AND column_name = 'credential_expires_at') THEN
          ALTER TABLE provider_accounts ADD COLUMN credential_expires_at TIMESTAMPTZ, ADD COLUMN credential_expiry_source TEXT, ADD COLUMN credential_expiry_checked_at TIMESTAMPTZ;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'provider_accounts' AND column_name = 'login_email') THEN
          ALTER TABLE provider_accounts ADD COLUMN login_email TEXT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'provider_accounts' AND column_name = 'role') THEN
          ALTER TABLE provider_accounts ADD COLUMN role TEXT NOT NULL DEFAULT 'member';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'provider_accounts' AND column_name = 'is_protected') THEN
          ALTER TABLE provider_accounts ADD COLUMN is_protected BOOLEAN NOT NULL DEFAULT false;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'provider_accounts' AND column_name = 'updated_at') THEN
          ALTER TABLE provider_accounts ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'provider_accounts' AND column_name = 'archived_at') THEN
          ALTER TABLE provider_accounts ADD COLUMN archived_at TIMESTAMPTZ, ADD COLUMN scope_id TEXT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'provider_accounts' AND column_name = 'plan') THEN
          ALTER TABLE provider_accounts ADD COLUMN plan TEXT NOT NULL DEFAULT 'unknown', ADD COLUMN plan_source TEXT NOT NULL DEFAULT 'manual', ADD COLUMN contact_id TEXT REFERENCES identity_contacts(id) ON DELETE SET NULL;
        END IF;
      END $$;
    `;

    // Link each account to the email contact that owns it (idempotent; accounts whose email is not a contact stay unlinked).
    await queryClient`
      UPDATE provider_accounts a SET contact_id = (
        SELECT c.id FROM identity_contacts c WHERE c.kind = 'email' AND LOWER(TRIM(c.value)) = LOWER(TRIM(a.owner_email))
        ORDER BY (c.identity_id IS NOT DISTINCT FROM a.identity_id) DESC, c.is_primary DESC, c.created_at LIMIT 1)
      WHERE a.contact_id IS NULL
    `;

    await queryClient`
      CREATE TABLE IF NOT EXISTS resources (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        provider TEXT NOT NULL,
        account_id TEXT REFERENCES provider_accounts(id),
        account_email TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'online',
        is_protected BOOLEAN NOT NULL DEFAULT false,
        tags JSONB NOT NULL DEFAULT '[]',
        attributes JSONB NOT NULL DEFAULT '{}',
        last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `;
    await queryClient`ALTER TABLE resources ADD COLUMN IF NOT EXISTS native_id TEXT`;
    await queryClient`ALTER TABLE resources ADD COLUMN IF NOT EXISTS region TEXT`;
    await queryClient`ALTER TABLE resources ADD COLUMN IF NOT EXISTS source_url TEXT`;
    await queryClient`ALTER TABLE resources ADD COLUMN IF NOT EXISTS inventory_source TEXT NOT NULL DEFAULT 'manual'`;
    await queryClient`ALTER TABLE resources ADD COLUMN IF NOT EXISTS scan_generation INTEGER`;
    await queryClient`ALTER TABLE resources ADD COLUMN IF NOT EXISTS retired_at TIMESTAMPTZ`;
    await queryClient`ALTER TABLE resources ADD COLUMN IF NOT EXISTS provider_state TEXT`;
    await queryClient`
      CREATE TABLE IF NOT EXISTS account_collections (
        account_id TEXT PRIMARY KEY REFERENCES provider_accounts(id) ON DELETE CASCADE,
        state TEXT NOT NULL DEFAULT 'queued',
        scope_hash TEXT,
        credential_hash TEXT,
        generation INTEGER NOT NULL DEFAULT 0,
        attempts INTEGER NOT NULL DEFAULT 0,
        lease_token TEXT,
        lease_until TIMESTAMPTZ,
        next_attempt_at TIMESTAMPTZ,
        last_attempt_at TIMESTAMPTZ,
        last_success_at TIMESTAMPTZ,
        error_code TEXT
      )`;
    await queryClient`ALTER TABLE account_collections ADD COLUMN IF NOT EXISTS credential_hash TEXT`;
    await queryClient`ALTER TABLE account_collections ADD COLUMN IF NOT EXISTS confirm_empty BOOLEAN NOT NULL DEFAULT false`;
    await queryClient`CREATE INDEX IF NOT EXISTS account_collections_due ON account_collections (next_attempt_at) WHERE state IN ('queued', 'ready', 'running')`;
    await queryClient`
      CREATE TABLE IF NOT EXISTS resource_profiles (
        resource_id TEXT PRIMARY KEY REFERENCES resources(id) ON DELETE CASCADE,
        role TEXT NOT NULL DEFAULT 'general',
        lifecycle TEXT NOT NULL DEFAULT 'always_on',
        backup_class TEXT NOT NULL DEFAULT 'none',
        criticality TEXT NOT NULL DEFAULT 'normal',
        auto_stop TEXT NOT NULL DEFAULT 'off',
        labels JSONB NOT NULL DEFAULT '{}',
        notes TEXT,
        updated_by TEXT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`;
    await queryClient`
      CREATE TABLE IF NOT EXISTS entitlements (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        product TEXT NOT NULL,
        metric TEXT NOT NULL,
        label TEXT NOT NULL,
        limit_value DOUBLE PRECISION NOT NULL CHECK (limit_value >= 0),
        unit TEXT NOT NULL,
        period TEXT NOT NULL CHECK (period IN ('day', 'month', 'pool', 'none')),
        resets_rule TEXT,
        verification TEXT NOT NULL CHECK (verification IN ('verified', 'reported', 'unverified')),
        verified_at DATE,
        source_url TEXT,
        note TEXT,
        catalog_version INTEGER NOT NULL DEFAULT 1,
        edited BOOLEAN NOT NULL DEFAULT false,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`;
    await queryClient`
      CREATE TABLE IF NOT EXISTS allowances (
        id TEXT PRIMARY KEY,
        entitlement_id TEXT NOT NULL REFERENCES entitlements(id) ON DELETE CASCADE,
        scope_type TEXT NOT NULL CHECK (scope_type IN ('global', 'account')),
        scope_id TEXT NOT NULL DEFAULT '',
        limit_value DOUBLE PRECISION NOT NULL CHECK (limit_value >= 0),
        reason TEXT,
        updated_by TEXT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (entitlement_id, scope_type, scope_id)
      )`;
    await queryClient`
      CREATE TABLE IF NOT EXISTS capacity_events (
        id BIGSERIAL PRIMARY KEY,
        subject TEXT NOT NULL,
        action TEXT NOT NULL,
        actor TEXT NOT NULL,
        detail JSONB NOT NULL DEFAULT '{}',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`;
    await queryClient`
      CREATE TABLE IF NOT EXISTS secret_store (
        name TEXT PRIMARY KEY,
        nonce BYTEA NOT NULL,
        ciphertext BYTEA NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`;
    // Shared request limiter. Unlogged: counters are worthless after a crash and should not add write-ahead log traffic.
    await queryClient`
      CREATE UNLOGGED TABLE IF NOT EXISTS rate_limit_windows (
        key TEXT NOT NULL,
        window_start TIMESTAMPTZ NOT NULL,
        count INTEGER NOT NULL,
        PRIMARY KEY (key, window_start)
      )`;
    await queryClient`CREATE INDEX IF NOT EXISTS rate_limit_windows_start ON rate_limit_windows (window_start)`;
    await queryClient`
      CREATE TABLE IF NOT EXISTS credential_rotation (
        account_id TEXT PRIMARY KEY REFERENCES provider_accounts(id) ON DELETE CASCADE,
        rotator_secret_name TEXT NOT NULL,
        schedule_days INTEGER CHECK (schedule_days IS NULL OR schedule_days BETWEEN 1 AND 365),
        next_rotation_at TIMESTAMPTZ,
        last_rotated_at TIMESTAMPTZ,
        last_attempt_at TIMESTAMPTZ,
        last_status TEXT,
        last_error_code TEXT,
        lease_until TIMESTAMPTZ
      )`;
    await queryClient`
      CREATE TABLE IF NOT EXISTS credential_events (
        id BIGSERIAL PRIMARY KEY,
        account_id TEXT NOT NULL,
        action TEXT NOT NULL,
        outcome TEXT NOT NULL,
        error_code TEXT,
        actor TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`;
    await queryClient`CREATE INDEX IF NOT EXISTS credential_events_recent ON credential_events (created_at DESC)`;
    await queryClient`
      CREATE TABLE IF NOT EXISTS inventory_worker (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        process_id TEXT NOT NULL,
        last_seen_at TIMESTAMPTZ NOT NULL
      )`;

    await queryClient`
      CREATE TABLE IF NOT EXISTS quota_meters (
        id TEXT PRIMARY KEY,
        account_id TEXT REFERENCES provider_accounts(id),
        key TEXT NOT NULL,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        unit TEXT NOT NULL,
        limit_value DOUBLE PRECISION NOT NULL,
        warn_pct INTEGER NOT NULL DEFAULT 80,
        crit_pct INTEGER NOT NULL DEFAULT 95,
        source TEXT NOT NULL DEFAULT 'api',
        "window" JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `;

    await queryClient`
      CREATE TABLE IF NOT EXISTS quota_samples (
        id TEXT PRIMARY KEY,
        meter_id TEXT NOT NULL REFERENCES quota_meters(id) ON DELETE CASCADE,
        ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        value DOUBLE PRECISION NOT NULL,
        method TEXT NOT NULL DEFAULT 'api'
      );
    `;

    await queryClient`
      CREATE TABLE IF NOT EXISTS network_gateways (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        tailscale_ip TEXT NOT NULL,
        port INTEGER NOT NULL DEFAULT 8888,
        state TEXT NOT NULL DEFAULT 'online',
        latency_ms INTEGER DEFAULT 12,
        last_checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `;

    await queryClient`
      CREATE TABLE IF NOT EXISTS audit_log (
        id TEXT PRIMARY KEY,
        ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        actor TEXT NOT NULL,
        action TEXT NOT NULL,
        target_type TEXT NOT NULL,
        target_id TEXT NOT NULL,
        details JSONB NOT NULL DEFAULT '{}'
      );
    `;

    await queryClient`
      CREATE TABLE IF NOT EXISTS app_users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT,
        google_sub TEXT UNIQUE,
        name TEXT,
        auth_provider TEXT NOT NULL DEFAULT 'local',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `;

    await queryClient`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS google_sub TEXT;`;
    await queryClient`CREATE UNIQUE INDEX IF NOT EXISTS app_users_google_sub_unique ON app_users (google_sub);`;
    await queryClient`
      CREATE TABLE IF NOT EXISTS oauth_transactions (
        state_hash TEXT PRIMARY KEY,
        verifier TEXT NOT NULL,
        issued_at BIGINT NOT NULL
      );
    `;

    await queryClient`
      CREATE TABLE IF NOT EXISTS onboarding_steps (
        id TEXT PRIMARY KEY CHECK (id IN ('tailscale', 'infisical', 'cliproxy', 'builtin')),
        config JSONB NOT NULL,
        revision INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL CHECK (status IN ('configured', 'verified', 'failed')),
        verified_at TIMESTAMPTZ,
        fingerprint TEXT
      );
    `;
    await queryClient`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'onboarding_steps_id_check' AND pg_get_constraintdef(oid) LIKE '%builtin%') THEN
          ALTER TABLE onboarding_steps DROP CONSTRAINT IF EXISTS onboarding_steps_id_check;
          ALTER TABLE onboarding_steps ADD CONSTRAINT onboarding_steps_id_check CHECK (id IN ('tailscale', 'infisical', 'cliproxy', 'builtin'));
        END IF;
      END $$;`;
    await queryClient`ALTER TABLE onboarding_steps ADD COLUMN IF NOT EXISTS verification_id TEXT;`;
    await queryClient`ALTER TABLE onboarding_steps ADD COLUMN IF NOT EXISTS skipped BOOLEAN NOT NULL DEFAULT FALSE;`;
    await queryClient`ALTER TABLE secret_refs ADD COLUMN IF NOT EXISTS vault_url TEXT;`;

    await queryClient`
      CREATE TABLE IF NOT EXISTS external_observations (
        id TEXT PRIMARY KEY,
        resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
        reporter_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        payload_hash TEXT NOT NULL,
        source TEXT NOT NULL,
        observed_at TIMESTAMPTZ NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        facts JSONB NOT NULL,
        UNIQUE (reporter_id, idempotency_key)
      )
    `;
    await queryClient`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        repo_url TEXT,
        owner_identity_id TEXT,
        environment TEXT NOT NULL DEFAULT 'prod',
        criticality TEXT NOT NULL DEFAULT 'normal',
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        archived_at TIMESTAMPTZ
      )
    `;
    await queryClient`ALTER TABLE projects ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'app'`;
    await queryClient`ALTER TABLE projects ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual'`;
    await queryClient`ALTER TABLE projects ADD COLUMN IF NOT EXISTS source_ref TEXT`;
    await queryClient`ALTER TABLE projects ADD COLUMN IF NOT EXISTS kind_manual BOOLEAN NOT NULL DEFAULT false`;
    await queryClient`ALTER TABLE projects ADD COLUMN IF NOT EXISTS kind_auto TEXT`;
    await queryClient`UPDATE projects SET kind_auto = kind WHERE kind_auto IS NULL AND NOT kind_manual`;
    await queryClient`
      CREATE TABLE IF NOT EXISTS project_placements (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        host_name TEXT NOT NULL,
        host_resource_id TEXT REFERENCES resources(id) ON DELETE SET NULL,
        runtime TEXT NOT NULL,
        source TEXT NOT NULL,
        evidence TEXT NOT NULL,
        declared JSONB NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'placed',
        first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (project_id, host_name)
      )
    `;
    await queryClient`ALTER TABLE project_placements ADD COLUMN IF NOT EXISTS scope TEXT`;
    await queryClient`
      CREATE TABLE IF NOT EXISTS connectors (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        label TEXT NOT NULL,
        host_name TEXT NOT NULL,
        config JSONB NOT NULL DEFAULT '{}',
        secret_name TEXT,
        secret_ref_id TEXT,
        created_by TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_scan_at TIMESTAMPTZ,
        last_status TEXT,
        last_summary JSONB
      )
    `;
    await queryClient`ALTER TABLE connectors ADD COLUMN IF NOT EXISTS secret_ref_id TEXT`;
    await queryClient`ALTER TABLE connectors ADD COLUMN IF NOT EXISTS scan_interval_minutes INTEGER`;
    await queryClient`ALTER TABLE connectors ADD COLUMN IF NOT EXISTS scan_requested_at TIMESTAMPTZ`;
    await queryClient`ALTER TABLE connectors ADD COLUMN IF NOT EXISTS scan_lease_until TIMESTAMPTZ`;
    await queryClient`ALTER TABLE connectors ADD COLUMN IF NOT EXISTS rescan_key_hash TEXT`;
    await queryClient`
      CREATE TABLE IF NOT EXISTS project_keys (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        key_hash TEXT NOT NULL UNIQUE,
        key_hint TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMPTZ NOT NULL,
        revoked_at TIMESTAMPTZ,
        last_used_at TIMESTAMPTZ
      )
    `;
    await queryClient`
      CREATE TABLE IF NOT EXISTS project_needs (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        idempotency_key TEXT NOT NULL,
        payload_hash TEXT NOT NULL,
        kind TEXT NOT NULL,
        purpose TEXT NOT NULL,
        spec JSONB NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'recommended',
        recommendation JSONB NOT NULL DEFAULT '{}',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (project_id, idempotency_key)
      )
    `;
    await queryClient`
      CREATE TABLE IF NOT EXISTS project_usage_reports (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        idempotency_key TEXT NOT NULL,
        payload_hash TEXT NOT NULL,
        resource_id TEXT REFERENCES resources(id) ON DELETE SET NULL,
        resource_ref TEXT NOT NULL,
        amount DOUBLE PRECISION,
        unit TEXT,
        period_start TIMESTAMPTZ NOT NULL,
        period_end TIMESTAMPTZ NOT NULL,
        metrics JSONB NOT NULL DEFAULT '{}',
        received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (project_id, idempotency_key)
      )
    `;
    await queryClient`
      CREATE TABLE IF NOT EXISTS host_measurements (
        connector_id TEXT NOT NULL,
        instance TEXT NOT NULL,
        host_key TEXT NOT NULL,
        node_name TEXT,
        cpu_cores DOUBLE PRECISION,
        cpu_busy_cores DOUBLE PRECISION,
        mem_total_mi DOUBLE PRECISION,
        mem_used_mi DOUBLE PRECISION,
        measured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (connector_id, instance)
      )
    `;
    await queryClient`
      CREATE TABLE IF NOT EXISTS host_addresses (
        host_key TEXT NOT NULL,
        address TEXT NOT NULL,
        kind TEXT NOT NULL,
        source TEXT NOT NULL,
        last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (host_key, address)
      )
    `;
    await queryClient`
      CREATE TABLE IF NOT EXISTS project_resource_links (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
        purpose TEXT,
        source TEXT NOT NULL,
        confidence DOUBLE PRECISION,
        status TEXT NOT NULL DEFAULT 'in_use',
        evidence TEXT,
        first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (project_id, resource_id, source)
      )
    `;
    await queryClient`
      CREATE TABLE IF NOT EXISTS project_link_decisions (
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
        decision TEXT NOT NULL,
        decided_by TEXT NOT NULL,
        decided_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (project_id, resource_id)
      )
    `;
    await queryClient`
      CREATE TABLE IF NOT EXISTS agent_keys (
        id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        key_hash TEXT NOT NULL UNIQUE,
        key_hint TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMPTZ NOT NULL,
        revoked_at TIMESTAMPTZ,
        last_used_at TIMESTAMPTZ
      )
    `;
    await queryClient`
      CREATE TABLE IF NOT EXISTS auth_sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        user_email TEXT NOT NULL,
        user_name TEXT NOT NULL,
        provider TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('browser', 'device')),
        scope TEXT NOT NULL CHECK (scope IN ('read', 'operator')),
        label TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_seen_at TIMESTAMPTZ,
        expires_at TIMESTAMPTZ NOT NULL,
        revoked_at TIMESTAMPTZ
      )
    `;
    await queryClient`
      CREATE TABLE IF NOT EXISTS device_pairings (
        id TEXT PRIMARY KEY,
        code_hash TEXT NOT NULL UNIQUE,
        label TEXT NOT NULL,
        scope TEXT NOT NULL CHECK (scope IN ('read', 'operator')),
        created_by_id TEXT NOT NULL,
        created_by_email TEXT NOT NULL,
        created_by_name TEXT NOT NULL,
        provider TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMPTZ NOT NULL,
        consumed_at TIMESTAMPTZ,
        cancelled_at TIMESTAMPTZ
      )
    `;
    await queryClient`ALTER TABLE device_pairings ADD COLUMN IF NOT EXISTS created_by_session TEXT`;
    // 2. Perform Migration & Backfill for any orphan provider_accounts
    await backfillProviderAccountIdentities();

    // 3. Seed initial identities, provider accounts, and resources ONLY if explicitly requested
    if (process.env.FLEETHUB_SEED_DEMO_DATA === "true") {
      try {
        await seedInitialIdentitiesAndAccounts();
      } catch (err: any) {
        console.warn("Demo data was not seeded; the schema is ready:", err.message);
      }
    }
    return { success: true, message: "Database schema and migrations ready" };
  } catch (err: any) {
    console.error("Bootstrap error (DB may be offline during build, graceful fallback active):", err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Backfill existing provider accounts using their current owner_email.
 * Rules:
 * - Persistent ID for identity record (never email or phone)
 * - 1:1 mapping based on distinct owner_email (no fuzzy merging on similar names)
 * - Preserves provider-specific account ID, login email, label, provider, role, protection status, health
 * - Mobile numbers are NEVER invented or inferred
 */
export async function backfillProviderAccountIdentities(): Promise<{ backfilledCount: number }> {
  try {
    const unlinked = await queryClient`
      SELECT id, owner_email, label, kind, is_protected, role
      FROM provider_accounts
      WHERE identity_id IS NULL;
    `;

    if (!unlinked || unlinked.length === 0) {
      return { backfilledCount: 0 };
    }

    let backfilledCount = 0;
    // Map distinct owner emails to identities
    const distinctEmails = Array.from(new Set(unlinked.map((r: any) => r.owner_email.trim().toLowerCase())));

    for (const email of distinctEmails) {
      // Check if identity already exists with this contact email
      const existingContact = await queryClient`
        SELECT identity_id FROM identity_contacts WHERE kind = 'email' AND LOWER(TRIM(value)) = ${email} LIMIT 1;
      `;

      let identityId: string;

      if (existingContact && existingContact.length > 0) {
        identityId = existingContact[0].identity_id;
      } else {
        // Derive clean persistent ID
        identityId = `ident-${createHash("sha256").update(email).digest("hex")}`;

        // Human readable display name from email
        const parts = email.split("@")[0].split(/[._-]/);
        const displayName = parts.map((p: string) => p.charAt(0).toUpperCase() + p.slice(1)).join(" ");

        await queryClient`
          INSERT INTO identities (id, display_name, notes)
          VALUES (${identityId}, ${displayName}, 'Created automatically via owner_email backfill migration')
          ON CONFLICT (id) DO NOTHING;
        `;

        await queryClient`
          INSERT INTO identity_contacts (id, identity_id, kind, value, is_primary, is_verified, label)
          VALUES (${`ct-${identityId}-email-primary`}, ${identityId}, 'email', ${email}, true, true, 'Primary Email')
          ON CONFLICT (id) DO NOTHING;
        `;
      }

      // Link accounts with this owner_email
      await queryClient`
        UPDATE provider_accounts
        SET
          identity_id = ${identityId},
          login_email = COALESCE(login_email, owner_email),
          updated_at = NOW()
        WHERE LOWER(TRIM(owner_email)) = ${email} AND identity_id IS NULL;
      `;

      backfilledCount += unlinked.filter((u: any) => u.owner_email.trim().toLowerCase() === email).length;
    }

    return { backfilledCount };
  } catch (err: any) {
    console.warn("[Identity Backfill] Warning:", err.message);
    return { backfilledCount: 0 };
  }
}

/** Fixed row IDs written by `seedInitialIdentitiesAndAccounts`, so a demo reset never touches real inventory. */
export const demoSeedIds = {
  identities: ["demo-ident-primary-operator", "demo-ident-alex-chen"],
  accounts: ["demo-acc-operator-main", "demo-acc-oracle-secondary", "demo-acc-cloudflare-main", "demo-acc-cloudflare-sandbox", "demo-acc-nvidia-inception", "demo-acc-gcp-prod", "demo-acc-upstash-main", "demo-acc-freellm-main", "demo-acc-oracle-partner", "demo-acc-cf-partner"],
  resources: ["demo-atlas", "demo-borealis", "demo-polar-night-owl", "demo-upstash-box", "demo-github-runner", "demo-r2-artifacts", "demo-cf-ephemeral-worker", "demo-oci-block", "demo-global-redis", "demo-nvidia-nim-llm", "demo-turso-edge", "demo-freellmapi-gateway", "demo-alex-dev-vm"],
  gateways: ["demo-gw-office"],
};
const demoSeedContactIds = [
  "demo-ct-operator-email-1", "demo-ct-operator-email-2", "demo-ct-operator-phone-1", "demo-ct-alex-email-1",
];

/**
 * Rows the demo seed wrote before the `demo-` prefix (until 2026-11-09), with the values that identify them. An older install
 * may still hold them, and names like `atlas` can also be real inventory. A legacy row is removed only while it still matches
 * the seed exactly and nothing real refers to it; anything an operator has touched is left in place.
 */
const legacyDemoSeed = {
  identities: [{ id: "ident-primary-operator", display_name: "Fleet Operator" }, { id: "ident-alex-chen", display_name: "Alex Chen" }],
  contacts: [
    { id: "ct-operator-email-1", value: "operator@fleethub.dev" }, { id: "ct-operator-email-2", value: "operator.backup@fleethub.dev" },
    { id: "ct-operator-phone-1", value: "+1 (555) 010-0198" }, { id: "ct-alex-email-1", value: "alex.chen@example.org" },
  ],
  accounts: [
    { id: "acc-operator-main", kind: "oracle", label: "Oracle Cloud Tenancy 1", owner_email: "operator@fleethub.dev" },
    { id: "acc-oracle-secondary", kind: "oracle", label: "Oracle Cloud Tenancy 2 (Secondary)", owner_email: "operator@fleethub.dev" },
    { id: "acc-cloudflare-main", kind: "cloudflare", label: "Cloudflare Primary DNS", owner_email: "operator@fleethub.dev" },
    { id: "acc-cloudflare-sandbox", kind: "cloudflare", label: "Cloudflare Worker Pool", owner_email: "operator@fleethub.dev" },
    { id: "acc-nvidia-inception", kind: "nvidia", label: "NVIDIA Inception AI Cluster", owner_email: "operator@fleethub.dev" },
    { id: "acc-gcp-prod", kind: "google", label: "Google Cloud Platform (Vertex & GCS)", owner_email: "operator@fleethub.dev" },
    { id: "acc-upstash-main", kind: "upstash", label: "Upstash Edge", owner_email: "operator@fleethub.dev" },
    { id: "acc-freellm-main", kind: "freellmapi", label: "FreeLLM Gateway Router", owner_email: "operator@fleethub.dev" },
    { id: "acc-oracle-partner", kind: "oracle", label: "Oracle Partner Sandbox", owner_email: "alex.chen@example.org" },
    { id: "acc-cf-partner", kind: "cloudflare", label: "Partner Staging CDN", owner_email: "alex.chen@example.org" },
  ],
  resources: [
    {"id": "atlas", "name": "atlas (Docker Brain)", "category": "compute", "provider": "Oracle Cloud", "account_id": "acc-operator-main", "account_email": "operator@fleethub.dev", "state": "online", "is_protected": true, "tags": ["arm64", "docker", "brain", "protected"], "attributes": {"ip": "100.64.0.1", "ocpu": 2, "ram_gb": 12, "free_ram_gb": 6, "services": ["llm-gateway", "metrics-agent"]}, "native_id": null, "region": null, "source_url": null, "inventory_source": "manual", "scan_generation": null, "retired_at": null, "provider_state": null},
    {"id": "borealis", "name": "borealis (K3s Cluster 1)", "category": "compute", "provider": "Oracle Cloud", "account_id": "acc-operator-main", "account_email": "operator@fleethub.dev", "state": "online", "is_protected": true, "tags": ["arm64", "k3s", "protected"], "attributes": {"ip": "100.64.0.2", "ocpu": 2, "ram_gb": 12, "free_ram_gb": 4, "version": "v1.33.0+k3s1"}, "native_id": null, "region": null, "source_url": null, "inventory_source": "manual", "scan_generation": null, "retired_at": null, "provider_state": null},
    {"id": "polar-night-owl", "name": "polar-night-owl (K3s Cluster 2)", "category": "compute", "provider": "Oracle Cloud", "account_id": "acc-oracle-secondary", "account_email": "operator@fleethub.dev", "state": "online", "is_protected": true, "tags": ["arm64", "k3s", "protected"], "attributes": {"ip": "100.64.0.3", "ocpu": 2, "ram_gb": 12, "free_ram_gb": 5, "version": "v1.33.0+k3s1"}, "native_id": null, "region": null, "source_url": null, "inventory_source": "manual", "scan_generation": null, "retired_at": null, "provider_state": null},
    {"id": "upstash-box", "name": "upstash-box-ephemeral", "category": "compute", "provider": "Upstash", "account_id": "acc-upstash-main", "account_email": "operator@fleethub.dev", "state": "idle", "is_protected": false, "tags": ["amd64", "ephemeral", "burst"], "attributes": {"ip": "Serverless", "vcpu": 2, "ram_gb": 4}, "native_id": null, "region": null, "source_url": null, "inventory_source": "manual", "scan_generation": null, "retired_at": null, "provider_state": null},
    {"id": "github-runner", "name": "github-hosted-runners", "category": "compute", "provider": "GitHub", "account_id": "acc-operator-main", "account_email": "operator@fleethub.dev", "state": "online", "is_protected": false, "tags": ["ci-runner", "amd64"], "attributes": {"ip": "Dynamic", "free_minutes_month": 2000}, "native_id": null, "region": null, "source_url": null, "inventory_source": "manual", "scan_generation": null, "retired_at": null, "provider_state": null},
    {"id": "r2-artifacts", "name": "fleet-artifacts", "category": "storage", "provider": "Cloudflare R2", "account_id": "acc-cloudflare-main", "account_email": "operator@fleethub.dev", "state": "online", "is_protected": true, "tags": ["s3", "zero-egress", "crypt", "protected"], "attributes": {"bucket": "fleet-artifacts", "cap_gb": 10, "used_gb": 4.2}, "native_id": null, "region": null, "source_url": null, "inventory_source": "manual", "scan_generation": null, "retired_at": null, "provider_state": null},
    {"id": "cf-ephemeral-worker", "name": "fleet-batch-worker", "category": "serverless", "provider": "Cloudflare", "account_id": "acc-cloudflare-sandbox", "account_email": "operator@fleethub.dev", "state": "online", "is_protected": false, "tags": ["worker", "ephemeral"], "attributes": {"routes": ["batch.fleethub.internal/*"]}, "native_id": null, "region": null, "source_url": null, "inventory_source": "manual", "scan_generation": null, "retired_at": null, "provider_state": null},
    {"id": "oci-block", "name": "oracle-block-volumes", "category": "storage", "provider": "Oracle Cloud", "account_id": "acc-operator-main", "account_email": "operator@fleethub.dev", "state": "online", "is_protected": false, "tags": ["boot-volume", "block"], "attributes": {"total_gb": 200, "used_gb": 147}, "native_id": null, "region": null, "source_url": null, "inventory_source": "manual", "scan_generation": null, "retired_at": null, "provider_state": null},
    {"id": "global-redis", "name": "global-cache-db", "category": "database", "provider": "Upstash", "account_id": "acc-upstash-main", "account_email": "operator@fleethub.dev", "state": "online", "is_protected": false, "tags": ["redis", "fast", "in-memory"], "attributes": {"host": "cache.example.upstash.io", "monthly_cap": 500000, "used": 148900}, "native_id": null, "region": null, "source_url": null, "inventory_source": "manual", "scan_generation": null, "retired_at": null, "provider_state": null},
    {"id": "nvidia-nim-llm", "name": "nvidia-h100-nim", "category": "llm", "provider": "NVIDIA Inception", "account_id": "acc-nvidia-inception", "account_email": "operator@fleethub.dev", "state": "online", "is_protected": true, "tags": ["h100", "nim", "protected", "cuda"], "attributes": {"accelerator": "H100 PCIe", "creditsRemaining": "$2,450.00"}, "native_id": null, "region": null, "source_url": null, "inventory_source": "manual", "scan_generation": null, "retired_at": null, "provider_state": null},
    {"id": "turso-edge", "name": "fleethub-edge-db", "category": "database", "provider": "Turso", "account_id": "acc-operator-main", "account_email": "operator@fleethub.dev", "state": "online", "is_protected": false, "tags": ["sqlite", "edge", "libsql"], "attributes": {"storage_cap_gb": 5, "used_gb": 0.85}, "native_id": null, "region": null, "source_url": null, "inventory_source": "manual", "scan_generation": null, "retired_at": null, "provider_state": null},
    {"id": "freellmapi-gateway", "name": "freellmapi (Brain Router)", "category": "llm", "provider": "FreeLLM API", "account_id": "acc-freellm-main", "account_email": "operator@fleethub.dev", "state": "online", "is_protected": true, "tags": ["router", "tailnet-only", "mcp"], "attributes": {"ip": "127.0.0.1:3001", "port": 3001, "pools": ["Gemini", "Groq", "Cerebras", "OpenRouter"]}, "native_id": null, "region": null, "source_url": null, "inventory_source": "manual", "scan_generation": null, "retired_at": null, "provider_state": null},
    {"id": "alex-dev-vm", "name": "alex-dev-node", "category": "compute", "provider": "Oracle Cloud", "account_id": "acc-oracle-partner", "account_email": "alex.chen@example.org", "state": "idle", "is_protected": false, "tags": ["amd64", "sandbox"], "attributes": {"ip": "10.0.0.84", "ocpu": 1, "ram_gb": 1}, "native_id": null, "region": null, "source_url": null, "inventory_source": "manual", "scan_generation": null, "retired_at": null, "provider_state": null}
  ],
  gateways: [{ id: "gw-office", name: "Office Tailscale exit node", tailscale_ip: "100.64.0.4" }],
};
export const legacyDemoSeedIds = {
  identities: legacyDemoSeed.identities.map(row => row.id),
  accounts: legacyDemoSeed.accounts.map(row => row.id),
  resources: legacyDemoSeed.resources.map(row => row.id),
  gateways: legacyDemoSeed.gateways.map(row => row.id),
};

type Sql = typeof queryClient;
/**
 * Prevents demo cleanup from cascading or detaching non-demo data.
 * Locks seeded parent rows before checking references so concurrent foreign-key inserts cannot race deletion.
 * Throws on a reference, causing the caller's transaction to roll back without deleting demo rows.
 */
async function assertCurrentDemoRowsUnreferenced(sql: Sql): Promise<void> {
  // Project ownership has no FK; serialize ownership/account edits with cleanup.
  await sql`LOCK TABLE projects, provider_accounts IN SHARE ROW EXCLUSIVE MODE`;
  const ids = demoSeedIds;

  // Lock rows that can be deleted so a concurrent foreign-key insert cannot race the reference checks.
  await sql`SELECT id FROM identities WHERE id IN ${sql(ids.identities)} ORDER BY id FOR UPDATE`;
  await sql`SELECT id FROM identity_contacts WHERE id IN ${sql(demoSeedContactIds)} ORDER BY id FOR UPDATE`;
  await sql`SELECT id FROM provider_accounts WHERE id IN ${sql(ids.accounts)} ORDER BY id FOR UPDATE`;
  await sql`SELECT id FROM resources WHERE id IN ${sql(ids.resources)} ORDER BY id FOR UPDATE`;

  const [referencedResource] = await sql`
    SELECT r.id FROM resources r
    WHERE r.id IN ${sql(ids.resources)}
      AND (
        EXISTS (SELECT 1 FROM resource_profiles x WHERE x.resource_id = r.id)
        OR EXISTS (SELECT 1 FROM external_observations x WHERE x.resource_id = r.id)
        OR EXISTS (SELECT 1 FROM project_placements x WHERE x.host_resource_id = r.id)
        OR EXISTS (SELECT 1 FROM project_usage_reports x WHERE x.resource_id = r.id)
        OR EXISTS (SELECT 1 FROM project_resource_links x WHERE x.resource_id = r.id)
        OR EXISTS (SELECT 1 FROM project_link_decisions x WHERE x.resource_id = r.id)
      )
    LIMIT 1`;
  if (referencedResource) throw new Error("Demo resources are referenced by real data");

  const [referencedAccount] = await sql`
    SELECT a.id FROM provider_accounts a
    WHERE a.id IN ${sql(ids.accounts)}
      AND (
        a.secret_ref_id IS NOT NULL
        OR EXISTS (SELECT 1 FROM account_collections x WHERE x.account_id = a.id)
        OR EXISTS (SELECT 1 FROM credential_rotation x WHERE x.account_id = a.id)
        OR EXISTS (SELECT 1 FROM quota_meters x WHERE x.account_id = a.id)
        OR EXISTS (SELECT 1 FROM resources x WHERE x.account_id = a.id AND x.id NOT IN ${sql(ids.resources)})
      )
    LIMIT 1`;
  if (referencedAccount) throw new Error("Demo accounts are referenced by real data");

  const [referencedIdentity] = await sql`
    SELECT i.id FROM identities i
    WHERE i.id IN ${sql(ids.identities)}
      AND (
        EXISTS (SELECT 1 FROM projects p WHERE p.owner_identity_id = i.id)
        OR EXISTS (
          SELECT 1 FROM identity_contacts c
          WHERE c.identity_id = i.id AND c.id NOT IN ${sql(demoSeedContactIds)}
        )
        OR EXISTS (
          SELECT 1 FROM provider_accounts a
          WHERE a.identity_id = i.id AND a.id NOT IN ${sql(ids.accounts)}
        )
      )
    LIMIT 1`;
  if (referencedIdentity) throw new Error("Demo identities are referenced by real data");

  const [referencedContact] = await sql`
    SELECT a.id FROM provider_accounts a
    WHERE a.id NOT IN ${sql(ids.accounts)} AND a.contact_id IN ${sql(demoSeedContactIds)}
    LIMIT 1`;
  if (referencedContact) throw new Error("Demo contacts are referenced by real accounts");
}

async function removeLegacyDemoRows(sql: Sql): Promise<void> {
  await sql`LOCK TABLE projects, provider_accounts IN SHARE ROW EXCLUSIVE MODE`;
  const seed = legacyDemoSeed;
  // Accounts that still match the seed and carry no credentials, collection, rotation or quota data of their own.
  const accounts = (await sql`
    SELECT a.id FROM provider_accounts a
    JOIN jsonb_to_recordset(${JSON.stringify(seed.accounts)}::jsonb) AS s(id TEXT, kind TEXT, label TEXT, owner_email TEXT)
      ON s.id = a.id AND s.kind = a.kind AND s.label = a.label AND s.owner_email = a.owner_email
    WHERE a.secret_ref_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM account_collections c WHERE c.account_id = a.id)
      AND NOT EXISTS (SELECT 1 FROM credential_rotation r WHERE r.account_id = a.id)
      AND NOT EXISTS (SELECT 1 FROM quota_meters q WHERE q.account_id = a.id)`).map(row => String(row.id));
  if (accounts.length > 0) {
    // Resources that still match the seed, on those accounts, with nothing real attached to them.
    await sql`
      DELETE FROM resources r
      USING jsonb_array_elements(${JSON.stringify(seed.resources)}::jsonb) AS s(fingerprint)
      WHERE s.fingerprint->>'id' = r.id AND (to_jsonb(r) - 'last_seen_at') = s.fingerprint AND r.account_id IN ${sql(accounts)}
        AND NOT EXISTS (SELECT 1 FROM resource_profiles x WHERE x.resource_id = r.id)
        AND NOT EXISTS (SELECT 1 FROM external_observations x WHERE x.resource_id = r.id)
        AND NOT EXISTS (SELECT 1 FROM project_placements x WHERE x.host_resource_id = r.id)
        AND NOT EXISTS (SELECT 1 FROM project_usage_reports x WHERE x.resource_id = r.id)
        AND NOT EXISTS (SELECT 1 FROM project_resource_links x WHERE x.resource_id = r.id)
        AND NOT EXISTS (SELECT 1 FROM project_link_decisions x WHERE x.resource_id = r.id)`;
    await sql`DELETE FROM provider_accounts a WHERE a.id IN ${sql(accounts)} AND NOT EXISTS (SELECT 1 FROM resources r WHERE r.account_id = a.id)`;
  }
  await sql`
    DELETE FROM network_gateways g
    USING jsonb_to_recordset(${JSON.stringify(seed.gateways)}::jsonb) AS s(id TEXT, name TEXT, tailscale_ip TEXT)
    WHERE s.id = g.id AND s.name = g.name AND s.tailscale_ip = g.tailscale_ip`;
  // Identities that still match the seed, own no account, and hold only the seed's own contacts, so the cascade cannot take a real one.
  await sql`
    DELETE FROM identities i
    USING jsonb_to_recordset(${JSON.stringify(seed.identities)}::jsonb) AS s(id TEXT, display_name TEXT)
    WHERE s.id = i.id AND s.display_name = i.display_name
      AND NOT EXISTS (SELECT 1 FROM projects p WHERE p.owner_identity_id = i.id)
      AND NOT EXISTS (SELECT 1 FROM identity_contacts c JOIN provider_accounts a ON a.contact_id = c.id WHERE c.identity_id = i.id)
      AND NOT EXISTS (SELECT 1 FROM provider_accounts a WHERE a.identity_id = i.id)
      AND NOT EXISTS (
        SELECT 1 FROM identity_contacts c WHERE c.identity_id = i.id
          AND NOT EXISTS (SELECT 1 FROM jsonb_to_recordset(${JSON.stringify(seed.contacts)}::jsonb) AS d(id TEXT, value TEXT) WHERE d.id = c.id AND d.value = c.value))`;
}

/** Removes the demo rows, current and legacy, in one transaction. Legacy rows real data has touched are kept; throws, deleting nothing, if real data references a current demo row. */
export async function removeDemoSeed(): Promise<void> {
  await queryClient.begin(async transaction => {
    const sql = transaction as unknown as Sql;
    const ids = demoSeedIds;
    await assertCurrentDemoRowsUnreferenced(sql);
    await sql`DELETE FROM resources WHERE id IN ${sql(ids.resources)}`;
    await sql`DELETE FROM network_gateways WHERE id IN ${sql(ids.gateways)}`;
    await sql`DELETE FROM provider_accounts WHERE id IN ${sql(ids.accounts)}`;
    await sql`DELETE FROM identities WHERE id IN ${sql(ids.identities)}`;
    await removeLegacyDemoRows(sql);
  });
}

/**
 * Seed initial identities, verified contacts, and accounts
 */
export async function seedInitialIdentitiesAndAccounts(): Promise<void> {
  // Upgrade an older install: replace legacy unprefixed demo rows instead of seeding duplicates beside them.
  // Rows real data refers to are skipped, not failed on, so an error here is a database fault and seeding stops.
  await queryClient.begin(transaction => removeLegacyDemoRows(transaction as unknown as Sql));
  // Identity 1: Primary Fleet Operator
  const identOperator = "demo-ident-primary-operator";
  await queryClient`
    INSERT INTO identities (id, display_name, notes)
    VALUES
      (${identOperator}, 'Fleet Operator', 'FleetHub Operator & Principal Administrator')
    ON CONFLICT (id) DO NOTHING;
  `;

  // Multiple contacts: 2 emails + 1 mobile
  await queryClient`
    INSERT INTO identity_contacts (id, identity_id, kind, value, is_primary, is_verified, label)
    VALUES
      ('demo-ct-operator-email-1', ${identOperator}, 'email', 'operator@fleethub.dev', true, true, 'Primary Infrastructure'),
      ('demo-ct-operator-email-2', ${identOperator}, 'email', 'operator.backup@fleethub.dev', false, true, 'Secondary / Cloud Alerts'),
      ('demo-ct-operator-phone-1', ${identOperator}, 'phone', '+1 (555) 010-0198', true, true, 'Verified Mobile & Alert SMS')
    ON CONFLICT (id) DO NOTHING;
  `;

  // Identity 2: Alex Chen (Operations Partner - demonstration of unverified contact and NO phone on file)
  const identAlex = "demo-ident-alex-chen";
  await queryClient`
    INSERT INTO identities (id, display_name, notes)
    VALUES
      (${identAlex}, 'Alex Chen', 'External Infra Collaborator (Sandbox Environment)')
    ON CONFLICT (id) DO NOTHING;
  `;

  await queryClient`
    INSERT INTO identity_contacts (id, identity_id, kind, value, is_primary, is_verified, label)
    VALUES
      ('demo-ct-alex-email-1', ${identAlex}, 'email', 'alex.chen@example.org', true, false, 'Partner Org Email (Pending Verification)')
    ON CONFLICT (id) DO NOTHING;
  `;

  // Seed provider accounts with authoritative protection, distinct roles, and multiple accounts under the same provider
  await queryClient`
    INSERT INTO provider_accounts (id, identity_id, kind, label, owner_email, login_email, role, is_protected, health, notes)
    VALUES
      ('demo-acc-operator-main', ${identOperator}, 'oracle', 'Oracle Cloud Tenancy 1', 'operator@fleethub.dev', 'operator@fleethub.dev', 'production_brain', true, 'ok', 'Primary personal OCI tenancy (A1 Always Free) - Strictly Protected'),
      ('demo-acc-oracle-secondary', ${identOperator}, 'oracle', 'Oracle Cloud Tenancy 2 (Secondary)', 'operator@fleethub.dev', 'partner@fleethub.dev', 'cluster_node', true, 'ok', 'Secondary tenancy running K3s Cluster 2 - Protected'),
      ('demo-acc-cloudflare-main', ${identOperator}, 'cloudflare', 'Cloudflare Primary DNS', 'operator@fleethub.dev', 'operator@fleethub.dev', 'dns_control', true, 'ok', 'Production DNS zone & Zero-Egress R2 storage - Protected'),
      ('demo-acc-cloudflare-sandbox', ${identOperator}, 'cloudflare', 'Cloudflare Worker Pool', 'operator@fleethub.dev', 'operator@fleethub.dev', 'worker_ephemeral', false, 'ok', 'Batch & ephemeral serverless worker execution sandbox'),
      ('demo-acc-nvidia-inception', ${identOperator}, 'nvidia', 'NVIDIA Inception AI Cluster', 'operator@fleethub.dev', 'operator@fleethub.dev', 'gpu_inference', true, 'ok', 'Accelerated H100 inference API credits & endpoints - Protected'),
      ('demo-acc-gcp-prod', ${identOperator}, 'google', 'Google Cloud Platform (Vertex & GCS)', 'operator@fleethub.dev', 'operator.backup@fleethub.dev', 'vertex_ai', false, 'ok', 'Vertex AI multimodal reasoning & persistent storage'),
      ('demo-acc-upstash-main', ${identOperator}, 'upstash', 'Upstash Edge', 'operator@fleethub.dev', 'operator@fleethub.dev', 'redis_cache', false, 'ok', '500K Redis cmds & QStash serverless'),
      ('demo-acc-freellm-main', ${identOperator}, 'freellmapi', 'FreeLLM Gateway Router', 'operator@fleethub.dev', 'operator@fleethub.dev', 'gateway_router', true, 'ok', 'LLM gateway with circuit breaker'),
      ('demo-acc-oracle-partner', ${identAlex}, 'oracle', 'Oracle Partner Sandbox', 'alex.chen@example.org', 'alex.chen@example.org', 'dev_sandbox', false, 'ok', 'Dev sandbox tenancy for collaborator experiments'),
      ('demo-acc-cf-partner', ${identAlex}, 'cloudflare', 'Partner Staging CDN', 'alex.chen@example.org', 'alex.chen@example.org', 'staging_proxy', false, 'ok', 'Staging CDN endpoints')
    ON CONFLICT (id) DO UPDATE SET
      identity_id = COALESCE(provider_accounts.identity_id, EXCLUDED.identity_id),
      role = EXCLUDED.role,
      is_protected = EXCLUDED.is_protected,
      login_email = EXCLUDED.login_email,
      label = EXCLUDED.label,
      notes = EXCLUDED.notes;
  `;

  // Seed resources
  await queryClient`
    INSERT INTO resources (id, name, category, provider, account_id, account_email, state, is_protected, tags, attributes)
    VALUES
      ('demo-atlas', 'atlas (Docker Brain)', 'compute', 'Oracle Cloud', 'demo-acc-operator-main', 'operator@fleethub.dev', 'online', true,
       '["arm64", "docker", "brain", "protected"]', '{"ip": "100.64.0.1", "ocpu": 2, "ram_gb": 12, "free_ram_gb": 6, "services": ["llm-gateway", "metrics-agent"]}'),
      ('demo-borealis', 'borealis (K3s Cluster 1)', 'compute', 'Oracle Cloud', 'demo-acc-operator-main', 'operator@fleethub.dev', 'online', true,
       '["arm64", "k3s", "protected"]', '{"ip": "100.64.0.2", "ocpu": 2, "ram_gb": 12, "free_ram_gb": 4, "version": "v1.33.0+k3s1"}'),
      ('demo-polar-night-owl', 'polar-night-owl (K3s Cluster 2)', 'compute', 'Oracle Cloud', 'demo-acc-oracle-secondary', 'operator@fleethub.dev', 'online', true,
       '["arm64", "k3s", "protected"]', '{"ip": "100.64.0.3", "ocpu": 2, "ram_gb": 12, "free_ram_gb": 5, "version": "v1.33.0+k3s1"}'),
      ('demo-upstash-box', 'upstash-box-ephemeral', 'compute', 'Upstash', 'demo-acc-upstash-main', 'operator@fleethub.dev', 'idle', false,
       '["amd64", "ephemeral", "burst"]', '{"ip": "Serverless", "vcpu": 2, "ram_gb": 4}'),
      ('demo-github-runner', 'github-hosted-runners', 'compute', 'GitHub', 'demo-acc-operator-main', 'operator@fleethub.dev', 'online', false,
       '["ci-runner", "amd64"]', '{"ip": "Dynamic", "free_minutes_month": 2000}'),
      ('demo-r2-artifacts', 'fleet-artifacts', 'storage', 'Cloudflare R2', 'demo-acc-cloudflare-main', 'operator@fleethub.dev', 'online', true,
       '["s3", "zero-egress", "crypt", "protected"]', '{"bucket": "fleet-artifacts", "cap_gb": 10, "used_gb": 4.2}'),
      ('demo-cf-ephemeral-worker', 'fleet-batch-worker', 'serverless', 'Cloudflare', 'demo-acc-cloudflare-sandbox', 'operator@fleethub.dev', 'online', false,
       '["worker", "ephemeral"]', '{"routes": ["batch.fleethub.internal/*"]}'),
      ('demo-oci-block', 'oracle-block-volumes', 'storage', 'Oracle Cloud', 'demo-acc-operator-main', 'operator@fleethub.dev', 'online', false,
       '["boot-volume", "block"]', '{"total_gb": 200, "used_gb": 147}'),
      ('demo-global-redis', 'global-cache-db', 'database', 'Upstash', 'demo-acc-upstash-main', 'operator@fleethub.dev', 'online', false,
       '["redis", "fast", "in-memory"]', '{"host": "cache.example.upstash.io", "monthly_cap": 500000, "used": 148900}'),
      ('demo-nvidia-nim-llm', 'nvidia-h100-nim', 'llm', 'NVIDIA Inception', 'demo-acc-nvidia-inception', 'operator@fleethub.dev', 'online', true,
       '["h100", "nim", "protected", "cuda"]', '{"accelerator": "H100 PCIe", "creditsRemaining": "$2,450.00"}'),
      ('demo-turso-edge', 'fleethub-edge-db', 'database', 'Turso', 'demo-acc-operator-main', 'operator@fleethub.dev', 'online', false,
       '["sqlite", "edge", "libsql"]', '{"storage_cap_gb": 5, "used_gb": 0.85}'),
      ('demo-freellmapi-gateway', 'freellmapi (Brain Router)', 'llm', 'FreeLLM API', 'demo-acc-freellm-main', 'operator@fleethub.dev', 'online', true,
       '["router", "tailnet-only", "mcp"]', '{"ip": "127.0.0.1:3001", "port": 3001, "pools": ["Gemini", "Groq", "Cerebras", "OpenRouter"]}'),
      ('demo-alex-dev-vm', 'alex-dev-node', 'compute', 'Oracle Cloud', 'demo-acc-oracle-partner', 'alex.chen@example.org', 'idle', false,
       '["amd64", "sandbox"]', '{"ip": "10.0.0.84", "ocpu": 1, "ram_gb": 1}')
    ON CONFLICT (id) DO NOTHING;
  `;

  // Seed network gateways
  await queryClient`
    INSERT INTO network_gateways (id, name, kind, tailscale_ip, port, state, latency_ms)
    VALUES
      ('demo-gw-office', 'Office Tailscale exit node', 'tailscale_exit_node', '100.64.0.4', 8888, 'online', 8)
    ON CONFLICT (id) DO NOTHING;
  `;
}
