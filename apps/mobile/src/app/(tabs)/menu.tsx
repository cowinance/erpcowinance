import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSync, API_URL } from '@/sync/SyncContext';
import { useAccount } from '@/account/AccountContext';
import { Button, Card } from '@/components/ui';
import { activatePush } from '@/push/native';
import { pushStatusMessage, type PushRegistrationStatus } from '@/push/registration';
import { useStyles, useTheme, type Theme } from '@/useTheme';

/**
 * El rol en castellano. Se escribe acá y no viaja del servidor porque es una etiqueta de interfaz:
 * el contrato con la API son los códigos (`veterinarian`, `foreman`), y traducirlos del lado del
 * servidor obligaría a versionar textos de pantalla.
 */
const ROL_ES: Record<string, string> = {
  owner: 'Propietario',
  admin: 'Administrador',
  veterinarian: 'Veterinario',
  foreman: 'Capataz',
  worker: 'Operario',
  accountant: 'Contador',
};

export default function Menu() {
  const T = useTheme();
  const styles = useStyles(makeStyles);
  const sync = useSync();
  const account = useAccount();
  const unread = sync.unreadNotifications(); // misma fuente única que el badge de la tab
  const [confirmReset, setConfirmReset] = useState(false);
  const [resending, setResending] = useState(false);
  const [resendMsg, setResendMsg] = useState('');
  const [pushStatus, setPushStatus] = useState<PushRegistrationStatus>('idle');
  const [activating, setActivating] = useState(false);
  const [confirmFinca, setConfirmFinca] = useState<string | null>(null);
  const [cambiando, setCambiando] = useState(false);
  const [fincaMsg, setFincaMsg] = useState('');

  /**
   * Cambiar de finca pide confirmar, con el mismo doble toque que el borrado local — y por el mismo
   * motivo: descarta la base de este teléfono y vuelve a bajar la finca nueva entera. En el campo
   * eso son minutos y datos.
   */
  async function cambiarFinca(tenantId: string) {
    if (cambiando) return;
    if (confirmFinca !== tenantId) {
      setConfirmFinca(tenantId);
      setFincaMsg('');
      return;
    }
    setCambiando(true);
    const err = await sync.switchOrganization(tenantId);
    setCambiando(false);
    setConfirmFinca(null);
    setFincaMsg(err ?? '');
  }

  // Permiso CONTEXTUAL (D3): el prompt del SO solo se dispara por esta acción explícita del
  // usuario, nunca en boot ni al abrir /notificaciones. La obtención/sync del token es nativa.
  async function activateNotifications() {
    if (activating) return;
    setActivating(true);
    const status = await activatePush({
      hasServerDevice: () => !!sync.serverDeviceId,
      lastSyncedToken: () => sync.pushLastToken,
      syncToken: sync.syncPushToken,
    });
    setPushStatus(status);
    setActivating(false);
  }

  async function doResend() {
    if (resending) return;
    setResending(true);
    setResendMsg('');
    const result = await account.resendVerification();
    setResending(false);
    // Anti-enum: mensaje constante ante 'sent'; solo la red caída se distingue.
    setResendMsg(
      result === 'sent'
        ? 'Si tu email sigue sin verificar, te enviamos un nuevo enlace.'
        : 'No se pudo conectar. Probá de nuevo.',
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: T.canvas }}>
      <ScrollView contentContainerStyle={{ padding: T.space['4'], gap: T.space['3'] }}>
        <Text style={{ fontSize: T.type.title, fontWeight: '700', color: T.ink }}>Menú</Text>

        {/* Acceso al feed in_app (P7-4.c.2): abre /notificaciones; muestra el contador real o
            «Sin novedades». El badge de la tab y este contador salen de la misma fuente única. */}
        <Pressable
          onPress={() => router.push('/notificaciones')}
          accessibilityRole="button"
          accessibilityLabel={unread === 0 ? 'Notificaciones. Sin novedades' : `Notificaciones. ${unread} sin leer`}
          accessibilityHint="Abre el feed de notificaciones"
          style={({ pressed }) => [styles.notifRow, pressed && { backgroundColor: T.sunken }]}
        >
          <Ionicons name="notifications-outline" size={20} color={T.ink2} />
          <Text style={styles.notifLabel}>Notificaciones</Text>
          {unread === 0 ? (
            <Text style={styles.notifEmpty}>Sin novedades</Text>
          ) : (
            <View style={styles.notifBadge}>
              <Text style={styles.notifBadgeText}>{unread > 99 ? '99+' : unread}</Text>
            </View>
          )}
          <Ionicons name="chevron-forward" size={18} color={T.ink3} />
        </Pressable>

        <Card>
          <Text style={styles.title}>Usuario</Text>
          <Text style={styles.value}>{account.name ?? '—'}</Text>
          {account.email ? <Text style={styles.mono}>{account.email}</Text> : null}
          {account.role ? <Text style={[styles.value, { marginTop: T.space['0.5'] }]}>Rol: {account.role}</Text> : null}
          <Text style={[styles.title, { marginTop: T.space['3'] }]}>Finca</Text>
          <Text style={styles.value}>{sync.farmName ?? '—'}</Text>

          {/* Solo con MÁS DE UNA: una lista que ofrece la única opción posible promete algo que no
              cumple, y esta pantalla la abre todo el mundo. La lista viene persistida del login,
              así que se ve sin señal — que es donde se usa la app. */}
          {sync.organizations.length > 1 && (
            <View style={{ marginTop: T.space['2'], gap: T.space['1'] }}>
              {sync.organizations.map((o) => {
                const actual = o.tenant_id === sync.tenantId;
                const porConfirmar = confirmFinca === o.tenant_id;
                return (
                  <Pressable
                    key={o.tenant_id}
                    onPress={() => !actual && cambiarFinca(o.tenant_id)}
                    disabled={actual || cambiando}
                    accessibilityRole="button"
                    accessibilityState={{ selected: actual, disabled: actual || cambiando }}
                    accessibilityLabel={actual ? `${o.name}, finca actual` : `Cambiar a ${o.name}, entrás como ${ROL_ES[o.role] ?? o.role}`}
                    style={[styles.finca, porConfirmar && styles.fincaConfirm]}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.value, actual && { color: T.brand500 }]}>{o.name}</Text>
                      <Text style={styles.mono}>{ROL_ES[o.role] ?? o.role}</Text>
                    </View>
                    {actual ? (
                      <Ionicons name="checkmark-circle" size={20} color={T.brand500} />
                    ) : (
                      <Text style={[styles.mono, porConfirmar && { color: T.danger }]}>
                        {cambiando ? 'cambiando…' : porConfirmar ? '¿confirmar?' : 'cambiar'}
                      </Text>
                    )}
                  </Pressable>
                );
              })}
              {confirmFinca && !cambiando ? (
                <Text style={{ fontSize: T.type.label, color: T.ink3 }}>
                  Se borra la base de este teléfono y se descarga la otra finca. Necesitás señal.
                </Text>
              ) : null}
              {fincaMsg ? (
                <Text accessibilityRole="alert" style={{ fontSize: T.type.label, color: T.danger }}>
                  {fincaMsg}
                </Text>
              ) : null}
            </View>
          )}
          <Text style={[styles.title, { marginTop: T.space['3'] }]}>API</Text>
          <Text style={styles.mono}>{API_URL}</Text>
          <Text style={[styles.title, { marginTop: T.space['3'] }]}>Último sync</Text>
          <Text style={styles.value}>{sync.lastSyncAt ? new Date(sync.lastSyncAt).toLocaleString('es-AR') : 'nunca'}</Text>
          <Text style={[styles.title, { marginTop: T.space['3'] }]}>Almacenamiento local</Text>
          <Text style={styles.value}>{sync.storageEngine}</Text>
          <Text style={[styles.title, { marginTop: T.space['3'] }]}>Zona de la finca</Text>
          <Text style={styles.value}>{sync.farmTimeZone ?? 'la del dispositivo'}</Text>
        </Card>

        {account.emailVerified === false && (
          <Card>
            <Text style={styles.title}>Verificá tu email</Text>
            <Text style={{ fontSize: T.type.label, color: T.ink3, marginVertical: T.space['2'] }}>
              Te enviamos un enlace de verificación{account.email ? ` a ${account.email}` : ''}. El enlace se abre en la
              web, no dentro de la app. Podés seguir usando Cowinance mientras tanto.
            </Text>
            {resendMsg ? (
              <Text
                accessibilityRole={resendMsg.startsWith('No se pudo') ? 'alert' : 'text'}
                style={{ fontSize: T.type.label, marginBottom: T.space['2'], color: resendMsg.startsWith('No se pudo') ? T.danger : T.success }}
              >
                {resendMsg}
              </Text>
            ) : null}
            <View style={{ flexDirection: 'row', gap: T.space['2'] }}>
              <View style={{ flex: 1 }}>
                <Button
                  label={resending ? 'Enviando…' : 'Reenviar email'}
                  variant="secondary"
                  onPress={doResend}
                  disabled={resending}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Button
                  label={account.refreshing ? 'Actualizando…' : 'Ya verifiqué'}
                  onPress={() => account.refresh()}
                  disabled={account.refreshing}
                />
              </View>
            </View>
          </Card>
        )}

        <Card>
          <Text style={styles.title}>Notificaciones push</Text>
          <Text style={{ fontSize: T.type.label, color: T.ink3, marginVertical: T.space['2'] }}>
            Recibí avisos de retiros, vacunas y preñeces en este dispositivo. Pediremos permiso al
            sistema solo cuando toques el botón.
          </Text>
          {pushStatus !== 'idle' ? (
            <Text
              accessibilityRole={pushStatus === 'registered' ? 'text' : 'alert'}
              style={{ fontSize: T.type.label, marginBottom: T.space['2'], color: pushStatus === 'registered' ? T.success : T.warning }}
            >
              {pushStatusMessage(pushStatus)}
            </Text>
          ) : null}
          <Button
            label={activating ? 'Activando…' : pushStatus === 'registered' ? 'Notificaciones activadas ✓' : 'Activar notificaciones'}
            variant="secondary"
            onPress={activateNotifications}
            disabled={activating || pushStatus === 'registered'}
          />
        </Card>

        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ flex: 1, paddingRight: T.space['3'] }}>
              <Text style={styles.title}>Simular sin señal</Text>
              <Text style={{ fontSize: T.type.label, color: T.ink3, marginTop: T.space['0.5'] }}>
                Bloquea el transporte para probar la captura offline; los registros quedan en cola.
              </Text>
            </View>
            <Switch
              value={sync.offlineSim}
              onValueChange={sync.setOfflineSim}
              trackColor={{ true: T.brand500, false: T.borderStrong }}
            />
          </View>
        </Card>

        <Card>
          <Text style={styles.title}>Base local</Text>
          <Text style={{ fontSize: T.type.label, color: T.ink3, marginVertical: T.space['2'] }}>
            Borra el snapshot local y vuelve a hidratar desde el servidor (requiere red).
          </Text>
          <Button
            label={confirmReset ? '¿Confirmar borrado local?' : 'Reiniciar base local'}
            variant="danger"
            onPress={() => {
              if (!confirmReset) {
                setConfirmReset(true);
                setTimeout(() => setConfirmReset(false), 3000);
              } else {
                sync.resetLocal();
              }
            }}
          />
        </Card>

        <Card>
          <Text style={styles.title}>Sesión</Text>
          <Text style={{ fontSize: T.type.label, color: T.ink3, marginVertical: T.space['2'] }}>
            Los datos locales se conservan; al volver a ingresar seguís donde estabas.
          </Text>
          <Button label="Cerrar sesión" variant="secondary" onPress={() => sync.logout()} />
        </Card>

        <Text style={{ fontSize: T.type.caption, color: T.ink3, textAlign: 'center' }}>Cowinance móvil · esqueleto v0.1</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (T: Theme) =>
  StyleSheet.create({
  title: { fontSize: T.type.body, fontWeight: '600', color: T.ink },
  value: { fontSize: 14, color: T.ink2, marginTop: T.space['0.5'] },
  mono: { fontFamily: 'monospace', fontSize: T.type.label, color: T.ink2, marginTop: T.space['0.5'] },
  notifRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: T.space['2.5'],
    minHeight: 48,
    paddingHorizontal: T.space['3'],
    backgroundColor: T.surface,
    borderRadius: T.radiusMd,
    borderWidth: 1,
    borderColor: T.borderSubtle,
  },
  // Fila de finca: `minHeight` y no alto fijo — el gate de arquitectura lo verifica, y con el
  // texto del sistema en grande un alto fijo recorta el nombre de la finca.
  finca: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: T.space['2'],
    minHeight: 48,
    paddingHorizontal: T.space['3'],
    paddingVertical: T.space['2'],
    backgroundColor: T.surface,
    borderRadius: T.radiusMd,
    borderWidth: 1,
    borderColor: T.borderSubtle,
  },
  fincaConfirm: { borderColor: T.danger },
  notifLabel: { flex: 1, fontSize: T.type.body, fontWeight: '600', color: T.ink },
  notifEmpty: { fontSize: T.type.label, color: T.ink3 },
  // El contador lleva un número adentro: si el texto del sistema crece y el globo no, se recorta.
  notifBadge: { minWidth: 20, paddingHorizontal: 6, minHeight: 20, paddingVertical: 2, borderRadius: 10, backgroundColor: T.warning, alignItems: 'center', justifyContent: 'center' },
  notifBadgeText: { fontSize: T.type.caption, fontWeight: '700', color: '#fff' },
});
