import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { AwsClient } from "aws4fetch";

export type StorageKind = "local" | "r2";

export interface PrivateStorage {
  put(id: string, bytes: ArrayBuffer, type: string): Promise<void>;
  open(id: string): Promise<ReadableStream<Uint8Array>>;
  remove(id: string): Promise<void>;
}

const localDir = () => resolve(/* turbopackIgnore: true */ process.env.STOCKPACT_FILE_PATH || ".stockpact/attachments");
const localStorage: PrivateStorage = {
  async put(id, bytes) {
    await mkdir(localDir(), { recursive: true });
    await writeFile(resolve(localDir(), id), new Uint8Array(bytes), { flag: "wx", mode: 0o600 });
  },
  async open(id) {
    const bytes = await readFile(/* turbopackIgnore: true */ resolve(localDir(), id));
    return new Blob([new Uint8Array(bytes)]).stream();
  },
  async remove(id) {
    await rm(resolve(localDir(), id), { force: true });
  },
};

function r2Storage(): PrivateStorage | null {
  const account = process.env.STOCKPACT_R2_ACCOUNT_ID;
  const bucket = process.env.STOCKPACT_R2_BUCKET;
  const accessKeyId = process.env.STOCKPACT_R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.STOCKPACT_R2_SECRET_ACCESS_KEY;
  if (!account || !bucket || !accessKeyId || !secretAccessKey) return null;
  if (!/^[a-f0-9]{32}$/i.test(account) || !/^[a-z0-9-]{3,63}$/.test(bucket)) return null;

  const client = new AwsClient({ service: "s3", region: "auto", accessKeyId, secretAccessKey, retries: 1 });
  const url = (id: string) => "https://" + account + ".r2.cloudflarestorage.com/" + bucket + "/orders/" + id;
  const request = async (id: string, method: string, bytes?: ArrayBuffer, type?: string) => {
    const response = await client.fetch(url(id), {
      method, body: bytes,
      headers: type ? { "Content-Type": type } : undefined,
      signal: AbortSignal.timeout(12000),
      cache: "no-store",
    });
    if (!response.ok) throw new Error("Private storage request failed");
    return response;
  };
  return {
    async put(id, bytes, type) { await request(id, "PUT", bytes, type); },
    async open(id) {
      const response = await request(id, "GET");
      if (!response.body) throw new Error("Stored object is empty");
      return response.body;
    },
    async remove(id) { await request(id, "DELETE"); },
  };
}

export function selectStorage(demo: boolean, kind?: StorageKind) {
  const localConfigured = process.env.STOCKPACT_STORAGE_MODE === "local" && !!process.env.STOCKPACT_FILE_PATH;
  if (kind === "r2" || (kind === undefined && !localConfigured)) {
    const provider = r2Storage();
    if (provider) return { kind: "r2" as const, provider };
    if (kind === "r2") return null;
  }
  return demo || localConfigured ? { kind: "local" as const, provider: localStorage } : null;
}
