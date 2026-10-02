import { resetBrowserOnce } from '@/lib/browserReset'

// Auth modules must not initialize until the one-time reset has completed.
async function boot() {
  if (await resetBrowserOnce()) return;
  await import('./renderApp.jsx');
}
boot().catch(() => {
  document.getElementById('root').textContent = 'Unable to open the app. Please allow site storage, then refresh this page.';
});
