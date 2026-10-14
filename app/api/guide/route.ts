import { z } from "zod";
import { isCrisis } from "@/lib/crisis";
import { MILES, search } from "@/lib/finder";
import { guide } from "@/lib/guide";
import { limited } from "@/lib/http";

// The Guide: the person's words go to the model once and are never logged or stored.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Body = z.object({ text: z.string().trim().min(2).max(600) });

export async function POST(req: Request) {
  if (limited(req, 6)) return Response.json({ error: "Too many messages. Try again in a minute, or use the search form." }, { status: 429 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Write a little about what you're looking for (up to 600 characters)." }, { status: 400 });
  const { text } = parsed.data;

  // Deterministic check first: crisis lines never wait on a model.
  if (isCrisis(text)) return Response.json({ crisis: true });

  let out;
  try {
    out = await guide(text);
  } catch (e) {
    // Error type and status only: never the person's words.
    const status = (e as { status?: number }).status;
    console.error("guide failed", (e as Error).name, status ?? "", status === undefined ? (e as Error).message : "");
    return Response.json({ error: "The guide is unavailable right now. Use the search form below." }, { status: 502 });
  }
  if (!out) return Response.json({ error: "The guide couldn't help with that. Use the search form below." }, { status: 200 });
  if (out.crisis) return Response.json({ crisis: true });

  const filters = { zip: out.zip, care: out.care, pay: out.pay, miles: MILES[1] };
  if (!out.zip || !/^\d{5}$/.test(out.zip)) return Response.json({ reply: out.reply, filters, results: null });
  try {
    const results = await search({ ...filters, zip: out.zip });
    return Response.json({ reply: out.reply, filters, results });
  } catch {
    return Response.json({ reply: out.reply, filters, results: null, error: "The treatment locator is not answering. Try again soon." });
  }
}
