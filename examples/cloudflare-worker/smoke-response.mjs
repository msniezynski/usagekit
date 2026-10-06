export async function readSmokeResponse(response, requestLabel) {
  const text = await response.text();
  try {
    return { status: response.status, body: JSON.parse(text) };
  } catch (cause) {
    throw new Error(
      `Cloudflare smoke ${requestLabel}: HTTP ${response.status}; expected JSON, received ${text.slice(0, 500)}`,
      { cause },
    );
  }
}
