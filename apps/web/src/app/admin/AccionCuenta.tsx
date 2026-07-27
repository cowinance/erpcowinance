'use client';

import { useState, useTransition } from 'react';
import type { ResultadoAccion } from './acciones';

const MOTIVO_MIN = 10;

/**
 * Botón de acción del panel con confirmación y MOTIVO OBLIGATORIO.
 *
 * ## Por qué el motivo está en la UI y no solo en el backend
 *
 * El backend ya lo exige (devolvería 400), pero enterarse recién ahí significa escribir la acción,
 * apretar, y recibir un error por algo que se podría haber pedido antes. Acá el botón de confirmar
 * queda deshabilitado hasta que hay una explicación de verdad, con el contador a la vista.
 *
 * ## Por qué el paso intermedio
 *
 * Suspender una cuenta deja a una finca entera sin poder trabajar. Un solo clic para eso es poco:
 * el formulario obliga a detenerse, leer a QUIÉN se le va a hacer, y escribir por qué. Es la misma
 * razón por la que el nombre de la cuenta aparece en el aviso y no solo en el encabezado de la
 * página — quien llega desde un listado puede tener abierta la fila equivocada.
 *
 * No se usa `confirm()` del navegador: no se puede pedir un texto obligatorio ni mostrar el
 * contexto, y en algunos navegadores se puede suprimir.
 */
export function AccionCuenta({
  etiqueta,
  titulo,
  descripcion,
  objetivo,
  tono = 'normal',
  planes,
  accion,
  deshabilitado,
  razonDeshabilitado,
}: {
  /** Texto del botón. */
  etiqueta: string;
  /** Encabezado del formulario de confirmación. */
  titulo: string;
  /** Qué va a pasar, en una frase. */
  descripcion: string;
  /** Sobre quién: nombre de la cuenta o del usuario. */
  objetivo: string;
  tono?: 'normal' | 'peligro';
  /** Si viene, el formulario pide además elegir un plan. */
  planes?: { code: string; name: string }[];
  accion: (motivo: string, planCode?: string) => Promise<ResultadoAccion>;
  deshabilitado?: boolean;
  razonDeshabilitado?: string;
}) {
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [plan, setPlan] = useState(planes?.[0]?.code ?? '');
  const [resultado, setResultado] = useState<ResultadoAccion | null>(null);
  const [pendiente, empezar] = useTransition();

  const motivoOk = motivo.trim().length >= MOTIVO_MIN;

  function cerrar() {
    setAbierto(false);
    setMotivo('');
    setResultado(null);
  }

  function confirmar() {
    if (!motivoOk || pendiente) return;
    empezar(async () => {
      const r = await accion(motivo.trim(), plan || undefined);
      setResultado(r);
      // Solo se cierra si salió bien: si falló, el motivo escrito se conserva para corregir y
      // reintentar sin tener que volver a tipearlo.
      if (r.ok) {
        setAbierto(false);
        setMotivo('');
      }
    });
  }

  if (deshabilitado)
    return (
      <span className="text-caption text-ink-3" title={razonDeshabilitado}>
        {razonDeshabilitado ?? '—'}
      </span>
    );

  return (
    <div className="inline-block">
      {!abierto && (
        <button
          type="button"
          onClick={() => {
            setResultado(null);
            setAbierto(true);
          }}
          className={`h-8 rounded-md border px-3 text-label font-medium ${
            tono === 'peligro'
              ? 'border-danger/40 text-danger hover:bg-danger/10'
              : 'border-subtle text-ink-2 hover:bg-sunken'
          }`}
        >
          {etiqueta}
        </button>
      )}

      {resultado && (
        <p
          role="status"
          className={`mt-2 max-w-md text-label ${resultado.ok ? 'text-success' : 'text-danger'}`}
        >
          {resultado.ok ? resultado.mensaje : resultado.error}
        </p>
      )}

      {abierto && (
        <div className="mt-2 w-full max-w-md rounded-[10px] border border-strong bg-surface p-4">
          <div className="text-body font-semibold">{titulo}</div>
          <p className="mt-1 text-label text-ink-2">{descripcion}</p>
          {/* El objetivo, repetido acá: quien llega desde un listado puede tener abierta la fila
              equivocada, y el encabezado de la página queda fuera de la vista al scrollear. */}
          <p className="mt-2 text-label">
            Sobre: <span className="font-medium">{objetivo}</span>
          </p>

          {planes && (
            <label className="mt-3 block text-label">
              Plan nuevo
              <select
                value={plan}
                onChange={(e) => setPlan(e.target.value)}
                className="mt-1 h-9 w-full rounded-md border border-subtle bg-canvas px-2 text-body"
              >
                {planes.map((p) => (
                  <option key={p.code} value={p.code}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label className="mt-3 block text-label">
            Motivo <span className="text-ink-3">(queda en la bitácora)</span>
            <textarea
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              rows={2}
              autoFocus
              placeholder="Ej.: falta de pago de la factura 1042"
              className="mt-1 w-full rounded-md border border-subtle bg-canvas px-2 py-1.5 text-body"
            />
          </label>
          <div className={`text-caption ${motivoOk ? 'text-ink-3' : 'text-warning'}`}>
            {motivoOk ? 'Listo para confirmar.' : `Faltan ${MOTIVO_MIN - motivo.trim().length} caracteres.`}
          </div>

          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={confirmar}
              disabled={!motivoOk || pendiente}
              className={`h-9 rounded-md px-4 text-body font-medium text-white disabled:opacity-40 ${
                tono === 'peligro' ? 'bg-danger' : 'bg-brand'
              }`}
            >
              {pendiente ? 'Aplicando…' : 'Confirmar'}
            </button>
            <button
              type="button"
              onClick={cerrar}
              disabled={pendiente}
              className="h-9 rounded-md border border-subtle px-4 text-body"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
