/**
 * Smart Workload Distribution Engine (FleetDeck)
 * 
 * Classifies incoming workloads (Heavy CI/Playwright, GPU/ML burst, Light cron/sync)
 * and routes workloads AWAY from protected production servers
 * to GitHub Actions runners, local ephemeral runners, or serverless boxes
 * based on verified quota clocks, architecture compatibility, and resource headroom.
 * 
 * Invariants:
 * 1. Protected nodes (isProtected: true) are NEVER eligible for automated workload dispatch.
 * 2. Unsafe raw shell string interpolation is replaced with a typed, structured ExecutionPlan.
 * 3. Quota calculations guard strictly against NaN, negative, or invalid values.
 */

import { z } from "zod";
import { MASTER_CATALOG } from "@/lib/catalog/providers";
import { evaluateQuota, type QuotaCalculation } from "@/lib/quota/engine";

export type WorkloadCategory = "heavy_ci" | "gpu_ml" | "light_cron" | "general_batch";

/**
 * Strict runtime schema for incoming workload specifications.
 */
export const WorkloadSpecSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1, "Workload name is required").max(128),
  description: z.string().max(1024).optional(),
  category: z.enum(["heavy_ci", "gpu_ml", "light_cron", "general_batch"]).optional(),
  command: z
    .string()
    .max(2048)
    .refine((val) => !/[\r\n]/.test(val), { message: "Command cannot contain newline characters" })
    .optional(),
  image: z
    .string()
    .max(512)
    .regex(/^[a-zA-Z0-9_.-]+(\/[a-zA-Z0-9_.-]+)*(:[a-zA-Z0-9_.-]+)?$/, {
      message: "Image must be a valid container image format (e.g. node:22-alpine)",
    })
    .optional(),
  requiredCpu: z.number().positive().finite().max(64).optional(),
  requiredMemoryMb: z.number().positive().finite().max(262144).optional(),
  maxRuntimeSeconds: z.number().positive().finite().max(86400).optional(),
  requiresGpu: z.boolean().optional(),
  requiredAccelerator: z.enum(["cuda", "mps", "any"]).optional(),
  maxCpuMs: z.number().positive().finite().max(300000).optional(),
  preferredArch: z.enum(["amd64", "arm64", "any"]).optional(),
  isPublicRepo: z.boolean().optional(),
  tags: z.array(z.string().max(64)).max(20).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type WorkloadSpec = z.infer<typeof WorkloadSpecSchema>;

export interface WorkloadClassification {
  category: WorkloadCategory;
  confidence: "high" | "medium" | "low";
  score: number; // 0 to 1
  signals: string[];
  recommendedLimits: {
    cpu: number;
    memoryMb: number;
    maxRuntimeSeconds: number;
    requiresGpu: boolean;
    accelerator: AcceleratorRequirement;
    preferredArch: "amd64" | "arm64" | "any";
  };
}

export type Accelerator = "cuda" | "mps";
export type AcceleratorRequirement = Accelerator | "any";

export type ExecutorKind =
  | "github_dispatch"
  | "local_process"
  | "modal"
  | "docker"
  | "serverless_http"
  | "process"
  | "k3s_job";

export interface DispatchTarget {
  id: string;
  name: string;
  kind:
    | "ci_runner"
    | "workstation"
    | "serverless_gpu"
    | "serverless_container"
    | "serverless_edge"
    | "ephemeral_notebook"
    | "production_server";
  provider: "github" | "local" | "modal" | "upstash" | "cloudflare" | "google" | "oracle";
  executor: ExecutorKind;
  arch: "amd64" | "arm64" | "any";
  accelerators: Accelerator[];
  isProtected: boolean;
  availableCpu: number;
  availableMemoryMb: number;
  quotaMeterId?: string;
  defaultCostPerRun?: number;
  tags: string[];
  notes?: string;
}

export interface DispatchEvaluation {
  target: DispatchTarget;
  eligible: boolean;
  score: number; // 0 to 100
  rejectionReason?: string;
  quotaAssessment?: {
    meterId: string;
    used: number;
    limit: number;
    status: QuotaCalculation["status"];
    remaining: number;
    percentUsed: number;
    resetCountdown: string;
    isUnmetered?: boolean;
    isValid?: boolean;
  };
}

/**
 * Structured execution payload replacing raw shell string interpolation.
 * Downstream executors consume typed arguments without shell injection vulnerabilities.
 */
export interface ExecutionPlan {
  type: "github_dispatch" | "modal_runner" | "serverless_http" | "container" | "local_process";
  targetId: string;
  executor: ExecutorKind;
  payload: {
    workflow?: string;
    inputs?: Record<string, string>;
    image?: string;
    /** Executable for container/local plans. With `args` this is an argv: executors must spawn it without a shell. */
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    limits?: { cpu: number; memoryMb: number; timeoutSeconds: number };
    endpoint?: string;
  };
  displayPreview: string; // Formatted preview for UI display only (sanitized via shellEscape)
}

export interface DispatchDecision {
  success: true;
  workload: WorkloadSpec;
  classification: WorkloadClassification;
  selectedTarget: DispatchTarget;
  routingStrategy:
    | "OFFLOAD_TO_GITHUB_ACTIONS"
    | "LOCAL_WORKSTATION_OFFLOAD"
    | "BURST_TO_SERVERLESS_GPU"
    | "UPSTASH_EPHEMERAL_CONTAINER"
    | "EDGE_SERVERLESS_EXECUTION"
    | "EPHEMERAL_NOTEBOOK_DISPATCH"
    | "STANDBY_NODE_DISPATCH";
  confidence: "high" | "medium" | "low";
  reason: string;
  executionPlan: ExecutionPlan;
  evaluations: DispatchEvaluation[];
  rejectedTargets: Array<{ targetId: string; targetName: string; reason: string }>;
  timestamp: string;
}

export interface DispatchRejection {
  success: false;
  workload: WorkloadSpec;
  classification: WorkloadClassification;
  reason: string;
  evaluations: DispatchEvaluation[];
  rejectedTargets: Array<{ targetId: string; targetName: string; reason: string }>;
  timestamp: string;
}

export type DispatchResult = DispatchDecision | DispatchRejection;

/** Cloudflare Workers Free plan CPU time per invocation (developers.cloudflare.com/workers/platform/limits). */
export const CF_WORKERS_FREE_CPU_MS = 10;

/**
 * Escapes an argument for safe display in shell preview strings.
 */
export function shellEscape(arg: string): string {
  if (!arg) return "''";
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

/**
 * Standard fleet targets across cloud providers, local workstation, and production hosts.
 */
export const STANDARD_DISPATCH_TARGETS: DispatchTarget[] = [
  {
    id: "github-actions-hosted",
    name: "GitHub Actions Hosted Runners",
    kind: "ci_runner",
    provider: "github",
    executor: "github_dispatch",
    arch: "amd64",
    accelerators: [],
    isProtected: false,
    availableCpu: 4.0,
    availableMemoryMb: 16384,
    quotaMeterId: "github.actions.minutes",
    tags: ["ci", "runner", "amd64", "ephemeral", "unmetered-public"],
    notes: "Free & unmetered on public repos; 2,000 monthly Linux minutes on private repos.",
  },
  {
    id: "local-mac-mini",
    name: "Local Mac Mini (Apple Silicon M-Series)",
    kind: "workstation",
    provider: "local",
    executor: "local_process",
    arch: "arm64",
    accelerators: ["mps"], // Apple Silicon Metal/MPS; cannot run CUDA
    isProtected: false,
    availableCpu: 8.0,
    availableMemoryMb: 24576,
    tags: ["local", "darwin", "arm64", "apple-silicon", "mps", "metal", "zero-cost"],
    notes: "Local workstation with fast M-series cores, MPS GPU acceleration, zero cloud quota egress.",
  },
  {
    id: "modal-serverless-gpu",
    name: "Modal Serverless GPU Runner",
    kind: "serverless_gpu",
    provider: "modal",
    executor: "modal",
    arch: "amd64",
    accelerators: ["cuda"],
    isProtected: false,
    availableCpu: 8.0,
    availableMemoryMb: 32768,
    quotaMeterId: "modal.credits.usd",
    tags: ["gpu", "serverless", "cuda", "amd64", "scale-to-zero"],
    notes: "$30/month free developer credits for GPU and container bursts.",
  },
  {
    id: "upstash-ephemeral-box",
    name: "Upstash Ephemeral Task Runner",
    kind: "serverless_container",
    provider: "upstash",
    executor: "docker",
    arch: "amd64",
    accelerators: [],
    isProtected: false,
    availableCpu: 2.0,
    availableMemoryMb: 4096,
    quotaMeterId: "upstash.box.hours",
    tags: ["container", "ephemeral", "amd64", "serverless"],
    notes: "5 CPU-hours/month, 2 vCPU / 4 GB per container, idle timeout isolation.",
  },
  {
    id: "cf-primary-dns",
    name: "Cloudflare Production DNS (fleethub.dev)",
    kind: "serverless_edge",
    provider: "cloudflare",
    executor: "serverless_http",
    arch: "any",
    accelerators: [],
    isProtected: true, // Primary DNS is strictly protected from arbitrary workload placement!
    availableCpu: 1.0,
    availableMemoryMb: 128,
    tags: ["dns", "protected", "production-gateway"],
    notes: "Production DNS and core site ingress. Automated workload execution strictly forbidden.",
  },
  {
    id: "cf-workers-edge",
    name: "Cloudflare Workers (staging account)",
    kind: "serverless_edge",
    provider: "cloudflare",
    executor: "serverless_http",
    arch: "any",
    accelerators: [],
    isProtected: false, // Dedicated worker sandbox: eligible for placement
    availableCpu: 1.0,
    availableMemoryMb: 128,
    quotaMeterId: "cf.workers.requests",
    tags: ["edge", "worker", "ephemeral-sandbox", "zero-cold-start"],
    notes: "100,000 free requests/day; Free plan allows 10 ms of CPU per invocation. Dedicated sandbox account.",
  },
  {
    id: "cf-worker-sandbox-2",
    name: "Cloudflare Workers (client project account)",
    kind: "serverless_edge",
    provider: "cloudflare",
    executor: "serverless_http",
    arch: "any",
    accelerators: [],
    isProtected: false,
    availableCpu: 1.0,
    availableMemoryMb: 128,
    quotaMeterId: "cf.workers.requests",
    tags: ["edge", "worker", "ephemeral-sandbox", "secondary"],
    notes: "Secondary sandbox for isolated cron/sync bursts.",
  },
  {
    id: "colab-ephemeral-notebook",
    name: "Google Colab / Kaggle Ephemeral Worker",
    kind: "ephemeral_notebook",
    provider: "google",
    executor: "process",
    arch: "amd64",
    accelerators: ["cuda"],
    isProtected: false,
    availableCpu: 2.0,
    availableMemoryMb: 12288,
    tags: ["notebook", "ephemeral", "t4-gpu", "cost:free"],
    notes: "Ephemeral notebook worker running fleet_agent.py on Colab or Kaggle with T4 GPU.",
  },
  // Protected Production Oracle Instances (strictly guarded invariant)
  {
    id: "oci-atlas",
    name: "Atlas (Oracle Ampere A1 - Docker Brain)",
    kind: "production_server",
    provider: "oracle",
    executor: "docker",
    arch: "arm64",
    accelerators: [],
    isProtected: true,
    availableCpu: 2.0,
    availableMemoryMb: 12288,
    quotaMeterId: "oci.a1.ocpu_hours",
    tags: ["arm64", "2-ocpu", "12gb", "protected", "brain", "tailnet-only"],
    notes: "Protected host running AI Gateway router, Infisical Agent Vault, and metadata DB.",
  },
  {
    id: "oci-borealis",
    name: "Borealis (Oracle Ampere A1 - K3s Cluster 1)",
    kind: "production_server",
    provider: "oracle",
    executor: "k3s_job",
    arch: "arm64",
    accelerators: [],
    isProtected: true,
    availableCpu: 2.0,
    availableMemoryMb: 12288,
    quotaMeterId: "oci.a1.ocpu_hours",
    tags: ["arm64", "k3s", "protected", "ingress-controller"],
    notes: "Protected production K3s cluster running core web services and ingress controller.",
  },
  {
    id: "oci-polar-night-owl",
    name: "Polar Night Owl (Oracle Ampere A1 - K3s Cluster 2)",
    kind: "production_server",
    provider: "oracle",
    executor: "k3s_job",
    arch: "arm64",
    accelerators: [],
    isProtected: true,
    availableCpu: 2.0,
    availableMemoryMb: 12288,
    quotaMeterId: "oci.a1.ocpu_hours",
    tags: ["arm64", "k3s", "protected", "egress-gateway"],
    notes: "Protected production K3s cluster running production workloads and egress gateway.",
  },
  {
    id: "oci-polar-ember",
    name: "Polar Ember (Oracle AMD E2.1.Micro)",
    kind: "production_server",
    provider: "oracle",
    executor: "process",
    arch: "amd64",
    accelerators: [],
    isProtected: false,
    availableCpu: 1.0, // 1/8 OCPU shared
    availableMemoryMb: 1024,
    tags: ["amd64", "micro", "standby", "low-spec"],
    notes: "1/8 OCPU burstable micro shape with 1GB RAM. Unsuitable for heavy CI builds.",
  },
];

/**
 * Analyzes workload specification and infers workload class, confidence, signals, and resource bounds.
 */
export function classifyWorkload(rawSpec: Partial<WorkloadSpec>): WorkloadClassification {
  const spec = {
    name: rawSpec.name || "unnamed-workload",
    description: rawSpec.description,
    category: rawSpec.category,
    command: rawSpec.command,
    image: rawSpec.image,
    requiredCpu: rawSpec.requiredCpu,
    requiredMemoryMb: rawSpec.requiredMemoryMb,
    maxRuntimeSeconds: rawSpec.maxRuntimeSeconds,
    requiresGpu: rawSpec.requiresGpu,
    preferredArch: rawSpec.preferredArch,
    tags: rawSpec.tags,
  };

  const textToScan = [
    spec.name,
    spec.description || "",
    spec.command || "",
    spec.image || "",
    ...(spec.tags || []),
  ].join(" ").toLowerCase();
  const accelerator = rawSpec.requiredAccelerator ?? inferAccelerator(textToScan);

  if (spec.category) {
    const limits = getDefaultLimitsForCategory(spec.category);
    return {
      category: spec.category,
      confidence: "high",
      score: 1.0,
      signals: [`Explicit category '${spec.category}' provided in workload specification`],
      recommendedLimits: {
        cpu: spec.requiredCpu ?? limits.cpu,
        memoryMb: spec.requiredMemoryMb ?? limits.memoryMb,
        maxRuntimeSeconds: spec.maxRuntimeSeconds ?? limits.maxRuntimeSeconds,
        requiresGpu: spec.requiresGpu ?? limits.requiresGpu,
        accelerator,
        preferredArch: spec.preferredArch ?? limits.preferredArch,
      },
    };
  }

  const signals: string[] = [];

  // Check GPU/ML signals
  const gpuKeywords = [
    "gpu",
    "cuda",
    "pytorch",
    "torch",
    "tensorflow",
    "vllm",
    "ollama",
    "whisper",
    "lora",
    "fine-tune",
    "finetune",
    "embedding",
    "huggingface",
    "diffusers",
    "deepseek",
    "mps",
    "metal",
    "sdxl",
  ];
  const matchedGpu = gpuKeywords.filter((k) => textToScan.includes(k));
  if (spec.requiresGpu) {
    signals.push("Flag 'requiresGpu: true' explicitly set");
  }
  if (matchedGpu.length > 0) {
    signals.push(`Matched GPU/ML keywords: ${matchedGpu.join(", ")}`);
  }
  if (accelerator !== "any") {
    signals.push(`Requires ${accelerator.toUpperCase()} acceleration`);
  }

  // Check Heavy CI signals
  const ciKeywords = [
    "playwright",
    "test",
    "e2e",
    "cypress",
    "vitest",
    "jest",
    "compile",
    "bundle",
    "webpack",
    "rollup",
    "build",
    "matrix",
    "ci-runner",
    "pytest",
    "cargo test",
    "mvn test",
    "gradle test",
    "regression",
    "docker build",
    "browser",
    "testcase",
  ];
  const matchedCi = ciKeywords.filter((k) => textToScan.includes(k));
  if (matchedCi.length > 0) {
    signals.push(`Matched CI/Test keywords: ${matchedCi.join(", ")}`);
  }
  if ((spec.requiredCpu && spec.requiredCpu >= 2.0) || (spec.requiredMemoryMb && spec.requiredMemoryMb >= 4096)) {
    signals.push("High CPU (>= 2.0) or Memory (>= 4096MB) requested");
  }

  // Check Light Cron / Sync signals
  const cronKeywords = [
    "cron",
    "sync",
    "health",
    "ping",
    "heartbeat",
    "scrape",
    "poll",
    "webhook",
    "cleanup",
    "rclone",
    "metric",
    "monitor",
    "backup",
    "vacuum",
    "telemetry",
    "status",
  ];
  const matchedCron = cronKeywords.filter((k) => textToScan.includes(k));
  if (matchedCron.length > 0) {
    signals.push(`Matched Cron/Sync keywords: ${matchedCron.join(", ")}`);
  }
  if (spec.maxRuntimeSeconds && spec.maxRuntimeSeconds <= 60) {
    signals.push("Short maxRuntimeSeconds (<= 60s) typical of cron/sync tasks");
  }

  // Calculate scores
  let gpuScore = 0;
  if (spec.requiresGpu) gpuScore += 0.9;
  gpuScore += Math.min(0.8, matchedGpu.length * 0.3);

  let ciScore = 0;
  ciScore += Math.min(0.8, matchedCi.length * 0.25);
  if ((spec.requiredCpu && spec.requiredCpu >= 2.0) || (spec.requiredMemoryMb && spec.requiredMemoryMb >= 4096)) {
    ciScore += 0.3;
  }
  if (spec.maxRuntimeSeconds && spec.maxRuntimeSeconds >= 300) {
    ciScore += 0.2;
  }

  let cronScore = 0;
  cronScore += Math.min(0.8, matchedCron.length * 0.3);
  if (spec.maxRuntimeSeconds && spec.maxRuntimeSeconds <= 60) {
    cronScore += 0.3;
  }
  if (spec.requiredCpu && spec.requiredCpu <= 0.5) {
    cronScore += 0.2;
  }

  // Classification decision
  let detectedCategory: WorkloadCategory = "general_batch";
  let confidence: "high" | "medium" | "low" = "low";
  let maxScore = 0.4;

  if (gpuScore > maxScore && gpuScore > ciScore && gpuScore > cronScore) {
    detectedCategory = "gpu_ml";
    maxScore = gpuScore;
    confidence = gpuScore >= 0.7 ? "high" : "medium";
  } else if (ciScore > maxScore && ciScore > cronScore) {
    detectedCategory = "heavy_ci";
    maxScore = ciScore;
    confidence = ciScore >= 0.6 ? "high" : "medium";
  } else if (cronScore > maxScore) {
    detectedCategory = "light_cron";
    maxScore = cronScore;
    confidence = cronScore >= 0.6 ? "high" : "medium";
  } else {
    detectedCategory = "general_batch";
    confidence = "low";
    signals.push("No dominant domain keywords; defaulting to general batch execution");
  }

  const limits = getDefaultLimitsForCategory(detectedCategory);

  return {
    category: detectedCategory,
    confidence,
    score: Math.min(1.0, Math.round(maxScore * 100) / 100),
    signals: signals.length > 0 ? signals : ["Standard default classification"],
    recommendedLimits: {
      cpu: spec.requiredCpu ?? limits.cpu,
      memoryMb: spec.requiredMemoryMb ?? limits.memoryMb,
      maxRuntimeSeconds: spec.maxRuntimeSeconds ?? limits.maxRuntimeSeconds,
      requiresGpu: spec.requiresGpu ?? limits.requiresGpu,
      accelerator,
      preferredArch: spec.preferredArch ?? limits.preferredArch,
    },
  };
}

const CUDA_ONLY_KEYWORDS = ["cuda", "nvidia", "vllm", "bitsandbytes", "flash-attn", "flash_attn", "tensorrt", "xformers", "nccl"];
const MPS_ONLY_KEYWORDS = ["mps", "metal", "mlx", "coreml"];

/**
 * Infers which GPU stack a workload needs. CUDA-only libraries cannot run on Apple Silicon,
 * so a CUDA signal wins over an MPS signal.
 */
export function inferAccelerator(text: string): AcceleratorRequirement {
  const words = new Set(text.toLowerCase().split(/[^a-z0-9_-]+/));
  if (CUDA_ONLY_KEYWORDS.some((keyword) => words.has(keyword))) return "cuda";
  if (MPS_ONLY_KEYWORDS.some((keyword) => words.has(keyword))) return "mps";
  return "any";
}

/** Runs an operator-supplied command through a shell as one opaque argument; nothing else is interpolated. */
function shellCommandArgv(command: string): { command: string; args: string[] } {
  return { command: "/bin/sh", args: ["-c", command] };
}

function getDefaultLimitsForCategory(category: WorkloadCategory) {
  switch (category) {
    case "heavy_ci":
      return { cpu: 4.0, memoryMb: 8192, maxRuntimeSeconds: 1800, requiresGpu: false, preferredArch: "amd64" as const };
    case "gpu_ml":
      return { cpu: 2.0, memoryMb: 8192, maxRuntimeSeconds: 3600, requiresGpu: true, preferredArch: "any" as const };
    case "light_cron":
      return { cpu: 0.5, memoryMb: 128, maxRuntimeSeconds: 60, requiresGpu: false, preferredArch: "any" as const };
    case "general_batch":
    default:
      return { cpu: 2.0, memoryMb: 2048, maxRuntimeSeconds: 600, requiresGpu: false, preferredArch: "any" as const };
  }
}

/**
 * Returns all configured dispatch targets with optional filter.
 */
export function getDispatchTargets(options?: { includeProtected?: boolean }): DispatchTarget[] {
  if (options?.includeProtected === false) {
    return STANDARD_DISPATCH_TARGETS.filter((t) => !t.isProtected);
  }
  return STANDARD_DISPATCH_TARGETS;
}

/**
 * Main dispatcher entrypoint:
 * - Validates input with Zod schema.
 * - Strictly enforces Protected Production Node Shield (no request override).
 * - Evaluates quota clocks and capacity headroom.
 * - Produces a typed ExecutionPlan (no raw unescaped string execution).
 * - Returns structured DispatchResult (success: true/false) without uncaught exceptions.
 */
export function dispatchWorkload(
  rawSpec: unknown,
  options?: {
    /** Observed usage per quota meter id. A meter with no reading is unknown, and its target is ineligible. */
    quotaReadings?: Record<string, number>;
    customTargets?: DispatchTarget[];
    now?: Date;
  }
): DispatchResult {
  const parsed = WorkloadSpecSchema.safeParse(rawSpec);
  if (!parsed.success) {
    const errorMsg = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    return {
      success: false,
      workload: (rawSpec as WorkloadSpec) || { name: "invalid-spec" },
      classification: {
        category: "general_batch",
        confidence: "low",
        score: 0,
        signals: ["Schema validation failed"],
        recommendedLimits: { ...getDefaultLimitsForCategory("general_batch"), accelerator: "any" },
      },
      reason: `Invalid workload specification: ${errorMsg}`,
      evaluations: [],
      rejectedTargets: [],
      timestamp: (options?.now || new Date()).toISOString(),
    };
  }

  const spec = parsed.data;
  const now = options?.now || new Date();
  const quotaValues = options?.quotaReadings ?? {};
  const targets = options?.customTargets || STANDARD_DISPATCH_TARGETS;

  // 1. Classify workload
  const classification = classifyWorkload(spec);
  const effectiveCategory = classification.category;
  const effectiveRequiresGpu = spec.requiredAccelerator !== undefined || (spec.requiresGpu ?? classification.recommendedLimits.requiresGpu);
  const effectiveAccelerator = classification.recommendedLimits.accelerator;
  const effectiveRequiredCpu = spec.requiredCpu ?? classification.recommendedLimits.cpu;
  const effectiveRequiredMem = spec.requiredMemoryMb ?? classification.recommendedLimits.memoryMb;
  const effectiveArch = spec.preferredArch ?? classification.recommendedLimits.preferredArch;
  const effectiveRuntime = spec.maxRuntimeSeconds ?? classification.recommendedLimits.maxRuntimeSeconds;

  // 2. Evaluate each target
  const evaluations: DispatchEvaluation[] = [];

  for (const target of targets) {
    let eligible = true;
    let rejectionReason: string | undefined;
    let score = 50;

    // Rule 1: Protected Production Node Shield Invariant (Guardrail G3)
    // Protected production servers are NEVER eligible.
    // No request argument or override can bypass this.
    const trustedTarget = STANDARD_DISPATCH_TARGETS.find((entry) => entry.id === target.id);
    if (!trustedTarget || trustedTarget.isProtected || target.isProtected || target.tags.some((tag) => ["protected", "dns", "production-gateway"].includes(tag))) {
      eligible = false;
      rejectionReason = "Protected production node: reserved strictly for core control plane & zero-downtime services (Guardrail G3)";
    }

    // Rule 2: Low-spec Micro Shape Guardrail
    if (eligible && (target.provider === "oracle" || trustedTarget?.provider === "oracle")) {
      eligible = false;
      rejectionReason = "OCI is inventory-only; task placement requires a new explicit operator authorization";
    }

    // Rule 3: GPU requirement
    if (eligible && effectiveRequiresGpu) {
      if (target.accelerators.length === 0) {
        eligible = false;
        rejectionReason = "Workload requires GPU acceleration; target lacks GPU / CUDA / Metal hardware";
      } else if (effectiveAccelerator !== "any" && !target.accelerators.includes(effectiveAccelerator)) {
        eligible = false;
        rejectionReason = `Workload requires ${effectiveAccelerator.toUpperCase()}; target only offers ${target.accelerators.map((a) => a.toUpperCase()).join(", ")}`;
      }
    }

    // Rule 4: Cloudflare Workers Free allows 10 ms of CPU per invocation.
    // Only workloads that declare a CPU budget within that limit may target it.
    if (eligible && (target.provider === "cloudflare" || trustedTarget?.provider === "cloudflare") && !(spec.maxCpuMs !== undefined && spec.maxCpuMs <= CF_WORKERS_FREE_CPU_MS)) {
      eligible = false;
      rejectionReason = spec.maxCpuMs === undefined
        ? `Cloudflare Workers Free allows ${CF_WORKERS_FREE_CPU_MS} ms of CPU per invocation; declare maxCpuMs <= ${CF_WORKERS_FREE_CPU_MS} to target it`
        : `Cloudflare Workers Free allows ${CF_WORKERS_FREE_CPU_MS} ms of CPU per invocation; workload needs ${spec.maxCpuMs} ms`;
    }

    // Rule 5: Compute & RAM headroom
    if (eligible && effectiveRequiredCpu > target.availableCpu) {
      eligible = false;
      rejectionReason = `Target available CPU (${target.availableCpu} vCPU) is less than required (${effectiveRequiredCpu} vCPU)`;
    }
    if (eligible && effectiveRequiredMem > target.availableMemoryMb) {
      eligible = false;
      rejectionReason = `Target available RAM (${target.availableMemoryMb} MB) is less than required (${effectiveRequiredMem} MB)`;
    }

    // Rule 6: Quota Evaluation via Live Quota Clocks
    let quotaAssessment: DispatchEvaluation["quotaAssessment"] | undefined;
    if (target.quotaMeterId) {
      const meterId = target.quotaMeterId;
      const provider = MASTER_CATALOG.find((p) => p.quotas.some((q) => q.id === meterId));
      const meterDef = provider?.quotas.find((q) => q.id === meterId);

      if (meterDef) {
        const rawUsed = quotaValues[meterId];
        const used = typeof rawUsed === "number" ? rawUsed : NaN;
        const evalResult = evaluateQuota(meterDef.limit, used, meterDef.window, now);

        const isPublicRepoSpec = target.id === "github-actions-hosted" && spec.isPublicRepo === true;

        quotaAssessment = {
          meterId,
          used: evalResult.used,
          limit: meterDef.limit,
          status: evalResult.status,
          remaining: evalResult.remaining,
          percentUsed: evalResult.percentUsed,
          resetCountdown: evalResult.resetCountdown,
          isUnmetered: isPublicRepoSpec,
          isValid: evalResult.isValid,
        };

        if (eligible) {
          if (evalResult.status === "exhausted") {
            eligible = false;
            rejectionReason = `Quota meter '${meterDef.name}' is exhausted (${evalResult.used}/${meterDef.limit} ${meterDef.unit}). Next reset in ${evalResult.resetCountdown}`;
          } else if (evalResult.status === "unknown" || !evalResult.isValid) {
            // Fail closed: Unknown or invalid quota readings are NEVER eligible for automated placement
            eligible = false;
            rejectionReason = `Quota reading for meter '${meterDef.name}' is unknown or invalid. Cannot safely verify capacity.`;
          } else if (evalResult.status === "critical") {
            score -= 35; // Eligible as fallback only
          } else if (evalResult.status === "warning") {
            score -= 15;
          } else {
            score += 10; // Healthy quota bonus
          }

          if (eligible && isPublicRepoSpec) {
            score += 25; // Bonus for verified unmetered public CI
          }
        }
      }
    }

    // Rule 7: Category Affinity & Scoring
    if (eligible) {
      switch (effectiveCategory) {
        case "heavy_ci":
          if (target.id === "github-actions-hosted") {
            score += spec.isPublicRepo ? 45 : 30;
          } else if (target.id === "local-mac-mini") {
            score += 45; // Apple Silicon M-series is fast, zero quota cost
          } else if (target.id === "upstash-ephemeral-box") {
            score += 15;
          } else if (target.id === "modal-serverless-gpu") {
            score -= 40; // Do not burn serverless GPU credits on standard CPU CI suites
          }
          break;

        case "gpu_ml":
          if (target.id === "modal-serverless-gpu") {
            score += 45; // Dedicated NVIDIA serverless GPU
          } else if (target.id === "local-mac-mini") {
            score += 35; // Metal / MPS acceleration
          } else if (target.id === "colab-ephemeral-notebook") {
            score += 30; // Free T4 GPU
          }
          break;

        case "light_cron":
          if (target.id === "cf-workers-edge") {
            score += 50; // Zero cold-start, instant edge execution
          } else if (target.id === "upstash-ephemeral-box") {
            score += 35;
          } else if (target.id === "local-mac-mini") {
            score += 25;
          } else if (target.id === "modal-serverless-gpu") {
            score -= 30; // Do not waste GPU credits on crons
          }
          break;

        case "general_batch":
        default:
          if (target.id === "upstash-ephemeral-box") score += 35;
          else if (target.id === "local-mac-mini") score += 30;
          else if (target.id === "github-actions-hosted") score += 20;
          break;
      }

      // Architecture matching bonus / penalty
      if (effectiveArch === target.arch || target.arch === "any") {
        score += 15;
      } else if (effectiveArch !== "any" && target.arch !== effectiveArch) {
        score -= 20;
      }

      // Headroom bonus
      score += Math.min(15, (target.availableCpu / 8) * 8 + (target.availableMemoryMb / 32768) * 7);
    }

    evaluations.push({
      target,
      eligible,
      score: Math.max(0, Math.round(score)),
      rejectionReason,
      quotaAssessment,
    });
  }

  // 3. Select winning candidate
  const eligibleCandidates = evaluations.filter((e) => e.eligible);
  eligibleCandidates.sort((a, b) => b.score - a.score);

  const rejectedTargets = evaluations
    .filter((e) => !e.eligible)
    .map((e) => ({
      targetId: e.target.id,
      targetName: e.target.name,
      reason: e.rejectionReason || "Ineligible candidate",
    }));

  if (eligibleCandidates.length === 0) {
    return {
      success: false,
      workload: spec,
      classification,
      reason: `No eligible dispatch targets found for workload '${spec.name}'. All ${targets.length} candidates were ineligible.`,
      evaluations,
      rejectedTargets,
      timestamp: now.toISOString(),
    };
  }

  const winner = eligibleCandidates[0];
  const target = winner.target;

  // 4. Derive routing strategy & reasoning
  let routingStrategy: DispatchDecision["routingStrategy"] = "LOCAL_WORKSTATION_OFFLOAD";
  let reason = "";

  if (target.id === "github-actions-hosted") {
    routingStrategy = "OFFLOAD_TO_GITHUB_ACTIONS";
    reason = spec.isPublicRepo
      ? "Routed to GitHub Actions Hosted Runners (unmetered & free for public repository). Successfully isolated away from protected Oracle production servers."
      : `Routed to GitHub Actions Hosted Runners (${winner.quotaAssessment?.remaining ?? 0} minutes remaining on free monthly tier). Protects production hosts from CI CPU steal.`;
  } else if (target.id === "local-mac-mini") {
    routingStrategy = "LOCAL_WORKSTATION_OFFLOAD";
    reason = effectiveCategory === "gpu_ml"
      ? "Routed to Local Mac Mini leveraging Apple Silicon Metal/MPS GPU acceleration with zero cloud egress cost."
      : "Routed to Local Mac Mini high-performance workstation. Avoids cloud quota burn and preserves production servers.";
  } else if (target.id === "modal-serverless-gpu") {
    routingStrategy = "BURST_TO_SERVERLESS_GPU";
    reason = `Routed to Modal Serverless GPU Runner ($${winner.quotaAssessment?.remaining ?? 0} free monthly credits remaining). Fulfills CUDA/GPU requirement without risking production host stability.`;
  } else if (target.id === "cf-workers-edge") {
    routingStrategy = "EDGE_SERVERLESS_EXECUTION";
    reason = `Routed to Cloudflare Edge Workers (${winner.quotaAssessment?.remaining ?? 0} invocations remaining today). Fits within the 10 ms CPU budget per invocation.`;
  } else if (target.id === "upstash-ephemeral-box") {
    routingStrategy = "UPSTASH_EPHEMERAL_CONTAINER";
    reason = `Routed to Upstash Ephemeral Box container (${winner.quotaAssessment?.remaining ?? 0} hours remaining). Provides clean isolated sandbox off the production fleet.`;
  } else if (target.id === "colab-ephemeral-notebook") {
    routingStrategy = "EPHEMERAL_NOTEBOOK_DISPATCH";
    reason = "Routed to Ephemeral Notebook Worker (Google Colab / Kaggle) with free T4 GPU support.";
  } else {
    routingStrategy = "STANDBY_NODE_DISPATCH";
    reason = "Routed to standby micro instance for lightweight low-priority batch execution.";
  }

  // 5. Build structured ExecutionPlan (No raw shell string execution)
  let executionPlan: ExecutionPlan;

  if (target.executor === "github_dispatch") {
    executionPlan = {
      type: "github_dispatch",
      targetId: target.id,
      executor: "github_dispatch",
      payload: {
        workflow: "fleet-job.yml",
        inputs: {
          workload: spec.name,
          command: spec.command || "npm test",
        },
      },
      displayPreview: `gh workflow run fleet-job.yml -f workload=${shellEscape(spec.name)} -f cmd=${shellEscape(spec.command || "npm test")}`,
    };
  } else if (target.executor === "modal") {
    executionPlan = {
      type: "modal_runner",
      targetId: target.id,
      executor: "modal",
      payload: {
        command: spec.command || "python train.py",
        limits: {
          cpu: effectiveRequiredCpu,
          memoryMb: effectiveRequiredMem,
          timeoutSeconds: effectiveRuntime,
        },
      },
      displayPreview: `modal run fleet_job::run --command ${shellEscape(spec.command || "python train.py")} --gpu`,
    };
  } else if (target.executor === "serverless_http") {
    executionPlan = {
      type: "serverless_http",
      targetId: target.id,
      executor: "serverless_http",
      payload: {
        endpoint: "https://workers.fleethub.dev/dispatch",
        inputs: { job: spec.name },
      },
      displayPreview: `curl -X POST https://workers.fleethub.dev/dispatch -H "Authorization: Bearer [REDACTED]" -d ${shellEscape(JSON.stringify({ job: spec.name }))}`,
    };
  } else if (target.executor === "docker") {
    const containerArgv = shellCommandArgv(spec.command || "npm test");
    executionPlan = {
      type: "container",
      targetId: target.id,
      executor: "docker",
      payload: {
        image: spec.image || "node:22-alpine",
        ...containerArgv,
        limits: {
          cpu: effectiveRequiredCpu,
          memoryMb: effectiveRequiredMem,
          timeoutSeconds: effectiveRuntime,
        },
      },
      displayPreview: ["docker", "run", "--rm", "--cpus", String(effectiveRequiredCpu), "--memory", `${effectiveRequiredMem}m`, spec.image || "node:22-alpine", containerArgv.command, ...containerArgv.args].map(shellEscape).join(" "),
    };
  } else {
    const localArgv = spec.command ? shellCommandArgv(spec.command) : { command: "echo", args: [spec.name] };
    executionPlan = {
      type: "local_process",
      targetId: target.id,
      executor: "local_process",
      payload: localArgv,
      displayPreview: [localArgv.command, ...localArgv.args].map(shellEscape).join(" "),
    };
  }

  return {
    success: true,
    workload: spec,
    classification,
    selectedTarget: target,
    routingStrategy,
    confidence: classification.confidence,
    reason,
    executionPlan,
    evaluations,
    rejectedTargets,
    timestamp: now.toISOString(),
  };
}
