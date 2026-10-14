import { describe, expect, it } from "vitest";
import { DEFAULT_SENTINEL, addressChange, expectedBalance, flag, lamportsToSol } from "./sentinel";
import type { RpcTransaction } from "./rpc";

const A = "TreasuryAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const B = "VaultBbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const C = "StrangerCccccccccccccccccccccccccccccccccc";

const tx = (keys: string[], pre: number[], post: number[], fee = 5000): RpcTransaction => ({
  slot: 1,
  blockTime: null,
  transaction: { signatures: ["s"], message: { accountKeys: keys } },
  meta: { err: null, fee, preBalances: pre, postBalances: post },
});

describe("sentinel pure pieces", () => {
  it("addressChange finds counterparties on the other side", () => {
    const t = tx([A, B], [100000, 0], [85000, 10000]);
    const r = addressChange(t, A)!;
    expect(r.feePayer).toBe(true);
    expect(r.counterparties).toEqual([B]);
    expect(addressChange(t, C)).toBeNull();
  });

  it("expectedBalance starts from the first transaction within the first slot", () => {
    const row = (slot: number, pre: bigint, post: bigint) => ({
      slot,
      preLamports: pre,
      postLamports: post,
    });
    // Same slot, stored out of order: 100 -> 60, then 60 -> 90.
    const rows = [row(5, 60n, 90n), row(5, 100n, 60n)];
    expect(expectedBalance(rows, 5)!.expected).toBe(90n);
    expect(expectedBalance(rows, 4)).toBeNull();
  });

  it("flags an outflow that hides behind one known receiver", () => {
    const known = new Set([A, B]);
    const toKnown = addressChange(tx([A, B], [10_000_000, 0], [4_995_000, 5_000_000]), A)!;
    expect(flag(toKnown, known, DEFAULT_SENTINEL)).toEqual([]);
    const split = addressChange(
      tx([A, B, C], [10_000_000, 0, 0], [995_000, 1, 8_999_999]),
      A,
    )!;
    expect(flag(split, known, DEFAULT_SENTINEL).map((f) => f.kind)).toEqual(["unknown_outflow"]);
  });

  it("the fee alone is not a movement; large movements are flagged", () => {
    const feeOnly = addressChange(tx([A], [10_000], [5_000]), A)!;
    expect(flag(feeOnly, new Set([A]), DEFAULT_SENTINEL)).toEqual([]);
    const big = addressChange(tx([B, A], [3e9, 0], [1e9 - 5000, 2e9], 5000), A)!;
    expect(flag(big, new Set([A, B]), DEFAULT_SENTINEL).map((f) => f.kind)).toEqual([
      "large_movement",
    ]);
  });

  it("lamportsToSol prints exact decimals", () => {
    expect(lamportsToSol(1_500_000_000n)).toBe("1.5");
    expect(lamportsToSol(-5000n)).toBe("-0.000005");
  });
});

describe("rpc url", () => {
  it("strips pasted whitespace and quotes", async () => {
    const { Rpc } = await import("./rpc");
    expect(new Rpc(' "https://mainnet.helius-rpc.com/?api-key=abc"\n').url).toBe(
      "https://mainnet.helius-rpc.com/?api-key=abc",
    );
  });
});
