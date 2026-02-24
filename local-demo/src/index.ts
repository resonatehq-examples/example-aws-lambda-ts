// ---------------------------------------------------------------------------
// Local simulation of the Lambda + Resonate pattern
// ---------------------------------------------------------------------------
//
// This simulates what happens when:
//   1. API Gateway receives POST /process-document
//   2. Lambda starts (cold start: module-level code runs)
//   3. Handler calls resonate.run() — fires and forgets
//   4. Lambda returns 202 immediately
//   5. Workflow runs on the "worker" (embedded mode in this demo)
//   6. Client polls GET /status/:jobId for results
//
// In production: Lambda connects to a remote Resonate Server.
// Here: Resonate runs embedded (same process) for easy local testing.

import express from "express";
import { Resonate } from "@resonatehq/sdk";
import { processDocument, type DocumentJob, type DocumentResult } from "./workflow.js";

// ---------------------------------------------------------------------------
// Resonate setup (embedded mode for local demo)
// ---------------------------------------------------------------------------
// In production Lambda: new Resonate({ url: process.env.RESONATE_URL })

const resonate = new Resonate();
resonate.register("processDocument", processDocument);

// ---------------------------------------------------------------------------
// Express server simulating API Gateway + Lambda
// ---------------------------------------------------------------------------

const app = express();
app.use(express.json());

const simulateCrash = process.argv.includes("--crash");

// POST /process-document — Lambda handler (returns immediately)
app.post("/process-document", (req, res) => {
  const body = req.body as Partial<DocumentJob>;

  if (!body.jobId || !body.documentUrl || !body.requesterId) {
    res.status(400).json({ error: "jobId, documentUrl, and requesterId are required" });
    return;
  }

  const job: DocumentJob = {
    jobId: body.jobId,
    documentUrl: body.documentUrl,
    requesterId: body.requesterId,
    type: body.type ?? "report",
  };

  console.log(`\n[lambda]     POST /process-document — job ${job.jobId} (${job.type})`);
  console.log(`[lambda]     Returning 202 immediately (workflow runs in background)`);

  // Fire-and-forget — Lambda returns before workflow completes
  resonate.run(`doc/${job.jobId}`, processDocument, job, simulateCrash).catch(console.error);

  res.status(202).json({
    status: "accepted",
    jobId: job.jobId,
    statusUrl: `/status/${job.jobId}`,
  });
});

// GET /status/:jobId — poll for result
app.get("/status/:jobId", async (req, res) => {
  const { jobId } = req.params;

  try {
    const handle = await resonate.get(`doc/${jobId!}`);
    const done = await handle.done();

    if (!done) {
      res.json({ status: "processing", jobId });
      return;
    }

    const result = (await handle.result()) as DocumentResult;
    res.json({ status: "done", result });
  } catch {
    res.status(404).json({ status: "not_found", jobId });
  }
});

// ---------------------------------------------------------------------------
// Demo runner
// ---------------------------------------------------------------------------

const PORT = 3000;
const server = app.listen(PORT);
await new Promise((r) => setTimeout(r, 100));

const job: DocumentJob = {
  jobId: `job_${Date.now()}`,
  documentUrl: "s3://my-bucket/contracts/Q4-2025-agreement.pdf",
  requesterId: "user_alice",
  type: "contract",
};

console.log("=== AWS Lambda + Resonate Demo ===");
console.log(
  simulateCrash
    ? "Mode: CRASH (LLM API fails on first attempt, retries)\n"
    : "Mode: HAPPY PATH (all steps complete successfully)\n",
);
console.log(
  `[demo]       Submitting ${job.type} document for processing`,
);
console.log(`[demo]       Document: ${job.documentUrl}\n`);

// Step 1: POST to Lambda (API Gateway event)
const submitRes = await fetch(`http://localhost:${PORT}/process-document`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(job),
});
const accepted = (await submitRes.json()) as { status: string; jobId: string };
console.log(`\n[demo]       Lambda response: ${JSON.stringify(accepted)}`);
console.log("[demo]       (Lambda exits here — workflow continues without it)\n");

// Step 2: Poll for result
const totalMs =
  simulateCrash
    ? 8000 // wait for retry
    : 5000;

await new Promise((r) => setTimeout(r, totalMs));

const statusRes = await fetch(`http://localhost:${PORT}/status/${accepted.jobId}`);
const status = (await statusRes.json()) as { status: string; result?: DocumentResult };

console.log("\n=== Result ===");
console.log(
  JSON.stringify(
    status.result ?? status,
    null,
    2,
  ),
);

if (simulateCrash) {
  console.log(
    "\nNotice: LLM analysis failed on attempt 1, retried → succeeded.",
    "\nPrevious steps (download, extract) were NOT re-run.",
    "\nDocument processed exactly once.",
  );
} else {
  console.log("\nNotice: Lambda returned 202 before any workflow steps ran.");
  console.log("The workflow completed independently, beyond Lambda's execution context.");
}

server.close();
