-- PLANO DE IDENTIDAD — bug que solo se ve con un rol NO privilegiado.
--
-- En desarrollo PGlite conecta como superusuario y SALTEA toda RLS, asi que esto pasaba
-- inadvertido: el DDL canonico habilita RLS en `user_role_assignments` con una policy sobre
-- `app.current_tenant`, variable que la app NUNCA fija (usa `app.tenant_id`) -> deny-all. Y el
-- LOGIN lee justo esa tabla para resolver el tenant ANTES de que exista contexto, asi que en
-- produccion el login quedaba roto.
--
-- Va SIN RLS a proposito, misma decision que `users` y `auth_refresh_tokens`: no se puede
-- filtrar por un tenant que todavia no se conoce. Se APAGA la RLS, no solo la policy:
-- habilitada sin politica tambien deniega todo. Por eso no esta en RLS_TABLES.

DROP POLICY IF EXISTS tenant_isolation_user_role_assignments ON "user_role_assignments";
ALTER TABLE "user_role_assignments" DISABLE ROW LEVEL SECURITY;
