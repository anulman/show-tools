export async function readEvents(response: Response, onEvent: (event: unknown) => void | Promise<void>, signal?: AbortSignal): Promise<void> {
  if (!response.ok || !response.body) throw new Error(`Relay stream failed (${response.status})`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (!signal?.aborted) {
      const { done, value } = await reader.read();
      if (done) throw new Error('Relay stream closed');
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
      if (buffer.length > 262144) throw new Error('Relay frame is too large');
      let end;
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const data = block.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
        if (data) { const value: unknown = JSON.parse(data); await onEvent(value); }
      }
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
