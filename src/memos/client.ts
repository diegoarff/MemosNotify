import { z } from "zod";
import { contentHasTag } from "../core/text.ts";

export interface MemosClientOptions {
  baseUrl: string;
  token: string;
}

// z.object strips unknown keys, so this tolerates extra fields across Memos versions.
const MemoResponse = z.object({
  name: z.string().optional(),
  uid: z.string().optional(),
  content: z.string().optional(),
  state: z.string().optional(),
});
type MemoResponse = z.infer<typeof MemoResponse>;

// Targets the Memos v1 REST API (≥ 0.22); newer builds use `state: ARCHIVED` to archive.
export class MemosClient {
  private readonly base: string;

  constructor(private readonly opts: MemosClientOptions) {
    this.base = opts.baseUrl.replace(/\/+$/, "");
  }

  private static resourceName(name: string): string {
    return name.startsWith("memos/") ? name : `memos/${name}`;
  }

  private async request(method: string, path: string, body?: unknown): Promise<unknown> {
    const init: RequestInit = {
      method,
      headers: {
        authorization: `Bearer ${this.opts.token}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
    };
    if (body !== undefined) init.body = JSON.stringify(body);
    const res = await fetch(`${this.base}/api/v1/${path}`, init);
    if (!res.ok) {
      throw new Error(`Memos API ${method} ${path} → ${res.status} ${res.statusText}`);
    }
    // Some Memos builds answer PATCH with 200 + empty body, which res.json() would choke on — parse only if non-empty.
    const text = await res.text();
    return text ? JSON.parse(text) : undefined;
  }

  async getMemo(name: string): Promise<MemoResponse> {
    const data = await this.request("GET", MemosClient.resourceName(name));
    return MemoResponse.parse(data);
  }

  async archiveMemo(name: string): Promise<void> {
    const resource = MemosClient.resourceName(name);
    await this.request("PATCH", `${resource}?updateMask=state`, { state: "ARCHIVED" });
  }

  /** Append "#tag" to a memo's content (complete action). Idempotent: a no-op if already tagged. */
  async addTag(name: string, tag: string): Promise<void> {
    const resource = MemosClient.resourceName(name);
    const memo = await this.getMemo(resource);
    const bare = tag.replace(/^#/, "");
    const existing = memo.content ?? "";
    // Whole-tag match so a retried `complete` doesn't append "#done" twice (and "#done" ≠ "#donezo").
    if (contentHasTag(existing, bare)) return;
    const content = `${existing}\n#${bare}`.trim();
    await this.request("PATCH", `${resource}?updateMask=content`, { content });
  }
}
