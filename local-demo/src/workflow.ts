import type { Context } from "@resonatehq/sdk";

// ---------------------------------------------------------------------------
// Document Processing Workflow
// ---------------------------------------------------------------------------
// Same workflow as src/workflow.ts, with crash simulation added for the demo.

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

// Track LLM attempts per job for crash simulation
const llmAttempts = new Map<string, number>();

async function downloadDocument(_ctx: unknown, job: DocumentJob): Promise<number> {
  console.log(`[download]   job ${job.jobId} — fetching ${job.type} from S3`);
  await sleep(400);
  const pageCount = 8;
  console.log(`[download]   job ${job.jobId} — ${pageCount} pages received`);
  return pageCount;
}

async function extractText(_ctx: unknown, job: DocumentJob, pageCount: number): Promise<string> {
  console.log(`[extract]    job ${job.jobId} — OCR on ${pageCount} pages`);
  await sleep(pageCount * 80);
  const text = `[text from ${pageCount}-page ${job.type}]`;
  console.log(`[extract]    job ${job.jobId} — extraction complete`);
  return text;
}

async function analyzeDocument(
  _ctx: unknown,
  job: DocumentJob,
  text: string,
  simulateCrash: boolean,
): Promise<{ summary: string; data: Record<string, unknown> }> {
  const attempt = (llmAttempts.get(job.jobId) ?? 0) + 1;
  llmAttempts.set(job.jobId, attempt);

  if (simulateCrash && attempt === 1) {
    console.log(`[analyze]    job ${job.jobId} — LLM API timeout (attempt 1)`);
    throw new Error("LLM API rate limit exceeded");
  }

  console.log(
    `[analyze]    job ${job.jobId} — LLM analyzing ${job.type}${attempt > 1 ? ` (attempt ${attempt})` : ""}`,
  );
  await sleep(600);

  const summary = `${job.type} document processed. ${text.length} chars analyzed.`;
  const data: Record<string, unknown> =
    job.type === "contract"
      ? { parties: ["Alice Inc.", "Bob LLC"], expires: "2027-01-01", pages: 8 }
      : { amount: 4999, currency: "USD" };

  console.log(`[analyze]    job ${job.jobId} — analysis complete`);
  return { summary, data };
}

async function storeResults(
  _ctx: unknown,
  job: DocumentJob,
  summary: string,
  data: Record<string, unknown>,
): Promise<string> {
  console.log(`[store]      job ${job.jobId} — writing to database`);
  await sleep(200);
  const storedAt = new Date().toISOString();
  console.log(`[store]      job ${job.jobId} — stored`);
  return storedAt;
}

async function notifyRequester(
  _ctx: unknown,
  job: DocumentJob,
  storedAt: string,
): Promise<string> {
  console.log(`[notify]     job ${job.jobId} — notifying ${job.requesterId}`);
  await sleep(100);
  const notifiedAt = new Date().toISOString();
  console.log(`[notify]     job ${job.jobId} — done`);
  return notifiedAt;
}

export function* processDocument(
  ctx: Context,
  job: DocumentJob,
  simulateCrash = false,
): Generator<any, DocumentResult, any> {
  const pageCount = yield* ctx.run(downloadDocument, job);
  const text = yield* ctx.run(extractText, job, pageCount);
  const { summary, data } = yield* ctx.run(analyzeDocument, job, text, simulateCrash);
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
