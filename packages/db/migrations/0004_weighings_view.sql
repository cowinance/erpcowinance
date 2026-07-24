-- Vista v_weighings: la GDP como regla unica DERIVADA (P8).
-- El calculo vive en la vista (LAG sobre el pesaje anterior del mismo animal), no en cada
-- servicio: web, movil y manga leen el MISMO numero.

CREATE INDEX IF NOT EXISTS ix_weighings_tenant_animal_weighed_at
  ON weighings (tenant_id, animal_id, weighed_at);
DROP VIEW IF EXISTS v_weighings;
CREATE VIEW v_weighings AS
  SELECT ranked.id,
         ranked.tenant_id,
         ranked.animal_id,
         ranked.weighed_at,
         ranked.weight_kg,
         ranked.method,
         ranked.device_id,
         CASE
           WHEN ranked.prev_weight_kg IS NULL THEN NULL
           ELSE ROUND(
             (ranked.weight_kg - ranked.prev_weight_kg)
             / GREATEST(1::numeric, EXTRACT(EPOCH FROM (ranked.weighed_at - ranked.prev_weighed_at))::numeric / 86400),
             3
           )::numeric(14,3)
         END AS adg_since_last,
         ranked.body_condition,
         ranked.created_at,
         ranked.updated_at,
         ranked.created_by,
         ranked.deleted_at
  FROM (
    SELECT w.*,
           LAG(w.weight_kg) OVER (
             PARTITION BY w.tenant_id, w.animal_id
             ORDER BY w.weighed_at, w.created_at, w.id
           ) AS prev_weight_kg,
           LAG(w.weighed_at) OVER (
             PARTITION BY w.tenant_id, w.animal_id
             ORDER BY w.weighed_at, w.created_at, w.id
           ) AS prev_weighed_at
    FROM weighings w
    WHERE w.deleted_at IS NULL
  ) ranked;
