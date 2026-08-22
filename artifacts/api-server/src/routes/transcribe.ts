import { Router, type IRouter, type Request } from "express";

const router: IRouter = Router();
const SARVAM_ENDPOINT = "https://api.sarvam.ai/speech-to-text";

type MultipartFile = {
  filename: string;
  contentType: string;
  data: Buffer;
};

function getBoundary(contentType: string): string | null {
  const match = contentType.match(/boundary="?([^";]+)"?/i);
  return match?.[1] ?? null;
}

function parseAudioPart(req: Request): MultipartFile | null {
  const contentType = req.headers["content-type"];
  if (!contentType || Array.isArray(contentType)) return null;

  const boundary = getBoundary(contentType);
  if (!boundary || !Buffer.isBuffer(req.body)) return null;

  const body = req.body as Buffer;
  const delimiter = Buffer.from(`--${boundary}`);
  const parts = [];
  let cursor = 0;

  while (true) {
    const start = body.indexOf(delimiter, cursor);
    if (start === -1) break;
    const next = body.indexOf(delimiter, start + delimiter.length);
    if (next === -1) break;
    parts.push(body.subarray(start + delimiter.length, next));
    cursor = next;
  }

  for (const part of parts) {
    const headerEnd = part.indexOf(Buffer.from("\r\n\r\n"));
    if (headerEnd === -1) continue;

    const headers = part.subarray(0, headerEnd).toString("utf8");
    const disposition = headers.match(
      /content-disposition:[^\r\n]*name="([^"]+)"[^\r\n]*filename="([^"]+)"/i,
    );
    if (!disposition || disposition[1] !== "file") continue;

    const content = part.subarray(headerEnd + 4, part.length - 2);
    const contentTypeMatch = headers.match(/content-type:\s*([^\r\n]+)/i);
    return {
      filename: disposition[2],
      contentType: contentTypeMatch?.[1]?.trim() || "audio/webm",
      data: content,
    };
  }

  return null;
}

router.post("/transcribe", async (req, res) => {
  const apiKey = process.env.SARVAM_API_KEY;
  if (!apiKey) {
    req.log.error("SARVAM_API_KEY is not configured");
    res.status(500).json({ error: "Sarvam API key is not configured" });
    return;
  }

  const audio = parseAudioPart(req);
  if (!audio || audio.data.length === 0) {
    res.status(400).json({ error: "An audio file is required" });
    return;
  }

  const form = new FormData();
  const audioBytes = new Uint8Array(audio.data.length);
  audioBytes.set(audio.data);
  form.append(
    "file",
    new Blob([audioBytes.buffer], { type: audio.contentType }),
    audio.filename,
  );
  form.append("model", "saaras:v3");
  form.append("mode", "transcribe");

  try {
    const response = await fetch(SARVAM_ENDPOINT, {
      method: "POST",
      headers: { "api-subscription-key": apiKey },
      body: form,
    });

    const data = (await response.json()) as {
      transcript?: string;
      language_code?: string | null;
      error?: string;
      message?: string;
    };

    if (!response.ok) {
      req.log.error(
        { statusCode: response.status, providerMessage: data.message },
        "Sarvam transcription failed",
      );
      res.status(502).json({
        error: data.message || data.error || "Sarvam transcription failed",
      });
      return;
    }

    res.json({
      transcript: data.transcript ?? "",
      language_code: data.language_code ?? null,
    });
  } catch (error) {
    req.log.error({ err: error }, "Could not reach Sarvam transcription API");
    res.status(502).json({ error: "Could not reach Sarvam transcription API" });
  }
});

export default router;