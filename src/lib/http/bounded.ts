/** Raised when an upstream body exceeds its cap. Carries no body content or destination. */
export class ResponseTooLargeError extends Error {
  constructor() { super("Upstream response is too large"); }
}

/**
 * Reads at most `maxBytes` of a response body. A declared Content-Length over the cap is
 * rejected before reading; the stream is cancelled as soon as the running total passes it,
 * so a server that lies about or omits the length still cannot exhaust memory.
 */
export async function readBoundedText(response: Response, maxBytes: number): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel();
    throw new ResponseTooLargeError();
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        throw new ResponseTooLargeError();
      }
      chunks.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  // TextDecoder drops a leading UTF-8 BOM, matching Response.text() and Response.json().
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/** Bounded JSON read. An empty body is `null`; invalid JSON throws SyntaxError. */
export async function readBoundedJson(response: Response, maxBytes: number): Promise<unknown> {
  const text = await readBoundedText(response, maxBytes);
  return text ? JSON.parse(text) : null;
}
