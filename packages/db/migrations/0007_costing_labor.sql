-- Costo de mano de obra (G2 . E6). Dos columnas, ninguna tabla nueva:
--   - employees.hourly_rate: NULLABLE a proposito. Un empleado sin tarifa NO cuesta 0 (eso
--     seria trabajo gratis): sus horas se informan aparte como «sin valorizar».
--   - work_logs.cost_center_id: imputacion explicita; si falta, se deriva de la tarea
--     vinculada (tasks.related_type/related_id). Ver CostingService.

ALTER TABLE employees ADD COLUMN IF NOT EXISTS hourly_rate numeric(18,4);
ALTER TABLE work_logs ADD COLUMN IF NOT EXISTS cost_center_id uuid REFERENCES cost_centers(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS ix_work_logs_tenant_date ON work_logs (tenant_id, work_date);
