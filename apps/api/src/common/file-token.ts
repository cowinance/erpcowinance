import * as jwt from 'jsonwebtoken';
import { JWT_ISSUER, JWT_SECRET } from '../modules/auth/auth.service';

/**
 * URL firmada para servir archivos (equivalente dev de una signed URL de S3):
 * el token porta el archivo, su tenant y su mime, con vencimiento corto. El
 * endpoint de servido lo valida sin tocar la base (no necesita contexto de
 * tenant) — el path se deriva del token, aislado por tenant.
 */
export interface FileTokenClaims {
  fid: string;
  ten: string;
  mime: string;
}

export function signFileToken(fileId: string, tenantId: string, mime: string): string {
  return jwt.sign({ fid: fileId, ten: tenantId, mime, typ: 'file' }, JWT_SECRET, {
    issuer: JWT_ISSUER,
    expiresIn: '6h',
  });
}

export function verifyFileToken(token: string): FileTokenClaims | null {
  try {
    const p = jwt.verify(token, JWT_SECRET, { issuer: JWT_ISSUER }) as any;
    if (p.typ !== 'file') return null;
    return { fid: p.fid, ten: p.ten, mime: p.mime };
  } catch {
    return null;
  }
}
