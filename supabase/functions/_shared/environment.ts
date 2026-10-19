export function assertLocalSandboxDatabase(value: string) {
  const url = new URL(value);
  const localHost = ['kong', 'localhost', '127.0.0.1'].includes(url.hostname) ||
    /^supabase_kong_[a-z0-9_-]+$/.test(url.hostname);
  if (url.protocol !== 'http:' || !localHost || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) {
    throw new Error('Sandbox refused a non-local database URL.');
  }
}
