import { describe, it, expect } from "vitest";
import {
  classifyWorkload,
  dispatchWorkload,
  getDispatchTargets,
  shellEscape,
  STANDARD_DISPATCH_TARGETS,
  type WorkloadSpec,
} from "../src/lib/distribution/dispatcher";

describe("Smart Workload Distribution Engine", () => {
  const baseTime = new Date("2026-10-25T12:00:00Z");
  // Observed usage for the metered targets. The dispatcher has no built-in defaults.
  const HEALTHY_READINGS: Record<string, number> = {
    "github.actions.minutes": 850,
    "modal.credits.usd": 8.5,
    "upstash.box.hours": 1.8,
    "cf.workers.requests": 42150,
  };

  describe("Workload Classification", () => {
    it("classifies Playwright E2E suites and heavy builds as heavy_ci", () => {
      const spec: WorkloadSpec = {
        name: "Playwright E2E Regression",
        command: "npx playwright test --workers=4",
        image: "mcr.microsoft.com/playwright:v1.49.0-noble",
        requiredCpu: 4,
        requiredMemoryMb: 8192,
        maxRuntimeSeconds: 900,
      };

      const result = classifyWorkload(spec);
      expect(result.category).toBe("heavy_ci");
      expect(result.confidence).toBe("high");
      expect(result.signals).toEqual(
        expect.arrayContaining([
          expect.stringContaining("playwright"),
        ])
      );
      expect(result.recommendedLimits.preferredArch).toBe("amd64");
    });

    it("classifies PyTorch, CUDA, and Whisper tasks as gpu_ml", () => {
      const spec: WorkloadSpec = {
        name: "Audio Transcription Pipeline",
        command: "python -m whisper audio.wav --model large-v3",
        requiresGpu: true,
      };

      const result = classifyWorkload(spec);
      expect(result.category).toBe("gpu_ml");
      expect(result.confidence).toBe("high");
      expect(result.recommendedLimits.requiresGpu).toBe(true);
      expect(result.signals).toEqual(
        expect.arrayContaining([
          expect.stringContaining("requiresGpu: true"),
        ])
      );
    });

    it("classifies periodic rclone sync and health monitors as light_cron", () => {
      const spec: WorkloadSpec = {
        name: "Nightly Storage Health Check",
        command: "rclone check gdrive-crypt: fleet-artifacts: --one-way",
        requiredCpu: 0.25,
        requiredMemoryMb: 128,
        maxRuntimeSeconds: 30,
      };

      const result = classifyWorkload(spec);
      expect(result.category).toBe("light_cron");
      expect(result.recommendedLimits.preferredArch).toBe("any");
      expect(result.recommendedLimits.maxRuntimeSeconds).toBe(30);
    });

    it("honors explicit category and merges recommended limits with user overrides", () => {
      const spec: WorkloadSpec = {
        name: "Custom Data Export",
        category: "general_batch",
        requiredCpu: 3.5,
      };

      const result = classifyWorkload(spec);
      expect(result.category).toBe("general_batch");
      expect(result.confidence).toBe("high");
      expect(result.recommendedLimits.cpu).toBe(3.5);
      expect(result.recommendedLimits.memoryMb).toBe(2048);
    });

    it("defaults to general_batch when no dominant domain keywords are found", () => {
      const spec: WorkloadSpec = {
        name: "generic-task-123",
      };

      const result = classifyWorkload(spec);
      expect(result.category).toBe("general_batch");
      expect(result.confidence).toBe("low");
    });
  });

  describe("Protected Production Server Shield (Guardrail G3 Invariant)", () => {
    it("strictly, unconditionally rejects protected Oracle instances (Atlas, Borealis, Polar Night Owl)", () => {
      const spec: WorkloadSpec = {
        name: "Integration Test Suite",
        command: "npm test",
        category: "heavy_ci",
      };

      const result = dispatchWorkload(spec, { now: baseTime, quotaReadings: HEALTHY_READINGS });
      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.selectedTarget.isProtected).toBe(false);
      expect(result.selectedTarget.id).not.toBe("oci-atlas");
      expect(result.selectedTarget.id).not.toBe("oci-borealis");
      expect(result.selectedTarget.id).not.toBe("oci-polar-night-owl");

      const protectedRejections = result.rejectedTargets.filter((r) =>
        r.targetId.startsWith("oci-") && r.targetId !== "oci-polar-ember"
      );
      expect(protectedRejections.length).toBe(3);
      for (const rej of protectedRejections) {
        expect(rej.reason).toContain("Protected production node: reserved strictly for core control plane");
      }
    });

    it("strictly, unconditionally rejects protected Cloudflare DNS accounts (cf-primary-dns)", () => {
      const spec: WorkloadSpec = {
        name: "Sync DNS records or Edge Cron",
        category: "light_cron",
        maxRuntimeSeconds: 5,
        maxCpuMs: 5,
      };

      const result = dispatchWorkload(spec, { now: baseTime, quotaReadings: HEALTHY_READINGS });
      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.selectedTarget.id).not.toBe("cf-primary-dns");
      const dnsRej = result.rejectedTargets.find((r) => r.targetId === "cf-primary-dns");
      expect(dnsRej).toBeDefined();
      expect(dnsRej?.reason).toContain("Protected production node: reserved strictly for core control plane");
      // But un-protected cf-workers-edge is selected!
      expect(result.selectedTarget.id).toBe("cf-workers-edge");
    });

    it("rejects Oracle AMD E2.1.Micro instance for heavy CI workloads", () => {
      const spec: WorkloadSpec = {
        name: "Heavy Build",
        command: "cargo build --release",
        category: "heavy_ci",
      };

      const result = dispatchWorkload(spec, { now: baseTime, quotaReadings: HEALTHY_READINGS });
      expect(result.success).toBe(true);
      if (!result.success) return;

      const emberRej = result.rejectedTargets.find((r) => r.targetId === "oci-polar-ember");
      expect(emberRej?.reason).toContain("inventory-only");
    });
  });

  describe("Routing Heavy CI Workloads", () => {
    it("routes public repository CI to GitHub Actions Runners with unmetered bonus", () => {
      const spec: WorkloadSpec = {
        name: "Playwright Public E2E",
        command: "npx playwright test",
        isPublicRepo: true,
      };

      const result = dispatchWorkload(spec, { now: baseTime, quotaReadings: HEALTHY_READINGS });
      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.selectedTarget.id).toBe("github-actions-hosted");
      expect(result.routingStrategy).toBe("OFFLOAD_TO_GITHUB_ACTIONS");
      expect(result.reason).toContain("unmetered & free for public repository");
      expect(result.executionPlan.type).toBe("github_dispatch");
      expect(result.executionPlan.displayPreview).toContain("gh workflow run");
    });

    it("routes private repository CI to GitHub Actions when minutes quota is healthy", () => {
      const spec: WorkloadSpec = {
        name: "Playwright Private E2E",
        command: "npx playwright test",
        isPublicRepo: false,
      };

      const result = dispatchWorkload(spec, {
        now: baseTime,
        quotaReadings: { ...HEALTHY_READINGS,  "github.actions.minutes": 600 }, // 600/2000 used
      });

      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.selectedTarget.id).toBe("github-actions-hosted");
      expect(result.routingStrategy).toBe("OFFLOAD_TO_GITHUB_ACTIONS");
      expect(result.reason).toContain("1400 minutes remaining");
    });

    it("routes to Local Mac Mini when GitHub Actions quota is exhausted", () => {
      const spec: WorkloadSpec = {
        name: "Heavy Build and Test",
        command: "npm test",
        category: "heavy_ci",
        isPublicRepo: false,
      };

      const result = dispatchWorkload(spec, {
        now: baseTime,
        quotaReadings: { ...HEALTHY_READINGS,  "github.actions.minutes": 2000 }, // Exhausted!
      });

      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.selectedTarget.id).toBe("local-mac-mini");
      expect(result.routingStrategy).toBe("LOCAL_WORKSTATION_OFFLOAD");
      expect(result.reason).toContain("Local Mac Mini high-performance workstation");

      const ghRej = result.rejectedTargets.find((r) => r.targetId === "github-actions-hosted");
      expect(ghRej?.reason).toContain("exhausted (2000/2000 minutes)");
    });
  });

  describe("Routing GPU / ML Bursts", () => {
    it("routes GPU workloads to Modal Serverless GPU runner when quota is available", () => {
      const spec: WorkloadSpec = {
        name: "LoRA Fine-tuning Run",
        command: "python train_lora.py",
        requiresGpu: true,
      };

      const result = dispatchWorkload(spec, {
        now: baseTime,
        quotaReadings: { ...HEALTHY_READINGS,  "modal.credits.usd": 5 },
      });

      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.selectedTarget.id).toBe("modal-serverless-gpu");
      expect(result.routingStrategy).toBe("BURST_TO_SERVERLESS_GPU");
      expect(result.reason).toContain("Modal Serverless GPU");
      expect(result.executionPlan.type).toBe("modal_runner");
    });

    it("routes to Local Mac Mini (MPS/Metal GPU) when Modal credits are exhausted", () => {
      const spec: WorkloadSpec = {
        name: "PyTorch Inference Benchmark",
        command: "python bench.py",
        requiresGpu: true,
      };

      const result = dispatchWorkload(spec, {
        now: baseTime,
        quotaReadings: { ...HEALTHY_READINGS,  "modal.credits.usd": 30 }, // Exhausted!
      });

      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.selectedTarget.id).toBe("local-mac-mini");
      expect(result.routingStrategy).toBe("LOCAL_WORKSTATION_OFFLOAD");
      expect(result.reason).toContain("Apple Silicon Metal/MPS GPU acceleration");
    });

    it("rejects non-GPU targets for GPU workloads", () => {
      const spec: WorkloadSpec = {
        name: "DeepSeek Quantization",
        requiresGpu: true,
      };

      const result = dispatchWorkload(spec, { now: baseTime, quotaReadings: HEALTHY_READINGS });
      expect(result.success).toBe(true);
      if (!result.success) return;

      const nonGpuRejections = result.rejectedTargets.filter((r) =>
        r.targetId === "github-actions-hosted" || r.targetId === "upstash-ephemeral-box"
      );
      for (const rej of nonGpuRejections) {
        expect(rej.reason).toContain("target lacks GPU");
      }
    });
  });

  describe("Routing Light Cron / Sync Tasks", () => {
    it("routes sub-10s tasks to Cloudflare Edge Workers", () => {
      const spec: WorkloadSpec = {
        name: "Hourly Mesh Ping & Quota Poll",
        category: "light_cron",
        maxRuntimeSeconds: 5,
        maxCpuMs: 5,
      };

      const result = dispatchWorkload(spec, { now: baseTime, quotaReadings: HEALTHY_READINGS });
      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.selectedTarget.id).toBe("cf-workers-edge");
      expect(result.routingStrategy).toBe("EDGE_SERVERLESS_EXECUTION");
      expect(result.reason).toContain("Cloudflare Edge Workers");
      expect(result.executionPlan.type).toBe("serverless_http");
    });

    it("rejects Cloudflare Workers unless the workload declares a CPU budget within 10 ms", () => {
      const spec: WorkloadSpec = {
        name: "Long Database Backup Sync",
        category: "light_cron",
        maxRuntimeSeconds: 45, // > 10s
      };

      const result = dispatchWorkload(spec, { now: baseTime, quotaReadings: HEALTHY_READINGS });
      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.selectedTarget.id).not.toBe("cf-workers-edge");

      const cfRej = result.rejectedTargets.find((r) => r.targetId === "cf-workers-edge");
      expect(cfRej?.reason).toContain("10 ms of CPU per invocation");
    });

    it("routes longer containerized cron jobs to Upstash Ephemeral Box", () => {
      const spec: WorkloadSpec = {
        name: "Storage Metadata Vacuum",
        category: "light_cron",
        maxRuntimeSeconds: 45,
        requiredCpu: 1.0,
        requiredMemoryMb: 1024,
      };

      const result = dispatchWorkload(spec, { now: baseTime, quotaReadings: HEALTHY_READINGS });
      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.selectedTarget.id).toBe("upstash-ephemeral-box");
      expect(result.routingStrategy).toBe("UPSTASH_EPHEMERAL_CONTAINER");
    });
  });

  describe("Security, Schema Validation & Guardrail Invariants", () => {
    it("safely returns structured rejection when requirements exceed all available infrastructure", () => {
      const impossibleSpec = {
        name: "Mega AI Monster",
        requiredCpu: 60,
        requiredMemoryMb: 200000,
      };

      const result = dispatchWorkload(impossibleSpec, { now: baseTime, quotaReadings: HEALTHY_READINGS });
      expect(result.success).toBe(false);
      expect(result.reason).toContain("No eligible dispatch targets found");
      expect(result.rejectedTargets.length).toBeGreaterThan(0);
    });

    it("safely handles invalid schema input without throwing unhandled exceptions", () => {
      const invalidSpec = {
        name: "", // Invalid empty name
        requiredCpu: -4, // Invalid negative
      };

      const result = dispatchWorkload(invalidSpec as any, { now: baseTime, quotaReadings: HEALTHY_READINGS });
      expect(result.success).toBe(false);
      expect(result.reason).toContain("Invalid workload specification");
    });

    it("escapes shell arguments safely for displayPreview", () => {
      expect(shellEscape("hello")).toBe("'hello'");
      expect(shellEscape("test; rm -rf /")).toBe("'test; rm -rf /'");
      expect(shellEscape("O'Reilly")).toBe("'O'\\''Reilly'");
      expect(shellEscape("")).toBe("''");
    });

    it("returns dispatch targets with and without protected nodes", () => {
      const allTargets = getDispatchTargets({ includeProtected: true });
      expect(allTargets.length).toBe(STANDARD_DISPATCH_TARGETS.length);

      const unprotectedOnly = getDispatchTargets({ includeProtected: false });
      expect(unprotectedOnly.every((t) => !t.isProtected)).toBe(true);
      expect(unprotectedOnly.length).toBeLessThan(allTargets.length);
    });

    it("routes to Colab / Kaggle Ephemeral Worker when it is the highest ranked GPU candidate", () => {
      const spec: WorkloadSpec = {
        name: "Interactive Notebook ML Experiment",
        requiresGpu: true,
      };

      const customColabOnly = [
        STANDARD_DISPATCH_TARGETS.find((t) => t.id === "colab-ephemeral-notebook")!,
      ];

      const result = dispatchWorkload(spec, {
        customTargets: customColabOnly,
        now: baseTime,
      });

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.selectedTarget.id).toBe("colab-ephemeral-notebook");
      expect(result.routingStrategy).toBe("EPHEMERAL_NOTEBOOK_DISPATCH");
    });

    it("rejects even standby OCI targets under the inventory-only policy", () => {
      const spec: WorkloadSpec = {
        name: "Micro Log Rotator",
        category: "general_batch",
        requiredCpu: 0.5,
        requiredMemoryMb: 512,
      };

      const customStandbyOnly = [
        STANDARD_DISPATCH_TARGETS.find((t) => t.id === "oci-polar-ember")!,
      ];

      const result = dispatchWorkload(spec, {
        customTargets: customStandbyOnly,
        now: baseTime,
      });

      expect(result.success).toBe(false);
      expect(result.rejectedTargets[0].reason).toContain("OCI is inventory-only");
    });

    it("applies quota penalties for critical and unknown quota meters", () => {
      const spec: WorkloadSpec = {
        name: "Actions Task",
        category: "heavy_ci",
        isPublicRepo: false,
      };

      // Critical quota (e.g. 1900/2000 used = 95%)
      const result = dispatchWorkload(spec, {
        now: baseTime,
        quotaReadings: { ...HEALTHY_READINGS,  "github.actions.minutes": 1900 },
      });

      expect(result.success).toBe(true);
      if (!result.success) return;
      const ghEval = result.evaluations.find((e) => e.target.id === "github-actions-hosted");
      expect(ghEval?.quotaAssessment?.status).toBe("critical");
    });

    it("rejects targets when quota reading is unknown or invalid", () => {
      const spec: WorkloadSpec = {
        name: "CI Task with Unknown Quota",
        category: "heavy_ci",
      };

      const result = dispatchWorkload(spec, {
        now: baseTime,
        quotaReadings: { ...HEALTHY_READINGS,  "github.actions.minutes": NaN },
      });

      expect(result.success).toBe(true);
      if (!result.success) return;
      const ghEval = result.evaluations.find((e) => e.target.id === "github-actions-hosted");
      expect(ghEval?.eligible).toBe(false);
      expect(ghEval?.rejectionReason).toContain("unknown or invalid");
    });

    it("rejects exhausted targets even if isPublicRepo is set to true", () => {
      const spec: WorkloadSpec = {
        name: "CI Task with Exhausted Quota",
        category: "heavy_ci",
        isPublicRepo: true,
      };

      const result = dispatchWorkload(spec, {
        now: baseTime,
        quotaReadings: { ...HEALTHY_READINGS,  "github.actions.minutes": 2000 },
      });

      expect(result.success).toBe(true);
      if (!result.success) return;
      const ghEval = result.evaluations.find((e) => e.target.id === "github-actions-hosted");
      expect(ghEval?.eligible).toBe(false);
      expect(ghEval?.rejectionReason).toContain("exhausted");
    });

    it("fails validation if command contains newline or image format is invalid", () => {
      const cmdResult = dispatchWorkload({
        name: "Malicious Command",
        command: "npm test\nrm -rf /",
      });
      expect(cmdResult.success).toBe(false);
      expect(cmdResult.reason).toContain("newline");

      const imgResult = dispatchWorkload({
        name: "Malicious Image",
        image: "node:22; cat /etc/passwd",
      });
      expect(imgResult.success).toBe(false);
      expect(imgResult.reason).toContain("valid container image");
    });

    it("generates structured container execution plan when docker executor is picked", () => {
      const spec: WorkloadSpec = {
        name: "Containerized Unit Tests",
        category: "general_batch",
        command: "npm run test:ci",
        image: "node:22-bullseye",
        requiredCpu: 2,
        requiredMemoryMb: 2048,
      };

      const customDockerTarget = [
        STANDARD_DISPATCH_TARGETS.find((t) => t.id === "upstash-ephemeral-box")!,
      ];

      const result = dispatchWorkload(spec, {
        customTargets: customDockerTarget,
        now: baseTime,
        quotaReadings: HEALTHY_READINGS,
      });

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.executionPlan.type).toBe("container");
      expect(result.executionPlan.payload.image).toBe("node:22-bullseye");
      expect(result.executionPlan.payload.command).toBe("/bin/sh");
      expect(result.executionPlan.payload.args).toEqual(["-c", "npm run test:ci"]);
      expect(result.executionPlan.displayPreview).toBe("'docker' 'run' '--rm' '--cpus' '2' '--memory' '2048m' 'node:22-bullseye' '/bin/sh' '-c' 'npm run test:ci'");
    });
  });

  describe("Review regressions", () => {
    it("fails closed for metered targets when no quota readings are supplied", () => {
      const result = dispatchWorkload(
        { name: "small batch", category: "general_batch", requiredCpu: 0.5, requiredMemoryMb: 128, maxCpuMs: 5, isPublicRepo: true },
        { now: baseTime },
      );
      for (const id of ["github-actions-hosted", "modal-serverless-gpu", "upstash-ephemeral-box", "cf-workers-edge"]) {
        const evaluation = result.evaluations.find((e) => e.target.id === id);
        expect(evaluation?.eligible).toBe(false);
        expect(evaluation?.rejectionReason).toContain("unknown or invalid");
      }
      expect(result.success && result.selectedTarget.id).toBe("local-mac-mini");
    });

    it("never routes CUDA workloads to the Apple Silicon Mac mini", () => {
      const result = dispatchWorkload(
        { name: "cuda pytorch training", requiresGpu: true },
        { now: baseTime, quotaReadings: { ...HEALTHY_READINGS, "modal.credits.usd": 28 } },
      );
      expect(result.success && result.selectedTarget.id).not.toBe("local-mac-mini");
      const mac = result.evaluations.find((e) => e.target.id === "local-mac-mini");
      expect(mac?.rejectionReason).toBe("Workload requires CUDA; target only offers MPS");
    });

    it("routes MPS workloads only to targets that offer MPS", () => {
      const result = dispatchWorkload({ name: "mlx fine-tune", requiresGpu: true }, { now: baseTime, quotaReadings: HEALTHY_READINGS });
      expect(result.success && result.selectedTarget.id).toBe("local-mac-mini");
      expect(result.evaluations.find((e) => e.target.id === "modal-serverless-gpu")?.eligible).toBe(false);
    });

    it("matches accelerator keywords as whole words", () => {
      expect(classifyWorkload({ name: "jumps over gpu queue", requiresGpu: true }).recommendedLimits.accelerator).toBe("any");
      expect(classifyWorkload({ name: "vLLM serve", requiresGpu: true }).recommendedLimits.accelerator).toBe("cuda");
    });

    it("keeps Cloudflare Workers to workloads within the 10 ms CPU budget", () => {
      const seconds = dispatchWorkload({ name: "quota poll", category: "light_cron", maxRuntimeSeconds: 5 }, { now: baseTime, quotaReadings: HEALTHY_READINGS });
      expect(seconds.success && seconds.selectedTarget.id).not.toBe("cf-workers-edge");
      const tiny = dispatchWorkload({ name: "quota poll", category: "light_cron", maxCpuMs: 10 }, { now: baseTime, quotaReadings: HEALTHY_READINGS });
      expect(tiny.success && tiny.selectedTarget.id).toBe("cf-workers-edge");
    });

    it("passes the workload name as data, never as part of a command", () => {
      const result = dispatchWorkload(
        { name: "x; touch /tmp/pwn", category: "general_batch" },
        { now: baseTime, quotaReadings: { ...HEALTHY_READINGS, "upstash.box.hours": 5, "github.actions.minutes": 2000 } },
      );
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.executionPlan.type).toBe("local_process");
      expect(result.executionPlan.payload).toEqual({ command: "echo", args: ["x; touch /tmp/pwn"] });
      expect(result.executionPlan.displayPreview).toBe("'echo' 'x; touch /tmp/pwn'");
    });
  });
});
