import { Text, View } from 'react-native';
import { Button } from '@/components/ui';
import { WEB_URL, openWeb } from '@/lib/webUrl';
import { T } from '@/theme';

/**
 * Estado vacío del hato (P1.3.6): la finca aún no tiene animales en este
 * dispositivo. El primer animal se carga desde la web (no hay alta móvil). Solo
 * ofrece "Abrir Cowinance web" si hay URL configurada; si no, instrucciones en
 * texto sin hardcodear dominios.
 */
export function EmptyHerd() {
  return (
    <View style={{ alignItems: 'center', paddingVertical: T.space['6'], paddingHorizontal: T.space['2'], gap: T.space['2'] }}>
      <Text style={{ fontSize: T.type.subheading, fontWeight: '700', color: T.ink, textAlign: 'center' }}>
        Tu finca aún no tiene animales
      </Text>
      <Text style={{ fontSize: T.type.body, color: T.ink3, textAlign: 'center', lineHeight: 19 }}>
        El primer animal se carga desde Cowinance web. Cuando lo hagas, se descargará a este dispositivo y vas a poder
        capturar en el campo, incluso sin señal.
      </Text>
      {WEB_URL ? (
        <View style={{ marginTop: T.space['2'], minWidth: 200 }}>
          <Button label="Abrir Cowinance web" variant="secondary" onPress={() => openWeb('/animales/nuevo')} />
        </View>
      ) : null}
    </View>
  );
}
