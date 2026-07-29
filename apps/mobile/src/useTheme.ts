/**
 * El tema que sigue al sistema: claro u oscuro, en caliente.
 *
 * **Por qué un hook y no un objeto.** El tema era un objeto de módulo construido con la paleta clara
 * al importar. Eso alcanzaba mientras hubo un solo modo, pero `useColorScheme()` cambia MIENTRAS la
 * app está abierta —en iOS el modo oscuro se activa solo al atardecer si está en automático— y un
 * objeto congelado no puede reaccionar. Un hook sí.
 *
 * **Por qué `useStyles` y no solo `useTheme`.** El problema real no son los colores escritos en el
 * JSX —esos se leen del hook y ya— sino los 17 `StyleSheet.create` que se evalúan UNA vez cuando el
 * archivo se importa. Ahí la paleta queda grabada y no hay hook que la salve. La forma de arreglarlo
 * es convertir cada hoja en una FÁBRICA que recibe el tema, y llamarla desde el componente:
 *
 *     const styles = useStyles(makeStyles);   // en el componente
 *     const makeStyles = (T: Theme) => StyleSheet.create({ ... });   // afuera
 *
 * Se memoiza por tema, y como los dos temas se arman una sola vez su identidad es estable: cambiar de
 * modo recalcula las hojas una vez, y volver al anterior no recalcula nada.
 *
 * **Nada de esto es opcional para que el modo oscuro funcione de verdad.** Una pantalla que se olvide
 * de la fábrica compila perfecto y se ve clara sobre fondo oscuro — el typechecker no lo puede ver.
 * Por eso la conversión va por pasos y cada paso se barre buscando `StyleSheet.create` que todavía
 * lea el tema estático.
 */
import { useMemo } from 'react';
import { useColorScheme } from 'react-native';
import { themes, type Theme } from './theme';

export type { Theme };

/** El tema del esquema actual del sistema. Sin esquema declarado (Android viejo, web) → claro. */
export function useTheme(): Theme {
  const scheme = useColorScheme();
  return scheme === 'dark' ? themes.dark : themes.light;
}

/** Los estilos de una pantalla, recalculados solo cuando cambia el tema. */
export function useStyles<S>(factory: (t: Theme) => S): S {
  const t = useTheme();
  return useMemo(() => factory(t), [factory, t]);
}
