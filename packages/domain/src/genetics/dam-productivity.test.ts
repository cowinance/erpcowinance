import { describe, expect, it } from 'vitest';
import { cullCandidates, damConfidenceFor, damProductivity, type DamRecord } from './dam-productivity';

const HOY = '2026-07-27';

const vaca = (damId: string, firstCalvingDate: string, destetes: [string, number][], exitDate?: string): DamRecord => ({
  damId,
  firstCalvingDate,
  weanings: destetes.map(([date, kg]) => ({ date, kg })),
  exitDate,
});

describe('kilos destetados por vaca y por año', () => {
  it('LA QUE SE SALTEA UN AÑO CAE, AUNQUE DESTETE MÁS PESADO', () => {
    // El motivo del número. Mirando solo el peso al destete, REGULAR parece peor madre; repartido
    // entre los años que lleva en el rodeo, es el mejor negocio de los dos. Es la decisión que un
    // productor toma mal cuando mira el kilaje suelto.
    const r = damProductivity(
      [
        vaca('REGULAR', '2020-08-01', [
          ['2021-06-01', 200],
          ['2022-06-01', 200],
          ['2023-06-01', 200],
          ['2024-06-01', 200],
          ['2025-06-01', 200],
          ['2026-06-01', 200],
        ]),
        vaca('PESADA', '2020-08-01', [
          ['2021-06-01', 220],
          ['2023-06-01', 220],
          ['2025-06-01', 220],
        ]),
      ],
      HOY,
    );
    expect(r[0].damId).toBe('REGULAR');
    // PESADA desteta 20 kg más por cría y produce bastante menos por año.
    expect(r[0].avgWeaningKg).toBeLessThan(r[1].avgWeaningKg);
    expect(r[0].kgPerYear).toBeGreaterThan(r[1].kgPerYear);
  });

  it('LA QUE HACE DOS AÑOS QUE NO DESTETA CAE EN EL RANKING', () => {
    // El denominador corre hasta HOY y no hasta su último destete: una vaca que dejó de producir
    // está comiendo sin dar nada, y tiene que verse. Medirla hasta su último destete la dejaría
    // congelada en su mejor momento.
    const r = damProductivity(
      [
        vaca('ACTIVA', '2022-06-01', [
          ['2023-06-01', 200],
          ['2024-06-01', 200],
          ['2025-06-01', 200],
          ['2026-06-01', 200],
        ]),
        vaca('PARADA', '2022-06-01', [
          ['2023-06-01', 210],
          ['2024-06-01', 210],
        ]),
      ],
      HOY,
    );
    expect(r[0].damId).toBe('ACTIVA');
    expect(r.find((d) => d.damId === 'PARADA')!.lastWeaningDate).toBe('2024-06-01');
  });

  it('a la que ya salió del rodeo se la mide hasta que salió', () => {
    // Si se la midiera hasta hoy, cada año que pasa la haría ver peor sin que ella pueda hacer nada
    // — y el ranking histórico cambiaría solo con el paso del tiempo.
    const conSalida = damProductivity([vaca('VENDIDA', '2020-06-01', [['2021-06-01', 200]], '2021-12-01')], HOY);
    const sinSalida = damProductivity([vaca('VENDIDA', '2020-06-01', [['2021-06-01', 200]])], HOY);
    expect(conSalida[0].kgPerYear).toBeGreaterThan(sinSalida[0].kgPerYear);
  });

  it('UNA VACA DE PRIMER PARTO RECIENTE NO SE DISPARA AL TOPE', () => {
    // Sin el piso de un año, tres meses en producción convertirían 180 kg en 720 kg/año y la
    // vaquillona encabezaría el ranking por una división, no por producir.
    const r = damProductivity([vaca('NUEVA', '2026-04-01', [['2026-07-01', 180]])], HOY);
    expect(r[0].years).toBe(1);
    expect(r[0].kgPerYear).toBe(180);
  });

  it('ignora destetes sin peso, en vez de contarlos como cero', () => {
    // Un destete sin pesar es un dato que falta, no un ternero de 0 kg: contarlo hundiría a la vaca
    // por algo que no hizo ella.
    const r = damProductivity([vaca('V', '2023-06-01', [['2024-06-01', 200], ['2025-06-01', 0]])], HOY);
    expect(r[0].calves).toBe(1);
    expect(r[0].totalWeanedKg).toBe(200);
  });

  it('sin destetes da cero y no rompe', () => {
    const r = damProductivity([vaca('V', '2025-06-01', [])], HOY);
    expect(r[0]).toMatchObject({ calves: 0, totalWeanedKg: 0, kgPerYear: 0, avgWeaningKg: 0, lastWeaningDate: null });
  });
});

describe('cuánto pesa el número de una vaca', () => {
  it('LOS UMBRALES NO SON LOS DE UN TORO', () => {
    // Un toro deja decenas de hijos por temporada; una vaca deja uno por año. Pedirle diez destetes
    // sería pedirle diez años, y no quedaría ninguna vaca evaluable.
    expect(damConfidenceFor(1)).toBe('baja');
    expect(damConfidenceFor(2)).toBe('media');
    expect(damConfidenceFor(4)).toBe('alta');
  });
});

describe('candidatas a descarte', () => {
  const rodeo = (kgs: number[]) =>
    damProductivity(
      kgs.map((kg, i) =>
        vaca(`V${i}`, '2020-06-01', [
          ['2021-06-01', kg],
          ['2022-06-01', kg],
          ['2023-06-01', kg],
          ['2024-06-01', kg],
          ['2025-06-01', kg],
          ['2026-06-01', kg],
        ]),
      ),
      HOY,
    );

  it('SE COMPARA CONTRA LA MEDIANA, NO CONTRA EL PROMEDIO', () => {
    // Con pocas vacas, una excepcional arrastra el promedio y de golpe media majada queda «por
    // debajo». La mediana no se mueve por un caso extremo — y acá la decisión es sacar un animal.
    const conUnaExcepcional = rodeo([200, 200, 200, 200, 900]);
    const candidatas = cullCandidates(conUnaExcepcional);
    expect(candidatas, 'el promedio habría marcado a las cuatro normales').toEqual([]);
  });

  it('marca a la que está bien por debajo del rodeo', () => {
    const c = cullCandidates(rodeo([200, 200, 200, 200, 80]));
    expect(c.map((d) => d.totalWeanedKg / 6)).toEqual([80]);
  });

  it('NO DESCARTA POR UN SOLO DESTETE', () => {
    // Descartar una vaca por su primer parto es apurarse: puede ser una vaquillona que todavía no
    // llegó a su tamaño adulto.
    const dams = damProductivity(
      [
        vaca('PRIMERIZA', '2025-06-01', [['2026-06-01', 60]]),
        ...[200, 200, 200].map((kg, i) => vaca(`V${i}`, '2020-06-01', [['2021-06-01', kg], ['2022-06-01', kg]])),
      ],
      HOY,
    );
    expect(cullCandidates(dams).map((d) => d.damId)).not.toContain('PRIMERIZA');
  });

  it('con un rodeo chico no se pronuncia', () => {
    // Con dos vacas, «la peor» no significa nada.
    expect(cullCandidates(rodeo([200, 80]))).toEqual([]);
  });
});

describe('transferencia de embrión: quién produjo y quién aportó los genes', () => {
  it('LA RECEPTORA SE LLEVA LOS KILOS QUE CRIÓ, AUNQUE LA CRÍA NO SEA SUYA', () => {
    // Gestó nueve meses y le dio la leche: esos kilos los produjo ella, y además quedó ocupada todo
    // el año. Acreditárselos a la donante le regalaría producción que no hizo.
    const r = damProductivity(
      [vaca('RECEPTORA', '2022-06-01', [['2023-06-01', 200], ['2024-06-01', 200], ['2025-06-01', 200]])],
      HOY,
    );
    expect(r[0].calves).toBe(3);
    expect(r[0].kgPerYear).toBeGreaterThan(0);
  });

  it('LA DONANTE SUMA LO SUYO EN UNA COLUMNA APARTE', () => {
    // Sus genes andan en crías que gestó otra. Sumarlo a lo que crió sería mentir sobre su
    // producción; ignorarlo borraría a una donante que puede tener media majada con su genética.
    const donante: DamRecord = {
      damId: 'DONANTE',
      firstCalvingDate: '2022-06-01',
      weanings: [{ date: '2023-06-01', kg: 180 }], // una cría propia
      donatedWeanings: [
        { date: '2024-06-01', kg: 220 },
        { date: '2025-06-01', kg: 230 },
      ],
    };
    const [d] = damProductivity([donante], HOY);
    expect(d.calves, 'las donadas NO cuentan como criadas por ella').toBe(1);
    expect(d.donatedCalves).toBe(2);
    expect(d.isDonor).toBe(true);
    expect(d.geneticKgPerYear, 'el aporte genético incluye las tres').toBeGreaterThan(d.kgPerYear);
  });

  it('para una finca SIN transferencia las dos columnas dan lo mismo', () => {
    // Es lo que hace que la tabla no se complique para el 99% de las vacas.
    const [d] = damProductivity([vaca('NORMAL', '2022-06-01', [['2023-06-01', 200], ['2024-06-01', 200]])], HOY);
    expect(d.geneticKgPerYear).toBe(d.kgPerYear);
    expect(d.isDonor).toBe(false);
    expect(d.donatedCalves).toBe(0);
  });

  it('UNA DONANTE NO SE MARCA PARA DESCARTE POR CRIAR POCO', () => {
    // Su trabajo es dar embriones, y su vientre puede estar descansando a propósito. Marcarla sería
    // sacar del rodeo justamente a la vaca cuya genética se está multiplicando.
    const rodeo: DamRecord[] = [
      ...[200, 200, 200, 200].map((kg, i) =>
        vaca(`V${i}`, '2020-06-01', [['2021-06-01', kg], ['2022-06-01', kg], ['2023-06-01', kg]]),
      ),
      {
        damId: 'ELITE',
        firstCalvingDate: '2020-06-01',
        weanings: [{ date: '2021-06-01', kg: 40 }, { date: '2022-06-01', kg: 40 }],
        donatedWeanings: [{ date: '2023-06-01', kg: 240 }, { date: '2024-06-01', kg: 240 }],
      },
    ];
    const dams = damProductivity(rodeo, HOY);
    expect(dams.find((d) => d.damId === 'ELITE')!.kgPerYear).toBeLessThan(100); // cría poquísimo
    expect(cullCandidates(dams).map((d) => d.damId)).not.toContain('ELITE');
  });
});
