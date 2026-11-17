import { getAccessToken } from './authClient';
export const assistantDev = import.meta.env.VITE_ASSISTANT_DEV === 'true' || import.meta.env.MODE === 'sandbox';
export async function assistantRequest(body, onProgress) {
  const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${assistantDev ? 'assistant-dev' : 'assistant'}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', apikey: import.meta.env.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${await getAccessToken()}` },
    body: JSON.stringify({ ...body, stream: !!onProgress }),
  });
  if (!response.ok || !onProgress) {
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Request failed');
    return { data };
  }
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let boundary;
      while ((boundary = buffer.indexOf('\n\n')) !== -1) {
        const block = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
        const event = block.match(/^event: (.+)$/m)?.[1];
        const raw = block.match(/^data: (.+)$/m)?.[1];
        if (!raw) continue;
        const data = JSON.parse(raw);
        if (event === 'progress') onProgress(data.label);
        if (event === 'error') throw new Error(data.error || 'Request failed');
        if (event === 'done') return { data };
      }
      if (done) throw new Error('The connection ended before the answer finished. Please retry.');
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
