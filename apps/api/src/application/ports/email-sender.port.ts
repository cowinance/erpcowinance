/**
 * Puerto de salida de la capa de aplicación (ADR-0011, sigue el patrón de
 * ADR-0005): "enviá este email". Los servicios de aplicación (identity)
 * dependen SOLO de esta interfaz — no conocen el proveedor. El adaptador de dev
 * imprime al log; SMTP/SES/Resend serán adaptadores futuros en `infra/email/`,
 * sin tocar este puerto ni sus emisores (mismo principio que el transporte de
 * eventos detrás de `EventPublisher`).
 */
export const EMAIL_SENDER = Symbol('EMAIL_SENDER');

export interface EmailMessage {
  to: string;
  subject: string;
  /** Cuerpo en texto plano. Plantillas/HTML son evolución futura del adaptador. */
  text: string;
}

export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}
