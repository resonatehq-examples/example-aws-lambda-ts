import type { Context } from "@resonatehq/sdk";

// ---------------------------------------------------------------------------
// Document Processing Workflow
// ---------------------------------------------------------------------------
//
// This workflow is designed to outlast Lambda's 15-minute execution limit.
// It runs on a Resonate worker (long-running Node.js process) that the
// Lambda function triggers via the Resonate Server.
//
// Steps:
//   1. Download document from S3
//   2. Extract text (slow — OCR or PDF parsing)
//   3. Analyze content with LLM (may take minutes)
//   4. Store results in database
//   5. Notify requester
//
// Lambda timeout: 15 minutes
// This workflow: potentially hours (LLM with large documents, human review)

export interface DocumentJob {
  jobId: string;
  documentUrl: string;
  requesterId: string;
  type: "invoice" | "contract" | "report";
}

export interface DocumentResult {
  jobId: string;
  type: string;
  pageCount: number;
  summary: string;
  extractedData: Record<string, unknown>;
  storedAt: string;
  notifiedAt: string;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// Step 1: Download document from S3/URL
async function downloadDocument(_ctx: unknown, job: DocumentJob): Promise<number> {
  console.log(`[download]   job ${job.jobId} — fetching ${job.type} from ${job.documentUrl}`);
  await sleep(500); // simulates download
  const pageCount = Math.floor(Math.random() * 20) + 1;
  console.log(`[download]   job ${job.jobId} — ${pageCount} pages received`);
  return pageCount;
}

// Step 2: Extract text — OCR or PDF parsing (can be slow)
async function extractText(_ctx: unknown, job: DocumentJob, pageCount: number): Promise<string> {
  console.log(
    `[extract]    job ${job.jobId} — extracting text from ${pageCount} pages (OCR)`,
  );
  await sleep(pageCount * 100); // 100ms per page — 20 pages = 2 seconds in demo
  const text = `[extracted text from ${pageCount}-page ${job.type} document]`;
  console.log(`[extract]    job ${job.jobId} — extraction complete`);
  return text;
}

// Step 3: Analyze with LLM — potentially slow for large documents
async function analyzeDocument(
  _ctx: unknown,
  job: DocumentJob,
  text: string,
): Promise<{ summary: string; data: Record<string, unknown> }> {
  console.log(`[analyze]    job ${job.jobId} — sending to LLM for ${job.type} analysis`);
  await sleep(800); // simulates LLM call
  const summary = `${job.type} document processed. ${text.length} chars analyzed.`;
  const data =
    job.type === "invoice"
      ? { vendor: "Acme Corp", amount: 4999, currency: "USD" }
      : job.type === "contract"
        ? { parties: ["Alice Inc.", "Bob LLC"], expires: "2027-01-01" }
        : { period: "Q4 2025", metrics: { revenue: 1200000 } };
  console.log(`[analyze]    job ${job.jobId} — analysis complete`);
  return { summary, data };
}

// Step 4: Store results in database
async function storeResults(
  _ctx: unknown,
  job: DocumentJob,
  summary: string,
  data: Record<string, unknown>,
): Promise<string> {
  console.log(`[store]      job ${job.jobId} — writing results to database`);
  await sleep(200);
  const storedAt = new Date().toISOString();
  console.log(`[store]      job ${job.jobId} — stored at ${storedAt}`);
  return storedAt;
}

// Step 5: Notify requester
async function notifyRequester(
  _ctx: unknown,
  job: DocumentJob,
  storedAt: string,
): Promise<string> {
  console.log(
    `[notify]     job ${job.jobId} — notifying ${job.requesterId} that results are ready`,
  );
  await sleep(150);
  const notifiedAt = new Date().toISOString();
  console.log(`[notify]     job ${job.jobId} — requester notified`);
  return notifiedAt;
}

// ---------------------------------------------------------------------------
// The workflow — runs on a worker process, not in Lambda
// ---------------------------------------------------------------------------

export function* processDocument(
  ctx: Context,
  job: DocumentJob,
): Generator<any, DocumentResult, any> {
  const pageCount = yield* ctx.run(downloadDocument, job);
  const text = yield* ctx.run(extractText, job, pageCount);
  const { summary, data } = yield* ctx.run(analyzeDocument, job, text);
  const storedAt = yield* ctx.run(storeResults, job, summary, data);
  const notifiedAt = yield* ctx.run(notifyRequester, job, storedAt);

  return {
    jobId: job.jobId,
    type: job.type,
    pageCount,
    summary,
    extractedData: data,
    storedAt,
    notifiedAt,
  };
}
