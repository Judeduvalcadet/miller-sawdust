import { service, verifyAccessToken } from './mod.ts';
// Sensitive operations also verify the current account, not only old JWT claims.
export async function quickBooksOffice(req: Request) {
  const claims = await verifyAccessToken(req);
  if (!claims || claims.amr !== 'password' || !['admin','assistant'].includes(String(claims.app_role))) return null;
  const {data,error} = await service.from('drivers').select('id,role,active').eq('id',String(claims.sub)).maybeSingle();
  if (error || !data?.active || !['admin','assistant'].includes(data.role)) return null;
  return claims;
}
