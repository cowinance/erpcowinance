-- CRM (F3): seguimiento comercial sobre la base de terceros que ya existe.
--
-- El catálogo asigna a F3 las entidades `business_partners`, `contacts` y `contracts` —las tres ya
-- estan en el esquema canonico— y describe ademas dos capacidades sin tabla propia: historial de
-- INTERACCIONES y OPORTUNIDADES. Esas dos se agregan aca.
--
-- No se toca `business_partners` salvo por el segmento comercial, que el catalogo pide
-- explicitamente ("segmentacion de clientes: frigorifico, tambo, remate, exportacion") y que hoy no
-- tiene donde vivir. Es una columna, no una tabla: un socio tiene UN segmento.

ALTER TABLE business_partners ADD COLUMN IF NOT EXISTS segment varchar(32);

-- Historial de interacciones: la conversacion con el tercero.
--
-- Es un HECHO INMUTABLE, como los eventos del animal: se registra que pasó, no se edita despues.
-- Por eso no tiene `updated_at` ni estado.
CREATE TABLE IF NOT EXISTS partner_interactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  partner_id uuid NOT NULL REFERENCES business_partners(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  kind varchar(16) NOT NULL CHECK (kind IN ('call','visit','email','whatsapp','meeting','note')),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  summary text NOT NULL,
  -- Proxima accion acordada. Es lo que convierte un historial en seguimiento: sin esto, la lista de
  -- llamadas es un archivo muerto.
  next_action text,
  next_action_at date,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  deleted_at timestamptz
);
CREATE INDEX IF NOT EXISTS ix_partner_interactions_partner ON partner_interactions (tenant_id, partner_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS ix_partner_interactions_followup ON partner_interactions (tenant_id, next_action_at) WHERE next_action_at IS NOT NULL AND deleted_at IS NULL;

-- Oportunidades: el pipeline comercial.
--
-- `expected_value` es NULLABLE a proposito: al principio de una charla no se sabe cuanto vale, y
-- forzar un numero inventado contamina el pronostico. El resumen del pipeline cuenta aparte las
-- oportunidades sin valor en vez de tratarlas como cero.
--
-- `sale_id` cierra el circulo que pide el catalogo ("integracion con Ventas: conversion"): al ganar
-- una oportunidad se la puede enlazar con la venta que la concreto.
CREATE TABLE IF NOT EXISTS opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  partner_id uuid NOT NULL REFERENCES business_partners(id) ON DELETE RESTRICT,
  title varchar(255) NOT NULL,
  description text,
  stage varchar(16) NOT NULL DEFAULT 'lead' CHECK (stage IN ('lead','qualified','proposal','negotiation','won','lost')),
  expected_value numeric(16,2),
  currency varchar(8),
  expected_close_date date,
  source varchar(32),
  lost_reason text,
  closed_at timestamptz,
  sale_id uuid REFERENCES sales(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  deleted_at timestamptz
);
CREATE INDEX IF NOT EXISTS ix_opportunities_tenant_stage ON opportunities (tenant_id, stage) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_opportunities_partner ON opportunities (tenant_id, partner_id);

-- Historial de etapas: sin esto, "cuanto tarda una oportunidad en cerrarse" no se puede responder,
-- porque la etapa actual pisa a la anterior.
CREATE TABLE IF NOT EXISTS opportunity_stage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  opportunity_id uuid NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  from_stage varchar(16),
  to_stage varchar(16) NOT NULL,
  note text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS ix_opportunity_stage_events ON opportunity_stage_events (opportunity_id, occurred_at);
