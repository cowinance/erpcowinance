import { Redirect } from 'expo-router';

/** El botón central abre el capturador rápido; esta ruta existe solo para el tab. */
export default function Capturar() {
  return <Redirect href="/captura" />;
}
