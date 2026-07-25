import { describe, expect, it } from 'vitest';
import { dataUrlBytes, formatBytes } from './image';

/**
 * La parte del preparado de imágenes que se puede probar sin navegador: la aritmética de tamaños.
 * El redimensionado en sí necesita canvas y se verificó corriendo la app con una foto de 12 MP.
 *
 * Esta cuenta importa más de lo que parece: es la que decide si conviene mandar el original o el
 * achicado, y si estuviera mal (por ejemplo tomando el largo del base64 como bytes) diría que la
 * foto pesa un 33% más de lo que pesa y elegiría siempre mal.
 */
describe('tamaño real de un data URL', () => {
  it('descuenta la inflación del base64', () => {
    // 3 bytes de datos → 4 caracteres de base64. Tomar el largo del string daría 4.
    expect(dataUrlBytes('data:image/jpeg;base64,' + btoa('abc'))).toBe(3);
  });

  it('vale para un contenido largo', () => {
    const datos = 'x'.repeat(3000);
    expect(dataUrlBytes('data:image/jpeg;base64,' + btoa(datos))).toBe(3000);
  });

  it('no confunde la cabecera con el contenido', () => {
    // Si contara desde el principio del string, la cabecera `data:image/jpeg;base64,` sumaría.
    const corto = dataUrlBytes('data:image/jpeg;base64,' + btoa('abc'));
    const largo = dataUrlBytes('data:image/png;base64,' + btoa('abc'));
    expect(corto).toBe(largo);
  });
});

describe('tamaño legible', () => {
  it('usa MB a partir del mega y KB abajo', () => {
    expect(formatBytes(9_961_472)).toBe('9.5 MB');
    expect(formatBytes(572 * 1024)).toBe('572 KB');
  });

  it('nunca muestra 0 KB para algo que existe', () => {
    // «0 KB» en el aviso de optimización se lee como que la foto se perdió.
    expect(formatBytes(1)).toBe('1 KB');
    expect(formatBytes(300)).toBe('1 KB');
  });
});
