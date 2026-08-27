import { Router, type IRouter } from "express";

const router: IRouter = Router();

const SARVAM_CHAT_ENDPOINT = "https://api.sarvam.ai/v1/chat/completions";

const extractionSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    events: {
      type: "array",
      minItems: 1,
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          customer_name: {
            type: ["string", "null"],
          },
          amount: {
            type: ["number", "null"],
          },
          amount_type: {
            type: ["string", "null"],
            enum: ["received", "promised", "outstanding", null],
          },
          promise_date: {
            type: ["string", "null"],
          },
          notes: {
            type: ["string", "null"],
          },
        },
        required: [
          "customer_name",
          "amount",
          "amount_type",
          "promise_date",
          "notes",
        ],
      },
    },
  },
  required: ["events"],
};

router.post("/extract", async (req, res) => {
  const apiKey = process.env.SARVAM_API_KEY;

  if (!apiKey) {
    req.log.error("SARVAM_API_KEY is not configured");
    res.status(500).json({
      error: "Sarvam API key is not configured",
    });
    return;
  }

  const transcript =
    typeof req.body?.transcript === "string"
      ? req.body.transcript.trim()
      : "";

  if (!transcript) {
    res.status(400).json({
      error: "A transcript is required",
    });
    return;
  }

  const systemPrompt = `
You extract financial events from a business owner's natural voice note.

The transcript may be in Hindi, Hinglish, or English.

IMPORTANT:
A single transcript may contain multiple financial events.

Return an "events" array containing every distinct financial event.
Return between 1 and 3 events.
Always return an array, even when there is only one event.

Supported event types:

1. "received"
   The customer actually paid money.
   Examples:
   - "paid 3000"
   - "teen hazaar diya"
   - "payment mil gaya"

2. "outstanding"
   The customer bought something on credit or owes money.
   Examples:
   - "bought goods worth 5000 on credit"
   - "5000 ka saaman liya"
   - "5000 udhar liya"
   - "5000 baaki hai"

3. "promised"
   The customer said they will pay later.
   Examples:
   - "will pay 3000 Monday"
   - "Monday ko dega"
   - "Friday tak paisa dega"
   CUSTOMER NAME FORMAT:
Always return customer_name using Latin/English script.

If the transcript contains a Hindi/Devanagari customer name,
transliterate it into Latin/English script.

Examples:
- "रमेश" → "Ramesh"
- "शर्मा" → "Sharma"
- "सुरेश" → "Suresh"

Do not return Devanagari customer names.
Preserve the actual name; do not translate it into a different name.

Each event must contain:

- customer_name: customer name, or null
- amount: numeric amount, or null
- amount_type: received, promised, outstanding, or null
- promise_date: date expression if relevant, otherwise null
- notes: useful context, otherwise null

IMPORTANT CUSTOMER RULE:
The transcript contains only ONE customer.
If the customer name is mentioned once, apply that same customer to later
events referring to that same person.

IMPORTANT EVENT RULE:
Do NOT merge separate financial events.

For example:

"Sharma ne teen hazaar diya, do hazaar ka naya saamaan liya,
aur bola baaki paisa Monday tak dega."

must produce THREE events:

1. received ₹3000
2. outstanding ₹2000
3. promised, date Monday

If a promise does not explicitly state its amount, return amount as null.
Do not invent or calculate an amount.

Do not invent customer names, amounts, dates, or transaction types.

Convert spoken amounts into numbers:
- "teen hazaar" → 3000
- "do hazaar" → 2000
- "pachaas hazaar" → 50000
- "50k" → 50000
- "2 lakh" → 200000

Understand natural Hindi, Hinglish, and English.

Return ONLY the structured JSON object.
`;

  try {
    const response = await fetch(SARVAM_CHAT_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-subscription-key": apiKey,
      },
      body: JSON.stringify({
        model: "sarvam-105b",
        messages: [
          {
            role: "system",
            content: systemPrompt,
          },
          {
            role: "user",
            content: transcript,
          },
        ],
        temperature: 0,
        reasoning_effort: null,
        max_tokens: 800,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "payment_extraction",
            strict: true,
            schema: extractionSchema,
          },
        },
      }),
    });

    const data = (await response.json()) as {
      choices?: Array<{
        message?: {
          content?: string;
        };
      }>;
      error?: unknown;
      message?: unknown;
    };

    if (!response.ok) {
      req.log.error(
        {
          statusCode: response.status,
          providerResponse: data,
        },
        "Sarvam extraction failed",
      );

      res.status(502).json({
        error: "Sarvam extraction failed",
      });
      return;
    }

    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      res.status(502).json({
        error: "Sarvam returned no extraction result",
      });
      return;
    }

    let extracted: unknown;

    try {
      extracted = JSON.parse(content);
    } catch {
      req.log.error(
        { content },
        "Sarvam returned invalid JSON for extraction",
      );

      res.status(502).json({
        error: "Sarvam returned invalid structured data",
      });
      return;
    }

    res.json(extracted);
  } catch (error) {
    req.log.error(
      { err: error },
      "Could not reach Sarvam extraction API",
    );

    res.status(502).json({
      error: "Could not reach Sarvam extraction API",
    });
  }
});

export default router;
