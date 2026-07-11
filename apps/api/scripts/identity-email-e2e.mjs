/**
 * E2E de email transaccional: verificación de email y reset de contraseña
 * (P1.2, ADR-0011). Caja negra HTTP, más la lectura del "buzón" de desarrollo:
 * el adaptador `log` imprime cada email (con su link+token) al log del servidor,
 * y este script lo lee de `SERVER_LOG` para extraer el token — igual que un
 * usuario leería su correo.
 *
 * Cubre:
 *  - Verificación: register emite email → verify (single-use, purpose) → estado.
 *  - Reenvío: anti-enumeración (constante), no reenvía a verificados/inexistentes.
 *  - Reset: forgot (anti-enumeración) → reset (valida antes de consumir) →
 *    contraseña vieja inválida / nueva válida → token single-use →
 *    sesiones revocadas.
 *
 *   API_URL=http://localhost:3097/v1 \
 *   SERVER_LOG=/ruta/al/server.log \
 *   node apps/api/scripts/identity-email-e2e.mjs
 */
import { readFileSync } from 'node:fs';

const API = process.env.API_URL ?? 'http://localhost:3001/v1';
const SERVER_LOG = process.env.SERVER_LOG;
const RUN = Date.now().toString(36);

if (!SERVER_LOG) {
  console.error('Falta SERVER_LOG (ruta al log del servidor, buzón del adaptador de email en dev).');
  process.exit(2);
}

async function api(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures++;
};

/** Cuenta cuántos emails se enviaron a `addr` (líneas "EMAIL → addr"). */
function emailsTo(addr) {
  const log = readFileSync(SERVER_LOG, 'utf8');
  return (log.match(new RegExp(`EMAIL → ${addr.replace(/[.+]/g, '\\$&')} `, 'g')) ?? []).length;
}

/** Último token enviado a `addr` para `kind` ('verify-email' | 'reset-password'). */
function lastToken(addr, kind) {
  const lines = readFileSync(SERVER_LOG, 'utf8').split('\n');
  let recipient = null;
  const found = {};
  const emailRe = /EMAIL → (\S+@\S+?) /;
  const tokenRe = /(verify-email|reset-password)\?token=([A-Za-z0-9_-]+)/;
  for (const line of lines) {
    const e = line.match(emailRe);
    if (e) recipient = e[1];
    const t = line.match(tokenRe);
    if (t && recipient) (found[recipient] ??= {})[t[1]] = t[2];
  }
  return found[addr]?.[kind] ?? null;
}

const emailA = `ver+${RUN}@finca.test`;
const emailB = `res+${RUN}@finca.test`;
const emailC = `ses+${RUN}@finca.test`;

async function register(email, password) {
  return api('POST', '/register', {
    email, password, full_name: 'Test', organization_name: `Org ${RUN}`,
    farm_name: 'Finca', country_code: 'AR',
  });
}

async function main() {
  console.log('── E2E email: verificación + reset (P1.2) ──');

  // ── Verificación de email ──────────────────────────────────────────────
  await register(emailA, 'origPass12');
  await new Promise((r) => setTimeout(r, 300)); // dar tiempo al envío best-effort
  check('register dispara email de verificación', emailsTo(emailA) === 1, `${emailsTo(emailA)} emails`);
  const vtok = lastToken(emailA, 'verify-email');
  check('el email trae un token de verificación', !!vtok);

  const badVerify = await api('POST', '/verify-email', { token: 'no-existe' });
  check('verify-email token inválido → 400', badVerify.status === 400, badVerify.json?.code);
  const okVerify = await api('POST', '/verify-email', { token: vtok });
  check('verify-email token real → verified', okVerify.json?.verified === true, `status=${okVerify.status}`);
  const reuseVerify = await api('POST', '/verify-email', { token: vtok });
  check('reuso del token de verificación → 400 (single-use)', reuseVerify.status === 400);

  // ── Reenvío de verificación (anti-enumeración) ─────────────────────────
  const beforeResendA = emailsTo(emailA);
  const resendVerified = await api('POST', '/resend-verification', { email: emailA });
  check('resend a verificado → 200 constante', resendVerified.status === 201, `status=${resendVerified.status}`);
  const resendUnknown = await api('POST', '/resend-verification', { email: `nadie+${RUN}@x.test` });
  check('resend a inexistente → 200 constante', resendUnknown.status === 201);
  await new Promise((r) => setTimeout(r, 200));
  check('resend NO reenvía a verificado ni a inexistente', emailsTo(emailA) === beforeResendA, `emails A = ${emailsTo(emailA)}`);

  await register(emailB, 'origPass12');
  await new Promise((r) => setTimeout(r, 300));
  const resendUnverified = await api('POST', '/resend-verification', { email: emailB });
  check('resend a no-verificado → 200', resendUnverified.status === 201);
  await new Promise((r) => setTimeout(r, 200));
  check('resend a no-verificado SÍ reenvía (2 emails)', emailsTo(emailB) === 2, `emails B = ${emailsTo(emailB)}`);
  const btok = lastToken(emailB, 'verify-email');
  const verifyB = await api('POST', '/verify-email', { token: btok });
  check('el token reenviado verifica', verifyB.json?.verified === true);

  // ── Reset de contraseña ────────────────────────────────────────────────
  // Sesión viva ANTES del reset (para probar revocación)
  const preLogin = (await api('POST', '/auth/login', { email: emailA, password: 'origPass12' })).json;
  check('login previo al reset OK', !!preLogin?.refresh_token);

  const forgotOk = await api('POST', '/forgot-password', { email: emailA });
  check('forgot-password existente → 200 constante', forgotOk.status === 201);
  const forgotUnknown = await api('POST', '/forgot-password', { email: `nadie2+${RUN}@x.test` });
  check('forgot-password inexistente → 200 constante', forgotUnknown.status === 201);
  await new Promise((r) => setTimeout(r, 300));
  const rtok = lastToken(emailA, 'reset-password');
  check('llega el token de reset', !!rtok);

  const weak = await api('POST', '/reset-password', { token: rtok, new_password: '123' });
  check('reset con contraseña débil → 400 (no quema el token)', weak.status === 400, weak.json?.code);
  const reset = await api('POST', '/reset-password', { token: rtok, new_password: 'nuevaPass9' });
  check('reset con token válido + contraseña fuerte → 200', reset.status === 201, `status=${reset.status}`);

  const oldPass = await api('POST', '/auth/login', { email: emailA, password: 'origPass12' });
  check('login con contraseña vieja → 401', oldPass.status === 401);
  const newPass = await api('POST', '/auth/login', { email: emailA, password: 'nuevaPass9' });
  check('login con contraseña nueva → OK', !!newPass.json?.access_token);
  const reuseReset = await api('POST', '/reset-password', { token: rtok, new_password: 'otraPass99' });
  check('reuso del token de reset → 400 (single-use)', reuseReset.status === 400);
  const revoked = await api('POST', '/auth/refresh', { refresh_token: preLogin.refresh_token });
  check('sesión previa al reset quedó revocada → 401', revoked.status === 401);

  // ── Revocación en una segunda sesión (emailC, aislado) ─────────────────
  await register(emailC, 'origPass12');
  const sesLogin = (await api('POST', '/auth/login', { email: emailC, password: 'origPass12' })).json;
  await api('POST', '/forgot-password', { email: emailC });
  await new Promise((r) => setTimeout(r, 300));
  const ctok = lastToken(emailC, 'reset-password');
  await api('POST', '/reset-password', { token: ctok, new_password: 'cambiada12' });
  const cRevoked = await api('POST', '/auth/refresh', { refresh_token: sesLogin.refresh_token });
  check('reset revoca TODAS las sesiones del usuario', cRevoked.status === 401);

  console.log(failures === 0 ? '\nE2E email: TODO OK ✓' : `\nE2E email: ${failures} fallas ✗`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error('E2E error:', e.message);
  process.exit(1);
});
