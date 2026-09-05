import { BaseAgent } from "./base.js";

/**
 * A picture book, written the way one is actually made: the pictures first.
 *
 * A spread is the unit of everything here — the words a child hears, the
 * picture they look at while hearing them, and the page turn at the end that
 * decides whether they ask for it again. Writing the prose first and
 * illustrating it afterwards is how you get a book whose pictures repeat what
 * the words already said, so the plan commits to what each spread *shows*
 * before anything commits to what it says.
 */
export interface SpreadPlan {
  readonly spread: number;
  /** What happens on this spread, in one sentence. */
  readonly beat: string;
  /** What the picture shows. Written for an illustrator, not a reader. */
  readonly art: string;
}

export interface SpreadText {
  /** The words on the spread. */
  readonly text: string;
  /** The art note, refined against the words that ended up on the page. */
  readonly art: string;
}

/**
 * Pull the first JSON value out of a reply.
 *
 * Models fence JSON, preface it, or apologise before it, and a bare
 * `JSON.parse` on the whole reply fails on all three. Cheaper than a retry
 * loop and it fails loudly when there is genuinely nothing there.
 */
function firstJson<T>(reply: string): T {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(reply);
  const body = fenced?.[1] ?? reply;
  const start = body.search(/[[{]/);
  if (start < 0) throw new Error(`no JSON in the reply: ${reply.slice(0, 200)}`);
  const opener = body[start];
  const closer = opener === "[" ? "]" : "}";
  const end = body.lastIndexOf(closer);
  if (end <= start) throw new Error(`unterminated JSON in the reply: ${reply.slice(0, 200)}`);
  return JSON.parse(body.slice(start, end + 1)) as T;
}

export class StorybookAgent extends BaseAgent {
  get name(): string {
    return "storybook";
  }

  /**
   * Break a brief into exactly the number of spreads the book has.
   *
   * The count is not a suggestion the model may round: a picture book is
   * printed on folded signatures, so 12 spreads is a physical fact about the
   * object and 13 is a different, more expensive book. Short of the count the
   * run would sit forever waiting for a spread nobody planned, so the list is
   * padded and trimmed here rather than trusted.
   */
  async planSpreads(input: {
    readonly title: string;
    readonly brief: string;
    readonly audience: string;
    readonly spreads: number;
  }): Promise<ReadonlyArray<SpreadPlan>> {
    const reply = await this.chat([
      {
        role: "system",
        content: "You are a picture-book editor. You answer with JSON and nothing else.",
      },
      {
        role: "user",
        content: [
          `Plan a picture book called "${input.title}" for ${input.audience}.`,
          "",
          `Brief: ${input.brief}`,
          "",
          `It has exactly ${input.spreads} spreads. Spread 1 opens, the last one closes.`,
          "Every spread must turn: something changes on it, so a child wants the page over.",
          "The art note says what the picture shows and must not repeat the beat in other words.",
          "",
          `Answer with a JSON array of ${input.spreads} objects:`,
          `[{"spread": 1, "beat": "...", "art": "..."}]`,
        ].join("\n"),
      },
    ], { temperature: 0.8 });

    const raw = firstJson<Array<Partial<SpreadPlan>>>(reply.content);
    const out: SpreadPlan[] = [];
    for (let n = 1; n <= input.spreads; n += 1) {
      const found = raw.find((s) => Number(s.spread) === n) ?? raw[n - 1];
      out.push({
        spread: n,
        beat: String(found?.beat ?? "").trim() || `Spread ${n}`,
        art: String(found?.art ?? "").trim() || "No art note was written for this spread.",
      });
    }
    return out;
  }

  /**
   * Write one spread.
   *
   * Given what came before, because a picture book is read aloud in one sitting
   * and a spread written without the previous one repeats its rhythm exactly.
   */
  async writeSpread(input: {
    readonly title: string;
    readonly audience: string;
    readonly plan: SpreadPlan;
    readonly total: number;
    readonly before?: string;
  }): Promise<SpreadText> {
    const reply = await this.chat([
      {
        role: "system",
        content: "You are a picture-book author. You answer with JSON and nothing else.",
      },
      {
        role: "user",
        content: [
          `Book: "${input.title}", for ${input.audience}.`,
          `Spread ${input.plan.spread} of ${input.total}.`,
          "",
          `What happens: ${input.plan.beat}`,
          `What the picture shows: ${input.plan.art}`,
          ...(input.before ? ["", `The spread before said: ${input.before}`] : []),
          "",
          "Write the words on this spread. Read aloud they take about fifteen seconds:",
          "roughly 20 to 50 words. Do not describe the picture — it is beside the words.",
          "Then give the art note, sharpened against the words you actually wrote.",
          "",
          `Answer as JSON: {"text": "...", "art": "..."}`,
        ].join("\n"),
      },
    ], { temperature: 0.9 });

    const parsed = firstJson<Partial<SpreadText>>(reply.content);
    const text = String(parsed.text ?? "").trim();
    if (!text) throw new Error(`spread ${input.plan.spread} came back with no words`);
    return { text, art: String(parsed.art ?? input.plan.art).trim() };
  }
}
