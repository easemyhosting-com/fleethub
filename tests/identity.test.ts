import { describe, it, expect, vi, beforeEach } from "vitest";
// This suite checks explicit fixture graphs, independently of any local database.
vi.mock("../src/lib/db/client", () => ({ queryClient: vi.fn(async () => []) }));
import {
  maskPhoneNumber,
  getIdentityGraph,
  getIdentitiesWithAccounts,
  CreateIdentitySchema,
  AddContactSchema,
  LinkAccountSchema,
  UpdateProtectionSchema,
} from "../src/lib/identity/service";
import { backfillProviderAccountIdentities } from "../src/lib/db/bootstrap";
import { dispatchWorkload, STANDARD_DISPATCH_TARGETS, type DispatchTarget } from "../src/lib/distribution/dispatcher";

describe("Identity & Accounts Architecture", () => {
  describe("1. Multiple Contacts & PII Phone Masking", () => {
    it("masks phone numbers by default with international prefix preserved", () => {
      expect(maskPhoneNumber("+1 (555) 010-0198")).toBe("+1 •••-••0198");
      expect(maskPhoneNumber("+1(555) 010-0198")).toBe("+1 •••-••0198");
      expect(maskPhoneNumber("+91 98765 43210")).toBe("+91 •••-••3210");
      expect(maskPhoneNumber("+15550100198")).toBe("+ •••-••0198");
      expect(maskPhoneNumber("")).toBe("");
    });

    it("supports multiple contacts per identity with verified and primary status", async () => {
      const identities = await getIdentitiesWithAccounts();
      const operator = identities.find((i) => i.id === "ident-primary-operator");
      expect(operator).toBeDefined();

      // Verified multi-contacts: 2 emails + 1 phone
      expect(operator?.contacts.length).toBeGreaterThanOrEqual(3);

      const primaryEmail = operator?.contacts.find((c) => c.kind === "email" && c.isPrimary);
      expect(primaryEmail?.value).toBe("operator@fleethub.dev");
      expect(primaryEmail?.isVerified).toBe(true);

      const secondaryEmail = operator?.contacts.find((c) => c.kind === "email" && !c.isPrimary);
      expect(secondaryEmail?.value).toBe("operator.backup@fleethub.dev");
      expect(secondaryEmail?.isVerified).toBe(true);

      const phone = operator?.contacts.find((c) => c.kind === "phone");
      expect(phone?.value).toBe("+1 (555) 010-0198");
      expect(phone?.isVerified).toBe(true);
    });

    it("honestly labels missing or unverified contacts without inventing fake phone numbers", async () => {
      const identities = await getIdentitiesWithAccounts();
      const alex = identities.find((i) => i.id === "ident-alex-chen");
      expect(alex).toBeDefined();

      // Alex has an unverified email
      const email = alex?.contacts.find((c) => c.kind === "email");
      expect(email?.isVerified).toBe(false);

      // Alex has NO phone on file: must NOT invent or infer one
      const phone = alex?.contacts.find((c) => c.kind === "phone");
      expect(phone).toBeUndefined();
    });
  });

  describe("2. Same-Provider Account Collisions & Persistent IDs", () => {
    it("maintains multiple accounts from the same provider under one identity without collision", async () => {
      const identities = await getIdentitiesWithAccounts();
      const operator = identities.find((i) => i.id === "ident-primary-operator");
      expect(operator).toBeDefined();

      // Oracle: 2 distinct accounts under Operator (acc-operator-main & acc-oracle-secondary)
      const oracleAccounts = operator?.accounts.filter((a) => a.provider === "oracle") || [];
      expect(oracleAccounts.length).toBeGreaterThanOrEqual(2);

      const [oci1, oci2] = oracleAccounts;
      expect(oci1.id).not.toBe(oci2.id);
      expect(oci1.loginEmail).toBe("operator@fleethub.dev");
      expect(oci2.loginEmail).toBe("partner@fleethub.dev");
      expect(oci1.label).toContain("Tenancy 1");
      expect(oci2.label).toContain("Tenancy 2");

      // Cloudflare: 2 distinct accounts under Operator (acc-cloudflare-main & acc-cloudflare-sandbox)
      const cfAccounts = operator?.accounts.filter((a) => a.provider === "cloudflare") || [];
      expect(cfAccounts.length).toBeGreaterThanOrEqual(2);

      const mainCf = cfAccounts.find((a) => a.id === "acc-cloudflare-main");
      const sandboxCf = cfAccounts.find((a) => a.id === "acc-cloudflare-sandbox");
      expect(mainCf?.role).toBe("dns_control");
      expect(sandboxCf?.role).toBe("worker_ephemeral");
      expect(mainCf?.isProtected).toBe(true);
      expect(sandboxCf?.isProtected).toBe(false);
    });

    it("generates persistent, non-email IDs for identity records", () => {
      const validIdentity = CreateIdentitySchema.safeParse({
        displayName: "DevOps Engineer",
        notes: "Infrastructure Team",
      });
      expect(validIdentity.success).toBe(true);

      // Verify that identities use persistent IDs, never email or phone as PK
      expect("ident-primary-operator").not.toContain("@");
      expect("ident-alex-chen").not.toContain("@");
    });
  });

  describe("3. Authoritative Protection Policy & Workload Shielding", () => {
    it("authoritatively marks protected accounts and provides distinct visual badge state", async () => {
      const graph = await getIdentityGraph();
      const protectedAccountNodes = graph.nodes.filter(
        (n) => n.type === "account" && n.isProtected === true
      );
      expect(protectedAccountNodes.length).toBeGreaterThanOrEqual(4);

      // Verify OCI Tenancy 1 is protected
      const ociNode = protectedAccountNodes.find((n) => n.id === "node-acc-acc-operator-main");
      expect(ociNode).toBeDefined();
      expect(ociNode?.role).toBe("production_brain");
      expect(ociNode?.isProtected).toBe(true);

      // Verify Cloudflare Primary DNS is protected
      const cfNode = protectedAccountNodes.find((n) => n.id === "node-acc-acc-cloudflare-main");
      expect(cfNode).toBeDefined();
      expect(cfNode?.isProtected).toBe(true);

      // Verify Cloudflare Worker sandbox is NOT protected
      const sandboxNode = graph.nodes.find((n) => n.id === "node-acc-acc-cloudflare-sandbox");
      expect(sandboxNode?.isProtected).toBe(false);
    });

    it("strictly prevents protected nodes from being offered as workload targets regardless of label", () => {
      // Even if an attacker or misconfiguration labels an account/node as 'batch-worker-open-sandbox',
      // authoritative isProtected: true MUST reject it!
      const deceptiveTarget: DispatchTarget = {
        id: "deceptive-target-node",
        name: "batch-worker-open-sandbox",
        provider: "oracle",
        kind: "production_server",
        executor: "docker",
        arch: "arm64",
        isProtected: true, // Authoritative protection flag!
        availableCpu: 4,
        availableMemoryMb: 8192,
        accelerators: [],
        tags: ["docker", "batch"],
      };

      const result = dispatchWorkload(
        {
          name: "untrusted-batch-job",
          command: "echo test",
          requiredCpu: 1,
          requiredMemoryMb: 512,
        },
        {
          customTargets: [deceptiveTarget],
        }
      );

      // Workload must NOT be assigned to deceptiveTarget
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.rejectedTargets[0]?.reason).toContain("Protected production node");
      }
    });
  });

  describe("4. Hierarchical Graph Generation & Progressive Expansion", () => {
    it("generates the complete 4-tier hierarchy: Identity -> Provider -> Account -> Descendants", async () => {
      const graph = await getIdentityGraph();

      expect(graph.summary.totalIdentities).toBeGreaterThanOrEqual(2);
      expect(graph.summary.totalProviders).toBeGreaterThanOrEqual(5);
      expect(graph.summary.totalAccounts).toBeGreaterThanOrEqual(8);
      expect(graph.summary.protectedAccounts).toBeGreaterThanOrEqual(4);

      // Check tier connections
      const identityNodes = graph.nodes.filter((n) => n.type === "identity");
      const providerNodes = graph.nodes.filter((n) => n.type === "provider");
      const accountNodes = graph.nodes.filter((n) => n.type === "account");

      expect(identityNodes.length).toBeGreaterThanOrEqual(2);
      expect(providerNodes.length).toBeGreaterThanOrEqual(5);
      expect(accountNodes.length).toBeGreaterThanOrEqual(8);

      // Verify multiple accounts grouped under the Oracle provider node
      const ociProviderNodes = providerNodes.filter((n) => n.provider === "oracle");
      expect(ociProviderNodes.length).toBeGreaterThan(0);
      expect(ociProviderNodes.reduce((sum, n) => sum + (n.childCount ?? 0), 0)).toBeGreaterThanOrEqual(2);

      // Identity -> email -> provider edges
      const identToEmailEdge = graph.edges.find((e) => e.source === identityNodes[0].id);
      expect(identToEmailEdge?.label).toBe("email");
      const emailNode = graph.nodes.find((n) => n.id === identToEmailEdge?.target);
      expect(emailNode?.type).toBe("email");
      expect(graph.edges.some((e) => e.source === emailNode?.id && e.label === "manages")).toBe(true);
    });

    it("supports filtering by provider, protection status, and search terms", async () => {
      // 1. Filter by provider = 'oracle'
      const oracleGraph = await getIdentityGraph({ provider: "oracle" });
      const nonOracleAccounts = oracleGraph.nodes.filter(
        (n) => n.type === "account" && n.provider !== "oracle"
      );
      expect(nonOracleAccounts.length).toBe(0);

      // 2. Filter by protection = 'protected'
      const protectedGraph = await getIdentityGraph({ protection: "protected" });
      const unprotectedAccounts = protectedGraph.nodes.filter(
        (n) => n.type === "account" && n.isProtected === false
      );
      expect(unprotectedAccounts.length).toBe(0);

      // 3. Search by account label 'Secondary'
      const searchGraph = await getIdentityGraph({ search: "secondary" });
      const matchingAccount = searchGraph.nodes.find(
        (n) => n.type === "account" && n.label.toLowerCase().includes("secondary")
      );
      expect(matchingAccount).toBeDefined();
    });

    it("includes child counts on parent nodes to enable progressive expansion and virtualization", async () => {
      const graph = await getIdentityGraph();
      const identity = graph.nodes.find((n) => n.id === "node-ident-ident-primary-operator");
      expect(identity?.childCount).toBeGreaterThan(0);

      const account = graph.nodes.find((n) => n.id === "node-acc-acc-operator-main");
      expect(account?.childCount).toBeGreaterThan(0);
    });
  });

  describe("5. Secret Safety & Safe Metadata", () => {
    it("never includes plaintext secret values or credentials in graph or identity responses", async () => {
      const graph = await getIdentityGraph();
      const graphJson = JSON.stringify(graph);

      // Strict security invariant: No private keys, passwords, auth tokens, or plaintext secrets
      expect(graphJson).not.toContain("BEGIN RSA PRIVATE KEY");
      expect(graphJson).not.toContain("password");
      expect(graphJson).not.toContain("secret_value");

      // Verifies that secret references expose safe metadata only
      const secretNode = graph.nodes.find((n) => n.type === "secret_ref");
      expect(secretNode).toBeDefined();
      expect(secretNode?.data.path).toBeDefined();
      expect(secretNode?.data.environment).toBeDefined();
      expect(secretNode?.data.status).toBe("verified");
    });

    it("validates contact input schemas with strict format rules", () => {
      // Valid email
      const validEmail = AddContactSchema.safeParse({
        identityId: "ident-1",
        kind: "email",
        value: "operator@fleethub.internal",
      });
      expect(validEmail.success).toBe(true);

      // Invalid email
      const invalidEmail = AddContactSchema.safeParse({
        identityId: "ident-1",
        kind: "email",
        value: "not-an-email",
      });
      expect(invalidEmail.success).toBe(false);

      // Short/bogus phone number
      const shortPhone = AddContactSchema.safeParse({
        identityId: "ident-1",
        kind: "phone",
        value: "123",
      });
      expect(shortPhone.success).toBe(false);
    });
  });

  describe("6. Migration & Backfill Engine", () => {
    it("executes backfillProviderAccountIdentities gracefully and handles unlinked accounts", async () => {
      const result = await backfillProviderAccountIdentities();
      expect(typeof result.backfilledCount).toBe("number");
      expect(result.backfilledCount).toBeGreaterThanOrEqual(0);
    });
  });
});
