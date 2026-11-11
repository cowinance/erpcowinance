import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { registrarFallo } from './crash-store';

/**
 * Límite de errores de render.
 *
 * Sin esto, un error en cualquier pantalla deja la app en blanco y sin forma de volver: hay que
 * matarla y abrirla de nuevo, parado en el corral con un animal en la manga.
 *
 * **Lo que esta pantalla NO hace es tan importante como lo que hace: no toca el almacenamiento.**
 * Las capturas sin subir ya están escritas en el dispositivo —la cola se persiste en cada commit,
 * no al sincronizar— así que lo único que hace falta es volver a montar el árbol. Un «empezar de
 * cero» acá borraría el trabajo del día, que es exactamente el daño que esto viene a evitar.
 *
 * **Los colores están escritos a mano y no salen del tema.** Es deliberado: esta es la última
 * pantalla que queda en pie cuando algo se rompió, y no puede depender de hooks, de contextos ni
 * de hojas de estilo que quizás sean lo que falló. Son los de `@cowinance/design-tokens`, copiados
 * para que esta pantalla no tenga ninguna dependencia que pueda fallar.
 */

const VERDE = '#1f4e3d';
const VERDE_CLARO = '#e7f2ec';
const TEXTO = '#0e2a20';
const GRIS = '#4a5a54';

interface Props {
  children: React.ReactNode;
}

interface State {
  error: Error | null;
  /** Cambia al reintentar: fuerza a React a desmontar y volver a montar todo el subárbol. */
  intento: number;
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null, intento: 0 };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // Best-effort y sin await: si no se puede registrar, igual hay que mostrar la salida.
    void registrarFallo(error, info.componentStack ?? undefined);
  }

  private reintentar = (): void => {
    this.setState((s) => ({ error: null, intento: s.intento + 1 }));
  };

  render(): React.ReactNode {
    const { error } = this.state;
    if (!error) return <React.Fragment key={this.state.intento}>{this.props.children}</React.Fragment>;

    return (
      <View style={estilos.fondo}>
        <ScrollView contentContainerStyle={estilos.contenido}>
          <Text style={estilos.titulo}>La app se trabó</Text>
          <Text style={estilos.cuerpo}>
            Algo falló al dibujar esta pantalla. Volvé a intentar: lo que hayas guardado sin señal sigue en el
            teléfono y se va a sincronizar igual.
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Volver a intentar"
            style={({ pressed }) => [estilos.boton, pressed && estilos.botonApretado]}
            onPress={this.reintentar}
          >
            <Text style={estilos.botonTexto}>Volver a intentar</Text>
          </Pressable>
          <Text style={estilos.detalleTitulo}>Detalle para soporte</Text>
          <Text style={estilos.detalle} selectable>
            {error.message}
          </Text>
        </ScrollView>
      </View>
    );
  }
}

const estilos = StyleSheet.create({
  fondo: { flex: 1, backgroundColor: VERDE_CLARO },
  contenido: { flexGrow: 1, justifyContent: 'center', padding: 24, gap: 16 },
  titulo: { fontSize: 24, fontWeight: '700', color: TEXTO },
  cuerpo: { fontSize: 16, lineHeight: 24, color: TEXTO },
  boton: { minHeight: 52, borderRadius: 12, backgroundColor: VERDE, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  botonApretado: { opacity: 0.8 },
  botonTexto: { color: '#ffffff', fontSize: 17, fontWeight: '600' },
  detalleTitulo: { fontSize: 13, fontWeight: '600', color: GRIS, marginTop: 8 },
  detalle: { fontSize: 13, color: GRIS, fontFamily: 'monospace' },
});
