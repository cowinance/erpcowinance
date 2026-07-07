import { describe, it, expect } from 'vitest';
import type { Brand } from './brand';

describe('Brand · marca nominal', () => {
  it('cero costo en runtime: el valor marcado ES su primitivo subyacente', () => {
    type AnimalId = Brand<string, 'AnimalId'>;
    const id = 'a-123' as AnimalId;

    expect(typeof id).toBe('string');
    expect(id).toBe('a-123');

    // Un tipo marcado sigue siendo asignable a su primitivo (chequeo de compilación).
    const asString: string = id;
    expect(asString).toBe('a-123');
  });
});
