// Local test-only crypto adapter; never writes decrypted credentials to reports.
import {readFileSync} from 'node:fs';
import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
const config=JSON.parse(readFileSync('supabase/functions/.env.qb-vault.local','utf8'));
const keys=JSON.parse(config.QB_TOKEN_KEYS);
export function sealTestValue(value,column){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',Buffer.from(keys[config.QB_TOKEN_KEY_ID],'base64'),iv);cipher.setAAD(Buffer.from(config.QB_INSTALLATION_ID+':'+column));const body=Buffer.concat([cipher.update(value,'utf8'),cipher.final(),cipher.getAuthTag()]);return ['jv1',config.QB_TOKEN_KEY_ID,iv.toString('base64'),body.toString('base64')].join('.');}
export function decodeTestConnection(row){const output={...row};for(const name of ['access_token','refresh_token','realm_id']){const [version,id,iv,data]=String(row[name]).split('.');if(version!=='jv1')throw new Error('Test requires encrypted storage.');const raw=Buffer.from(data,'base64'),decipher=createDecipheriv('aes-256-gcm',Buffer.from(keys[id],'base64'),Buffer.from(iv,'base64'));decipher.setAAD(Buffer.from(config.QB_INSTALLATION_ID+':'+name));decipher.setAuthTag(raw.subarray(-16));output[name]=Buffer.concat([decipher.update(raw.subarray(0,-16)),decipher.final()]).toString();}return output;}
