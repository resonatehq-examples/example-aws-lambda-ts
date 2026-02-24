// ---------------------------------------------------------------------------
// AWS Lambda Handler — API Gateway → Lambda → Resonate workflow
// ---------------------------------------------------------------------------
//
// This Lambda function is a STATELESS TRIGGER. It:
//   1. Receives a POST /process-document request via API Gateway
//   2. Starts a durable workflow on the Resonate Server (non-blocking)
//   3. Returns 202 Accepted immediately
//
// The actual document processing runs on a Resonate worker process
// (long-running Node.js server) that can outlast Lambda's 15-minute limit.
//
// Why not run the workflow in Lambda itself?
//
//   Lambda timeout: 15 minutes max.
//   Document processing with large files + LLM analysis: potentially hours.
//   Human-in-the-loop review: potentially days.
//
//   Lambda can't hold state between timeouts. Resonate can.
//
// Compare to Restate on Lambda:
//   Restate makes Lambda the EXECUTOR — your Lambda IS the service handler.
//   Restate Cloud calls back into your Lambda functions to run each step.
//   This requires: CDK stack, IAM roles, Restate Cloud environment,
//   service registration, and the @restatedev/restate-sdk/lambda adapter.
//
//   With Resonate: Lambda just calls resonate.run() — same as calling a REST API.
//   No CDK required. No service registration. The Resonate Server manages execution.

import { Resonate } from "@resonatehq/sdk";
import { processDocument, type DocumentJob, type DocumentResult } from "./workflow.js";

// ---------------------------------------------------------------------------
// Lambda-side Resonate client
// ---------------------------------------------------------------------------
// Connected to the Resonate Server (remote mode).
// In Lambda, module-level code runs once per container cold start —
// this avoids creating a new connection on every invocation.

const resonate = new Resonate({ url: process.env["RESONATE_URL"] ?? "http://localhost:8001" });
resonate.register("processDocument", processDocument);

// ---------------------------------------------------------------------------
// Lambda handler types (simplified — no @types/aws-lambda required for demo)
// ---------------------------------------------------------------------------

interface APIGatewayEvent {
  httpMethod: string;
  path: string;
  body: string | null;
  pathParameters: Record<string, string> | null;
}

interface LambdaResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

const JSON_HEADERS = { "Content-Type": "application/json" };

// ---------------------------------------------------------------------------
// POST /process-document — start a durable document processing job
// ---------------------------------------------------------------------------

async function handleProcessDocument(event: APIGatewayEvent): Promise<LambdaResponse> {
  const body = JSON.parse(event.body ?? "{}") as Partial<DocumentJob>;

  if (!body.jobId || !body.documentUrl || !body.requesterId) {
    return {
      statusCode: 400,
      headers: JSON_HEADERS,
      body: JSON.stringify({ error: "jobId, documentUrl, and requesterId are required" }),
    };
  }

  const job: DocumentJob = {
    jobId: body.jobId,
    documentUrl: body.documentUrl,
    requesterId: body.requesterId,
    type: body.type ?? "report",
  };

  console.log(`[lambda]     Starting job ${job.jobId} (${job.type})`);

  // Fire-and-forget: workflow runs on the Resonate worker, not in Lambda.
  // This returns immediately — the Lambda function exits without waiting.
  resonate.run(`doc/${job.jobId}`, processDocument, job).catch(console.error);

  return {
    statusCode: 202,
    headers: JSON_HEADERS,
    body: JSON.stringify({
      status: "accepted",
      jobId: job.jobId,
      statusUrl: `/status/${job.jobId}`,
      message: "Processing in background. Poll statusUrl for results.",
    }),
  };
}

// ---------------------------------------------------------------------------
// GET /status/:jobId — poll for workflow result
// ---------------------------------------------------------------------------

async function handleStatus(event: APIGatewayEvent): Promise<LambdaResponse> {
  const jobId = event.pathParameters?.["jobId"];

  if (!jobId) {
    return {
      statusCode: 400,
      headers: JSON_HEADERS,
      body: JSON.stringify({ error: "jobId is required" }),
    };
  }

  try {
    const handle = await resonate.get(`doc/${jobId}`);
    const done = await handle.done();

    if (!done) {
      return {
        statusCode: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify({ status: "processing", jobId }),
      };
    }

    const result = (await handle.result()) as DocumentResult;
    return {
      statusCode: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify({ status: "done", result }),
    };
  } catch {
    return {
      statusCode: 404,
      headers: JSON_HEADERS,
      body: JSON.stringify({ status: "not_found", jobId }),
    };
  }
}

// ---------------------------------------------------------------------------
// Main handler — routes API Gateway events
// ---------------------------------------------------------------------------

export async function handler(event: APIGatewayEvent): Promise<LambdaResponse> {
  console.log(`[lambda]     ${event.httpMethod} ${event.path}`);

  if (event.httpMethod === "POST" && event.path === "/process-document") {
    return handleProcessDocument(event);
  }

  if (event.httpMethod === "GET" && event.path.startsWith("/status/")) {
    return handleStatus(event);
  }

  return {
    statusCode: 404,
    headers: JSON_HEADERS,
    body: JSON.stringify({ error: "Not found" }),
  };
}
