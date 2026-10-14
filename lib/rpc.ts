/**
 * Minimal Solana JSON-RPC over fetch. It asks for maxSupportedTransactionVersion 1 and reads
 * the JSON itself, so it handles every transaction version. Read-only: nothing here signs.
 */
export type Commitment = "confirmed" | "finalized";

export interface RpcTransaction {
  slot: number;
  blockTime: number | null;
  transaction: { signatures: string[]; message: { accountKeys: string[] } };
  meta: {
    err: unknown;
    fee: number;
    preBalances: number[];
    postBalances: number[];
    loadedAddresses?: { writable: string[]; readonly: string[] };
  } | null;
}

export interface SignatureInfo {
  signature: string;
  slot: number;
  err: unknown;
}

export class Rpc {
  private id = 0;
  readonly url: string;
  constructor(url: string) {
    // Dashboard pastes often carry spaces, a newline or quotes; any of them breaks the api-key.
    this.url = url.trim().replace(/^["']|["']$/g, "");
  }

  /** Where a failing request went, without the key: host, path and api-key length. */
  private describe(): string {
    try {
      const u = new URL(this.url);
      const key = u.searchParams.get("api-key");
      return `${u.host}${u.pathname}${key === null ? " (no api-key)" : ` (api-key ${key.length} chars)`}`;
    } catch {
      return "an invalid URL";
    }
  }

  async call<T>(method: string, params: unknown[]): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(this.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: ++this.id, method, params }),
      });
      if (res.status === 429 && attempt < 5) {
        await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
        continue;
      }
      if (!res.ok) {
        throw new Error(`${method}: RPC answered HTTP ${res.status} from ${this.describe()} (check RPC_URL)`);
      }
      const body = (await res.json()) as { result?: T; error?: { message: string } };
      if (body.error) throw new Error(`${method}: ${body.error.message}`);
      return body.result as T;
    }
  }

  getTransaction(signature: string, commitment: Commitment = "finalized") {
    return this.call<RpcTransaction | null>("getTransaction", [
      signature,
      { encoding: "json", maxSupportedTransactionVersion: 1, commitment },
    ]);
  }

  /** Signatures newer than `until`, oldest first, reading at most `maxPages` pages of 1,000. */
  async signaturesSince(
    address: string,
    until?: string,
    maxPages = Infinity,
    commitment: Commitment = "finalized",
  ): Promise<SignatureInfo[]> {
    const out: SignatureInfo[] = [];
    let before: string | undefined;
    for (let n = 0; n < maxPages; n++) {
      const page = await this.call<SignatureInfo[]>("getSignaturesForAddress", [
        address,
        { limit: 1000, until, before, commitment },
      ]);
      out.push(...page);
      if (page.length < 1000) break;
      before = page[page.length - 1]!.signature;
    }
    return out.reverse();
  }

  /** Balance with the slot it was read at. */
  async balance(address: string, commitment: Commitment = "finalized") {
    const r = await this.call<{ context: { slot: number }; value: number }>("getBalance", [
      address,
      { commitment },
    ]);
    return { lamports: BigInt(r.value), slot: r.context.slot };
  }
}

export type ChainRpc = Pick<Rpc, "signaturesSince" | "getTransaction" | "balance">;
