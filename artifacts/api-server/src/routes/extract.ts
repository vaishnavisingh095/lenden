import { Router, type IRouter } from "express";

const router: IRouter = Router();

const SARVAM_CHAT_ENDPOINT = "https://api.sarvam.ai/v1/chat/completions";

const extractionSchema = {
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
You extract structured payment information from a business owner's voice note.

The transcript may be in Hindi, English, or Hinglish.

Extract exactly these fields:

- customer_name: the customer's name, or null
- amount: numeric payment amount, or null
- amount_type: exactly one of "received", "promised", "outstanding", or null
- promise_date: natural-language date such as "Friday", "next Monday", or null
- notes: other relevant payment context, or null

Rules:
1. Do not guess or invent information.
2. If a field is not clearly mentioned, return null.
3. Convert spoken/natural amounts into numbers where possible.
   Example: "चार हजार" → 4000.
4. "दे चुका है", "मिल गया", "paid", etc. means "received".
5. "देगा", "बाद में देगा", "Friday ko dega", etc. means "promised".
6. "बाकी है", "बाकी ₹5000", "outstanding", etc. means "outstanding".
7. Return only the requested structured object.
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
        max_tokens: 500,
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
