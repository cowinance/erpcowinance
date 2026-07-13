-- ============================================================================
-- COWINANCE — Modelo de datos PostgreSQL (DDL completo)
-- Generado automáticamente desde la definición única del esquema.
-- 140 tablas · 539 relaciones (claves foráneas)
-- Convenciones: PK uuid (gen_random_uuid; v7 recomendado en prod) · multi-tenant tenant_id + RLS · auditoría estándar
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS postgis;    -- tipos geography/geometry
-- CREATE EXTENSION IF NOT EXISTS timescaledb;  -- hypertables de series de tiempo (sensor_readings, gps_positions)
-- CREATE EXTENSION IF NOT EXISTS pg_uuidv7;    -- RECOMENDADO en producción: UUID v7 ordenables temporalmente

-- Las claves primarias usan gen_random_uuid() por portabilidad.
-- En producción se recomienda instalar pg_uuidv7 y cambiar el DEFAULT a uuid_generate_v7()
-- para obtener identificadores ordenables en el tiempo (mejor localidad de índice).

-- ============================================================================
-- MÓDULO: Identidad y Organización
-- ============================================================================

CREATE TABLE "organizations" (
  "id" uuid DEFAULT gen_random_uuid(),
  "name" varchar(255) NOT NULL,
  "legal_name" varchar(255),
  "country_code" varchar(2) NOT NULL,
  "default_currency" varchar(3) NOT NULL,
  "default_locale" varchar(10) DEFAULT 'es' NOT NULL,
  "timezone" varchar(255) DEFAULT 'UTC' NOT NULL,
  "unit_system" varchar(255) DEFAULT 'metric' NOT NULL CHECK ("unit_system" IN ('metric','imperial')),
  "status" varchar(255) DEFAULT 'active' NOT NULL CHECK ("status" IN ('active','suspended','churned')),
  "data_region" varchar(255) DEFAULT 'latam' NOT NULL,
  "settings" jsonb DEFAULT '{}' NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id")
);

CREATE TABLE "companies" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "name" varchar(255) NOT NULL,
  "tax_id" varchar(255),
  "country_code" varchar(2) NOT NULL,
  "functional_currency" varchar(3) NOT NULL,
  "fiscal_year_start_month" smallint DEFAULT 1 NOT NULL,
  "address" jsonb,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id")
);
CREATE INDEX "ix_companies_tenant_id" ON "companies" ("tenant_id");

CREATE TABLE "farms" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "company_id" uuid NOT NULL,
  "name" varchar(255) NOT NULL,
  "official_code" varchar(255),
  "location" geography(Point,4326),
  "boundary" geography(Polygon,4326),
  "total_area_ha" numeric(14,3),
  "timezone" varchar(255),
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id")
);
CREATE INDEX "ix_farms_tenant_id" ON "farms" ("tenant_id");

CREATE TABLE "users" (
  "id" uuid DEFAULT gen_random_uuid(),
  "email" varchar(255) NOT NULL UNIQUE,
  "phone" varchar(255),
  "full_name" varchar(255) NOT NULL,
  "locale" varchar(10),
  "avatar_file_id" uuid,
  "auth_provider" varchar(255) DEFAULT 'password' NOT NULL CHECK ("auth_provider" IN ('password','google','apple','saml')),
  "mfa_enabled" boolean DEFAULT false NOT NULL,
  "last_login_at" timestamptz,
  "status" varchar(255) DEFAULT 'active' NOT NULL CHECK ("status" IN ('active','blocked','deleted')),
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id")
);

CREATE TABLE "roles" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid,
  "code" varchar(255) NOT NULL,
  "name" varchar(255) NOT NULL,
  "description" varchar(255),
  "is_system" boolean DEFAULT false NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id"),
  UNIQUE ("tenant_id", "code")
);
CREATE INDEX "ix_roles_tenant_id" ON "roles" ("tenant_id");

CREATE TABLE "permissions" (
  "id" uuid DEFAULT gen_random_uuid(),
  "code" varchar(255) NOT NULL UNIQUE,
  "module" varchar(255) NOT NULL,
  "description" varchar(255) NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "role_permissions" (
  "role_id" uuid,
  "permission_id" uuid,
  PRIMARY KEY ("role_id", "permission_id")
);

CREATE TABLE "user_role_assignments" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "role_id" uuid NOT NULL,
  "company_id" uuid,
  "farm_id" uuid,
  "valid_from" date,
  "valid_until" date,
  "granted_by" uuid,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id")
);
CREATE INDEX "ix_user_role_assignments_tenant_id" ON "user_role_assignments" ("tenant_id");
CREATE INDEX "ix_user_role_assignments_user_id" ON "user_role_assignments" ("user_id");

CREATE TABLE "invitations" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "email" varchar(255) NOT NULL,
  "role_id" uuid NOT NULL,
  "farm_id" uuid,
  "token" varchar(255) NOT NULL UNIQUE,
  "expires_at" timestamptz NOT NULL,
  "accepted_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id")
);
CREATE INDEX "ix_invitations_tenant_id" ON "invitations" ("tenant_id");

CREATE TABLE "api_keys" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "name" varchar(255) NOT NULL,
  "key_hash" varchar(255) NOT NULL UNIQUE,
  "scopes" jsonb DEFAULT '[]' NOT NULL,
  "rate_limit_tier" varchar(255) DEFAULT 'standard' NOT NULL,
  "last_used_at" timestamptz,
  "revoked_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id")
);
CREATE INDEX "ix_api_keys_tenant_id" ON "api_keys" ("tenant_id");

CREATE TABLE "plans" (
  "id" uuid DEFAULT gen_random_uuid(),
  "code" varchar(255) NOT NULL UNIQUE,
  "name" varchar(255) NOT NULL,
  "monthly_price_usd" numeric(16,2) NOT NULL,
  "max_animals" integer,
  "max_users" integer,
  "max_devices" integer,
  "features" jsonb DEFAULT '{}' NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id")
);

CREATE TABLE "subscriptions" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "plan_id" uuid NOT NULL,
  "status" varchar(255) DEFAULT 'trialing' NOT NULL CHECK ("status" IN ('trialing','active','past_due','canceled')),
  "billing_currency" varchar(3) NOT NULL,
  "current_period_start" date NOT NULL,
  "current_period_end" date NOT NULL,
  "external_ref" varchar(255),
  "canceled_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id")
);
CREATE INDEX "ix_subscriptions_tenant_id" ON "subscriptions" ("tenant_id");

CREATE TABLE "subscription_usage" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "subscription_id" uuid NOT NULL,
  "period" date NOT NULL,
  "active_animals" integer DEFAULT 0 NOT NULL,
  "active_users" integer DEFAULT 0 NOT NULL,
  "active_devices" integer DEFAULT 0 NOT NULL,
  "api_calls" bigint DEFAULT 0 NOT NULL,
  "storage_gb" numeric(14,3) DEFAULT 0 NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id"),
  UNIQUE ("subscription_id", "period")
);
CREATE INDEX "ix_subscription_usage_tenant_id" ON "subscription_usage" ("tenant_id");
CREATE INDEX "ix_subscription_usage_subscription_id" ON "subscription_usage" ("subscription_id");

CREATE TABLE "billing_payments" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "subscription_id" uuid NOT NULL,
  "amount" numeric(16,2) NOT NULL,
  "currency" varchar(3) NOT NULL,
  "status" varchar(255) NOT NULL CHECK ("status" IN ('pending','succeeded','failed','refunded')),
  "gateway" varchar(255) NOT NULL,
  "external_ref" varchar(255),
  "paid_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id")
);
CREATE INDEX "ix_billing_payments_tenant_id" ON "billing_payments" ("tenant_id");
CREATE INDEX "ix_billing_payments_subscription_id" ON "billing_payments" ("subscription_id");

-- ============================================================================
-- MÓDULO: Catálogos Globales
-- ============================================================================

CREATE TABLE "countries" (
  "code" varchar(2),
  "name" varchar(255) NOT NULL,
  "name_en" varchar(255) NOT NULL,
  "traceability_authority" varchar(255),
  "id_format_regex" varchar(255),
  PRIMARY KEY ("code")
);

CREATE TABLE "currencies" (
  "code" varchar(3),
  "name" varchar(255) NOT NULL,
  "symbol" varchar(255) NOT NULL,
  "decimals" smallint DEFAULT 2 NOT NULL,
  PRIMARY KEY ("code")
);

CREATE TABLE "exchange_rates" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid,
  "from_currency" varchar(3) NOT NULL,
  "to_currency" varchar(3) NOT NULL,
  "rate_date" date NOT NULL,
  "rate" numeric(20,6) NOT NULL,
  "source" varchar(255),
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id"),
  UNIQUE ("tenant_id", "from_currency", "to_currency", "rate_date")
);
CREATE INDEX "ix_exchange_rates_tenant_id" ON "exchange_rates" ("tenant_id");

CREATE TABLE "units" (
  "code" varchar(255),
  "name" varchar(255) NOT NULL,
  "dimension" varchar(255) NOT NULL CHECK ("dimension" IN ('mass','volume','area','length','temperature','time','count','energy')),
  "si_factor" numeric(20,6) NOT NULL,
  PRIMARY KEY ("code")
);

CREATE TABLE "species" (
  "id" uuid DEFAULT gen_random_uuid(),
  "code" varchar(255) NOT NULL UNIQUE,
  "name" varchar(255) NOT NULL,
  "gestation_days" integer,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id")
);

CREATE TABLE "breeds" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid,
  "species_id" uuid NOT NULL,
  "code" varchar(255) NOT NULL,
  "name" varchar(255) NOT NULL,
  "purpose" varchar(255) CHECK ("purpose" IN ('beef','dairy','dual','wool','work')),
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id"),
  UNIQUE ("tenant_id", "species_id", "code")
);
CREATE INDEX "ix_breeds_tenant_id" ON "breeds" ("tenant_id");

CREATE TABLE "animal_categories" (
  "id" uuid DEFAULT gen_random_uuid(),
  "species_id" uuid NOT NULL,
  "code" varchar(255) NOT NULL,
  "name" varchar(255) NOT NULL,
  "sex" varchar(255) CHECK ("sex" IN ('F','M','any')),
  "min_age_months" smallint,
  "max_age_months" smallint,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id"),
  UNIQUE ("species_id", "code")
);

CREATE TABLE "diagnoses" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid,
  "code" varchar(255) NOT NULL,
  "name" varchar(255) NOT NULL,
  "category" varchar(255),
  "is_notifiable" boolean DEFAULT false NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id"),
  UNIQUE ("tenant_id", "code")
);
CREATE INDEX "ix_diagnoses_tenant_id" ON "diagnoses" ("tenant_id");

-- ============================================================================
-- MÓDULO: Hato (Animales)
-- ============================================================================

CREATE TABLE "animals" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "farm_id" uuid NOT NULL,
  "species_id" uuid NOT NULL,
  "category_id" uuid,
  "sex" varchar(255) NOT NULL CHECK ("sex" IN ('F','M')),
  "name" varchar(255),
  "birth_date" date,
  "birth_date_estimated" boolean DEFAULT false NOT NULL,
  "dam_id" uuid,
  "sire_id" uuid,
  "breeding_method_origin" varchar(255) CHECK ("breeding_method_origin" IN ('natural','ai','et')),
  "origin" varchar(255) DEFAULT 'born' NOT NULL CHECK ("origin" IN ('born','purchased','transferred')),
  "acquisition_date" date,
  "current_lot_id" uuid,
  "current_paddock_id" uuid,
  "status" varchar(255) DEFAULT 'active' NOT NULL CHECK ("status" IN ('active','sold','dead','culled','lost','transferred')),
  "status_changed_at" timestamptz,
  "coat_color" varchar(255),
  "photo_file_id" uuid,
  "notes" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id")
);
CREATE INDEX "ix_animals_tenant_id" ON "animals" ("tenant_id");
CREATE INDEX "ix_animals_farm_id" ON "animals" ("farm_id");
CREATE INDEX "ix_animals_current_lot_id" ON "animals" ("current_lot_id");

CREATE TABLE "animal_breeds" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "animal_id" uuid NOT NULL,
  "breed_id" uuid NOT NULL,
  "fraction" numeric(14,3) DEFAULT 1 NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id"),
  UNIQUE ("animal_id", "breed_id")
);
CREATE INDEX "ix_animal_breeds_tenant_id" ON "animal_breeds" ("tenant_id");
CREATE INDEX "ix_animal_breeds_animal_id" ON "animal_breeds" ("animal_id");

CREATE TABLE "animal_identifiers" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "animal_id" uuid NOT NULL,
  "type" varchar(255) NOT NULL CHECK ("type" IN ('visual','rfid','tattoo','bolus','brand','biometric','official')),
  "value" varchar(255) NOT NULL,
  "is_official" boolean DEFAULT false NOT NULL,
  "issued_at" date,
  "retired_at" date,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id")
);
CREATE INDEX "ix_animal_identifiers_tenant_id" ON "animal_identifiers" ("tenant_id");
CREATE INDEX "ix_animal_identifiers_animal_id" ON "animal_identifiers" ("animal_id");
CREATE INDEX "ix_animal_identifiers_value" ON "animal_identifiers" ("value");

CREATE TABLE "lots" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "farm_id" uuid NOT NULL,
  "name" varchar(255) NOT NULL,
  "purpose" varchar(255) CHECK ("purpose" IN ('breeding','fattening','dairy','weaning','quarantine','hospital')),
  "current_paddock_id" uuid,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id")
);
CREATE INDEX "ix_lots_tenant_id" ON "lots" ("tenant_id");
CREATE INDEX "ix_lots_farm_id" ON "lots" ("farm_id");

CREATE TABLE "animal_movements" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "animal_id" uuid NOT NULL,
  "moved_at" timestamptz NOT NULL,
  "from_paddock_id" uuid,
  "to_paddock_id" uuid,
  "from_lot_id" uuid,
  "to_lot_id" uuid,
  "from_farm_id" uuid,
  "to_farm_id" uuid,
  "reason" varchar(255),
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id")
);
CREATE INDEX "ix_animal_movements_tenant_id" ON "animal_movements" ("tenant_id");
CREATE INDEX "ix_animal_movements_animal_id" ON "animal_movements" ("animal_id");

CREATE TABLE "animal_events" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "animal_id" uuid NOT NULL,
  "event_type" varchar(255) NOT NULL,
  "payload" jsonb NOT NULL,
  "occurred_at" timestamptz NOT NULL,
  "recorded_at" timestamptz NOT NULL,
  "device_id" uuid,
  "source" varchar(255) DEFAULT 'manual' NOT NULL CHECK ("source" IN ('manual','sensor','scale','import','ai')),
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id")
);
CREATE INDEX "ix_animal_events_tenant_id" ON "animal_events" ("tenant_id");
CREATE INDEX "ix_animal_events_animal_id" ON "animal_events" ("animal_id");
CREATE INDEX "ix_animal_events_event_type" ON "animal_events" ("event_type");
CREATE INDEX "ix_animal_events_occurred_at" ON "animal_events" ("occurred_at");

-- ============================================================================
-- MÓDULO: Reproducción y Genética
-- ============================================================================

CREATE TABLE "breeding_events" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "animal_id" uuid NOT NULL,
  "type" varchar(255) NOT NULL CHECK ("type" IN ('heat','service_natural','service_ai','embryo_transfer','synchronization')),
  "occurred_at" timestamptz NOT NULL,
  "sire_id" uuid,
  "semen_batch_id" uuid,
  "embryo_id" uuid,
  "technician_id" uuid,
  "protocol_id" uuid,
  "notes" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id")
);
CREATE INDEX "ix_breeding_events_tenant_id" ON "breeding_events" ("tenant_id");
CREATE INDEX "ix_breeding_events_animal_id" ON "breeding_events" ("animal_id");

CREATE TABLE "repro_protocols" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "name" varchar(255) NOT NULL,
  "species_id" uuid NOT NULL,
  "steps" jsonb DEFAULT '[]' NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id")
);
CREATE INDEX "ix_repro_protocols_tenant_id" ON "repro_protocols" ("tenant_id");

CREATE TABLE "pregnancies" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "animal_id" uuid NOT NULL,
  "breeding_event_id" uuid,
  "diagnosis_date" date NOT NULL,
  "method" varchar(255) CHECK ("method" IN ('palpation','ultrasound','blood','visual')),
  "expected_due_date" date,
  "status" varchar(255) DEFAULT 'open' NOT NULL CHECK ("status" IN ('open','calved','aborted','lost')),
  "closed_at" date,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id")
);
CREATE INDEX "ix_pregnancies_tenant_id" ON "pregnancies" ("tenant_id");
CREATE INDEX "ix_pregnancies_animal_id" ON "pregnancies" ("animal_id");

CREATE TABLE "calvings" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "pregnancy_id" uuid,
  "dam_id" uuid NOT NULL,
  "calving_date" date NOT NULL,
  "ease" smallint CHECK ("ease" IN ('1','2','3','4','5')),
  "offspring_count" smallint DEFAULT 1 NOT NULL,
  "notes" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id")
);
CREATE INDEX "ix_calvings_tenant_id" ON "calvings" ("tenant_id");
CREATE INDEX "ix_calvings_dam_id" ON "calvings" ("dam_id");

CREATE TABLE "calving_offspring" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "calving_id" uuid NOT NULL,
  "animal_id" uuid,
  "birth_weight_kg" numeric(14,3),
  "vitality" varchar(255) CHECK ("vitality" IN ('live','stillborn','died_soon')),
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id")
);
CREATE INDEX "ix_calving_offspring_tenant_id" ON "calving_offspring" ("tenant_id");
CREATE INDEX "ix_calving_offspring_calving_id" ON "calving_offspring" ("calving_id");

CREATE TABLE "weanings" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "animal_id" uuid NOT NULL,
  "weaning_date" date NOT NULL,
  "weaning_weight_kg" numeric(14,3),
  "dam_id" uuid,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id")
);
CREATE INDEX "ix_weanings_tenant_id" ON "weanings" ("tenant_id");
CREATE INDEX "ix_weanings_animal_id" ON "weanings" ("animal_id");

CREATE TABLE "semen_batches" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "sire_id" uuid,
  "sire_name_external" varchar(255),
  "breed_id" uuid,
  "supplier_id" uuid,
  "batch_code" varchar(255) NOT NULL,
  "straws_available" integer DEFAULT 0 NOT NULL,
  "tank_id" uuid,
  "canister" varchar(255),
  "acquired_date" date,
  "unit_cost" numeric(16,2),
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id")
);
CREATE INDEX "ix_semen_batches_tenant_id" ON "semen_batches" ("tenant_id");

CREATE TABLE "embryos" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "donor_dam_id" uuid,
  "sire_id" uuid,
  "semen_batch_id" uuid,
  "stage" varchar(255),
  "grade" varchar(255),
  "production_method" varchar(255) CHECK ("production_method" IN ('in_vivo','ivf')),
  "straws_available" integer DEFAULT 0 NOT NULL,
  "tank_id" uuid,
  "created_date" date,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id")
);
CREATE INDEX "ix_embryos_tenant_id" ON "embryos" ("tenant_id");

CREATE TABLE "storage_tanks" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "farm_id" uuid NOT NULL,
  "name" varchar(255) NOT NULL,
  "capacity" integer,
  "nitrogen_level" varchar(255),
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id")
);
CREATE INDEX "ix_storage_tanks_tenant_id" ON "storage_tanks" ("tenant_id");

CREATE TABLE "genetic_evaluations" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "animal_id" uuid NOT NULL,
  "source" varchar(255),
  "evaluation_date" date,
  "traits" jsonb DEFAULT '{}' NOT NULL,
  "lab_sample_id" uuid,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id")
);
CREATE INDEX "ix_genetic_evaluations_tenant_id" ON "genetic_evaluations" ("tenant_id");
CREATE INDEX "ix_genetic_evaluations_animal_id" ON "genetic_evaluations" ("animal_id");

-- ============================================================================
-- MÓDULO: Sanidad
-- ============================================================================

CREATE TABLE "products_veterinary" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "name" varchar(255) NOT NULL,
  "type" varchar(255) NOT NULL CHECK ("type" IN ('vaccine','antibiotic','antiparasitic','vitamin','hormone','other')),
  "active_ingredient" varchar(255),
  "manufacturer" varchar(255),
  "withdrawal_meat_days" smallint,
  "withdrawal_milk_hours" smallint,
  "default_dose" varchar(255),
  "inventory_item_id" uuid,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id")
);
CREATE INDEX "ix_products_veterinary_tenant_id" ON "products_veterinary" ("tenant_id");

CREATE TABLE "vaccinations" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "animal_id" uuid NOT NULL,
  "product_id" uuid NOT NULL,
  "applied_at" timestamptz NOT NULL,
  "dose" numeric(14,3),
  "dose_unit" varchar(255),
  "batch_number" varchar(255),
  "applied_by" uuid,
  "next_due_date" date,
  "plan_id" uuid,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id")
);
CREATE INDEX "ix_vaccinations_tenant_id" ON "vaccinations" ("tenant_id");
CREATE INDEX "ix_vaccinations_animal_id" ON "vaccinations" ("animal_id");

CREATE TABLE "treatments" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "animal_id" uuid NOT NULL,
  "diagnosis_id" uuid,
  "product_id" uuid,
  "applied_at" timestamptz NOT NULL,
  "dose" numeric(14,3),
  "dose_unit" varchar(255),
  "route" varchar(255) CHECK ("route" IN ('im','sc','iv','oral','topical','intramammary')),
  "meat_withdrawal_until" date,
  "milk_withdrawal_until" timestamptz,
  "applied_by" uuid,
  "cost" numeric(16,2),
  "notes" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id")
);
CREATE INDEX "ix_treatments_tenant_id" ON "treatments" ("tenant_id");
CREATE INDEX "ix_treatments_animal_id" ON "treatments" ("animal_id");

CREATE TABLE "health_events" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "animal_id" uuid NOT NULL,
  "diagnosis_id" uuid,
  "occurred_at" timestamptz NOT NULL,
  "severity" varchar(255) CHECK ("severity" IN ('mild','moderate','severe')),
  "outcome" varchar(255) CHECK ("outcome" IN ('recovered','ongoing','referred','died')),
  "examined_by" uuid,
  "notes" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id")
);
CREATE INDEX "ix_health_events_tenant_id" ON "health_events" ("tenant_id");
CREATE INDEX "ix_health_events_animal_id" ON "health_events" ("animal_id");

CREATE TABLE "health_plans" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "name" varchar(255) NOT NULL,
  "species_id" uuid NOT NULL,
  "schedule" jsonb DEFAULT '[]' NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id")
);
CREATE INDEX "ix_health_plans_tenant_id" ON "health_plans" ("tenant_id");

CREATE TABLE "mortalities" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "animal_id" uuid NOT NULL UNIQUE,
  "died_at" timestamptz NOT NULL,
  "cause_diagnosis_id" uuid,
  "necropsy" boolean DEFAULT false NOT NULL,
  "lab_sample_id" uuid,
  "estimated_loss" numeric(16,2),
  "notes" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id")
);
CREATE INDEX "ix_mortalities_tenant_id" ON "mortalities" ("tenant_id");

-- ============================================================================
-- MÓDULO: Producción
-- ============================================================================

CREATE TABLE "weighings" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "animal_id" uuid NOT NULL,
  "weighed_at" timestamptz NOT NULL,
  "weight_kg" numeric(14,3) NOT NULL,
  "method" varchar(255) DEFAULT 'scale' NOT NULL CHECK ("method" IN ('scale','visual','tape','image')),
  "device_id" uuid,
  "adg_since_last" numeric(14,3),
  "body_condition" numeric(14,3),
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id")
);
CREATE INDEX "ix_weighings_tenant_id" ON "weighings" ("tenant_id");
CREATE INDEX "ix_weighings_animal_id" ON "weighings" ("animal_id");
CREATE INDEX "ix_weighings_weighed_at" ON "weighings" ("weighed_at");
CREATE INDEX "ix_weighings_tenant_animal_weighed_at" ON "weighings" ("tenant_id", "animal_id", "weighed_at");

CREATE VIEW "v_weighings" AS
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

CREATE TABLE "milk_production_daily" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "animal_id" uuid NOT NULL,
  "production_date" date NOT NULL,
  "total_liters" numeric(14,3) NOT NULL,
  "milking_count" smallint,
  "device_id" uuid,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id"),
  UNIQUE ("animal_id", "production_date")
);
CREATE INDEX "ix_milk_production_daily_tenant_id" ON "milk_production_daily" ("tenant_id");
CREATE INDEX "ix_milk_production_daily_animal_id" ON "milk_production_daily" ("animal_id");
CREATE INDEX "ix_milk_production_daily_production_date" ON "milk_production_daily" ("production_date");

CREATE TABLE "milk_quality_tests" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "animal_id" uuid,
  "tank_id" uuid,
  "sample_date" date NOT NULL,
  "fat_pct" numeric(14,3),
  "protein_pct" numeric(14,3),
  "scc" integer,
  "lab_sample_id" uuid,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id")
);
CREATE INDEX "ix_milk_quality_tests_tenant_id" ON "milk_quality_tests" ("tenant_id");

CREATE TABLE "milk_tanks" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "farm_id" uuid NOT NULL,
  "name" varchar(255) NOT NULL,
  "capacity_liters" numeric(14,3),
  "device_id" uuid,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id")
);
CREATE INDEX "ix_milk_tanks_tenant_id" ON "milk_tanks" ("tenant_id");

CREATE TABLE "milk_deliveries" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "tank_id" uuid,
  "delivered_at" timestamptz NOT NULL,
  "liters" numeric(14,3) NOT NULL,
  "buyer_id" uuid,
  "price_per_liter" numeric(18,4),
  "sale_id" uuid,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id")
);
CREATE INDEX "ix_milk_deliveries_tenant_id" ON "milk_deliveries" ("tenant_id");

CREATE TABLE "carcass_records" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "animal_id" uuid NOT NULL UNIQUE,
  "slaughter_date" date NOT NULL,
  "slaughterhouse_id" uuid,
  "hot_carcass_weight_kg" numeric(14,3),
  "dressing_pct" numeric(14,3),
  "fat_grade" varchar(255),
  "conformation" varchar(255),
  "marbling" varchar(255),
  "sale_id" uuid,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id")
);
CREATE INDEX "ix_carcass_records_tenant_id" ON "carcass_records" ("tenant_id");

CREATE TABLE "shearing_records" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "animal_id" uuid NOT NULL,
  "shearing_date" date NOT NULL,
  "fleece_weight_kg" numeric(14,3),
  "micron" numeric(14,3),
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id")
);
CREATE INDEX "ix_shearing_records_tenant_id" ON "shearing_records" ("tenant_id");
CREATE INDEX "ix_shearing_records_animal_id" ON "shearing_records" ("animal_id");

-- ============================================================================
-- MÓDULO: Nutrición
-- ============================================================================

CREATE TABLE "rations" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "name" varchar(255) NOT NULL,
  "target_category_id" uuid,
  "dry_matter_pct" numeric(14,3),
  "metabolizable_energy" numeric(14,3),
  "crude_protein_pct" numeric(14,3),
  "cost_per_kg" numeric(18,4),
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id")
);
CREATE INDEX "ix_rations_tenant_id" ON "rations" ("tenant_id");

CREATE TABLE "ration_ingredients" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "ration_id" uuid NOT NULL,
  "inventory_item_id" uuid NOT NULL,
  "pct" numeric(14,3) NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id")
);
CREATE INDEX "ix_ration_ingredients_tenant_id" ON "ration_ingredients" ("tenant_id");
CREATE INDEX "ix_ration_ingredients_ration_id" ON "ration_ingredients" ("ration_id");

CREATE TABLE "feed_deliveries" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "lot_id" uuid NOT NULL,
  "ration_id" uuid,
  "delivered_at" timestamptz NOT NULL,
  "quantity_kg" numeric(14,3) NOT NULL,
  "animals_count" integer,
  "total_cost" numeric(16,2),
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id")
);
CREATE INDEX "ix_feed_deliveries_tenant_id" ON "feed_deliveries" ("tenant_id");
CREATE INDEX "ix_feed_deliveries_lot_id" ON "feed_deliveries" ("lot_id");

CREATE TABLE "grazing_records" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "paddock_id" uuid NOT NULL,
  "lot_id" uuid NOT NULL,
  "entry_date" date NOT NULL,
  "exit_date" date,
  "pre_grazing_kg_dm_ha" numeric(14,3),
  "post_grazing_kg_dm_ha" numeric(14,3),
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id")
);
CREATE INDEX "ix_grazing_records_tenant_id" ON "grazing_records" ("tenant_id");
CREATE INDEX "ix_grazing_records_paddock_id" ON "grazing_records" ("paddock_id");

-- ============================================================================
-- MÓDULO: Tierra y Cultivos
-- ============================================================================

CREATE TABLE "paddocks" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "farm_id" uuid NOT NULL,
  "name" varchar(255) NOT NULL,
  "boundary" geography(Polygon,4326),
  "area_ha" numeric(14,3),
  "pasture_type" varchar(255),
  "carrying_capacity" numeric(14,3),
  "water_source" varchar(255),
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id")
);
CREATE INDEX "ix_paddocks_tenant_id" ON "paddocks" ("tenant_id");
CREATE INDEX "ix_paddocks_farm_id" ON "paddocks" ("farm_id");

CREATE TABLE "crops" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "paddock_id" uuid NOT NULL,
  "crop_type" varchar(255) NOT NULL,
  "variety" varchar(255),
  "planting_date" date,
  "expected_harvest_date" date,
  "area_ha" numeric(14,3),
  "status" varchar(255) DEFAULT 'planned' NOT NULL CHECK ("status" IN ('planned','growing','harvested','failed')),
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id")
);
CREATE INDEX "ix_crops_tenant_id" ON "crops" ("tenant_id");
CREATE INDEX "ix_crops_paddock_id" ON "crops" ("paddock_id");

CREATE TABLE "crop_operations" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "crop_id" uuid NOT NULL,
  "operation_type" varchar(255) NOT NULL CHECK ("operation_type" IN ('planting','fertilization','spraying','irrigation','harvest','tillage')),
  "performed_at" timestamptz NOT NULL,
  "inventory_item_id" uuid,
  "quantity" numeric(14,3),
  "machinery_id" uuid,
  "operator_id" uuid,
  "cost" numeric(16,2),
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id")
);
CREATE INDEX "ix_crop_operations_tenant_id" ON "crop_operations" ("tenant_id");
CREATE INDEX "ix_crop_operations_crop_id" ON "crop_operations" ("crop_id");

CREATE TABLE "harvests" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "crop_id" uuid NOT NULL,
  "harvest_date" date NOT NULL,
  "yield_quantity" numeric(14,3) NOT NULL,
  "yield_unit" varchar(255),
  "yield_per_ha" numeric(14,3),
  "moisture_pct" numeric(14,3),
  "destination_item_id" uuid,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id")
);
CREATE INDEX "ix_harvests_tenant_id" ON "harvests" ("tenant_id");
CREATE INDEX "ix_harvests_crop_id" ON "harvests" ("crop_id");

CREATE TABLE "soil_analyses" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "paddock_id" uuid NOT NULL,
  "sample_date" date NOT NULL,
  "ph" numeric(14,3),
  "organic_matter_pct" numeric(14,3),
  "nutrients" jsonb DEFAULT '{}' NOT NULL,
  "lab_sample_id" uuid,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id")
);
CREATE INDEX "ix_soil_analyses_tenant_id" ON "soil_analyses" ("tenant_id");
CREATE INDEX "ix_soil_analyses_paddock_id" ON "soil_analyses" ("paddock_id");

-- ============================================================================
-- MÓDULO: Inventario, Activos y Maquinaria
-- ============================================================================

CREATE TABLE "warehouses" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "farm_id" uuid NOT NULL,
  "name" varchar(255) NOT NULL,
  "location" geography(Point,4326),
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id")
);
CREATE INDEX "ix_warehouses_tenant_id" ON "warehouses" ("tenant_id");
CREATE INDEX "ix_warehouses_farm_id" ON "warehouses" ("farm_id");

CREATE TABLE "inventory_categories" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "parent_id" uuid,
  "name" varchar(255) NOT NULL,
  "kind" varchar(255) NOT NULL CHECK ("kind" IN ('feed','veterinary','agrochemical','seed','fuel','spare_part','supply','product')),
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id")
);
CREATE INDEX "ix_inventory_categories_tenant_id" ON "inventory_categories" ("tenant_id");

CREATE TABLE "inventory_items" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "category_id" uuid,
  "name" varchar(255) NOT NULL,
  "sku" varchar(255),
  "unit" varchar(255) NOT NULL,
  "track_batches" boolean DEFAULT false NOT NULL,
  "reorder_point" numeric(14,3),
  "standard_cost" numeric(18,4),
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id")
);
CREATE INDEX "ix_inventory_items_tenant_id" ON "inventory_items" ("tenant_id");

CREATE TABLE "inventory_batches" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "item_id" uuid NOT NULL,
  "batch_number" varchar(255) NOT NULL,
  "expiry_date" date,
  "supplier_id" uuid,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id")
);
CREATE INDEX "ix_inventory_batches_tenant_id" ON "inventory_batches" ("tenant_id");
CREATE INDEX "ix_inventory_batches_item_id" ON "inventory_batches" ("item_id");

CREATE TABLE "stock_levels" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "item_id" uuid NOT NULL,
  "warehouse_id" uuid NOT NULL,
  "batch_id" uuid,
  "quantity" numeric(14,3) DEFAULT 0 NOT NULL,
  "avg_cost" numeric(18,4),
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id"),
  UNIQUE ("item_id", "warehouse_id", "batch_id")
);
CREATE INDEX "ix_stock_levels_tenant_id" ON "stock_levels" ("tenant_id");
CREATE INDEX "ix_stock_levels_item_id" ON "stock_levels" ("item_id");

CREATE TABLE "stock_movements" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "item_id" uuid NOT NULL,
  "warehouse_id" uuid NOT NULL,
  "batch_id" uuid,
  "movement_type" varchar(255) NOT NULL CHECK ("movement_type" IN ('in','out','adjustment','transfer','consumption')),
  "quantity" numeric(14,3) NOT NULL,
  "unit_cost" numeric(18,4),
  "occurred_at" timestamptz NOT NULL,
  "reference_type" varchar(255),
  "reference_id" uuid,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id")
);
CREATE INDEX "ix_stock_movements_tenant_id" ON "stock_movements" ("tenant_id");
CREATE INDEX "ix_stock_movements_item_id" ON "stock_movements" ("item_id");

CREATE TABLE "assets" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "farm_id" uuid NOT NULL,
  "name" varchar(255) NOT NULL,
  "type" varchar(255) CHECK ("type" IN ('building','equipment','vehicle','improvement','other')),
  "acquisition_date" date,
  "acquisition_cost" numeric(16,2),
  "useful_life_years" smallint,
  "residual_value" numeric(16,2),
  "status" varchar(255) DEFAULT 'active' NOT NULL CHECK ("status" IN ('active','maintenance','retired','sold')),
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id")
);
CREATE INDEX "ix_assets_tenant_id" ON "assets" ("tenant_id");
CREATE INDEX "ix_assets_farm_id" ON "assets" ("farm_id");

CREATE TABLE "machinery" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "asset_id" uuid,
  "farm_id" uuid NOT NULL,
  "name" varchar(255) NOT NULL,
  "type" varchar(255) CHECK ("type" IN ('tractor','harvester','truck','atv','mixer','implement','other')),
  "make" varchar(255),
  "model" varchar(255),
  "year" smallint,
  "plate" varchar(255),
  "engine_hours" numeric(14,3),
  "odometer_km" numeric(14,3),
  "device_id" uuid,
  "status" varchar(255) DEFAULT 'active' NOT NULL CHECK ("status" IN ('active','maintenance','retired')),
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id")
);
CREATE INDEX "ix_machinery_tenant_id" ON "machinery" ("tenant_id");
CREATE INDEX "ix_machinery_farm_id" ON "machinery" ("farm_id");

CREATE TABLE "maintenance_records" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "machinery_id" uuid,
  "asset_id" uuid,
  "type" varchar(255) NOT NULL CHECK ("type" IN ('preventive','corrective','inspection')),
  "performed_at" timestamptz NOT NULL,
  "description" text,
  "engine_hours" numeric(14,3),
  "cost" numeric(16,2),
  "next_due_date" date,
  "performed_by" varchar(255),
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id")
);
CREATE INDEX "ix_maintenance_records_tenant_id" ON "maintenance_records" ("tenant_id");
CREATE INDEX "ix_maintenance_records_machinery_id" ON "maintenance_records" ("machinery_id");

CREATE TABLE "fuel_logs" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "machinery_id" uuid,
  "fueled_at" timestamptz NOT NULL,
  "item_id" uuid,
  "liters" numeric(14,3) NOT NULL,
  "odometer_km" numeric(14,3),
  "engine_hours" numeric(14,3),
  "unit_cost" numeric(18,4),
  "total_cost" numeric(16,2),
  "operator_id" uuid,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id")
);
CREATE INDEX "ix_fuel_logs_tenant_id" ON "fuel_logs" ("tenant_id");
CREATE INDEX "ix_fuel_logs_machinery_id" ON "fuel_logs" ("machinery_id");

-- ============================================================================
-- MÓDULO: Laboratorio
-- ============================================================================

CREATE TABLE "labs" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "name" varchar(255) NOT NULL,
  "type" varchar(255) CHECK ("type" IN ('genetics','pathology','milk','soil','serology','other')),
  "contact" jsonb,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id")
);
CREATE INDEX "ix_labs_tenant_id" ON "labs" ("tenant_id");

CREATE TABLE "lab_samples" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "lab_id" uuid,
  "sample_type" varchar(255) NOT NULL CHECK ("sample_type" IN ('blood','tissue','milk','soil','hair','semen','feces','other')),
  "animal_id" uuid,
  "paddock_id" uuid,
  "collected_at" timestamptz NOT NULL,
  "sent_at" timestamptz,
  "status" varchar(255) DEFAULT 'collected' NOT NULL CHECK ("status" IN ('collected','sent','in_progress','completed','rejected')),
  "barcode" varchar(255),
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id")
);
CREATE INDEX "ix_lab_samples_tenant_id" ON "lab_samples" ("tenant_id");
CREATE INDEX "ix_lab_samples_animal_id" ON "lab_samples" ("animal_id");

CREATE TABLE "lab_results" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "sample_id" uuid NOT NULL,
  "test_code" varchar(255) NOT NULL,
  "result_value" varchar(255),
  "result_data" jsonb DEFAULT '{}' NOT NULL,
  "reference_range" varchar(255),
  "is_abnormal" boolean,
  "reported_at" timestamptz,
  "document_id" uuid,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id")
);
CREATE INDEX "ix_lab_results_tenant_id" ON "lab_results" ("tenant_id");
CREATE INDEX "ix_lab_results_sample_id" ON "lab_results" ("sample_id");

-- ============================================================================
-- MÓDULO: Comercial
-- ============================================================================

CREATE TABLE "business_partners" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "company_id" uuid NOT NULL,
  "type" varchar(255) NOT NULL CHECK ("type" IN ('customer','supplier','both')),
  "name" varchar(255) NOT NULL,
  "tax_id" varchar(255),
  "email" varchar(255),
  "phone" varchar(255),
  "address" jsonb,
  "credit_limit" numeric(16,2),
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id")
);
CREATE INDEX "ix_business_partners_tenant_id" ON "business_partners" ("tenant_id");
CREATE INDEX "ix_business_partners_company_id" ON "business_partners" ("company_id");

CREATE TABLE "customers" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "partner_id" uuid NOT NULL UNIQUE,
  "segment" varchar(255) CHECK ("segment" IN ('slaughterhouse','dairy','auction','breeder','retail','export','other')),
  "payment_terms_days" smallint,
  "price_list_id" uuid,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id")
);
CREATE INDEX "ix_customers_tenant_id" ON "customers" ("tenant_id");

CREATE TABLE "suppliers" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "partner_id" uuid NOT NULL UNIQUE,
  "category" varchar(255) CHECK ("category" IN ('feed','veterinary','genetics','machinery','fuel','services','other')),
  "payment_terms_days" smallint,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id")
);
CREATE INDEX "ix_suppliers_tenant_id" ON "suppliers" ("tenant_id");

CREATE TABLE "contacts" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "partner_id" uuid NOT NULL,
  "name" varchar(255) NOT NULL,
  "role" varchar(255),
  "email" varchar(255),
  "phone" varchar(255),
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id")
);
CREATE INDEX "ix_contacts_tenant_id" ON "contacts" ("tenant_id");
CREATE INDEX "ix_contacts_partner_id" ON "contacts" ("partner_id");

CREATE TABLE "price_lists" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "company_id" uuid NOT NULL,
  "name" varchar(255) NOT NULL,
  "currency" varchar(3) NOT NULL,
  "valid_from" date,
  "valid_until" date,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id")
);
CREATE INDEX "ix_price_lists_tenant_id" ON "price_lists" ("tenant_id");

CREATE TABLE "purchases" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "company_id" uuid NOT NULL,
  "supplier_partner_id" uuid NOT NULL,
  "document_number" varchar(255),
  "purchase_date" date NOT NULL,
  "currency" varchar(3) NOT NULL,
  "subtotal" numeric(16,2) DEFAULT 0 NOT NULL,
  "tax_total" numeric(16,2) DEFAULT 0 NOT NULL,
  "total" numeric(16,2) DEFAULT 0 NOT NULL,
  "status" varchar(255) DEFAULT 'draft' NOT NULL CHECK ("status" IN ('draft','confirmed','received','paid','canceled')),
  "journal_entry_id" uuid,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id")
);
CREATE INDEX "ix_purchases_tenant_id" ON "purchases" ("tenant_id");
CREATE INDEX "ix_purchases_company_id" ON "purchases" ("company_id");

CREATE TABLE "purchase_lines" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "purchase_id" uuid NOT NULL,
  "item_id" uuid,
  "animal_id" uuid,
  "description" varchar(255),
  "quantity" numeric(14,3) NOT NULL,
  "unit_price" numeric(18,4) NOT NULL,
  "tax_rate" numeric(14,3) DEFAULT 0 NOT NULL,
  "line_total" numeric(16,2) NOT NULL,
  "warehouse_id" uuid,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id")
);
CREATE INDEX "ix_purchase_lines_tenant_id" ON "purchase_lines" ("tenant_id");
CREATE INDEX "ix_purchase_lines_purchase_id" ON "purchase_lines" ("purchase_id");

CREATE TABLE "sales" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "company_id" uuid NOT NULL,
  "customer_partner_id" uuid NOT NULL,
  "document_number" varchar(255),
  "sale_date" date NOT NULL,
  "type" varchar(255) NOT NULL CHECK ("type" IN ('livestock','milk','crop','product','service','other')),
  "currency" varchar(3) NOT NULL,
  "subtotal" numeric(16,2) DEFAULT 0 NOT NULL,
  "tax_total" numeric(16,2) DEFAULT 0 NOT NULL,
  "total" numeric(16,2) DEFAULT 0 NOT NULL,
  "status" varchar(255) DEFAULT 'draft' NOT NULL CHECK ("status" IN ('draft','confirmed','delivered','invoiced','paid','canceled')),
  "journal_entry_id" uuid,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id")
);
CREATE INDEX "ix_sales_tenant_id" ON "sales" ("tenant_id");
CREATE INDEX "ix_sales_company_id" ON "sales" ("company_id");

CREATE TABLE "sale_lines" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "sale_id" uuid NOT NULL,
  "item_id" uuid,
  "animal_id" uuid,
  "description" varchar(255),
  "quantity" numeric(14,3) NOT NULL,
  "unit_price" numeric(18,4) NOT NULL,
  "weight_kg" numeric(14,3),
  "tax_rate" numeric(14,3) DEFAULT 0 NOT NULL,
  "line_total" numeric(16,2) NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id")
);
CREATE INDEX "ix_sale_lines_tenant_id" ON "sale_lines" ("tenant_id");
CREATE INDEX "ix_sale_lines_sale_id" ON "sale_lines" ("sale_id");

CREATE TABLE "invoices" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "company_id" uuid NOT NULL,
  "direction" varchar(255) NOT NULL CHECK ("direction" IN ('issued','received')),
  "sale_id" uuid,
  "purchase_id" uuid,
  "partner_id" uuid NOT NULL,
  "invoice_number" varchar(255) NOT NULL,
  "issue_date" date NOT NULL,
  "due_date" date,
  "currency" varchar(3) NOT NULL,
  "total" numeric(16,2) NOT NULL,
  "tax_authority_status" varchar(255),
  "status" varchar(255) DEFAULT 'issued' NOT NULL CHECK ("status" IN ('draft','issued','paid','void')),
  "document_id" uuid,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id")
);
CREATE INDEX "ix_invoices_tenant_id" ON "invoices" ("tenant_id");
CREATE INDEX "ix_invoices_company_id" ON "invoices" ("company_id");

CREATE TABLE "contracts" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "company_id" uuid NOT NULL,
  "partner_id" uuid NOT NULL,
  "type" varchar(255) NOT NULL CHECK ("type" IN ('supply','lease','capitalization','agistment','service','other')),
  "start_date" date NOT NULL,
  "end_date" date,
  "terms" text,
  "value" numeric(16,2),
  "status" varchar(255) DEFAULT 'active' NOT NULL CHECK ("status" IN ('draft','active','expired','terminated')),
  "document_id" uuid,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id")
);
CREATE INDEX "ix_contracts_tenant_id" ON "contracts" ("tenant_id");
CREATE INDEX "ix_contracts_company_id" ON "contracts" ("company_id");

CREATE TABLE "market_prices" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid,
  "product" varchar(255) NOT NULL,
  "market" varchar(255),
  "price_date" date NOT NULL,
  "price" numeric(18,4) NOT NULL,
  "currency" varchar(3) NOT NULL,
  "unit" varchar(255),
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id")
);
CREATE INDEX "ix_market_prices_tenant_id" ON "market_prices" ("tenant_id");

-- ============================================================================
-- MÓDULO: Finanzas y Contabilidad
-- ============================================================================

CREATE TABLE "chart_of_accounts" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "company_id" uuid NOT NULL,
  "code" varchar(255) NOT NULL,
  "name" varchar(255) NOT NULL,
  "type" varchar(255) NOT NULL CHECK ("type" IN ('asset','liability','equity','income','expense')),
  "parent_id" uuid,
  "is_postable" boolean DEFAULT true NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id"),
  UNIQUE ("company_id", "code")
);
CREATE INDEX "ix_chart_of_accounts_tenant_id" ON "chart_of_accounts" ("tenant_id");
CREATE INDEX "ix_chart_of_accounts_company_id" ON "chart_of_accounts" ("company_id");

CREATE TABLE "cost_centers" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "company_id" uuid NOT NULL,
  "name" varchar(255) NOT NULL,
  "level" varchar(255) NOT NULL CHECK ("level" IN ('company','farm','paddock','lot','animal','crop','machinery')),
  "farm_id" uuid,
  "reference_id" uuid,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id")
);
CREATE INDEX "ix_cost_centers_tenant_id" ON "cost_centers" ("tenant_id");
CREATE INDEX "ix_cost_centers_company_id" ON "cost_centers" ("company_id");

CREATE TABLE "fiscal_periods" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "company_id" uuid NOT NULL,
  "name" varchar(255) NOT NULL,
  "start_date" date NOT NULL,
  "end_date" date NOT NULL,
  "status" varchar(255) DEFAULT 'open' NOT NULL CHECK ("status" IN ('open','closed')),
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id")
);
CREATE INDEX "ix_fiscal_periods_tenant_id" ON "fiscal_periods" ("tenant_id");
CREATE INDEX "ix_fiscal_periods_company_id" ON "fiscal_periods" ("company_id");

CREATE TABLE "journal_entries" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "company_id" uuid NOT NULL,
  "period_id" uuid,
  "entry_date" date NOT NULL,
  "reference" varchar(255),
  "source_type" varchar(255),
  "source_id" uuid,
  "currency" varchar(3) NOT NULL,
  "status" varchar(255) DEFAULT 'posted' NOT NULL CHECK ("status" IN ('draft','posted','reversed')),
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id")
);
CREATE INDEX "ix_journal_entries_tenant_id" ON "journal_entries" ("tenant_id");
CREATE INDEX "ix_journal_entries_company_id" ON "journal_entries" ("company_id");

CREATE TABLE "journal_lines" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "entry_id" uuid NOT NULL,
  "account_id" uuid NOT NULL,
  "cost_center_id" uuid,
  "debit" numeric(16,2) DEFAULT 0 NOT NULL,
  "credit" numeric(16,2) DEFAULT 0 NOT NULL,
  "currency_amount" numeric(16,2),
  "exchange_rate" numeric(20,6),
  "description" varchar(255),
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id")
);
CREATE INDEX "ix_journal_lines_tenant_id" ON "journal_lines" ("tenant_id");
CREATE INDEX "ix_journal_lines_entry_id" ON "journal_lines" ("entry_id");

CREATE TABLE "payments" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "company_id" uuid NOT NULL,
  "direction" varchar(255) NOT NULL CHECK ("direction" IN ('inbound','outbound')),
  "partner_id" uuid,
  "payment_date" date NOT NULL,
  "amount" numeric(16,2) NOT NULL,
  "currency" varchar(3) NOT NULL,
  "method" varchar(255) CHECK ("method" IN ('cash','transfer','check','card','other')),
  "account_id" uuid,
  "journal_entry_id" uuid,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id")
);
CREATE INDEX "ix_payments_tenant_id" ON "payments" ("tenant_id");
CREATE INDEX "ix_payments_company_id" ON "payments" ("company_id");

CREATE TABLE "payment_allocations" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "payment_id" uuid NOT NULL,
  "invoice_id" uuid NOT NULL,
  "amount" numeric(16,2) NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id")
);
CREATE INDEX "ix_payment_allocations_tenant_id" ON "payment_allocations" ("tenant_id");
CREATE INDEX "ix_payment_allocations_payment_id" ON "payment_allocations" ("payment_id");

CREATE TABLE "budgets" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "company_id" uuid NOT NULL,
  "name" varchar(255) NOT NULL,
  "fiscal_year" smallint NOT NULL,
  "status" varchar(255) DEFAULT 'draft' NOT NULL CHECK ("status" IN ('draft','approved','closed')),
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id")
);
CREATE INDEX "ix_budgets_tenant_id" ON "budgets" ("tenant_id");
CREATE INDEX "ix_budgets_company_id" ON "budgets" ("company_id");

CREATE TABLE "budget_lines" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "budget_id" uuid NOT NULL,
  "account_id" uuid NOT NULL,
  "cost_center_id" uuid,
  "month" smallint NOT NULL,
  "amount" numeric(16,2) NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id")
);
CREATE INDEX "ix_budget_lines_tenant_id" ON "budget_lines" ("tenant_id");
CREATE INDEX "ix_budget_lines_budget_id" ON "budget_lines" ("budget_id");

CREATE TABLE "bank_accounts" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "company_id" uuid NOT NULL,
  "name" varchar(255) NOT NULL,
  "bank_name" varchar(255),
  "account_number" varchar(255),
  "currency" varchar(3) NOT NULL,
  "ledger_account_id" uuid,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id")
);
CREATE INDEX "ix_bank_accounts_tenant_id" ON "bank_accounts" ("tenant_id");
CREATE INDEX "ix_bank_accounts_company_id" ON "bank_accounts" ("company_id");

-- ============================================================================
-- MÓDULO: Personas y Trabajo
-- ============================================================================

CREATE TABLE "employees" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "company_id" uuid NOT NULL,
  "user_id" uuid,
  "full_name" varchar(255) NOT NULL,
  "role" varchar(255),
  "employment_type" varchar(255) CHECK ("employment_type" IN ('permanent','temporary','contractor')),
  "hire_date" date,
  "termination_date" date,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id")
);
CREATE INDEX "ix_employees_tenant_id" ON "employees" ("tenant_id");
CREATE INDEX "ix_employees_company_id" ON "employees" ("company_id");

CREATE TABLE "work_logs" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "employee_id" uuid NOT NULL,
  "work_date" date NOT NULL,
  "hours" numeric(14,3),
  "task_id" uuid,
  "farm_id" uuid,
  "notes" varchar(255),
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id")
);
CREATE INDEX "ix_work_logs_tenant_id" ON "work_logs" ("tenant_id");
CREATE INDEX "ix_work_logs_employee_id" ON "work_logs" ("employee_id");

CREATE TABLE "payroll_runs" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "company_id" uuid NOT NULL,
  "period" date NOT NULL,
  "status" varchar(255) DEFAULT 'draft' NOT NULL CHECK ("status" IN ('draft','approved','paid')),
  "total_amount" numeric(16,2) DEFAULT 0 NOT NULL,
  "journal_entry_id" uuid,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id")
);
CREATE INDEX "ix_payroll_runs_tenant_id" ON "payroll_runs" ("tenant_id");
CREATE INDEX "ix_payroll_runs_company_id" ON "payroll_runs" ("company_id");

CREATE TABLE "payroll_items" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "payroll_run_id" uuid NOT NULL,
  "employee_id" uuid NOT NULL,
  "gross" numeric(16,2) NOT NULL,
  "deductions" numeric(16,2) DEFAULT 0 NOT NULL,
  "net" numeric(16,2) NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id")
);
CREATE INDEX "ix_payroll_items_tenant_id" ON "payroll_items" ("tenant_id");
CREATE INDEX "ix_payroll_items_payroll_run_id" ON "payroll_items" ("payroll_run_id");

-- ============================================================================
-- MÓDULO: Calendario, Tareas y Notificaciones
-- ============================================================================

CREATE TABLE "tasks" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "farm_id" uuid,
  "title" varchar(255) NOT NULL,
  "description" text,
  "type" varchar(255) CHECK ("type" IN ('health','breeding','feeding','maintenance','crop','general')),
  "due_date" timestamptz,
  "priority" varchar(255) DEFAULT 'normal' NOT NULL CHECK ("priority" IN ('low','normal','high','urgent')),
  "status" varchar(255) DEFAULT 'pending' NOT NULL CHECK ("status" IN ('pending','in_progress','done','canceled')),
  "assigned_to" uuid,
  "related_type" varchar(255),
  "related_id" uuid,
  "completed_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id")
);
CREATE INDEX "ix_tasks_tenant_id" ON "tasks" ("tenant_id");
CREATE INDEX "ix_tasks_farm_id" ON "tasks" ("farm_id");

CREATE TABLE "calendar_events" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "farm_id" uuid,
  "title" varchar(255) NOT NULL,
  "starts_at" timestamptz NOT NULL,
  "ends_at" timestamptz,
  "all_day" boolean DEFAULT false NOT NULL,
  "recurrence_rule" varchar(255),
  "location" varchar(255),
  "created_by" uuid,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id")
);
CREATE INDEX "ix_calendar_events_tenant_id" ON "calendar_events" ("tenant_id");
CREATE INDEX "ix_calendar_events_farm_id" ON "calendar_events" ("farm_id");

CREATE TABLE "alert_rules" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "farm_id" uuid,
  "name" varchar(255) NOT NULL,
  "category" varchar(255) NOT NULL CHECK ("category" IN ('health','inventory','reproduction','iot','finance','task')),
  "condition" jsonb NOT NULL,
  "severity" varchar(255) DEFAULT 'info' NOT NULL CHECK ("severity" IN ('info','warning','critical')),
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id")
);
CREATE INDEX "ix_alert_rules_tenant_id" ON "alert_rules" ("tenant_id");

CREATE TABLE "alerts" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "rule_id" uuid,
  "category" varchar(255) NOT NULL,
  "severity" varchar(255) NOT NULL CHECK ("severity" IN ('info','warning','critical')),
  "title" varchar(255) NOT NULL,
  "message" text,
  "related_type" varchar(255),
  "related_id" uuid,
  "status" varchar(255) DEFAULT 'open' NOT NULL CHECK ("status" IN ('open','acknowledged','resolved','dismissed')),
  "triggered_at" timestamptz NOT NULL,
  "resolved_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id")
);
CREATE INDEX "ix_alerts_tenant_id" ON "alerts" ("tenant_id");
CREATE INDEX "ix_alerts_rule_id" ON "alerts" ("rule_id");

CREATE TABLE "notifications" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "channel" varchar(255) NOT NULL CHECK ("channel" IN ('push','email','sms','whatsapp','in_app')),
  "title" varchar(255) NOT NULL,
  "body" text,
  "alert_id" uuid,
  "status" varchar(255) DEFAULT 'queued' NOT NULL CHECK ("status" IN ('queued','sent','delivered','read','failed')),
  "sent_at" timestamptz,
  "read_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id")
);
CREATE INDEX "ix_notifications_tenant_id" ON "notifications" ("tenant_id");
CREATE INDEX "ix_notifications_user_id" ON "notifications" ("user_id");

CREATE TABLE "notification_preferences" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "category" varchar(255) NOT NULL,
  "channels" jsonb DEFAULT '[]' NOT NULL,
  "quiet_hours" jsonb,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id"),
  UNIQUE ("user_id", "category")
);
CREATE INDEX "ix_notification_preferences_tenant_id" ON "notification_preferences" ("tenant_id");
CREATE INDEX "ix_notification_preferences_user_id" ON "notification_preferences" ("user_id");

-- ============================================================================
-- MÓDULO: Documentos y Media
-- ============================================================================

CREATE TABLE "files" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "bucket_key" varchar(255) NOT NULL,
  "file_name" varchar(255) NOT NULL,
  "mime_type" varchar(255) NOT NULL,
  "media_type" varchar(255) NOT NULL CHECK ("media_type" IN ('image','video','document','audio','other')),
  "size_bytes" bigint,
  "checksum" varchar(255),
  "width" integer,
  "height" integer,
  "duration_seconds" numeric(14,3),
  "taken_at" timestamptz,
  "location" geography(Point,4326),
  "uploaded_by" uuid,
  "sync_status" varchar(255) DEFAULT 'synced' NOT NULL CHECK ("sync_status" IN ('local','uploading','synced','failed')),
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id")
);
CREATE INDEX "ix_files_tenant_id" ON "files" ("tenant_id");

CREATE TABLE "attachments" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "file_id" uuid NOT NULL,
  "entity_type" varchar(255) NOT NULL,
  "entity_id" uuid NOT NULL,
  "role" varchar(255) CHECK ("role" IN ('photo','video','document','signature','avatar','other')),
  "caption" varchar(255),
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id")
);
CREATE INDEX "ix_attachments_tenant_id" ON "attachments" ("tenant_id");
CREATE INDEX "ix_attachments_file_id" ON "attachments" ("file_id");
CREATE INDEX "ix_attachments_entity_id" ON "attachments" ("entity_id");

CREATE TABLE "documents" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "file_id" uuid NOT NULL,
  "type" varchar(255) NOT NULL CHECK ("type" IN ('certificate','contract','invoice','health_guide','report','permit','other')),
  "title" varchar(255) NOT NULL,
  "issued_by" varchar(255),
  "issue_date" date,
  "expiry_date" date,
  "entity_type" varchar(255),
  "entity_id" uuid,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id")
);
CREATE INDEX "ix_documents_tenant_id" ON "documents" ("tenant_id");

-- ============================================================================
-- MÓDULO: IoT, GPS y Sensores
-- ============================================================================

CREATE TABLE "device_types" (
  "id" uuid DEFAULT gen_random_uuid(),
  "code" varchar(255) NOT NULL UNIQUE,
  "name" varchar(255) NOT NULL,
  "category" varchar(255) NOT NULL CHECK ("category" IN ('identification','weighing','wearable','environmental','machinery','gateway')),
  "protocol" varchar(255) CHECK ("protocol" IN ('mqtt','lorawan','bluetooth','isobus','http')),
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id")
);

CREATE TABLE "devices" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "farm_id" uuid NOT NULL,
  "device_type_id" uuid NOT NULL,
  "serial_number" varchar(255) NOT NULL,
  "name" varchar(255),
  "gateway_id" uuid,
  "assigned_animal_id" uuid,
  "assigned_machinery_id" uuid,
  "firmware_version" varchar(255),
  "battery_level" smallint,
  "last_seen_at" timestamptz,
  "status" varchar(255) DEFAULT 'active' NOT NULL CHECK ("status" IN ('provisioned','active','offline','retired')),
  "cert_fingerprint" varchar(255),
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id")
);
CREATE INDEX "ix_devices_tenant_id" ON "devices" ("tenant_id");
CREATE INDEX "ix_devices_farm_id" ON "devices" ("farm_id");
CREATE INDEX "ix_devices_serial_number" ON "devices" ("serial_number");

CREATE TABLE "sensor_readings" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "device_id" uuid NOT NULL,
  "metric" varchar(255) NOT NULL,
  "value" numeric(14,3) NOT NULL,
  "unit" varchar(255),
  "recorded_at" timestamptz NOT NULL,
  "location" geography(Point,4326),
  PRIMARY KEY ("id")
);
CREATE INDEX "ix_sensor_readings_tenant_id" ON "sensor_readings" ("tenant_id");
CREATE INDEX "ix_sensor_readings_device_id" ON "sensor_readings" ("device_id");
CREATE INDEX "ix_sensor_readings_metric" ON "sensor_readings" ("metric");
CREATE INDEX "ix_sensor_readings_recorded_at" ON "sensor_readings" ("recorded_at");
-- SELECT create_hypertable('sensor_readings', 'recorded_at');  -- TimescaleDB

CREATE TABLE "gps_positions" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "device_id" uuid,
  "animal_id" uuid,
  "machinery_id" uuid,
  "position" geography(Point,4326) NOT NULL,
  "altitude" numeric(14,3),
  "speed" numeric(14,3),
  "heading" numeric(14,3),
  "recorded_at" timestamptz NOT NULL,
  PRIMARY KEY ("id")
);
CREATE INDEX "ix_gps_positions_tenant_id" ON "gps_positions" ("tenant_id");
CREATE INDEX "ix_gps_positions_device_id" ON "gps_positions" ("device_id");
CREATE INDEX "ix_gps_positions_recorded_at" ON "gps_positions" ("recorded_at");
-- SELECT create_hypertable('gps_positions', 'recorded_at');  -- TimescaleDB

CREATE TABLE "geofences" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "farm_id" uuid NOT NULL,
  "name" varchar(255) NOT NULL,
  "boundary" geography(Polygon,4326) NOT NULL,
  "trigger" varchar(255) NOT NULL CHECK ("trigger" IN ('enter','exit','both')),
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id")
);
CREATE INDEX "ix_geofences_tenant_id" ON "geofences" ("tenant_id");
CREATE INDEX "ix_geofences_farm_id" ON "geofences" ("farm_id");

-- ============================================================================
-- MÓDULO: Trazabilidad y Cumplimiento
-- ============================================================================

CREATE TABLE "trace_events" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "subject_type" varchar(255) NOT NULL CHECK ("subject_type" IN ('animal','lot','product','batch')),
  "subject_id" uuid NOT NULL,
  "event_type" varchar(255) NOT NULL,
  "occurred_at" timestamptz NOT NULL,
  "payload" jsonb NOT NULL,
  "prev_hash" varchar(255),
  "event_hash" varchar(255) NOT NULL,
  "anchor_id" uuid,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id")
);
CREATE INDEX "ix_trace_events_tenant_id" ON "trace_events" ("tenant_id");
CREATE INDEX "ix_trace_events_subject_id" ON "trace_events" ("subject_id");
CREATE INDEX "ix_trace_events_event_hash" ON "trace_events" ("event_hash");

CREATE TABLE "compliance_reports" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "company_id" uuid NOT NULL,
  "farm_id" uuid,
  "authority" varchar(255) NOT NULL,
  "report_type" varchar(255) NOT NULL,
  "period_start" date,
  "period_end" date,
  "status" varchar(255) DEFAULT 'draft' NOT NULL CHECK ("status" IN ('draft','submitted','accepted','rejected')),
  "submitted_at" timestamptz,
  "external_ref" varchar(255),
  "document_id" uuid,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id")
);
CREATE INDEX "ix_compliance_reports_tenant_id" ON "compliance_reports" ("tenant_id");
CREATE INDEX "ix_compliance_reports_company_id" ON "compliance_reports" ("company_id");

CREATE TABLE "movement_guides" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "company_id" uuid NOT NULL,
  "guide_number" varchar(255) NOT NULL,
  "from_farm_id" uuid,
  "to_partner_id" uuid,
  "issued_at" date NOT NULL,
  "animal_count" integer,
  "status" varchar(255) DEFAULT 'issued' NOT NULL CHECK ("status" IN ('issued','in_transit','completed','canceled')),
  "document_id" uuid,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id")
);
CREATE INDEX "ix_movement_guides_tenant_id" ON "movement_guides" ("tenant_id");
CREATE INDEX "ix_movement_guides_company_id" ON "movement_guides" ("company_id");

CREATE TABLE "certifications" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "entity_type" varchar(255) NOT NULL CHECK ("entity_type" IN ('farm','animal','lot','product')),
  "entity_id" uuid NOT NULL,
  "scheme" varchar(255) NOT NULL,
  "issuer" varchar(255),
  "valid_from" date,
  "valid_until" date,
  "status" varchar(255) DEFAULT 'active' NOT NULL CHECK ("status" IN ('active','expired','suspended','revoked')),
  "document_id" uuid,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id")
);
CREATE INDEX "ix_certifications_tenant_id" ON "certifications" ("tenant_id");
CREATE INDEX "ix_certifications_entity_id" ON "certifications" ("entity_id");

CREATE TABLE "blockchain_anchors" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "merkle_root" varchar(255) NOT NULL,
  "event_count" integer NOT NULL,
  "network" varchar(255) NOT NULL CHECK ("network" IN ('polygon','ethereum','fabric','besu','other')),
  "tx_hash" varchar(255),
  "block_number" bigint,
  "anchored_at" timestamptz,
  "status" varchar(255) DEFAULT 'pending' NOT NULL CHECK ("status" IN ('pending','confirmed','failed')),
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id")
);
CREATE INDEX "ix_blockchain_anchors_tenant_id" ON "blockchain_anchors" ("tenant_id");

CREATE TABLE "verifiable_credentials" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "subject_type" varchar(255) NOT NULL,
  "subject_id" uuid,
  "credential_type" varchar(255) NOT NULL,
  "issuer_did" varchar(255),
  "payload" jsonb NOT NULL,
  "issued_at" timestamptz,
  "expires_at" timestamptz,
  "status" varchar(255) DEFAULT 'valid' NOT NULL CHECK ("status" IN ('valid','revoked','expired')),
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id")
);
CREATE INDEX "ix_verifiable_credentials_tenant_id" ON "verifiable_credentials" ("tenant_id");

-- ============================================================================
-- MÓDULO: Inteligencia Artificial
-- ============================================================================

CREATE TABLE "ml_models" (
  "id" uuid DEFAULT gen_random_uuid(),
  "name" varchar(255) NOT NULL,
  "version" varchar(255) NOT NULL,
  "task_type" varchar(255) NOT NULL CHECK ("task_type" IN ('regression','classification','anomaly','vision','forecast','llm')),
  "status" varchar(255) DEFAULT 'staging' NOT NULL CHECK ("status" IN ('training','staging','production','retired')),
  "metrics" jsonb DEFAULT '{}' NOT NULL,
  "artifact_uri" varchar(255),
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id")
);

CREATE TABLE "predictions" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "model_id" uuid NOT NULL,
  "entity_type" varchar(255) NOT NULL,
  "entity_id" uuid NOT NULL,
  "prediction_type" varchar(255) NOT NULL,
  "value" jsonb NOT NULL,
  "confidence" numeric(14,3),
  "explanation" jsonb,
  "predicted_at" timestamptz NOT NULL,
  "valid_until" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id")
);
CREATE INDEX "ix_predictions_tenant_id" ON "predictions" ("tenant_id");
CREATE INDEX "ix_predictions_model_id" ON "predictions" ("model_id");
CREATE INDEX "ix_predictions_entity_id" ON "predictions" ("entity_id");

CREATE TABLE "ai_conversations" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "farm_id" uuid,
  "channel" varchar(255) DEFAULT 'app' NOT NULL CHECK ("channel" IN ('app','whatsapp','voice')),
  "started_at" timestamptz NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id")
);
CREATE INDEX "ix_ai_conversations_tenant_id" ON "ai_conversations" ("tenant_id");
CREATE INDEX "ix_ai_conversations_user_id" ON "ai_conversations" ("user_id");

CREATE TABLE "ai_messages" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "conversation_id" uuid NOT NULL,
  "role" varchar(255) NOT NULL CHECK ("role" IN ('user','assistant','tool')),
  "content" text NOT NULL,
  "tool_calls" jsonb,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id")
);
CREATE INDEX "ix_ai_messages_tenant_id" ON "ai_messages" ("tenant_id");
CREATE INDEX "ix_ai_messages_conversation_id" ON "ai_messages" ("conversation_id");

CREATE TABLE "image_analyses" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "file_id" uuid NOT NULL,
  "model_id" uuid,
  "analysis_type" varchar(255) NOT NULL CHECK ("analysis_type" IN ('body_score','weight_estimate','count','biometric_id','pasture_ndvi','lameness')),
  "animal_id" uuid,
  "result" jsonb NOT NULL,
  "confidence" numeric(14,3),
  "analyzed_at" timestamptz NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id")
);
CREATE INDEX "ix_image_analyses_tenant_id" ON "image_analyses" ("tenant_id");
CREATE INDEX "ix_image_analyses_file_id" ON "image_analyses" ("file_id");

-- ============================================================================
-- MÓDULO: Marketplace
-- ============================================================================

CREATE TABLE "marketplace_listings" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "company_id" uuid NOT NULL,
  "type" varchar(255) NOT NULL CHECK ("type" IN ('livestock','genetics','equipment','input','service','land')),
  "title" varchar(255) NOT NULL,
  "description" text,
  "animal_id" uuid,
  "semen_batch_id" uuid,
  "price" numeric(16,2),
  "currency" varchar(3),
  "location" geography(Point,4326),
  "status" varchar(255) DEFAULT 'draft' NOT NULL CHECK ("status" IN ('draft','published','reserved','sold','expired')),
  "published_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id")
);
CREATE INDEX "ix_marketplace_listings_tenant_id" ON "marketplace_listings" ("tenant_id");
CREATE INDEX "ix_marketplace_listings_company_id" ON "marketplace_listings" ("company_id");

CREATE TABLE "marketplace_media" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "listing_id" uuid NOT NULL,
  "file_id" uuid NOT NULL,
  "position" smallint DEFAULT 0 NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id")
);
CREATE INDEX "ix_marketplace_media_tenant_id" ON "marketplace_media" ("tenant_id");
CREATE INDEX "ix_marketplace_media_listing_id" ON "marketplace_media" ("listing_id");

CREATE TABLE "marketplace_inquiries" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "listing_id" uuid NOT NULL,
  "from_user_id" uuid,
  "message" text,
  "offer_price" numeric(16,2),
  "status" varchar(255) DEFAULT 'open' NOT NULL CHECK ("status" IN ('open','accepted','declined','closed')),
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id")
);
CREATE INDEX "ix_marketplace_inquiries_tenant_id" ON "marketplace_inquiries" ("tenant_id");
CREATE INDEX "ix_marketplace_inquiries_listing_id" ON "marketplace_inquiries" ("listing_id");

CREATE TABLE "marketplace_transactions" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "listing_id" uuid NOT NULL,
  "buyer_company_id" uuid,
  "amount" numeric(16,2) NOT NULL,
  "currency" varchar(3),
  "sale_id" uuid,
  "status" varchar(255) DEFAULT 'pending' NOT NULL CHECK ("status" IN ('pending','paid','completed','disputed')),
  "closed_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id")
);
CREATE INDEX "ix_marketplace_transactions_tenant_id" ON "marketplace_transactions" ("tenant_id");
CREATE INDEX "ix_marketplace_transactions_listing_id" ON "marketplace_transactions" ("listing_id");

-- ============================================================================
-- MÓDULO: Formación y Contenido
-- ============================================================================

CREATE TABLE "courses" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid,
  "title" varchar(255) NOT NULL,
  "description" text,
  "category" varchar(255),
  "language" varchar(10),
  "level" varchar(255) CHECK ("level" IN ('basic','intermediate','advanced')),
  "is_published" boolean DEFAULT false NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id")
);
CREATE INDEX "ix_courses_tenant_id" ON "courses" ("tenant_id");

CREATE TABLE "course_modules" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "course_id" uuid NOT NULL,
  "title" varchar(255) NOT NULL,
  "content_type" varchar(255) NOT NULL CHECK ("content_type" IN ('video','article','quiz','pdf')),
  "file_id" uuid,
  "body" text,
  "position" smallint DEFAULT 0 NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id")
);
CREATE INDEX "ix_course_modules_tenant_id" ON "course_modules" ("tenant_id");
CREATE INDEX "ix_course_modules_course_id" ON "course_modules" ("course_id");

CREATE TABLE "course_enrollments" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "course_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "progress_pct" smallint DEFAULT 0 NOT NULL,
  "completed_at" timestamptz,
  "certificate_document_id" uuid,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id"),
  UNIQUE ("course_id", "user_id")
);
CREATE INDEX "ix_course_enrollments_tenant_id" ON "course_enrollments" ("tenant_id");
CREATE INDEX "ix_course_enrollments_course_id" ON "course_enrollments" ("course_id");

-- ============================================================================
-- MÓDULO: Sincronización, Auditoría y Sistema
-- ============================================================================

CREATE TABLE "sync_devices" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "platform" varchar(255) NOT NULL CHECK ("platform" IN ('ios','android','web')),
  "app_version" varchar(255),
  "device_name" varchar(255),
  "last_sync_at" timestamptz,
  "sync_cursor" bigint DEFAULT 0 NOT NULL,
  "push_token" varchar(255),
  "status" varchar(255) DEFAULT 'active' NOT NULL CHECK ("status" IN ('active','revoked')),
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id")
);
CREATE INDEX "ix_sync_devices_tenant_id" ON "sync_devices" ("tenant_id");
CREATE INDEX "ix_sync_devices_user_id" ON "sync_devices" ("user_id");

CREATE TABLE "sync_changesets" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "sync_device_id" uuid NOT NULL,
  "seq" bigint NOT NULL,
  "hlc" varchar(255) NOT NULL,
  "operations" jsonb NOT NULL,
  "status" varchar(255) DEFAULT 'pending' NOT NULL CHECK ("status" IN ('pending','applied','conflict','rejected')),
  "received_at" timestamptz,
  "applied_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id"),
  UNIQUE ("sync_device_id", "seq")
);
CREATE INDEX "ix_sync_changesets_tenant_id" ON "sync_changesets" ("tenant_id");
CREATE INDEX "ix_sync_changesets_sync_device_id" ON "sync_changesets" ("sync_device_id");

CREATE TABLE "sync_conflicts" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "changeset_id" uuid NOT NULL,
  "entity_type" varchar(255) NOT NULL,
  "entity_id" uuid NOT NULL,
  "conflict_type" varchar(255) NOT NULL CHECK ("conflict_type" IN ('concurrent_update','duplicate','semantic')),
  "resolution" varchar(255) CHECK ("resolution" IN ('server_wins','client_wins','merged','manual')),
  "resolved_by" uuid,
  "resolved_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id")
);
CREATE INDEX "ix_sync_conflicts_tenant_id" ON "sync_conflicts" ("tenant_id");
CREATE INDEX "ix_sync_conflicts_changeset_id" ON "sync_conflicts" ("changeset_id");

CREATE TABLE "audit_logs" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "user_id" uuid,
  "action" varchar(255) NOT NULL,
  "entity_type" varchar(255),
  "entity_id" uuid,
  "changes" jsonb,
  "ip_address" varchar(255),
  "user_agent" varchar(255),
  "occurred_at" timestamptz NOT NULL,
  PRIMARY KEY ("id")
);
CREATE INDEX "ix_audit_logs_tenant_id" ON "audit_logs" ("tenant_id");
CREATE INDEX "ix_audit_logs_user_id" ON "audit_logs" ("user_id");
CREATE INDEX "ix_audit_logs_occurred_at" ON "audit_logs" ("occurred_at");

CREATE TABLE "system_settings" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "key" varchar(255) NOT NULL,
  "value" jsonb NOT NULL,
  "scope" varchar(255) DEFAULT 'organization' NOT NULL CHECK ("scope" IN ('organization','company','farm')),
  "scope_id" uuid,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id"),
  UNIQUE ("tenant_id", "key", "scope", "scope_id")
);
CREATE INDEX "ix_system_settings_tenant_id" ON "system_settings" ("tenant_id");

CREATE TABLE "feature_flags" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "flag_key" varchar(255) NOT NULL,
  "is_enabled" boolean DEFAULT false NOT NULL,
  "rollout_pct" smallint,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id"),
  UNIQUE ("tenant_id", "flag_key")
);
CREATE INDEX "ix_feature_flags_tenant_id" ON "feature_flags" ("tenant_id");

CREATE TABLE "webhooks" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "url" varchar(255) NOT NULL,
  "events" jsonb DEFAULT '[]' NOT NULL,
  "secret" varchar(255),
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id")
);
CREATE INDEX "ix_webhooks_tenant_id" ON "webhooks" ("tenant_id");

CREATE TABLE "webhook_deliveries" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "webhook_id" uuid NOT NULL,
  "event_type" varchar(255) NOT NULL,
  "payload" jsonb NOT NULL,
  "response_status" smallint,
  "attempts" smallint DEFAULT 0 NOT NULL,
  "status" varchar(255) DEFAULT 'pending' NOT NULL CHECK ("status" IN ('pending','delivered','failed')),
  "delivered_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id")
);
CREATE INDEX "ix_webhook_deliveries_tenant_id" ON "webhook_deliveries" ("tenant_id");
CREATE INDEX "ix_webhook_deliveries_webhook_id" ON "webhook_deliveries" ("webhook_id");

CREATE TABLE "integrations" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "company_id" uuid,
  "provider" varchar(255) NOT NULL,
  "config" jsonb DEFAULT '{}' NOT NULL,
  "status" varchar(255) DEFAULT 'active' NOT NULL CHECK ("status" IN ('active','error','disabled')),
  "last_sync_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id")
);
CREATE INDEX "ix_integrations_tenant_id" ON "integrations" ("tenant_id");

-- ============================================================================
-- CLAVES FORÁNEAS (relaciones)
-- ============================================================================
ALTER TABLE "organizations" ADD CONSTRAINT "fk_organizations_country_code" FOREIGN KEY ("country_code") REFERENCES "countries" ("code") ON DELETE RESTRICT;
ALTER TABLE "organizations" ADD CONSTRAINT "fk_organizations_default_currency" FOREIGN KEY ("default_currency") REFERENCES "currencies" ("code") ON DELETE RESTRICT;
ALTER TABLE "organizations" ADD CONSTRAINT "fk_organizations_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "companies" ADD CONSTRAINT "fk_companies_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "companies" ADD CONSTRAINT "fk_companies_country_code" FOREIGN KEY ("country_code") REFERENCES "countries" ("code") ON DELETE RESTRICT;
ALTER TABLE "companies" ADD CONSTRAINT "fk_companies_functional_currency" FOREIGN KEY ("functional_currency") REFERENCES "currencies" ("code") ON DELETE RESTRICT;
ALTER TABLE "companies" ADD CONSTRAINT "fk_companies_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "farms" ADD CONSTRAINT "fk_farms_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "farms" ADD CONSTRAINT "fk_farms_company_id" FOREIGN KEY ("company_id") REFERENCES "companies" ("id") ON DELETE RESTRICT;
ALTER TABLE "farms" ADD CONSTRAINT "fk_farms_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "users" ADD CONSTRAINT "fk_users_avatar_file_id" FOREIGN KEY ("avatar_file_id") REFERENCES "files" ("id") ON DELETE SET NULL;
ALTER TABLE "users" ADD CONSTRAINT "fk_users_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "roles" ADD CONSTRAINT "fk_roles_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE SET NULL;
ALTER TABLE "roles" ADD CONSTRAINT "fk_roles_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "role_permissions" ADD CONSTRAINT "fk_role_permissions_role_id" FOREIGN KEY ("role_id") REFERENCES "roles" ("id") ON DELETE RESTRICT;
ALTER TABLE "role_permissions" ADD CONSTRAINT "fk_role_permissions_permission_id" FOREIGN KEY ("permission_id") REFERENCES "permissions" ("id") ON DELETE RESTRICT;
ALTER TABLE "user_role_assignments" ADD CONSTRAINT "fk_user_role_assignments_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "user_role_assignments" ADD CONSTRAINT "fk_user_role_assignments_user_id" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE RESTRICT;
ALTER TABLE "user_role_assignments" ADD CONSTRAINT "fk_user_role_assignments_role_id" FOREIGN KEY ("role_id") REFERENCES "roles" ("id") ON DELETE RESTRICT;
ALTER TABLE "user_role_assignments" ADD CONSTRAINT "fk_user_role_assignments_company_id" FOREIGN KEY ("company_id") REFERENCES "companies" ("id") ON DELETE SET NULL;
ALTER TABLE "user_role_assignments" ADD CONSTRAINT "fk_user_role_assignments_farm_id" FOREIGN KEY ("farm_id") REFERENCES "farms" ("id") ON DELETE SET NULL;
ALTER TABLE "user_role_assignments" ADD CONSTRAINT "fk_user_role_assignments_granted_by" FOREIGN KEY ("granted_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "user_role_assignments" ADD CONSTRAINT "fk_user_role_assignments_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "invitations" ADD CONSTRAINT "fk_invitations_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "invitations" ADD CONSTRAINT "fk_invitations_role_id" FOREIGN KEY ("role_id") REFERENCES "roles" ("id") ON DELETE RESTRICT;
ALTER TABLE "invitations" ADD CONSTRAINT "fk_invitations_farm_id" FOREIGN KEY ("farm_id") REFERENCES "farms" ("id") ON DELETE SET NULL;
ALTER TABLE "invitations" ADD CONSTRAINT "fk_invitations_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "api_keys" ADD CONSTRAINT "fk_api_keys_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "api_keys" ADD CONSTRAINT "fk_api_keys_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "plans" ADD CONSTRAINT "fk_plans_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "subscriptions" ADD CONSTRAINT "fk_subscriptions_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "subscriptions" ADD CONSTRAINT "fk_subscriptions_plan_id" FOREIGN KEY ("plan_id") REFERENCES "plans" ("id") ON DELETE RESTRICT;
ALTER TABLE "subscriptions" ADD CONSTRAINT "fk_subscriptions_billing_currency" FOREIGN KEY ("billing_currency") REFERENCES "currencies" ("code") ON DELETE RESTRICT;
ALTER TABLE "subscriptions" ADD CONSTRAINT "fk_subscriptions_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "subscription_usage" ADD CONSTRAINT "fk_subscription_usage_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "subscription_usage" ADD CONSTRAINT "fk_subscription_usage_subscription_id" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions" ("id") ON DELETE RESTRICT;
ALTER TABLE "subscription_usage" ADD CONSTRAINT "fk_subscription_usage_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "billing_payments" ADD CONSTRAINT "fk_billing_payments_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "billing_payments" ADD CONSTRAINT "fk_billing_payments_subscription_id" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions" ("id") ON DELETE RESTRICT;
ALTER TABLE "billing_payments" ADD CONSTRAINT "fk_billing_payments_currency" FOREIGN KEY ("currency") REFERENCES "currencies" ("code") ON DELETE RESTRICT;
ALTER TABLE "billing_payments" ADD CONSTRAINT "fk_billing_payments_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "exchange_rates" ADD CONSTRAINT "fk_exchange_rates_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE SET NULL;
ALTER TABLE "exchange_rates" ADD CONSTRAINT "fk_exchange_rates_from_currency" FOREIGN KEY ("from_currency") REFERENCES "currencies" ("code") ON DELETE RESTRICT;
ALTER TABLE "exchange_rates" ADD CONSTRAINT "fk_exchange_rates_to_currency" FOREIGN KEY ("to_currency") REFERENCES "currencies" ("code") ON DELETE RESTRICT;
ALTER TABLE "exchange_rates" ADD CONSTRAINT "fk_exchange_rates_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "species" ADD CONSTRAINT "fk_species_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "breeds" ADD CONSTRAINT "fk_breeds_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE SET NULL;
ALTER TABLE "breeds" ADD CONSTRAINT "fk_breeds_species_id" FOREIGN KEY ("species_id") REFERENCES "species" ("id") ON DELETE RESTRICT;
ALTER TABLE "breeds" ADD CONSTRAINT "fk_breeds_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "animal_categories" ADD CONSTRAINT "fk_animal_categories_species_id" FOREIGN KEY ("species_id") REFERENCES "species" ("id") ON DELETE RESTRICT;
ALTER TABLE "animal_categories" ADD CONSTRAINT "fk_animal_categories_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "diagnoses" ADD CONSTRAINT "fk_diagnoses_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE SET NULL;
ALTER TABLE "diagnoses" ADD CONSTRAINT "fk_diagnoses_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "animals" ADD CONSTRAINT "fk_animals_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "animals" ADD CONSTRAINT "fk_animals_farm_id" FOREIGN KEY ("farm_id") REFERENCES "farms" ("id") ON DELETE RESTRICT;
ALTER TABLE "animals" ADD CONSTRAINT "fk_animals_species_id" FOREIGN KEY ("species_id") REFERENCES "species" ("id") ON DELETE RESTRICT;
ALTER TABLE "animals" ADD CONSTRAINT "fk_animals_category_id" FOREIGN KEY ("category_id") REFERENCES "animal_categories" ("id") ON DELETE SET NULL;
ALTER TABLE "animals" ADD CONSTRAINT "fk_animals_dam_id" FOREIGN KEY ("dam_id") REFERENCES "animals" ("id") ON DELETE SET NULL;
ALTER TABLE "animals" ADD CONSTRAINT "fk_animals_sire_id" FOREIGN KEY ("sire_id") REFERENCES "animals" ("id") ON DELETE SET NULL;
ALTER TABLE "animals" ADD CONSTRAINT "fk_animals_current_lot_id" FOREIGN KEY ("current_lot_id") REFERENCES "lots" ("id") ON DELETE SET NULL;
ALTER TABLE "animals" ADD CONSTRAINT "fk_animals_current_paddock_id" FOREIGN KEY ("current_paddock_id") REFERENCES "paddocks" ("id") ON DELETE SET NULL;
ALTER TABLE "animals" ADD CONSTRAINT "fk_animals_photo_file_id" FOREIGN KEY ("photo_file_id") REFERENCES "files" ("id") ON DELETE SET NULL;
ALTER TABLE "animals" ADD CONSTRAINT "fk_animals_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "animal_breeds" ADD CONSTRAINT "fk_animal_breeds_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "animal_breeds" ADD CONSTRAINT "fk_animal_breeds_animal_id" FOREIGN KEY ("animal_id") REFERENCES "animals" ("id") ON DELETE RESTRICT;
ALTER TABLE "animal_breeds" ADD CONSTRAINT "fk_animal_breeds_breed_id" FOREIGN KEY ("breed_id") REFERENCES "breeds" ("id") ON DELETE RESTRICT;
ALTER TABLE "animal_breeds" ADD CONSTRAINT "fk_animal_breeds_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "animal_identifiers" ADD CONSTRAINT "fk_animal_identifiers_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "animal_identifiers" ADD CONSTRAINT "fk_animal_identifiers_animal_id" FOREIGN KEY ("animal_id") REFERENCES "animals" ("id") ON DELETE RESTRICT;
ALTER TABLE "animal_identifiers" ADD CONSTRAINT "fk_animal_identifiers_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "lots" ADD CONSTRAINT "fk_lots_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "lots" ADD CONSTRAINT "fk_lots_farm_id" FOREIGN KEY ("farm_id") REFERENCES "farms" ("id") ON DELETE RESTRICT;
ALTER TABLE "lots" ADD CONSTRAINT "fk_lots_current_paddock_id" FOREIGN KEY ("current_paddock_id") REFERENCES "paddocks" ("id") ON DELETE SET NULL;
ALTER TABLE "lots" ADD CONSTRAINT "fk_lots_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "animal_movements" ADD CONSTRAINT "fk_animal_movements_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "animal_movements" ADD CONSTRAINT "fk_animal_movements_animal_id" FOREIGN KEY ("animal_id") REFERENCES "animals" ("id") ON DELETE RESTRICT;
ALTER TABLE "animal_movements" ADD CONSTRAINT "fk_animal_movements_from_paddock_id" FOREIGN KEY ("from_paddock_id") REFERENCES "paddocks" ("id") ON DELETE SET NULL;
ALTER TABLE "animal_movements" ADD CONSTRAINT "fk_animal_movements_to_paddock_id" FOREIGN KEY ("to_paddock_id") REFERENCES "paddocks" ("id") ON DELETE SET NULL;
ALTER TABLE "animal_movements" ADD CONSTRAINT "fk_animal_movements_from_lot_id" FOREIGN KEY ("from_lot_id") REFERENCES "lots" ("id") ON DELETE SET NULL;
ALTER TABLE "animal_movements" ADD CONSTRAINT "fk_animal_movements_to_lot_id" FOREIGN KEY ("to_lot_id") REFERENCES "lots" ("id") ON DELETE SET NULL;
ALTER TABLE "animal_movements" ADD CONSTRAINT "fk_animal_movements_from_farm_id" FOREIGN KEY ("from_farm_id") REFERENCES "farms" ("id") ON DELETE SET NULL;
ALTER TABLE "animal_movements" ADD CONSTRAINT "fk_animal_movements_to_farm_id" FOREIGN KEY ("to_farm_id") REFERENCES "farms" ("id") ON DELETE SET NULL;
ALTER TABLE "animal_movements" ADD CONSTRAINT "fk_animal_movements_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "animal_events" ADD CONSTRAINT "fk_animal_events_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "animal_events" ADD CONSTRAINT "fk_animal_events_animal_id" FOREIGN KEY ("animal_id") REFERENCES "animals" ("id") ON DELETE RESTRICT;
ALTER TABLE "animal_events" ADD CONSTRAINT "fk_animal_events_device_id" FOREIGN KEY ("device_id") REFERENCES "devices" ("id") ON DELETE SET NULL;
ALTER TABLE "animal_events" ADD CONSTRAINT "fk_animal_events_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "breeding_events" ADD CONSTRAINT "fk_breeding_events_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "breeding_events" ADD CONSTRAINT "fk_breeding_events_animal_id" FOREIGN KEY ("animal_id") REFERENCES "animals" ("id") ON DELETE RESTRICT;
ALTER TABLE "breeding_events" ADD CONSTRAINT "fk_breeding_events_sire_id" FOREIGN KEY ("sire_id") REFERENCES "animals" ("id") ON DELETE SET NULL;
ALTER TABLE "breeding_events" ADD CONSTRAINT "fk_breeding_events_semen_batch_id" FOREIGN KEY ("semen_batch_id") REFERENCES "semen_batches" ("id") ON DELETE SET NULL;
ALTER TABLE "breeding_events" ADD CONSTRAINT "fk_breeding_events_embryo_id" FOREIGN KEY ("embryo_id") REFERENCES "embryos" ("id") ON DELETE SET NULL;
ALTER TABLE "breeding_events" ADD CONSTRAINT "fk_breeding_events_technician_id" FOREIGN KEY ("technician_id") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "breeding_events" ADD CONSTRAINT "fk_breeding_events_protocol_id" FOREIGN KEY ("protocol_id") REFERENCES "repro_protocols" ("id") ON DELETE SET NULL;
ALTER TABLE "breeding_events" ADD CONSTRAINT "fk_breeding_events_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "repro_protocols" ADD CONSTRAINT "fk_repro_protocols_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "repro_protocols" ADD CONSTRAINT "fk_repro_protocols_species_id" FOREIGN KEY ("species_id") REFERENCES "species" ("id") ON DELETE RESTRICT;
ALTER TABLE "repro_protocols" ADD CONSTRAINT "fk_repro_protocols_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "pregnancies" ADD CONSTRAINT "fk_pregnancies_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "pregnancies" ADD CONSTRAINT "fk_pregnancies_animal_id" FOREIGN KEY ("animal_id") REFERENCES "animals" ("id") ON DELETE RESTRICT;
ALTER TABLE "pregnancies" ADD CONSTRAINT "fk_pregnancies_breeding_event_id" FOREIGN KEY ("breeding_event_id") REFERENCES "breeding_events" ("id") ON DELETE SET NULL;
ALTER TABLE "pregnancies" ADD CONSTRAINT "fk_pregnancies_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "calvings" ADD CONSTRAINT "fk_calvings_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "calvings" ADD CONSTRAINT "fk_calvings_pregnancy_id" FOREIGN KEY ("pregnancy_id") REFERENCES "pregnancies" ("id") ON DELETE SET NULL;
ALTER TABLE "calvings" ADD CONSTRAINT "fk_calvings_dam_id" FOREIGN KEY ("dam_id") REFERENCES "animals" ("id") ON DELETE RESTRICT;
ALTER TABLE "calvings" ADD CONSTRAINT "fk_calvings_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "calving_offspring" ADD CONSTRAINT "fk_calving_offspring_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "calving_offspring" ADD CONSTRAINT "fk_calving_offspring_calving_id" FOREIGN KEY ("calving_id") REFERENCES "calvings" ("id") ON DELETE RESTRICT;
ALTER TABLE "calving_offspring" ADD CONSTRAINT "fk_calving_offspring_animal_id" FOREIGN KEY ("animal_id") REFERENCES "animals" ("id") ON DELETE SET NULL;
ALTER TABLE "calving_offspring" ADD CONSTRAINT "fk_calving_offspring_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "weanings" ADD CONSTRAINT "fk_weanings_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "weanings" ADD CONSTRAINT "fk_weanings_animal_id" FOREIGN KEY ("animal_id") REFERENCES "animals" ("id") ON DELETE RESTRICT;
ALTER TABLE "weanings" ADD CONSTRAINT "fk_weanings_dam_id" FOREIGN KEY ("dam_id") REFERENCES "animals" ("id") ON DELETE SET NULL;
ALTER TABLE "weanings" ADD CONSTRAINT "fk_weanings_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "semen_batches" ADD CONSTRAINT "fk_semen_batches_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "semen_batches" ADD CONSTRAINT "fk_semen_batches_sire_id" FOREIGN KEY ("sire_id") REFERENCES "animals" ("id") ON DELETE SET NULL;
ALTER TABLE "semen_batches" ADD CONSTRAINT "fk_semen_batches_breed_id" FOREIGN KEY ("breed_id") REFERENCES "breeds" ("id") ON DELETE SET NULL;
ALTER TABLE "semen_batches" ADD CONSTRAINT "fk_semen_batches_supplier_id" FOREIGN KEY ("supplier_id") REFERENCES "suppliers" ("id") ON DELETE SET NULL;
ALTER TABLE "semen_batches" ADD CONSTRAINT "fk_semen_batches_tank_id" FOREIGN KEY ("tank_id") REFERENCES "storage_tanks" ("id") ON DELETE SET NULL;
ALTER TABLE "semen_batches" ADD CONSTRAINT "fk_semen_batches_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "embryos" ADD CONSTRAINT "fk_embryos_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "embryos" ADD CONSTRAINT "fk_embryos_donor_dam_id" FOREIGN KEY ("donor_dam_id") REFERENCES "animals" ("id") ON DELETE SET NULL;
ALTER TABLE "embryos" ADD CONSTRAINT "fk_embryos_sire_id" FOREIGN KEY ("sire_id") REFERENCES "animals" ("id") ON DELETE SET NULL;
ALTER TABLE "embryos" ADD CONSTRAINT "fk_embryos_semen_batch_id" FOREIGN KEY ("semen_batch_id") REFERENCES "semen_batches" ("id") ON DELETE SET NULL;
ALTER TABLE "embryos" ADD CONSTRAINT "fk_embryos_tank_id" FOREIGN KEY ("tank_id") REFERENCES "storage_tanks" ("id") ON DELETE SET NULL;
ALTER TABLE "embryos" ADD CONSTRAINT "fk_embryos_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "storage_tanks" ADD CONSTRAINT "fk_storage_tanks_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "storage_tanks" ADD CONSTRAINT "fk_storage_tanks_farm_id" FOREIGN KEY ("farm_id") REFERENCES "farms" ("id") ON DELETE RESTRICT;
ALTER TABLE "storage_tanks" ADD CONSTRAINT "fk_storage_tanks_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "genetic_evaluations" ADD CONSTRAINT "fk_genetic_evaluations_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "genetic_evaluations" ADD CONSTRAINT "fk_genetic_evaluations_animal_id" FOREIGN KEY ("animal_id") REFERENCES "animals" ("id") ON DELETE RESTRICT;
ALTER TABLE "genetic_evaluations" ADD CONSTRAINT "fk_genetic_evaluations_lab_sample_id" FOREIGN KEY ("lab_sample_id") REFERENCES "lab_samples" ("id") ON DELETE SET NULL;
ALTER TABLE "genetic_evaluations" ADD CONSTRAINT "fk_genetic_evaluations_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "products_veterinary" ADD CONSTRAINT "fk_products_veterinary_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "products_veterinary" ADD CONSTRAINT "fk_products_veterinary_inventory_item_id" FOREIGN KEY ("inventory_item_id") REFERENCES "inventory_items" ("id") ON DELETE SET NULL;
ALTER TABLE "products_veterinary" ADD CONSTRAINT "fk_products_veterinary_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "vaccinations" ADD CONSTRAINT "fk_vaccinations_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "vaccinations" ADD CONSTRAINT "fk_vaccinations_animal_id" FOREIGN KEY ("animal_id") REFERENCES "animals" ("id") ON DELETE RESTRICT;
ALTER TABLE "vaccinations" ADD CONSTRAINT "fk_vaccinations_product_id" FOREIGN KEY ("product_id") REFERENCES "products_veterinary" ("id") ON DELETE RESTRICT;
ALTER TABLE "vaccinations" ADD CONSTRAINT "fk_vaccinations_dose_unit" FOREIGN KEY ("dose_unit") REFERENCES "units" ("code") ON DELETE SET NULL;
ALTER TABLE "vaccinations" ADD CONSTRAINT "fk_vaccinations_applied_by" FOREIGN KEY ("applied_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "vaccinations" ADD CONSTRAINT "fk_vaccinations_plan_id" FOREIGN KEY ("plan_id") REFERENCES "health_plans" ("id") ON DELETE SET NULL;
ALTER TABLE "vaccinations" ADD CONSTRAINT "fk_vaccinations_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "treatments" ADD CONSTRAINT "fk_treatments_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "treatments" ADD CONSTRAINT "fk_treatments_animal_id" FOREIGN KEY ("animal_id") REFERENCES "animals" ("id") ON DELETE RESTRICT;
ALTER TABLE "treatments" ADD CONSTRAINT "fk_treatments_diagnosis_id" FOREIGN KEY ("diagnosis_id") REFERENCES "diagnoses" ("id") ON DELETE SET NULL;
ALTER TABLE "treatments" ADD CONSTRAINT "fk_treatments_product_id" FOREIGN KEY ("product_id") REFERENCES "products_veterinary" ("id") ON DELETE SET NULL;
ALTER TABLE "treatments" ADD CONSTRAINT "fk_treatments_dose_unit" FOREIGN KEY ("dose_unit") REFERENCES "units" ("code") ON DELETE SET NULL;
ALTER TABLE "treatments" ADD CONSTRAINT "fk_treatments_applied_by" FOREIGN KEY ("applied_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "treatments" ADD CONSTRAINT "fk_treatments_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "health_events" ADD CONSTRAINT "fk_health_events_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "health_events" ADD CONSTRAINT "fk_health_events_animal_id" FOREIGN KEY ("animal_id") REFERENCES "animals" ("id") ON DELETE RESTRICT;
ALTER TABLE "health_events" ADD CONSTRAINT "fk_health_events_diagnosis_id" FOREIGN KEY ("diagnosis_id") REFERENCES "diagnoses" ("id") ON DELETE SET NULL;
ALTER TABLE "health_events" ADD CONSTRAINT "fk_health_events_examined_by" FOREIGN KEY ("examined_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "health_events" ADD CONSTRAINT "fk_health_events_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "health_plans" ADD CONSTRAINT "fk_health_plans_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "health_plans" ADD CONSTRAINT "fk_health_plans_species_id" FOREIGN KEY ("species_id") REFERENCES "species" ("id") ON DELETE RESTRICT;
ALTER TABLE "health_plans" ADD CONSTRAINT "fk_health_plans_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "mortalities" ADD CONSTRAINT "fk_mortalities_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "mortalities" ADD CONSTRAINT "fk_mortalities_animal_id" FOREIGN KEY ("animal_id") REFERENCES "animals" ("id") ON DELETE RESTRICT;
ALTER TABLE "mortalities" ADD CONSTRAINT "fk_mortalities_cause_diagnosis_id" FOREIGN KEY ("cause_diagnosis_id") REFERENCES "diagnoses" ("id") ON DELETE SET NULL;
ALTER TABLE "mortalities" ADD CONSTRAINT "fk_mortalities_lab_sample_id" FOREIGN KEY ("lab_sample_id") REFERENCES "lab_samples" ("id") ON DELETE SET NULL;
ALTER TABLE "mortalities" ADD CONSTRAINT "fk_mortalities_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "weighings" ADD CONSTRAINT "fk_weighings_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "weighings" ADD CONSTRAINT "fk_weighings_animal_id" FOREIGN KEY ("animal_id") REFERENCES "animals" ("id") ON DELETE RESTRICT;
ALTER TABLE "weighings" ADD CONSTRAINT "fk_weighings_device_id" FOREIGN KEY ("device_id") REFERENCES "devices" ("id") ON DELETE SET NULL;
ALTER TABLE "weighings" ADD CONSTRAINT "fk_weighings_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "milk_production_daily" ADD CONSTRAINT "fk_milk_production_daily_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "milk_production_daily" ADD CONSTRAINT "fk_milk_production_daily_animal_id" FOREIGN KEY ("animal_id") REFERENCES "animals" ("id") ON DELETE RESTRICT;
ALTER TABLE "milk_production_daily" ADD CONSTRAINT "fk_milk_production_daily_device_id" FOREIGN KEY ("device_id") REFERENCES "devices" ("id") ON DELETE SET NULL;
ALTER TABLE "milk_production_daily" ADD CONSTRAINT "fk_milk_production_daily_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "milk_quality_tests" ADD CONSTRAINT "fk_milk_quality_tests_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "milk_quality_tests" ADD CONSTRAINT "fk_milk_quality_tests_animal_id" FOREIGN KEY ("animal_id") REFERENCES "animals" ("id") ON DELETE SET NULL;
ALTER TABLE "milk_quality_tests" ADD CONSTRAINT "fk_milk_quality_tests_tank_id" FOREIGN KEY ("tank_id") REFERENCES "milk_tanks" ("id") ON DELETE SET NULL;
ALTER TABLE "milk_quality_tests" ADD CONSTRAINT "fk_milk_quality_tests_lab_sample_id" FOREIGN KEY ("lab_sample_id") REFERENCES "lab_samples" ("id") ON DELETE SET NULL;
ALTER TABLE "milk_quality_tests" ADD CONSTRAINT "fk_milk_quality_tests_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "milk_tanks" ADD CONSTRAINT "fk_milk_tanks_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "milk_tanks" ADD CONSTRAINT "fk_milk_tanks_farm_id" FOREIGN KEY ("farm_id") REFERENCES "farms" ("id") ON DELETE RESTRICT;
ALTER TABLE "milk_tanks" ADD CONSTRAINT "fk_milk_tanks_device_id" FOREIGN KEY ("device_id") REFERENCES "devices" ("id") ON DELETE SET NULL;
ALTER TABLE "milk_tanks" ADD CONSTRAINT "fk_milk_tanks_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "milk_deliveries" ADD CONSTRAINT "fk_milk_deliveries_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "milk_deliveries" ADD CONSTRAINT "fk_milk_deliveries_tank_id" FOREIGN KEY ("tank_id") REFERENCES "milk_tanks" ("id") ON DELETE SET NULL;
ALTER TABLE "milk_deliveries" ADD CONSTRAINT "fk_milk_deliveries_buyer_id" FOREIGN KEY ("buyer_id") REFERENCES "customers" ("id") ON DELETE SET NULL;
ALTER TABLE "milk_deliveries" ADD CONSTRAINT "fk_milk_deliveries_sale_id" FOREIGN KEY ("sale_id") REFERENCES "sales" ("id") ON DELETE SET NULL;
ALTER TABLE "milk_deliveries" ADD CONSTRAINT "fk_milk_deliveries_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "carcass_records" ADD CONSTRAINT "fk_carcass_records_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "carcass_records" ADD CONSTRAINT "fk_carcass_records_animal_id" FOREIGN KEY ("animal_id") REFERENCES "animals" ("id") ON DELETE RESTRICT;
ALTER TABLE "carcass_records" ADD CONSTRAINT "fk_carcass_records_slaughterhouse_id" FOREIGN KEY ("slaughterhouse_id") REFERENCES "customers" ("id") ON DELETE SET NULL;
ALTER TABLE "carcass_records" ADD CONSTRAINT "fk_carcass_records_sale_id" FOREIGN KEY ("sale_id") REFERENCES "sales" ("id") ON DELETE SET NULL;
ALTER TABLE "carcass_records" ADD CONSTRAINT "fk_carcass_records_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "shearing_records" ADD CONSTRAINT "fk_shearing_records_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "shearing_records" ADD CONSTRAINT "fk_shearing_records_animal_id" FOREIGN KEY ("animal_id") REFERENCES "animals" ("id") ON DELETE RESTRICT;
ALTER TABLE "shearing_records" ADD CONSTRAINT "fk_shearing_records_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "rations" ADD CONSTRAINT "fk_rations_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "rations" ADD CONSTRAINT "fk_rations_target_category_id" FOREIGN KEY ("target_category_id") REFERENCES "animal_categories" ("id") ON DELETE SET NULL;
ALTER TABLE "rations" ADD CONSTRAINT "fk_rations_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "ration_ingredients" ADD CONSTRAINT "fk_ration_ingredients_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "ration_ingredients" ADD CONSTRAINT "fk_ration_ingredients_ration_id" FOREIGN KEY ("ration_id") REFERENCES "rations" ("id") ON DELETE RESTRICT;
ALTER TABLE "ration_ingredients" ADD CONSTRAINT "fk_ration_ingredients_inventory_item_id" FOREIGN KEY ("inventory_item_id") REFERENCES "inventory_items" ("id") ON DELETE RESTRICT;
ALTER TABLE "ration_ingredients" ADD CONSTRAINT "fk_ration_ingredients_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "feed_deliveries" ADD CONSTRAINT "fk_feed_deliveries_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "feed_deliveries" ADD CONSTRAINT "fk_feed_deliveries_lot_id" FOREIGN KEY ("lot_id") REFERENCES "lots" ("id") ON DELETE RESTRICT;
ALTER TABLE "feed_deliveries" ADD CONSTRAINT "fk_feed_deliveries_ration_id" FOREIGN KEY ("ration_id") REFERENCES "rations" ("id") ON DELETE SET NULL;
ALTER TABLE "feed_deliveries" ADD CONSTRAINT "fk_feed_deliveries_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "grazing_records" ADD CONSTRAINT "fk_grazing_records_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "grazing_records" ADD CONSTRAINT "fk_grazing_records_paddock_id" FOREIGN KEY ("paddock_id") REFERENCES "paddocks" ("id") ON DELETE RESTRICT;
ALTER TABLE "grazing_records" ADD CONSTRAINT "fk_grazing_records_lot_id" FOREIGN KEY ("lot_id") REFERENCES "lots" ("id") ON DELETE RESTRICT;
ALTER TABLE "grazing_records" ADD CONSTRAINT "fk_grazing_records_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "paddocks" ADD CONSTRAINT "fk_paddocks_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "paddocks" ADD CONSTRAINT "fk_paddocks_farm_id" FOREIGN KEY ("farm_id") REFERENCES "farms" ("id") ON DELETE RESTRICT;
ALTER TABLE "paddocks" ADD CONSTRAINT "fk_paddocks_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "crops" ADD CONSTRAINT "fk_crops_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "crops" ADD CONSTRAINT "fk_crops_paddock_id" FOREIGN KEY ("paddock_id") REFERENCES "paddocks" ("id") ON DELETE RESTRICT;
ALTER TABLE "crops" ADD CONSTRAINT "fk_crops_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "crop_operations" ADD CONSTRAINT "fk_crop_operations_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "crop_operations" ADD CONSTRAINT "fk_crop_operations_crop_id" FOREIGN KEY ("crop_id") REFERENCES "crops" ("id") ON DELETE RESTRICT;
ALTER TABLE "crop_operations" ADD CONSTRAINT "fk_crop_operations_inventory_item_id" FOREIGN KEY ("inventory_item_id") REFERENCES "inventory_items" ("id") ON DELETE SET NULL;
ALTER TABLE "crop_operations" ADD CONSTRAINT "fk_crop_operations_machinery_id" FOREIGN KEY ("machinery_id") REFERENCES "machinery" ("id") ON DELETE SET NULL;
ALTER TABLE "crop_operations" ADD CONSTRAINT "fk_crop_operations_operator_id" FOREIGN KEY ("operator_id") REFERENCES "employees" ("id") ON DELETE SET NULL;
ALTER TABLE "crop_operations" ADD CONSTRAINT "fk_crop_operations_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "harvests" ADD CONSTRAINT "fk_harvests_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "harvests" ADD CONSTRAINT "fk_harvests_crop_id" FOREIGN KEY ("crop_id") REFERENCES "crops" ("id") ON DELETE RESTRICT;
ALTER TABLE "harvests" ADD CONSTRAINT "fk_harvests_yield_unit" FOREIGN KEY ("yield_unit") REFERENCES "units" ("code") ON DELETE SET NULL;
ALTER TABLE "harvests" ADD CONSTRAINT "fk_harvests_destination_item_id" FOREIGN KEY ("destination_item_id") REFERENCES "inventory_items" ("id") ON DELETE SET NULL;
ALTER TABLE "harvests" ADD CONSTRAINT "fk_harvests_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "soil_analyses" ADD CONSTRAINT "fk_soil_analyses_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "soil_analyses" ADD CONSTRAINT "fk_soil_analyses_paddock_id" FOREIGN KEY ("paddock_id") REFERENCES "paddocks" ("id") ON DELETE RESTRICT;
ALTER TABLE "soil_analyses" ADD CONSTRAINT "fk_soil_analyses_lab_sample_id" FOREIGN KEY ("lab_sample_id") REFERENCES "lab_samples" ("id") ON DELETE SET NULL;
ALTER TABLE "soil_analyses" ADD CONSTRAINT "fk_soil_analyses_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "warehouses" ADD CONSTRAINT "fk_warehouses_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "warehouses" ADD CONSTRAINT "fk_warehouses_farm_id" FOREIGN KEY ("farm_id") REFERENCES "farms" ("id") ON DELETE RESTRICT;
ALTER TABLE "warehouses" ADD CONSTRAINT "fk_warehouses_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "inventory_categories" ADD CONSTRAINT "fk_inventory_categories_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "inventory_categories" ADD CONSTRAINT "fk_inventory_categories_parent_id" FOREIGN KEY ("parent_id") REFERENCES "inventory_categories" ("id") ON DELETE SET NULL;
ALTER TABLE "inventory_categories" ADD CONSTRAINT "fk_inventory_categories_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "inventory_items" ADD CONSTRAINT "fk_inventory_items_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "inventory_items" ADD CONSTRAINT "fk_inventory_items_category_id" FOREIGN KEY ("category_id") REFERENCES "inventory_categories" ("id") ON DELETE SET NULL;
ALTER TABLE "inventory_items" ADD CONSTRAINT "fk_inventory_items_unit" FOREIGN KEY ("unit") REFERENCES "units" ("code") ON DELETE RESTRICT;
ALTER TABLE "inventory_items" ADD CONSTRAINT "fk_inventory_items_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "inventory_batches" ADD CONSTRAINT "fk_inventory_batches_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "inventory_batches" ADD CONSTRAINT "fk_inventory_batches_item_id" FOREIGN KEY ("item_id") REFERENCES "inventory_items" ("id") ON DELETE RESTRICT;
ALTER TABLE "inventory_batches" ADD CONSTRAINT "fk_inventory_batches_supplier_id" FOREIGN KEY ("supplier_id") REFERENCES "suppliers" ("id") ON DELETE SET NULL;
ALTER TABLE "inventory_batches" ADD CONSTRAINT "fk_inventory_batches_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "stock_levels" ADD CONSTRAINT "fk_stock_levels_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "stock_levels" ADD CONSTRAINT "fk_stock_levels_item_id" FOREIGN KEY ("item_id") REFERENCES "inventory_items" ("id") ON DELETE RESTRICT;
ALTER TABLE "stock_levels" ADD CONSTRAINT "fk_stock_levels_warehouse_id" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses" ("id") ON DELETE RESTRICT;
ALTER TABLE "stock_levels" ADD CONSTRAINT "fk_stock_levels_batch_id" FOREIGN KEY ("batch_id") REFERENCES "inventory_batches" ("id") ON DELETE SET NULL;
ALTER TABLE "stock_levels" ADD CONSTRAINT "fk_stock_levels_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "stock_movements" ADD CONSTRAINT "fk_stock_movements_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "stock_movements" ADD CONSTRAINT "fk_stock_movements_item_id" FOREIGN KEY ("item_id") REFERENCES "inventory_items" ("id") ON DELETE RESTRICT;
ALTER TABLE "stock_movements" ADD CONSTRAINT "fk_stock_movements_warehouse_id" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses" ("id") ON DELETE RESTRICT;
ALTER TABLE "stock_movements" ADD CONSTRAINT "fk_stock_movements_batch_id" FOREIGN KEY ("batch_id") REFERENCES "inventory_batches" ("id") ON DELETE SET NULL;
ALTER TABLE "stock_movements" ADD CONSTRAINT "fk_stock_movements_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "assets" ADD CONSTRAINT "fk_assets_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "assets" ADD CONSTRAINT "fk_assets_farm_id" FOREIGN KEY ("farm_id") REFERENCES "farms" ("id") ON DELETE RESTRICT;
ALTER TABLE "assets" ADD CONSTRAINT "fk_assets_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "machinery" ADD CONSTRAINT "fk_machinery_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "machinery" ADD CONSTRAINT "fk_machinery_asset_id" FOREIGN KEY ("asset_id") REFERENCES "assets" ("id") ON DELETE SET NULL;
ALTER TABLE "machinery" ADD CONSTRAINT "fk_machinery_farm_id" FOREIGN KEY ("farm_id") REFERENCES "farms" ("id") ON DELETE RESTRICT;
ALTER TABLE "machinery" ADD CONSTRAINT "fk_machinery_device_id" FOREIGN KEY ("device_id") REFERENCES "devices" ("id") ON DELETE SET NULL;
ALTER TABLE "machinery" ADD CONSTRAINT "fk_machinery_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "maintenance_records" ADD CONSTRAINT "fk_maintenance_records_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "maintenance_records" ADD CONSTRAINT "fk_maintenance_records_machinery_id" FOREIGN KEY ("machinery_id") REFERENCES "machinery" ("id") ON DELETE SET NULL;
ALTER TABLE "maintenance_records" ADD CONSTRAINT "fk_maintenance_records_asset_id" FOREIGN KEY ("asset_id") REFERENCES "assets" ("id") ON DELETE SET NULL;
ALTER TABLE "maintenance_records" ADD CONSTRAINT "fk_maintenance_records_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "fuel_logs" ADD CONSTRAINT "fk_fuel_logs_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "fuel_logs" ADD CONSTRAINT "fk_fuel_logs_machinery_id" FOREIGN KEY ("machinery_id") REFERENCES "machinery" ("id") ON DELETE SET NULL;
ALTER TABLE "fuel_logs" ADD CONSTRAINT "fk_fuel_logs_item_id" FOREIGN KEY ("item_id") REFERENCES "inventory_items" ("id") ON DELETE SET NULL;
ALTER TABLE "fuel_logs" ADD CONSTRAINT "fk_fuel_logs_operator_id" FOREIGN KEY ("operator_id") REFERENCES "employees" ("id") ON DELETE SET NULL;
ALTER TABLE "fuel_logs" ADD CONSTRAINT "fk_fuel_logs_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "labs" ADD CONSTRAINT "fk_labs_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "labs" ADD CONSTRAINT "fk_labs_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "lab_samples" ADD CONSTRAINT "fk_lab_samples_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "lab_samples" ADD CONSTRAINT "fk_lab_samples_lab_id" FOREIGN KEY ("lab_id") REFERENCES "labs" ("id") ON DELETE SET NULL;
ALTER TABLE "lab_samples" ADD CONSTRAINT "fk_lab_samples_animal_id" FOREIGN KEY ("animal_id") REFERENCES "animals" ("id") ON DELETE SET NULL;
ALTER TABLE "lab_samples" ADD CONSTRAINT "fk_lab_samples_paddock_id" FOREIGN KEY ("paddock_id") REFERENCES "paddocks" ("id") ON DELETE SET NULL;
ALTER TABLE "lab_samples" ADD CONSTRAINT "fk_lab_samples_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "lab_results" ADD CONSTRAINT "fk_lab_results_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "lab_results" ADD CONSTRAINT "fk_lab_results_sample_id" FOREIGN KEY ("sample_id") REFERENCES "lab_samples" ("id") ON DELETE RESTRICT;
ALTER TABLE "lab_results" ADD CONSTRAINT "fk_lab_results_document_id" FOREIGN KEY ("document_id") REFERENCES "documents" ("id") ON DELETE SET NULL;
ALTER TABLE "lab_results" ADD CONSTRAINT "fk_lab_results_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "business_partners" ADD CONSTRAINT "fk_business_partners_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "business_partners" ADD CONSTRAINT "fk_business_partners_company_id" FOREIGN KEY ("company_id") REFERENCES "companies" ("id") ON DELETE RESTRICT;
ALTER TABLE "business_partners" ADD CONSTRAINT "fk_business_partners_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "customers" ADD CONSTRAINT "fk_customers_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "customers" ADD CONSTRAINT "fk_customers_partner_id" FOREIGN KEY ("partner_id") REFERENCES "business_partners" ("id") ON DELETE RESTRICT;
ALTER TABLE "customers" ADD CONSTRAINT "fk_customers_price_list_id" FOREIGN KEY ("price_list_id") REFERENCES "price_lists" ("id") ON DELETE SET NULL;
ALTER TABLE "customers" ADD CONSTRAINT "fk_customers_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "suppliers" ADD CONSTRAINT "fk_suppliers_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "suppliers" ADD CONSTRAINT "fk_suppliers_partner_id" FOREIGN KEY ("partner_id") REFERENCES "business_partners" ("id") ON DELETE RESTRICT;
ALTER TABLE "suppliers" ADD CONSTRAINT "fk_suppliers_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "contacts" ADD CONSTRAINT "fk_contacts_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "contacts" ADD CONSTRAINT "fk_contacts_partner_id" FOREIGN KEY ("partner_id") REFERENCES "business_partners" ("id") ON DELETE RESTRICT;
ALTER TABLE "contacts" ADD CONSTRAINT "fk_contacts_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "price_lists" ADD CONSTRAINT "fk_price_lists_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "price_lists" ADD CONSTRAINT "fk_price_lists_company_id" FOREIGN KEY ("company_id") REFERENCES "companies" ("id") ON DELETE RESTRICT;
ALTER TABLE "price_lists" ADD CONSTRAINT "fk_price_lists_currency" FOREIGN KEY ("currency") REFERENCES "currencies" ("code") ON DELETE RESTRICT;
ALTER TABLE "price_lists" ADD CONSTRAINT "fk_price_lists_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "purchases" ADD CONSTRAINT "fk_purchases_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "purchases" ADD CONSTRAINT "fk_purchases_company_id" FOREIGN KEY ("company_id") REFERENCES "companies" ("id") ON DELETE RESTRICT;
ALTER TABLE "purchases" ADD CONSTRAINT "fk_purchases_supplier_partner_id" FOREIGN KEY ("supplier_partner_id") REFERENCES "business_partners" ("id") ON DELETE RESTRICT;
ALTER TABLE "purchases" ADD CONSTRAINT "fk_purchases_currency" FOREIGN KEY ("currency") REFERENCES "currencies" ("code") ON DELETE RESTRICT;
ALTER TABLE "purchases" ADD CONSTRAINT "fk_purchases_journal_entry_id" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries" ("id") ON DELETE SET NULL;
ALTER TABLE "purchases" ADD CONSTRAINT "fk_purchases_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "purchase_lines" ADD CONSTRAINT "fk_purchase_lines_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "purchase_lines" ADD CONSTRAINT "fk_purchase_lines_purchase_id" FOREIGN KEY ("purchase_id") REFERENCES "purchases" ("id") ON DELETE RESTRICT;
ALTER TABLE "purchase_lines" ADD CONSTRAINT "fk_purchase_lines_item_id" FOREIGN KEY ("item_id") REFERENCES "inventory_items" ("id") ON DELETE SET NULL;
ALTER TABLE "purchase_lines" ADD CONSTRAINT "fk_purchase_lines_animal_id" FOREIGN KEY ("animal_id") REFERENCES "animals" ("id") ON DELETE SET NULL;
ALTER TABLE "purchase_lines" ADD CONSTRAINT "fk_purchase_lines_warehouse_id" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses" ("id") ON DELETE SET NULL;
ALTER TABLE "purchase_lines" ADD CONSTRAINT "fk_purchase_lines_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "sales" ADD CONSTRAINT "fk_sales_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "sales" ADD CONSTRAINT "fk_sales_company_id" FOREIGN KEY ("company_id") REFERENCES "companies" ("id") ON DELETE RESTRICT;
ALTER TABLE "sales" ADD CONSTRAINT "fk_sales_customer_partner_id" FOREIGN KEY ("customer_partner_id") REFERENCES "business_partners" ("id") ON DELETE RESTRICT;
ALTER TABLE "sales" ADD CONSTRAINT "fk_sales_currency" FOREIGN KEY ("currency") REFERENCES "currencies" ("code") ON DELETE RESTRICT;
ALTER TABLE "sales" ADD CONSTRAINT "fk_sales_journal_entry_id" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries" ("id") ON DELETE SET NULL;
ALTER TABLE "sales" ADD CONSTRAINT "fk_sales_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "sale_lines" ADD CONSTRAINT "fk_sale_lines_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "sale_lines" ADD CONSTRAINT "fk_sale_lines_sale_id" FOREIGN KEY ("sale_id") REFERENCES "sales" ("id") ON DELETE RESTRICT;
ALTER TABLE "sale_lines" ADD CONSTRAINT "fk_sale_lines_item_id" FOREIGN KEY ("item_id") REFERENCES "inventory_items" ("id") ON DELETE SET NULL;
ALTER TABLE "sale_lines" ADD CONSTRAINT "fk_sale_lines_animal_id" FOREIGN KEY ("animal_id") REFERENCES "animals" ("id") ON DELETE SET NULL;
ALTER TABLE "sale_lines" ADD CONSTRAINT "fk_sale_lines_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "invoices" ADD CONSTRAINT "fk_invoices_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "invoices" ADD CONSTRAINT "fk_invoices_company_id" FOREIGN KEY ("company_id") REFERENCES "companies" ("id") ON DELETE RESTRICT;
ALTER TABLE "invoices" ADD CONSTRAINT "fk_invoices_sale_id" FOREIGN KEY ("sale_id") REFERENCES "sales" ("id") ON DELETE SET NULL;
ALTER TABLE "invoices" ADD CONSTRAINT "fk_invoices_purchase_id" FOREIGN KEY ("purchase_id") REFERENCES "purchases" ("id") ON DELETE SET NULL;
ALTER TABLE "invoices" ADD CONSTRAINT "fk_invoices_partner_id" FOREIGN KEY ("partner_id") REFERENCES "business_partners" ("id") ON DELETE RESTRICT;
ALTER TABLE "invoices" ADD CONSTRAINT "fk_invoices_currency" FOREIGN KEY ("currency") REFERENCES "currencies" ("code") ON DELETE RESTRICT;
ALTER TABLE "invoices" ADD CONSTRAINT "fk_invoices_document_id" FOREIGN KEY ("document_id") REFERENCES "documents" ("id") ON DELETE SET NULL;
ALTER TABLE "invoices" ADD CONSTRAINT "fk_invoices_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "contracts" ADD CONSTRAINT "fk_contracts_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "contracts" ADD CONSTRAINT "fk_contracts_company_id" FOREIGN KEY ("company_id") REFERENCES "companies" ("id") ON DELETE RESTRICT;
ALTER TABLE "contracts" ADD CONSTRAINT "fk_contracts_partner_id" FOREIGN KEY ("partner_id") REFERENCES "business_partners" ("id") ON DELETE RESTRICT;
ALTER TABLE "contracts" ADD CONSTRAINT "fk_contracts_document_id" FOREIGN KEY ("document_id") REFERENCES "documents" ("id") ON DELETE SET NULL;
ALTER TABLE "contracts" ADD CONSTRAINT "fk_contracts_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "market_prices" ADD CONSTRAINT "fk_market_prices_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE SET NULL;
ALTER TABLE "market_prices" ADD CONSTRAINT "fk_market_prices_currency" FOREIGN KEY ("currency") REFERENCES "currencies" ("code") ON DELETE RESTRICT;
ALTER TABLE "market_prices" ADD CONSTRAINT "fk_market_prices_unit" FOREIGN KEY ("unit") REFERENCES "units" ("code") ON DELETE SET NULL;
ALTER TABLE "market_prices" ADD CONSTRAINT "fk_market_prices_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "chart_of_accounts" ADD CONSTRAINT "fk_chart_of_accounts_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "chart_of_accounts" ADD CONSTRAINT "fk_chart_of_accounts_company_id" FOREIGN KEY ("company_id") REFERENCES "companies" ("id") ON DELETE RESTRICT;
ALTER TABLE "chart_of_accounts" ADD CONSTRAINT "fk_chart_of_accounts_parent_id" FOREIGN KEY ("parent_id") REFERENCES "chart_of_accounts" ("id") ON DELETE SET NULL;
ALTER TABLE "chart_of_accounts" ADD CONSTRAINT "fk_chart_of_accounts_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "cost_centers" ADD CONSTRAINT "fk_cost_centers_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "cost_centers" ADD CONSTRAINT "fk_cost_centers_company_id" FOREIGN KEY ("company_id") REFERENCES "companies" ("id") ON DELETE RESTRICT;
ALTER TABLE "cost_centers" ADD CONSTRAINT "fk_cost_centers_farm_id" FOREIGN KEY ("farm_id") REFERENCES "farms" ("id") ON DELETE SET NULL;
ALTER TABLE "cost_centers" ADD CONSTRAINT "fk_cost_centers_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "fiscal_periods" ADD CONSTRAINT "fk_fiscal_periods_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "fiscal_periods" ADD CONSTRAINT "fk_fiscal_periods_company_id" FOREIGN KEY ("company_id") REFERENCES "companies" ("id") ON DELETE RESTRICT;
ALTER TABLE "fiscal_periods" ADD CONSTRAINT "fk_fiscal_periods_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "journal_entries" ADD CONSTRAINT "fk_journal_entries_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "journal_entries" ADD CONSTRAINT "fk_journal_entries_company_id" FOREIGN KEY ("company_id") REFERENCES "companies" ("id") ON DELETE RESTRICT;
ALTER TABLE "journal_entries" ADD CONSTRAINT "fk_journal_entries_period_id" FOREIGN KEY ("period_id") REFERENCES "fiscal_periods" ("id") ON DELETE SET NULL;
ALTER TABLE "journal_entries" ADD CONSTRAINT "fk_journal_entries_currency" FOREIGN KEY ("currency") REFERENCES "currencies" ("code") ON DELETE RESTRICT;
ALTER TABLE "journal_entries" ADD CONSTRAINT "fk_journal_entries_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "journal_lines" ADD CONSTRAINT "fk_journal_lines_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "journal_lines" ADD CONSTRAINT "fk_journal_lines_entry_id" FOREIGN KEY ("entry_id") REFERENCES "journal_entries" ("id") ON DELETE RESTRICT;
ALTER TABLE "journal_lines" ADD CONSTRAINT "fk_journal_lines_account_id" FOREIGN KEY ("account_id") REFERENCES "chart_of_accounts" ("id") ON DELETE RESTRICT;
ALTER TABLE "journal_lines" ADD CONSTRAINT "fk_journal_lines_cost_center_id" FOREIGN KEY ("cost_center_id") REFERENCES "cost_centers" ("id") ON DELETE SET NULL;
ALTER TABLE "journal_lines" ADD CONSTRAINT "fk_journal_lines_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "payments" ADD CONSTRAINT "fk_payments_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "payments" ADD CONSTRAINT "fk_payments_company_id" FOREIGN KEY ("company_id") REFERENCES "companies" ("id") ON DELETE RESTRICT;
ALTER TABLE "payments" ADD CONSTRAINT "fk_payments_partner_id" FOREIGN KEY ("partner_id") REFERENCES "business_partners" ("id") ON DELETE SET NULL;
ALTER TABLE "payments" ADD CONSTRAINT "fk_payments_currency" FOREIGN KEY ("currency") REFERENCES "currencies" ("code") ON DELETE RESTRICT;
ALTER TABLE "payments" ADD CONSTRAINT "fk_payments_account_id" FOREIGN KEY ("account_id") REFERENCES "chart_of_accounts" ("id") ON DELETE SET NULL;
ALTER TABLE "payments" ADD CONSTRAINT "fk_payments_journal_entry_id" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries" ("id") ON DELETE SET NULL;
ALTER TABLE "payments" ADD CONSTRAINT "fk_payments_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "payment_allocations" ADD CONSTRAINT "fk_payment_allocations_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "payment_allocations" ADD CONSTRAINT "fk_payment_allocations_payment_id" FOREIGN KEY ("payment_id") REFERENCES "payments" ("id") ON DELETE RESTRICT;
ALTER TABLE "payment_allocations" ADD CONSTRAINT "fk_payment_allocations_invoice_id" FOREIGN KEY ("invoice_id") REFERENCES "invoices" ("id") ON DELETE RESTRICT;
ALTER TABLE "payment_allocations" ADD CONSTRAINT "fk_payment_allocations_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "budgets" ADD CONSTRAINT "fk_budgets_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "budgets" ADD CONSTRAINT "fk_budgets_company_id" FOREIGN KEY ("company_id") REFERENCES "companies" ("id") ON DELETE RESTRICT;
ALTER TABLE "budgets" ADD CONSTRAINT "fk_budgets_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "budget_lines" ADD CONSTRAINT "fk_budget_lines_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "budget_lines" ADD CONSTRAINT "fk_budget_lines_budget_id" FOREIGN KEY ("budget_id") REFERENCES "budgets" ("id") ON DELETE RESTRICT;
ALTER TABLE "budget_lines" ADD CONSTRAINT "fk_budget_lines_account_id" FOREIGN KEY ("account_id") REFERENCES "chart_of_accounts" ("id") ON DELETE RESTRICT;
ALTER TABLE "budget_lines" ADD CONSTRAINT "fk_budget_lines_cost_center_id" FOREIGN KEY ("cost_center_id") REFERENCES "cost_centers" ("id") ON DELETE SET NULL;
ALTER TABLE "budget_lines" ADD CONSTRAINT "fk_budget_lines_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "bank_accounts" ADD CONSTRAINT "fk_bank_accounts_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "bank_accounts" ADD CONSTRAINT "fk_bank_accounts_company_id" FOREIGN KEY ("company_id") REFERENCES "companies" ("id") ON DELETE RESTRICT;
ALTER TABLE "bank_accounts" ADD CONSTRAINT "fk_bank_accounts_currency" FOREIGN KEY ("currency") REFERENCES "currencies" ("code") ON DELETE RESTRICT;
ALTER TABLE "bank_accounts" ADD CONSTRAINT "fk_bank_accounts_ledger_account_id" FOREIGN KEY ("ledger_account_id") REFERENCES "chart_of_accounts" ("id") ON DELETE SET NULL;
ALTER TABLE "bank_accounts" ADD CONSTRAINT "fk_bank_accounts_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "employees" ADD CONSTRAINT "fk_employees_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "employees" ADD CONSTRAINT "fk_employees_company_id" FOREIGN KEY ("company_id") REFERENCES "companies" ("id") ON DELETE RESTRICT;
ALTER TABLE "employees" ADD CONSTRAINT "fk_employees_user_id" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "employees" ADD CONSTRAINT "fk_employees_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "work_logs" ADD CONSTRAINT "fk_work_logs_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "work_logs" ADD CONSTRAINT "fk_work_logs_employee_id" FOREIGN KEY ("employee_id") REFERENCES "employees" ("id") ON DELETE RESTRICT;
ALTER TABLE "work_logs" ADD CONSTRAINT "fk_work_logs_task_id" FOREIGN KEY ("task_id") REFERENCES "tasks" ("id") ON DELETE SET NULL;
ALTER TABLE "work_logs" ADD CONSTRAINT "fk_work_logs_farm_id" FOREIGN KEY ("farm_id") REFERENCES "farms" ("id") ON DELETE SET NULL;
ALTER TABLE "work_logs" ADD CONSTRAINT "fk_work_logs_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "payroll_runs" ADD CONSTRAINT "fk_payroll_runs_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "payroll_runs" ADD CONSTRAINT "fk_payroll_runs_company_id" FOREIGN KEY ("company_id") REFERENCES "companies" ("id") ON DELETE RESTRICT;
ALTER TABLE "payroll_runs" ADD CONSTRAINT "fk_payroll_runs_journal_entry_id" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries" ("id") ON DELETE SET NULL;
ALTER TABLE "payroll_runs" ADD CONSTRAINT "fk_payroll_runs_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "payroll_items" ADD CONSTRAINT "fk_payroll_items_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "payroll_items" ADD CONSTRAINT "fk_payroll_items_payroll_run_id" FOREIGN KEY ("payroll_run_id") REFERENCES "payroll_runs" ("id") ON DELETE RESTRICT;
ALTER TABLE "payroll_items" ADD CONSTRAINT "fk_payroll_items_employee_id" FOREIGN KEY ("employee_id") REFERENCES "employees" ("id") ON DELETE RESTRICT;
ALTER TABLE "payroll_items" ADD CONSTRAINT "fk_payroll_items_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "tasks" ADD CONSTRAINT "fk_tasks_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "tasks" ADD CONSTRAINT "fk_tasks_farm_id" FOREIGN KEY ("farm_id") REFERENCES "farms" ("id") ON DELETE SET NULL;
ALTER TABLE "tasks" ADD CONSTRAINT "fk_tasks_assigned_to" FOREIGN KEY ("assigned_to") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "tasks" ADD CONSTRAINT "fk_tasks_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "calendar_events" ADD CONSTRAINT "fk_calendar_events_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "calendar_events" ADD CONSTRAINT "fk_calendar_events_farm_id" FOREIGN KEY ("farm_id") REFERENCES "farms" ("id") ON DELETE SET NULL;
ALTER TABLE "calendar_events" ADD CONSTRAINT "fk_calendar_events_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "alert_rules" ADD CONSTRAINT "fk_alert_rules_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "alert_rules" ADD CONSTRAINT "fk_alert_rules_farm_id" FOREIGN KEY ("farm_id") REFERENCES "farms" ("id") ON DELETE SET NULL;
ALTER TABLE "alert_rules" ADD CONSTRAINT "fk_alert_rules_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "alerts" ADD CONSTRAINT "fk_alerts_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "alerts" ADD CONSTRAINT "fk_alerts_rule_id" FOREIGN KEY ("rule_id") REFERENCES "alert_rules" ("id") ON DELETE SET NULL;
ALTER TABLE "alerts" ADD CONSTRAINT "fk_alerts_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "notifications" ADD CONSTRAINT "fk_notifications_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "notifications" ADD CONSTRAINT "fk_notifications_user_id" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE RESTRICT;
ALTER TABLE "notifications" ADD CONSTRAINT "fk_notifications_alert_id" FOREIGN KEY ("alert_id") REFERENCES "alerts" ("id") ON DELETE SET NULL;
ALTER TABLE "notifications" ADD CONSTRAINT "fk_notifications_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "notification_preferences" ADD CONSTRAINT "fk_notification_preferences_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "notification_preferences" ADD CONSTRAINT "fk_notification_preferences_user_id" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE RESTRICT;
ALTER TABLE "notification_preferences" ADD CONSTRAINT "fk_notification_preferences_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "files" ADD CONSTRAINT "fk_files_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "files" ADD CONSTRAINT "fk_files_uploaded_by" FOREIGN KEY ("uploaded_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "files" ADD CONSTRAINT "fk_files_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "attachments" ADD CONSTRAINT "fk_attachments_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "attachments" ADD CONSTRAINT "fk_attachments_file_id" FOREIGN KEY ("file_id") REFERENCES "files" ("id") ON DELETE RESTRICT;
ALTER TABLE "attachments" ADD CONSTRAINT "fk_attachments_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "documents" ADD CONSTRAINT "fk_documents_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "documents" ADD CONSTRAINT "fk_documents_file_id" FOREIGN KEY ("file_id") REFERENCES "files" ("id") ON DELETE RESTRICT;
ALTER TABLE "documents" ADD CONSTRAINT "fk_documents_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "device_types" ADD CONSTRAINT "fk_device_types_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "devices" ADD CONSTRAINT "fk_devices_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "devices" ADD CONSTRAINT "fk_devices_farm_id" FOREIGN KEY ("farm_id") REFERENCES "farms" ("id") ON DELETE RESTRICT;
ALTER TABLE "devices" ADD CONSTRAINT "fk_devices_device_type_id" FOREIGN KEY ("device_type_id") REFERENCES "device_types" ("id") ON DELETE RESTRICT;
ALTER TABLE "devices" ADD CONSTRAINT "fk_devices_gateway_id" FOREIGN KEY ("gateway_id") REFERENCES "devices" ("id") ON DELETE SET NULL;
ALTER TABLE "devices" ADD CONSTRAINT "fk_devices_assigned_animal_id" FOREIGN KEY ("assigned_animal_id") REFERENCES "animals" ("id") ON DELETE SET NULL;
ALTER TABLE "devices" ADD CONSTRAINT "fk_devices_assigned_machinery_id" FOREIGN KEY ("assigned_machinery_id") REFERENCES "machinery" ("id") ON DELETE SET NULL;
ALTER TABLE "devices" ADD CONSTRAINT "fk_devices_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "sensor_readings" ADD CONSTRAINT "fk_sensor_readings_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "sensor_readings" ADD CONSTRAINT "fk_sensor_readings_device_id" FOREIGN KEY ("device_id") REFERENCES "devices" ("id") ON DELETE RESTRICT;
ALTER TABLE "sensor_readings" ADD CONSTRAINT "fk_sensor_readings_unit" FOREIGN KEY ("unit") REFERENCES "units" ("code") ON DELETE SET NULL;
ALTER TABLE "gps_positions" ADD CONSTRAINT "fk_gps_positions_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "gps_positions" ADD CONSTRAINT "fk_gps_positions_device_id" FOREIGN KEY ("device_id") REFERENCES "devices" ("id") ON DELETE SET NULL;
ALTER TABLE "gps_positions" ADD CONSTRAINT "fk_gps_positions_animal_id" FOREIGN KEY ("animal_id") REFERENCES "animals" ("id") ON DELETE SET NULL;
ALTER TABLE "gps_positions" ADD CONSTRAINT "fk_gps_positions_machinery_id" FOREIGN KEY ("machinery_id") REFERENCES "machinery" ("id") ON DELETE SET NULL;
ALTER TABLE "geofences" ADD CONSTRAINT "fk_geofences_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "geofences" ADD CONSTRAINT "fk_geofences_farm_id" FOREIGN KEY ("farm_id") REFERENCES "farms" ("id") ON DELETE RESTRICT;
ALTER TABLE "geofences" ADD CONSTRAINT "fk_geofences_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "trace_events" ADD CONSTRAINT "fk_trace_events_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "trace_events" ADD CONSTRAINT "fk_trace_events_anchor_id" FOREIGN KEY ("anchor_id") REFERENCES "blockchain_anchors" ("id") ON DELETE SET NULL;
ALTER TABLE "trace_events" ADD CONSTRAINT "fk_trace_events_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "compliance_reports" ADD CONSTRAINT "fk_compliance_reports_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "compliance_reports" ADD CONSTRAINT "fk_compliance_reports_company_id" FOREIGN KEY ("company_id") REFERENCES "companies" ("id") ON DELETE RESTRICT;
ALTER TABLE "compliance_reports" ADD CONSTRAINT "fk_compliance_reports_farm_id" FOREIGN KEY ("farm_id") REFERENCES "farms" ("id") ON DELETE SET NULL;
ALTER TABLE "compliance_reports" ADD CONSTRAINT "fk_compliance_reports_document_id" FOREIGN KEY ("document_id") REFERENCES "documents" ("id") ON DELETE SET NULL;
ALTER TABLE "compliance_reports" ADD CONSTRAINT "fk_compliance_reports_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "movement_guides" ADD CONSTRAINT "fk_movement_guides_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "movement_guides" ADD CONSTRAINT "fk_movement_guides_company_id" FOREIGN KEY ("company_id") REFERENCES "companies" ("id") ON DELETE RESTRICT;
ALTER TABLE "movement_guides" ADD CONSTRAINT "fk_movement_guides_from_farm_id" FOREIGN KEY ("from_farm_id") REFERENCES "farms" ("id") ON DELETE SET NULL;
ALTER TABLE "movement_guides" ADD CONSTRAINT "fk_movement_guides_to_partner_id" FOREIGN KEY ("to_partner_id") REFERENCES "business_partners" ("id") ON DELETE SET NULL;
ALTER TABLE "movement_guides" ADD CONSTRAINT "fk_movement_guides_document_id" FOREIGN KEY ("document_id") REFERENCES "documents" ("id") ON DELETE SET NULL;
ALTER TABLE "movement_guides" ADD CONSTRAINT "fk_movement_guides_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "certifications" ADD CONSTRAINT "fk_certifications_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "certifications" ADD CONSTRAINT "fk_certifications_document_id" FOREIGN KEY ("document_id") REFERENCES "documents" ("id") ON DELETE SET NULL;
ALTER TABLE "certifications" ADD CONSTRAINT "fk_certifications_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "blockchain_anchors" ADD CONSTRAINT "fk_blockchain_anchors_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "blockchain_anchors" ADD CONSTRAINT "fk_blockchain_anchors_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "verifiable_credentials" ADD CONSTRAINT "fk_verifiable_credentials_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "verifiable_credentials" ADD CONSTRAINT "fk_verifiable_credentials_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "ml_models" ADD CONSTRAINT "fk_ml_models_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "predictions" ADD CONSTRAINT "fk_predictions_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "predictions" ADD CONSTRAINT "fk_predictions_model_id" FOREIGN KEY ("model_id") REFERENCES "ml_models" ("id") ON DELETE RESTRICT;
ALTER TABLE "predictions" ADD CONSTRAINT "fk_predictions_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "ai_conversations" ADD CONSTRAINT "fk_ai_conversations_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "ai_conversations" ADD CONSTRAINT "fk_ai_conversations_user_id" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE RESTRICT;
ALTER TABLE "ai_conversations" ADD CONSTRAINT "fk_ai_conversations_farm_id" FOREIGN KEY ("farm_id") REFERENCES "farms" ("id") ON DELETE SET NULL;
ALTER TABLE "ai_conversations" ADD CONSTRAINT "fk_ai_conversations_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "ai_messages" ADD CONSTRAINT "fk_ai_messages_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "ai_messages" ADD CONSTRAINT "fk_ai_messages_conversation_id" FOREIGN KEY ("conversation_id") REFERENCES "ai_conversations" ("id") ON DELETE RESTRICT;
ALTER TABLE "ai_messages" ADD CONSTRAINT "fk_ai_messages_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "image_analyses" ADD CONSTRAINT "fk_image_analyses_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "image_analyses" ADD CONSTRAINT "fk_image_analyses_file_id" FOREIGN KEY ("file_id") REFERENCES "files" ("id") ON DELETE RESTRICT;
ALTER TABLE "image_analyses" ADD CONSTRAINT "fk_image_analyses_model_id" FOREIGN KEY ("model_id") REFERENCES "ml_models" ("id") ON DELETE SET NULL;
ALTER TABLE "image_analyses" ADD CONSTRAINT "fk_image_analyses_animal_id" FOREIGN KEY ("animal_id") REFERENCES "animals" ("id") ON DELETE SET NULL;
ALTER TABLE "image_analyses" ADD CONSTRAINT "fk_image_analyses_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "marketplace_listings" ADD CONSTRAINT "fk_marketplace_listings_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "marketplace_listings" ADD CONSTRAINT "fk_marketplace_listings_company_id" FOREIGN KEY ("company_id") REFERENCES "companies" ("id") ON DELETE RESTRICT;
ALTER TABLE "marketplace_listings" ADD CONSTRAINT "fk_marketplace_listings_animal_id" FOREIGN KEY ("animal_id") REFERENCES "animals" ("id") ON DELETE SET NULL;
ALTER TABLE "marketplace_listings" ADD CONSTRAINT "fk_marketplace_listings_semen_batch_id" FOREIGN KEY ("semen_batch_id") REFERENCES "semen_batches" ("id") ON DELETE SET NULL;
ALTER TABLE "marketplace_listings" ADD CONSTRAINT "fk_marketplace_listings_currency" FOREIGN KEY ("currency") REFERENCES "currencies" ("code") ON DELETE SET NULL;
ALTER TABLE "marketplace_listings" ADD CONSTRAINT "fk_marketplace_listings_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "marketplace_media" ADD CONSTRAINT "fk_marketplace_media_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "marketplace_media" ADD CONSTRAINT "fk_marketplace_media_listing_id" FOREIGN KEY ("listing_id") REFERENCES "marketplace_listings" ("id") ON DELETE RESTRICT;
ALTER TABLE "marketplace_media" ADD CONSTRAINT "fk_marketplace_media_file_id" FOREIGN KEY ("file_id") REFERENCES "files" ("id") ON DELETE RESTRICT;
ALTER TABLE "marketplace_media" ADD CONSTRAINT "fk_marketplace_media_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "marketplace_inquiries" ADD CONSTRAINT "fk_marketplace_inquiries_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "marketplace_inquiries" ADD CONSTRAINT "fk_marketplace_inquiries_listing_id" FOREIGN KEY ("listing_id") REFERENCES "marketplace_listings" ("id") ON DELETE RESTRICT;
ALTER TABLE "marketplace_inquiries" ADD CONSTRAINT "fk_marketplace_inquiries_from_user_id" FOREIGN KEY ("from_user_id") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "marketplace_inquiries" ADD CONSTRAINT "fk_marketplace_inquiries_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "marketplace_transactions" ADD CONSTRAINT "fk_marketplace_transactions_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "marketplace_transactions" ADD CONSTRAINT "fk_marketplace_transactions_listing_id" FOREIGN KEY ("listing_id") REFERENCES "marketplace_listings" ("id") ON DELETE RESTRICT;
ALTER TABLE "marketplace_transactions" ADD CONSTRAINT "fk_marketplace_transactions_buyer_company_id" FOREIGN KEY ("buyer_company_id") REFERENCES "companies" ("id") ON DELETE SET NULL;
ALTER TABLE "marketplace_transactions" ADD CONSTRAINT "fk_marketplace_transactions_currency" FOREIGN KEY ("currency") REFERENCES "currencies" ("code") ON DELETE SET NULL;
ALTER TABLE "marketplace_transactions" ADD CONSTRAINT "fk_marketplace_transactions_sale_id" FOREIGN KEY ("sale_id") REFERENCES "sales" ("id") ON DELETE SET NULL;
ALTER TABLE "marketplace_transactions" ADD CONSTRAINT "fk_marketplace_transactions_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "courses" ADD CONSTRAINT "fk_courses_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE SET NULL;
ALTER TABLE "courses" ADD CONSTRAINT "fk_courses_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "course_modules" ADD CONSTRAINT "fk_course_modules_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "course_modules" ADD CONSTRAINT "fk_course_modules_course_id" FOREIGN KEY ("course_id") REFERENCES "courses" ("id") ON DELETE RESTRICT;
ALTER TABLE "course_modules" ADD CONSTRAINT "fk_course_modules_file_id" FOREIGN KEY ("file_id") REFERENCES "files" ("id") ON DELETE SET NULL;
ALTER TABLE "course_modules" ADD CONSTRAINT "fk_course_modules_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "course_enrollments" ADD CONSTRAINT "fk_course_enrollments_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "course_enrollments" ADD CONSTRAINT "fk_course_enrollments_course_id" FOREIGN KEY ("course_id") REFERENCES "courses" ("id") ON DELETE RESTRICT;
ALTER TABLE "course_enrollments" ADD CONSTRAINT "fk_course_enrollments_user_id" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE RESTRICT;
ALTER TABLE "course_enrollments" ADD CONSTRAINT "fk_course_enrollments_certificate_document_id" FOREIGN KEY ("certificate_document_id") REFERENCES "documents" ("id") ON DELETE SET NULL;
ALTER TABLE "course_enrollments" ADD CONSTRAINT "fk_course_enrollments_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "sync_devices" ADD CONSTRAINT "fk_sync_devices_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "sync_devices" ADD CONSTRAINT "fk_sync_devices_user_id" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE RESTRICT;
ALTER TABLE "sync_devices" ADD CONSTRAINT "fk_sync_devices_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "sync_changesets" ADD CONSTRAINT "fk_sync_changesets_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "sync_changesets" ADD CONSTRAINT "fk_sync_changesets_sync_device_id" FOREIGN KEY ("sync_device_id") REFERENCES "sync_devices" ("id") ON DELETE RESTRICT;
ALTER TABLE "sync_changesets" ADD CONSTRAINT "fk_sync_changesets_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "sync_conflicts" ADD CONSTRAINT "fk_sync_conflicts_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "sync_conflicts" ADD CONSTRAINT "fk_sync_conflicts_changeset_id" FOREIGN KEY ("changeset_id") REFERENCES "sync_changesets" ("id") ON DELETE RESTRICT;
ALTER TABLE "sync_conflicts" ADD CONSTRAINT "fk_sync_conflicts_resolved_by" FOREIGN KEY ("resolved_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "sync_conflicts" ADD CONSTRAINT "fk_sync_conflicts_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "audit_logs" ADD CONSTRAINT "fk_audit_logs_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "audit_logs" ADD CONSTRAINT "fk_audit_logs_user_id" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "system_settings" ADD CONSTRAINT "fk_system_settings_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "system_settings" ADD CONSTRAINT "fk_system_settings_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "feature_flags" ADD CONSTRAINT "fk_feature_flags_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "feature_flags" ADD CONSTRAINT "fk_feature_flags_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "webhooks" ADD CONSTRAINT "fk_webhooks_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "webhooks" ADD CONSTRAINT "fk_webhooks_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "fk_webhook_deliveries_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "fk_webhook_deliveries_webhook_id" FOREIGN KEY ("webhook_id") REFERENCES "webhooks" ("id") ON DELETE RESTRICT;
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "fk_webhook_deliveries_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "integrations" ADD CONSTRAINT "fk_integrations_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "integrations" ADD CONSTRAINT "fk_integrations_company_id" FOREIGN KEY ("company_id") REFERENCES "companies" ("id") ON DELETE SET NULL;
ALTER TABLE "integrations" ADD CONSTRAINT "fk_integrations_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;

-- ============================================================================
-- SEGURIDAD A NIVEL DE FILA (RLS) — aislamiento multi-tenant
-- La app fija app.current_tenant por sesión; la política filtra por tenant_id.
-- ============================================================================
ALTER TABLE "companies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "companies" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_companies" ON "companies" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "farms" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "farms" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_farms" ON "farms" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "user_role_assignments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_role_assignments" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_user_role_assignments" ON "user_role_assignments" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "invitations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invitations" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_invitations" ON "invitations" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "api_keys" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "api_keys" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_api_keys" ON "api_keys" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "subscriptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "subscriptions" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_subscriptions" ON "subscriptions" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "subscription_usage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "subscription_usage" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_subscription_usage" ON "subscription_usage" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "billing_payments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "billing_payments" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_billing_payments" ON "billing_payments" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "animals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "animals" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_animals" ON "animals" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "animal_breeds" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "animal_breeds" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_animal_breeds" ON "animal_breeds" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "animal_identifiers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "animal_identifiers" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_animal_identifiers" ON "animal_identifiers" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "lots" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lots" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_lots" ON "lots" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "animal_movements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "animal_movements" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_animal_movements" ON "animal_movements" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "animal_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "animal_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_animal_events" ON "animal_events" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "breeding_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "breeding_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_breeding_events" ON "breeding_events" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "repro_protocols" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "repro_protocols" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_repro_protocols" ON "repro_protocols" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "pregnancies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pregnancies" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_pregnancies" ON "pregnancies" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "calvings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "calvings" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_calvings" ON "calvings" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "calving_offspring" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "calving_offspring" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_calving_offspring" ON "calving_offspring" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "weanings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "weanings" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_weanings" ON "weanings" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "semen_batches" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "semen_batches" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_semen_batches" ON "semen_batches" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "embryos" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "embryos" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_embryos" ON "embryos" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "storage_tanks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "storage_tanks" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_storage_tanks" ON "storage_tanks" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "genetic_evaluations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "genetic_evaluations" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_genetic_evaluations" ON "genetic_evaluations" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "products_veterinary" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "products_veterinary" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_products_veterinary" ON "products_veterinary" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "vaccinations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "vaccinations" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_vaccinations" ON "vaccinations" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "treatments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "treatments" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_treatments" ON "treatments" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "health_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "health_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_health_events" ON "health_events" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "health_plans" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "health_plans" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_health_plans" ON "health_plans" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "mortalities" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mortalities" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_mortalities" ON "mortalities" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "weighings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "weighings" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_weighings" ON "weighings" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "milk_production_daily" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "milk_production_daily" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_milk_production_daily" ON "milk_production_daily" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "milk_quality_tests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "milk_quality_tests" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_milk_quality_tests" ON "milk_quality_tests" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "milk_tanks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "milk_tanks" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_milk_tanks" ON "milk_tanks" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "milk_deliveries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "milk_deliveries" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_milk_deliveries" ON "milk_deliveries" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "carcass_records" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "carcass_records" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_carcass_records" ON "carcass_records" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "shearing_records" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "shearing_records" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_shearing_records" ON "shearing_records" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "rations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "rations" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_rations" ON "rations" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "ration_ingredients" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ration_ingredients" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_ration_ingredients" ON "ration_ingredients" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "feed_deliveries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "feed_deliveries" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_feed_deliveries" ON "feed_deliveries" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "grazing_records" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "grazing_records" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_grazing_records" ON "grazing_records" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "paddocks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "paddocks" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_paddocks" ON "paddocks" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "crops" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crops" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_crops" ON "crops" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "crop_operations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crop_operations" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_crop_operations" ON "crop_operations" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "harvests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "harvests" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_harvests" ON "harvests" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "soil_analyses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "soil_analyses" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_soil_analyses" ON "soil_analyses" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "warehouses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "warehouses" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_warehouses" ON "warehouses" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "inventory_categories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "inventory_categories" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_inventory_categories" ON "inventory_categories" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "inventory_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "inventory_items" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_inventory_items" ON "inventory_items" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "inventory_batches" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "inventory_batches" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_inventory_batches" ON "inventory_batches" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "stock_levels" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stock_levels" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_stock_levels" ON "stock_levels" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "stock_movements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stock_movements" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_stock_movements" ON "stock_movements" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "assets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "assets" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_assets" ON "assets" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "machinery" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "machinery" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_machinery" ON "machinery" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "maintenance_records" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "maintenance_records" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_maintenance_records" ON "maintenance_records" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "fuel_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "fuel_logs" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_fuel_logs" ON "fuel_logs" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "labs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "labs" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_labs" ON "labs" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "lab_samples" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lab_samples" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_lab_samples" ON "lab_samples" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "lab_results" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lab_results" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_lab_results" ON "lab_results" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "business_partners" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "business_partners" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_business_partners" ON "business_partners" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "customers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "customers" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_customers" ON "customers" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "suppliers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "suppliers" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_suppliers" ON "suppliers" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "contacts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "contacts" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_contacts" ON "contacts" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "price_lists" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "price_lists" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_price_lists" ON "price_lists" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "purchases" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "purchases" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_purchases" ON "purchases" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "purchase_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "purchase_lines" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_purchase_lines" ON "purchase_lines" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "sales" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sales" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_sales" ON "sales" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "sale_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sale_lines" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_sale_lines" ON "sale_lines" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "invoices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invoices" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_invoices" ON "invoices" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "contracts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "contracts" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_contracts" ON "contracts" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "chart_of_accounts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "chart_of_accounts" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_chart_of_accounts" ON "chart_of_accounts" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "cost_centers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cost_centers" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_cost_centers" ON "cost_centers" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "fiscal_periods" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "fiscal_periods" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_fiscal_periods" ON "fiscal_periods" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "journal_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "journal_entries" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_journal_entries" ON "journal_entries" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "journal_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "journal_lines" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_journal_lines" ON "journal_lines" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "payments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payments" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_payments" ON "payments" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "payment_allocations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payment_allocations" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_payment_allocations" ON "payment_allocations" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "budgets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "budgets" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_budgets" ON "budgets" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "budget_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "budget_lines" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_budget_lines" ON "budget_lines" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "bank_accounts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "bank_accounts" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_bank_accounts" ON "bank_accounts" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "employees" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "employees" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_employees" ON "employees" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "work_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "work_logs" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_work_logs" ON "work_logs" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "payroll_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payroll_runs" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_payroll_runs" ON "payroll_runs" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "payroll_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payroll_items" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_payroll_items" ON "payroll_items" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "tasks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tasks" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_tasks" ON "tasks" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "calendar_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "calendar_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_calendar_events" ON "calendar_events" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "alert_rules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "alert_rules" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_alert_rules" ON "alert_rules" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "alerts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "alerts" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_alerts" ON "alerts" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notifications" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_notifications" ON "notifications" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "notification_preferences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notification_preferences" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_notification_preferences" ON "notification_preferences" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "files" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "files" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_files" ON "files" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "attachments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "attachments" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_attachments" ON "attachments" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "documents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "documents" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_documents" ON "documents" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "devices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "devices" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_devices" ON "devices" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "sensor_readings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sensor_readings" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_sensor_readings" ON "sensor_readings" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "gps_positions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "gps_positions" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_gps_positions" ON "gps_positions" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "geofences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "geofences" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_geofences" ON "geofences" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "trace_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "trace_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_trace_events" ON "trace_events" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "compliance_reports" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "compliance_reports" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_compliance_reports" ON "compliance_reports" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "movement_guides" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "movement_guides" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_movement_guides" ON "movement_guides" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "certifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "certifications" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_certifications" ON "certifications" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "blockchain_anchors" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "blockchain_anchors" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_blockchain_anchors" ON "blockchain_anchors" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "verifiable_credentials" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "verifiable_credentials" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_verifiable_credentials" ON "verifiable_credentials" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "predictions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "predictions" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_predictions" ON "predictions" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "ai_conversations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_conversations" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_ai_conversations" ON "ai_conversations" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "ai_messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_messages" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_ai_messages" ON "ai_messages" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "image_analyses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "image_analyses" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_image_analyses" ON "image_analyses" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "marketplace_listings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "marketplace_listings" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_marketplace_listings" ON "marketplace_listings" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "marketplace_media" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "marketplace_media" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_marketplace_media" ON "marketplace_media" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "marketplace_inquiries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "marketplace_inquiries" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_marketplace_inquiries" ON "marketplace_inquiries" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "marketplace_transactions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "marketplace_transactions" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_marketplace_transactions" ON "marketplace_transactions" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "course_modules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "course_modules" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_course_modules" ON "course_modules" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "course_enrollments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "course_enrollments" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_course_enrollments" ON "course_enrollments" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "sync_devices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sync_devices" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_sync_devices" ON "sync_devices" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "sync_changesets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sync_changesets" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_sync_changesets" ON "sync_changesets" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "sync_conflicts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sync_conflicts" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_sync_conflicts" ON "sync_conflicts" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_logs" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_audit_logs" ON "audit_logs" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "system_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "system_settings" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_system_settings" ON "system_settings" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "feature_flags" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "feature_flags" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_feature_flags" ON "feature_flags" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "webhooks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "webhooks" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_webhooks" ON "webhooks" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "webhook_deliveries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "webhook_deliveries" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_webhook_deliveries" ON "webhook_deliveries" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
ALTER TABLE "integrations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "integrations" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_integrations" ON "integrations" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);

-- ============================================================================
-- COMENTARIOS (documentación de tablas y columnas)
-- ============================================================================
COMMENT ON TABLE "organizations" IS 'Tenant raíz: grupo económico o productor individual. Toda fila de negocio referencia a esta tabla vía tenant_id.';
COMMENT ON COLUMN "organizations"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "organizations"."name" IS 'Nombre comercial del grupo/productor';
COMMENT ON COLUMN "organizations"."legal_name" IS 'Razón social si difiere del nombre';
COMMENT ON COLUMN "organizations"."country_code" IS 'País principal (ISO 3166-1)';
COMMENT ON COLUMN "organizations"."default_currency" IS 'Moneda por defecto (ISO 4217)';
COMMENT ON COLUMN "organizations"."default_locale" IS 'Idioma/locale por defecto (BCP 47)';
COMMENT ON COLUMN "organizations"."timezone" IS 'Zona horaria IANA por defecto';
COMMENT ON COLUMN "organizations"."unit_system" IS 'Sistema de unidades preferido';
COMMENT ON COLUMN "organizations"."status" IS 'Estado comercial del tenant';
COMMENT ON COLUMN "organizations"."data_region" IS 'Célula regional donde residen sus datos';
COMMENT ON COLUMN "organizations"."settings" IS 'Configuración específica (overrides de UI, políticas)';
COMMENT ON COLUMN "organizations"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "organizations"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "organizations"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "organizations"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "companies" IS 'Entidad legal dentro de la organización (empresa). Posee moneda funcional, régimen fiscal y plan de cuentas propio.';
COMMENT ON COLUMN "companies"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "companies"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "companies"."name" IS 'Nombre de la empresa';
COMMENT ON COLUMN "companies"."tax_id" IS 'Identificación fiscal (RUT/RFC/NIT/CUIT/EIN)';
COMMENT ON COLUMN "companies"."country_code" IS 'País de constitución';
COMMENT ON COLUMN "companies"."functional_currency" IS 'Moneda funcional contable';
COMMENT ON COLUMN "companies"."fiscal_year_start_month" IS 'Mes de inicio del ejercicio fiscal (1-12)';
COMMENT ON COLUMN "companies"."address" IS 'Dirección estructurada (calle, ciudad, región, CP)';
COMMENT ON COLUMN "companies"."is_active" IS 'Empresa operativa o dada de baja';
COMMENT ON COLUMN "companies"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "companies"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "companies"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "companies"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "farms" IS 'Finca/establecimiento: unidad operativa georreferenciada perteneciente a una empresa.';
COMMENT ON COLUMN "farms"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "farms"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "farms"."company_id" IS 'Empresa propietaria u operadora';
COMMENT ON COLUMN "farms"."name" IS 'Nombre de la finca';
COMMENT ON COLUMN "farms"."official_code" IS 'Código oficial ante autoridad sanitaria (UPP/PIC/DICOSE/CUE)';
COMMENT ON COLUMN "farms"."location" IS 'Coordenada principal (casco)';
COMMENT ON COLUMN "farms"."boundary" IS 'Perímetro de la finca (polígono)';
COMMENT ON COLUMN "farms"."total_area_ha" IS 'Superficie total en hectáreas';
COMMENT ON COLUMN "farms"."timezone" IS 'Zona horaria si difiere de la organización';
COMMENT ON COLUMN "farms"."is_active" IS 'Finca operativa';
COMMENT ON COLUMN "farms"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "farms"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "farms"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "farms"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "users" IS 'Cuenta de usuario global (una identidad puede pertenecer a varias organizaciones).';
COMMENT ON COLUMN "users"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "users"."email" IS 'Email de acceso, único global';
COMMENT ON COLUMN "users"."phone" IS 'Teléfono E.164 (login por SMS/WhatsApp)';
COMMENT ON COLUMN "users"."full_name" IS 'Nombre completo';
COMMENT ON COLUMN "users"."locale" IS 'Idioma preferido del usuario';
COMMENT ON COLUMN "users"."avatar_file_id" IS 'Foto de perfil';
COMMENT ON COLUMN "users"."auth_provider" IS 'Método de autenticación primario';
COMMENT ON COLUMN "users"."mfa_enabled" IS 'Segundo factor activado';
COMMENT ON COLUMN "users"."last_login_at" IS 'Último acceso';
COMMENT ON COLUMN "users"."status" IS 'Estado de la cuenta';
COMMENT ON COLUMN "users"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "users"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "users"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "users"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "roles" IS 'Rol de autorización. Los roles de sistema (owner, admin, vet…) tienen tenant_id NULL; los tenants pueden crear roles propios.';
COMMENT ON COLUMN "roles"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "roles"."tenant_id" IS 'NULL = rol de sistema; valor = rol personalizado del tenant';
COMMENT ON COLUMN "roles"."code" IS 'Código estable (p. ej. veterinarian)';
COMMENT ON COLUMN "roles"."name" IS 'Nombre visible';
COMMENT ON COLUMN "roles"."description" IS 'Qué permite el rol';
COMMENT ON COLUMN "roles"."is_system" IS 'Rol predefinido no editable';
COMMENT ON COLUMN "roles"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "roles"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "roles"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "roles"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "permissions" IS 'Permiso atómico del sistema (recurso + acción). Catálogo fijo versionado con la aplicación.';
COMMENT ON COLUMN "permissions"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "permissions"."code" IS 'Código único (p. ej. animals:write, finance:read)';
COMMENT ON COLUMN "permissions"."module" IS 'Módulo funcional al que pertenece';
COMMENT ON COLUMN "permissions"."description" IS 'Qué habilita exactamente';
COMMENT ON TABLE "role_permissions" IS 'Asignación N:M de permisos a roles.';
COMMENT ON COLUMN "role_permissions"."role_id" IS 'Rol';
COMMENT ON COLUMN "role_permissions"."permission_id" IS 'Permiso otorgado';
COMMENT ON TABLE "user_role_assignments" IS 'Rol de un usuario dentro de un alcance: organización completa, una empresa o una finca. Soporta accesos temporales de asesores.';
COMMENT ON COLUMN "user_role_assignments"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "user_role_assignments"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "user_role_assignments"."user_id" IS 'Usuario';
COMMENT ON COLUMN "user_role_assignments"."role_id" IS 'Rol otorgado';
COMMENT ON COLUMN "user_role_assignments"."company_id" IS 'Alcance empresa (NULL = toda la organización)';
COMMENT ON COLUMN "user_role_assignments"."farm_id" IS 'Alcance finca (NULL = toda la empresa)';
COMMENT ON COLUMN "user_role_assignments"."valid_from" IS 'Inicio de vigencia (accesos temporales)';
COMMENT ON COLUMN "user_role_assignments"."valid_until" IS 'Fin de vigencia; NULL = indefinido';
COMMENT ON COLUMN "user_role_assignments"."granted_by" IS 'Quién otorgó el acceso';
COMMENT ON COLUMN "user_role_assignments"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "user_role_assignments"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "user_role_assignments"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "user_role_assignments"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "invitations" IS 'Invitación pendiente de un usuario a la organización.';
COMMENT ON COLUMN "invitations"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "invitations"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "invitations"."email" IS 'Email invitado';
COMMENT ON COLUMN "invitations"."role_id" IS 'Rol que recibirá al aceptar';
COMMENT ON COLUMN "invitations"."farm_id" IS 'Alcance opcional de finca';
COMMENT ON COLUMN "invitations"."token" IS 'Token firmado de aceptación';
COMMENT ON COLUMN "invitations"."expires_at" IS 'Vencimiento de la invitación';
COMMENT ON COLUMN "invitations"."accepted_at" IS 'Momento de aceptación; NULL = pendiente';
COMMENT ON COLUMN "invitations"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "invitations"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "invitations"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "invitations"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "api_keys" IS 'Credencial de la API pública emitida por el tenant para integraciones.';
COMMENT ON COLUMN "api_keys"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "api_keys"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "api_keys"."name" IS 'Nombre descriptivo de la integración';
COMMENT ON COLUMN "api_keys"."key_hash" IS 'Hash de la clave (nunca se guarda en claro)';
COMMENT ON COLUMN "api_keys"."scopes" IS 'Lista de permisos otorgados a la clave';
COMMENT ON COLUMN "api_keys"."rate_limit_tier" IS 'Nivel de límite de peticiones';
COMMENT ON COLUMN "api_keys"."last_used_at" IS 'Último uso registrado';
COMMENT ON COLUMN "api_keys"."revoked_at" IS 'Revocación; NULL = activa';
COMMENT ON COLUMN "api_keys"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "api_keys"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "api_keys"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "api_keys"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "plans" IS 'Plan comercial SaaS (catálogo global).';
COMMENT ON COLUMN "plans"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "plans"."code" IS 'Código del plan (free, starter, pro, enterprise)';
COMMENT ON COLUMN "plans"."name" IS 'Nombre comercial';
COMMENT ON COLUMN "plans"."monthly_price_usd" IS 'Precio base mensual en USD';
COMMENT ON COLUMN "plans"."max_animals" IS 'Límite de animales activos; NULL = ilimitado';
COMMENT ON COLUMN "plans"."max_users" IS 'Límite de usuarios';
COMMENT ON COLUMN "plans"."max_devices" IS 'Límite de dispositivos IoT';
COMMENT ON COLUMN "plans"."features" IS 'Mapa de módulos/capacidades habilitadas';
COMMENT ON COLUMN "plans"."is_active" IS 'Contratable actualmente';
COMMENT ON COLUMN "plans"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "plans"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "plans"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "plans"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "subscriptions" IS 'Suscripción de una organización a un plan.';
COMMENT ON COLUMN "subscriptions"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "subscriptions"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "subscriptions"."plan_id" IS 'Plan contratado';
COMMENT ON COLUMN "subscriptions"."status" IS 'Estado del ciclo de vida';
COMMENT ON COLUMN "subscriptions"."billing_currency" IS 'Moneda de facturación';
COMMENT ON COLUMN "subscriptions"."current_period_start" IS 'Inicio del período vigente';
COMMENT ON COLUMN "subscriptions"."current_period_end" IS 'Fin del período vigente';
COMMENT ON COLUMN "subscriptions"."external_ref" IS 'ID en la pasarela (Stripe/MercadoPago)';
COMMENT ON COLUMN "subscriptions"."canceled_at" IS 'Fecha de cancelación';
COMMENT ON COLUMN "subscriptions"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "subscriptions"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "subscriptions"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "subscriptions"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "subscription_usage" IS 'Medición mensual de uso para facturación por consumo.';
COMMENT ON COLUMN "subscription_usage"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "subscription_usage"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "subscription_usage"."subscription_id" IS 'Suscripción medida';
COMMENT ON COLUMN "subscription_usage"."period" IS 'Mes medido (primer día del mes)';
COMMENT ON COLUMN "subscription_usage"."active_animals" IS 'Animales activos promedio del período';
COMMENT ON COLUMN "subscription_usage"."active_users" IS 'Usuarios activos';
COMMENT ON COLUMN "subscription_usage"."active_devices" IS 'Dispositivos IoT conectados';
COMMENT ON COLUMN "subscription_usage"."api_calls" IS 'Llamadas a la API pública';
COMMENT ON COLUMN "subscription_usage"."storage_gb" IS 'Almacenamiento consumido (GB)';
COMMENT ON COLUMN "subscription_usage"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "subscription_usage"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "subscription_usage"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "subscription_usage"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "billing_payments" IS 'Pago de la suscripción SaaS (no confundir con pagos del módulo Comercial del productor).';
COMMENT ON COLUMN "billing_payments"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "billing_payments"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "billing_payments"."subscription_id" IS 'Suscripción pagada';
COMMENT ON COLUMN "billing_payments"."amount" IS 'Importe cobrado';
COMMENT ON COLUMN "billing_payments"."currency" IS 'Moneda del cobro';
COMMENT ON COLUMN "billing_payments"."status" IS 'Resultado del cobro';
COMMENT ON COLUMN "billing_payments"."gateway" IS 'Pasarela utilizada';
COMMENT ON COLUMN "billing_payments"."external_ref" IS 'ID de transacción en la pasarela';
COMMENT ON COLUMN "billing_payments"."paid_at" IS 'Momento de confirmación';
COMMENT ON COLUMN "billing_payments"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "billing_payments"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "billing_payments"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "billing_payments"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "countries" IS 'Catálogo ISO de países con parámetros regulatorios.';
COMMENT ON COLUMN "countries"."code" IS 'Código ISO 3166-1 alfa-2';
COMMENT ON COLUMN "countries"."name" IS 'Nombre en español';
COMMENT ON COLUMN "countries"."name_en" IS 'Nombre en inglés';
COMMENT ON COLUMN "countries"."traceability_authority" IS 'Autoridad de trazabilidad (SENASA, ICA, USDA…)';
COMMENT ON COLUMN "countries"."id_format_regex" IS 'Formato oficial de identificador animal';
COMMENT ON TABLE "currencies" IS 'Catálogo ISO 4217 de monedas.';
COMMENT ON COLUMN "currencies"."code" IS 'Código ISO 4217';
COMMENT ON COLUMN "currencies"."name" IS 'Nombre de la moneda';
COMMENT ON COLUMN "currencies"."symbol" IS 'Símbolo ($, €, R$)';
COMMENT ON COLUMN "currencies"."decimals" IS 'Decimales usuales';
COMMENT ON TABLE "exchange_rates" IS 'Tipo de cambio diario entre monedas (fuente central + overrides por tenant).';
COMMENT ON COLUMN "exchange_rates"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "exchange_rates"."tenant_id" IS 'NULL = tasa oficial central; valor = tasa propia del tenant';
COMMENT ON COLUMN "exchange_rates"."from_currency" IS 'Moneda origen';
COMMENT ON COLUMN "exchange_rates"."to_currency" IS 'Moneda destino';
COMMENT ON COLUMN "exchange_rates"."rate_date" IS 'Fecha de la tasa';
COMMENT ON COLUMN "exchange_rates"."rate" IS 'Unidades de destino por 1 de origen';
COMMENT ON COLUMN "exchange_rates"."source" IS 'Origen del dato (BCB, manual…)';
COMMENT ON COLUMN "exchange_rates"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "exchange_rates"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "exchange_rates"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "exchange_rates"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "units" IS 'Catálogo de unidades de medida con dimensión física.';
COMMENT ON COLUMN "units"."code" IS 'Código (kg, lb, L, ha, km, °C)';
COMMENT ON COLUMN "units"."name" IS 'Nombre';
COMMENT ON COLUMN "units"."dimension" IS 'Magnitud física';
COMMENT ON COLUMN "units"."si_factor" IS 'Factor a la unidad SI canónica de su dimensión';
COMMENT ON TABLE "species" IS 'Especies productivas soportadas (multi-especie).';
COMMENT ON COLUMN "species"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "species"."code" IS 'Código (bovine, ovine, caprine, equine, swine, buffalo)';
COMMENT ON COLUMN "species"."name" IS 'Nombre en español';
COMMENT ON COLUMN "species"."gestation_days" IS 'Duración media de gestación (validaciones reproductivas)';
COMMENT ON COLUMN "species"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "species"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "species"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "species"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "breeds" IS 'Razas por especie. Catálogo central extensible por tenant (razas locales).';
COMMENT ON COLUMN "breeds"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "breeds"."tenant_id" IS 'NULL = raza estándar; valor = raza creada por el tenant';
COMMENT ON COLUMN "breeds"."species_id" IS 'Especie a la que pertenece';
COMMENT ON COLUMN "breeds"."code" IS 'Código estable (ANG, HER, BRA, NEL, HOL, GYR…)';
COMMENT ON COLUMN "breeds"."name" IS 'Nombre de la raza';
COMMENT ON COLUMN "breeds"."purpose" IS 'Aptitud principal';
COMMENT ON COLUMN "breeds"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "breeds"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "breeds"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "breeds"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "animal_categories" IS 'Categoría zootécnica por especie (ternero, vaquillona, novillo, vaca, toro…), usada en inventarios y reportes.';
COMMENT ON COLUMN "animal_categories"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "animal_categories"."species_id" IS 'Especie';
COMMENT ON COLUMN "animal_categories"."code" IS 'Código estable (calf, heifer, steer, cow, bull)';
COMMENT ON COLUMN "animal_categories"."name" IS 'Nombre local';
COMMENT ON COLUMN "animal_categories"."sex" IS 'Sexo al que aplica';
COMMENT ON COLUMN "animal_categories"."min_age_months" IS 'Edad mínima típica';
COMMENT ON COLUMN "animal_categories"."max_age_months" IS 'Edad máxima típica';
COMMENT ON COLUMN "animal_categories"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "animal_categories"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "animal_categories"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "animal_categories"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "diagnoses" IS 'Catálogo de diagnósticos/enfermedades (base ICAR/OIE) extensible por tenant.';
COMMENT ON COLUMN "diagnoses"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "diagnoses"."tenant_id" IS 'NULL = catálogo central; valor = diagnóstico propio';
COMMENT ON COLUMN "diagnoses"."code" IS 'Código estable (MAST, BRD, FMD…)';
COMMENT ON COLUMN "diagnoses"."name" IS 'Nombre de la condición';
COMMENT ON COLUMN "diagnoses"."category" IS 'Sistema afectado (reproductivo, respiratorio, podal…)';
COMMENT ON COLUMN "diagnoses"."is_notifiable" IS 'De declaración obligatoria a la autoridad sanitaria';
COMMENT ON COLUMN "diagnoses"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "diagnoses"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "diagnoses"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "diagnoses"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "animals" IS 'Registro individual del animal. Entidad central del sistema; su estado se deriva de eventos inmutables.';
COMMENT ON COLUMN "animals"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "animals"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "animals"."farm_id" IS 'Finca actual del animal';
COMMENT ON COLUMN "animals"."species_id" IS 'Especie';
COMMENT ON COLUMN "animals"."category_id" IS 'Categoría zootécnica actual (se recalcula por edad/estado)';
COMMENT ON COLUMN "animals"."sex" IS 'Sexo';
COMMENT ON COLUMN "animals"."name" IS 'Nombre o apodo (opcional)';
COMMENT ON COLUMN "animals"."birth_date" IS 'Fecha de nacimiento (real o estimada)';
COMMENT ON COLUMN "animals"."birth_date_estimated" IS 'La fecha de nacimiento es estimada';
COMMENT ON COLUMN "animals"."dam_id" IS 'Madre (genealogía)';
COMMENT ON COLUMN "animals"."sire_id" IS 'Padre (genealogía)';
COMMENT ON COLUMN "animals"."breeding_method_origin" IS 'Cómo se originó (monta, IA, transferencia embrionaria)';
COMMENT ON COLUMN "animals"."origin" IS 'Procedencia del animal';
COMMENT ON COLUMN "animals"."acquisition_date" IS 'Fecha de ingreso al hato si no nació aquí';
COMMENT ON COLUMN "animals"."current_lot_id" IS 'Lote/rodeo actual';
COMMENT ON COLUMN "animals"."current_paddock_id" IS 'Potrero donde se encuentra';
COMMENT ON COLUMN "animals"."status" IS 'Estado del ciclo de vida';
COMMENT ON COLUMN "animals"."status_changed_at" IS 'Fecha del último cambio de estado';
COMMENT ON COLUMN "animals"."coat_color" IS 'Color/capa';
COMMENT ON COLUMN "animals"."photo_file_id" IS 'Fotografía principal';
COMMENT ON COLUMN "animals"."notes" IS 'Observaciones libres';
COMMENT ON COLUMN "animals"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "animals"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "animals"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "animals"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "animal_breeds" IS 'Composición racial del animal (N:M con porcentaje) para cruzas.';
COMMENT ON COLUMN "animal_breeds"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "animal_breeds"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "animal_breeds"."animal_id" IS 'Animal';
COMMENT ON COLUMN "animal_breeds"."breed_id" IS 'Raza componente';
COMMENT ON COLUMN "animal_breeds"."fraction" IS 'Fracción de la raza (0-1); suma 1 por animal';
COMMENT ON COLUMN "animal_breeds"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "animal_breeds"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "animal_breeds"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "animal_breeds"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "animal_identifiers" IS 'Identificadores del animal en el tiempo (visual, RFID EID, bolus, tatuaje, biométrico). Un animal, N identificadores.';
COMMENT ON COLUMN "animal_identifiers"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "animal_identifiers"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "animal_identifiers"."animal_id" IS 'Animal identificado';
COMMENT ON COLUMN "animal_identifiers"."type" IS 'Tipo de identificador';
COMMENT ON COLUMN "animal_identifiers"."value" IS 'Valor (número de caravana, EID de 15 dígitos, hash biométrico)';
COMMENT ON COLUMN "animal_identifiers"."is_official" IS 'Es el identificador oficial ante la autoridad';
COMMENT ON COLUMN "animal_identifiers"."issued_at" IS 'Fecha de colocación';
COMMENT ON COLUMN "animal_identifiers"."retired_at" IS 'Fecha de retiro; NULL = vigente';
COMMENT ON COLUMN "animal_identifiers"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "animal_identifiers"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "animal_identifiers"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "animal_identifiers"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "lots" IS 'Lote, rodeo o grupo de manejo. Agrupa animales para manejo conjunto.';
COMMENT ON COLUMN "lots"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "lots"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "lots"."farm_id" IS 'Finca';
COMMENT ON COLUMN "lots"."name" IS 'Nombre del lote';
COMMENT ON COLUMN "lots"."purpose" IS 'Propósito del grupo';
COMMENT ON COLUMN "lots"."current_paddock_id" IS 'Potrero asignado al lote';
COMMENT ON COLUMN "lots"."is_active" IS 'Lote vigente';
COMMENT ON COLUMN "lots"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "lots"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "lots"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "lots"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "animal_movements" IS 'Movimiento de un animal entre potreros, lotes o fincas. Trazabilidad de ubicación.';
COMMENT ON COLUMN "animal_movements"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "animal_movements"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "animal_movements"."animal_id" IS 'Animal movido';
COMMENT ON COLUMN "animal_movements"."moved_at" IS 'Momento del movimiento';
COMMENT ON COLUMN "animal_movements"."from_paddock_id" IS 'Potrero origen';
COMMENT ON COLUMN "animal_movements"."to_paddock_id" IS 'Potrero destino';
COMMENT ON COLUMN "animal_movements"."from_lot_id" IS 'Lote origen';
COMMENT ON COLUMN "animal_movements"."to_lot_id" IS 'Lote destino';
COMMENT ON COLUMN "animal_movements"."from_farm_id" IS 'Finca origen (traslados)';
COMMENT ON COLUMN "animal_movements"."to_farm_id" IS 'Finca destino';
COMMENT ON COLUMN "animal_movements"."reason" IS 'Motivo del movimiento';
COMMENT ON COLUMN "animal_movements"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "animal_movements"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "animal_movements"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "animal_movements"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "animal_events" IS 'Bitácora inmutable de eventos del animal (event store). Fuente de trazabilidad y datos para IA.';
COMMENT ON COLUMN "animal_events"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "animal_events"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "animal_events"."animal_id" IS 'Animal';
COMMENT ON COLUMN "animal_events"."event_type" IS 'Tipo (weighing, treatment, breeding, movement, death…)';
COMMENT ON COLUMN "animal_events"."payload" IS 'Datos del evento validados por esquema según tipo';
COMMENT ON COLUMN "animal_events"."occurred_at" IS 'Cuándo ocurrió en el campo';
COMMENT ON COLUMN "animal_events"."recorded_at" IS 'Cuándo se capturó en el dispositivo';
COMMENT ON COLUMN "animal_events"."device_id" IS 'Dispositivo de captura';
COMMENT ON COLUMN "animal_events"."source" IS 'Origen del dato';
COMMENT ON COLUMN "animal_events"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "animal_events"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "animal_events"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "animal_events"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "breeding_events" IS 'Evento reproductivo: celo, servicio (monta/IA/TE), sincronización.';
COMMENT ON COLUMN "breeding_events"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "breeding_events"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "breeding_events"."animal_id" IS 'Hembra (o macho en registro de servicio)';
COMMENT ON COLUMN "breeding_events"."type" IS 'Tipo de evento';
COMMENT ON COLUMN "breeding_events"."occurred_at" IS 'Fecha del evento';
COMMENT ON COLUMN "breeding_events"."sire_id" IS 'Toro en monta natural';
COMMENT ON COLUMN "breeding_events"."semen_batch_id" IS 'Pajuela usada en IA';
COMMENT ON COLUMN "breeding_events"."embryo_id" IS 'Embrión en TE';
COMMENT ON COLUMN "breeding_events"."technician_id" IS 'Inseminador/técnico';
COMMENT ON COLUMN "breeding_events"."protocol_id" IS 'Protocolo de sincronización aplicado';
COMMENT ON COLUMN "breeding_events"."notes" IS 'Observaciones';
COMMENT ON COLUMN "breeding_events"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "breeding_events"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "breeding_events"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "breeding_events"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "repro_protocols" IS 'Protocolo reproductivo reutilizable (IATF, sincronización) con pasos y días.';
COMMENT ON COLUMN "repro_protocols"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "repro_protocols"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "repro_protocols"."name" IS 'Nombre del protocolo';
COMMENT ON COLUMN "repro_protocols"."species_id" IS 'Especie objetivo';
COMMENT ON COLUMN "repro_protocols"."steps" IS 'Secuencia de pasos {día, hormona, dosis}';
COMMENT ON COLUMN "repro_protocols"."is_active" IS 'Disponible para uso';
COMMENT ON COLUMN "repro_protocols"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "repro_protocols"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "repro_protocols"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "repro_protocols"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "pregnancies" IS 'Ciclo de gestación: desde diagnóstico positivo hasta parto o pérdida.';
COMMENT ON COLUMN "pregnancies"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "pregnancies"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "pregnancies"."animal_id" IS 'Hembra gestante';
COMMENT ON COLUMN "pregnancies"."breeding_event_id" IS 'Servicio que originó la preñez';
COMMENT ON COLUMN "pregnancies"."diagnosis_date" IS 'Fecha de diagnóstico positivo';
COMMENT ON COLUMN "pregnancies"."method" IS 'Método de diagnóstico';
COMMENT ON COLUMN "pregnancies"."expected_due_date" IS 'Fecha probable de parto';
COMMENT ON COLUMN "pregnancies"."status" IS 'Resultado de la gestación';
COMMENT ON COLUMN "pregnancies"."closed_at" IS 'Fecha de cierre (parto/pérdida)';
COMMENT ON COLUMN "pregnancies"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "pregnancies"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "pregnancies"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "pregnancies"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "calvings" IS 'Registro de parto y descendencia resultante.';
COMMENT ON COLUMN "calvings"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "calvings"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "calvings"."pregnancy_id" IS 'Gestación asociada';
COMMENT ON COLUMN "calvings"."dam_id" IS 'Madre';
COMMENT ON COLUMN "calvings"."calving_date" IS 'Fecha del parto';
COMMENT ON COLUMN "calvings"."ease" IS 'Facilidad de parto (1 fácil – 5 cesárea)';
COMMENT ON COLUMN "calvings"."offspring_count" IS 'Número de crías';
COMMENT ON COLUMN "calvings"."notes" IS 'Complicaciones u observaciones';
COMMENT ON COLUMN "calvings"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "calvings"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "calvings"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "calvings"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "calving_offspring" IS 'Cría individual nacida en un parto (soporta partos múltiples/mortinatos).';
COMMENT ON COLUMN "calving_offspring"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "calving_offspring"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "calving_offspring"."calving_id" IS 'Parto';
COMMENT ON COLUMN "calving_offspring"."animal_id" IS 'Registro del animal cría (NULL si mortinato)';
COMMENT ON COLUMN "calving_offspring"."birth_weight_kg" IS 'Peso al nacer';
COMMENT ON COLUMN "calving_offspring"."vitality" IS 'Vitalidad al nacer';
COMMENT ON COLUMN "calving_offspring"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "calving_offspring"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "calving_offspring"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "calving_offspring"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "weanings" IS 'Registro de destete.';
COMMENT ON COLUMN "weanings"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "weanings"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "weanings"."animal_id" IS 'Cría destetada';
COMMENT ON COLUMN "weanings"."weaning_date" IS 'Fecha de destete';
COMMENT ON COLUMN "weanings"."weaning_weight_kg" IS 'Peso al destete';
COMMENT ON COLUMN "weanings"."dam_id" IS 'Madre';
COMMENT ON COLUMN "weanings"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "weanings"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "weanings"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "weanings"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "semen_batches" IS 'Inventario de pajuelas de semen (banco de genética).';
COMMENT ON COLUMN "semen_batches"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "semen_batches"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "semen_batches"."sire_id" IS 'Toro donante propio (si aplica)';
COMMENT ON COLUMN "semen_batches"."sire_name_external" IS 'Nombre del toro si es semen comprado';
COMMENT ON COLUMN "semen_batches"."breed_id" IS 'Raza del donante';
COMMENT ON COLUMN "semen_batches"."supplier_id" IS 'Proveedor/central de genética';
COMMENT ON COLUMN "semen_batches"."batch_code" IS 'Código de lote/partida';
COMMENT ON COLUMN "semen_batches"."straws_available" IS 'Pajuelas disponibles';
COMMENT ON COLUMN "semen_batches"."tank_id" IS 'Termo de nitrógeno donde se almacena';
COMMENT ON COLUMN "semen_batches"."canister" IS 'Canastilla/posición en el termo';
COMMENT ON COLUMN "semen_batches"."acquired_date" IS 'Fecha de ingreso';
COMMENT ON COLUMN "semen_batches"."unit_cost" IS 'Costo por pajuela';
COMMENT ON COLUMN "semen_batches"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "semen_batches"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "semen_batches"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "semen_batches"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "embryos" IS 'Inventario de embriones (producción in vivo o FIV).';
COMMENT ON COLUMN "embryos"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "embryos"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "embryos"."donor_dam_id" IS 'Vaca donante';
COMMENT ON COLUMN "embryos"."sire_id" IS 'Toro';
COMMENT ON COLUMN "embryos"."semen_batch_id" IS 'Semen usado';
COMMENT ON COLUMN "embryos"."stage" IS 'Estadio embrionario';
COMMENT ON COLUMN "embryos"."grade" IS 'Calidad/grado';
COMMENT ON COLUMN "embryos"."production_method" IS 'Método de producción';
COMMENT ON COLUMN "embryos"."straws_available" IS 'Unidades disponibles';
COMMENT ON COLUMN "embryos"."tank_id" IS 'Termo de almacenamiento';
COMMENT ON COLUMN "embryos"."created_date" IS 'Fecha de colecta/producción';
COMMENT ON COLUMN "embryos"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "embryos"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "embryos"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "embryos"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "storage_tanks" IS 'Termos de nitrógeno líquido para semen y embriones.';
COMMENT ON COLUMN "storage_tanks"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "storage_tanks"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "storage_tanks"."farm_id" IS 'Finca donde está el termo';
COMMENT ON COLUMN "storage_tanks"."name" IS 'Identificación del termo';
COMMENT ON COLUMN "storage_tanks"."capacity" IS 'Capacidad en pajuelas';
COMMENT ON COLUMN "storage_tanks"."nitrogen_level" IS 'Último nivel de nitrógeno registrado';
COMMENT ON COLUMN "storage_tanks"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "storage_tanks"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "storage_tanks"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "storage_tanks"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "genetic_evaluations" IS 'Valores genéticos / EPDs / índices del animal (genómica).';
COMMENT ON COLUMN "genetic_evaluations"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "genetic_evaluations"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "genetic_evaluations"."animal_id" IS 'Animal evaluado';
COMMENT ON COLUMN "genetic_evaluations"."source" IS 'Origen (asociación de raza, laboratorio)';
COMMENT ON COLUMN "genetic_evaluations"."evaluation_date" IS 'Fecha de la evaluación';
COMMENT ON COLUMN "genetic_evaluations"."traits" IS 'Mapa de rasgo→valor (peso destete, leche, marmoleo…)';
COMMENT ON COLUMN "genetic_evaluations"."lab_sample_id" IS 'Muestra genómica asociada';
COMMENT ON COLUMN "genetic_evaluations"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "genetic_evaluations"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "genetic_evaluations"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "genetic_evaluations"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "products_veterinary" IS 'Catálogo de productos veterinarios (vacunas, antibióticos, antiparasitarios).';
COMMENT ON COLUMN "products_veterinary"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "products_veterinary"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "products_veterinary"."name" IS 'Nombre comercial';
COMMENT ON COLUMN "products_veterinary"."type" IS 'Tipo de producto';
COMMENT ON COLUMN "products_veterinary"."active_ingredient" IS 'Principio activo';
COMMENT ON COLUMN "products_veterinary"."manufacturer" IS 'Fabricante';
COMMENT ON COLUMN "products_veterinary"."withdrawal_meat_days" IS 'Período de retiro en carne (días)';
COMMENT ON COLUMN "products_veterinary"."withdrawal_milk_hours" IS 'Período de retiro en leche (horas)';
COMMENT ON COLUMN "products_veterinary"."default_dose" IS 'Dosis recomendada';
COMMENT ON COLUMN "products_veterinary"."inventory_item_id" IS 'Ítem de inventario vinculado (control de stock)';
COMMENT ON COLUMN "products_veterinary"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "products_veterinary"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "products_veterinary"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "products_veterinary"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "vaccinations" IS 'Aplicación de vacuna a un animal (o registro por lote expandido a animales).';
COMMENT ON COLUMN "vaccinations"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "vaccinations"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "vaccinations"."animal_id" IS 'Animal vacunado';
COMMENT ON COLUMN "vaccinations"."product_id" IS 'Vacuna aplicada';
COMMENT ON COLUMN "vaccinations"."applied_at" IS 'Fecha de aplicación';
COMMENT ON COLUMN "vaccinations"."dose" IS 'Dosis administrada';
COMMENT ON COLUMN "vaccinations"."dose_unit" IS 'Unidad de la dosis';
COMMENT ON COLUMN "vaccinations"."batch_number" IS 'Lote del frasco (trazabilidad)';
COMMENT ON COLUMN "vaccinations"."applied_by" IS 'Quién aplicó';
COMMENT ON COLUMN "vaccinations"."next_due_date" IS 'Próxima dosis programada';
COMMENT ON COLUMN "vaccinations"."plan_id" IS 'Plan sanitario que la generó';
COMMENT ON COLUMN "vaccinations"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "vaccinations"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "vaccinations"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "vaccinations"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "treatments" IS 'Tratamiento sanitario aplicado a un animal (con retiros calculados).';
COMMENT ON COLUMN "treatments"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "treatments"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "treatments"."animal_id" IS 'Animal tratado';
COMMENT ON COLUMN "treatments"."diagnosis_id" IS 'Diagnóstico motivante';
COMMENT ON COLUMN "treatments"."product_id" IS 'Producto usado';
COMMENT ON COLUMN "treatments"."applied_at" IS 'Fecha de aplicación';
COMMENT ON COLUMN "treatments"."dose" IS 'Dosis';
COMMENT ON COLUMN "treatments"."dose_unit" IS 'Unidad de dosis';
COMMENT ON COLUMN "treatments"."route" IS 'Vía de administración';
COMMENT ON COLUMN "treatments"."meat_withdrawal_until" IS 'Fecha hasta la que no puede faenarse';
COMMENT ON COLUMN "treatments"."milk_withdrawal_until" IS 'Fecha/hora hasta la que la leche se descarta';
COMMENT ON COLUMN "treatments"."applied_by" IS 'Aplicador';
COMMENT ON COLUMN "treatments"."cost" IS 'Costo del tratamiento';
COMMENT ON COLUMN "treatments"."notes" IS 'Observaciones clínicas';
COMMENT ON COLUMN "treatments"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "treatments"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "treatments"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "treatments"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "health_events" IS 'Evento clínico general: diagnóstico, revisión, síntoma observado.';
COMMENT ON COLUMN "health_events"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "health_events"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "health_events"."animal_id" IS 'Animal';
COMMENT ON COLUMN "health_events"."diagnosis_id" IS 'Diagnóstico';
COMMENT ON COLUMN "health_events"."occurred_at" IS 'Fecha del evento';
COMMENT ON COLUMN "health_events"."severity" IS 'Severidad';
COMMENT ON COLUMN "health_events"."outcome" IS 'Desenlace';
COMMENT ON COLUMN "health_events"."examined_by" IS 'Veterinario';
COMMENT ON COLUMN "health_events"."notes" IS 'Notas clínicas';
COMMENT ON COLUMN "health_events"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "health_events"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "health_events"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "health_events"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "health_plans" IS 'Plan/calendario sanitario reutilizable (vacunaciones y desparasitaciones programadas).';
COMMENT ON COLUMN "health_plans"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "health_plans"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "health_plans"."name" IS 'Nombre del plan';
COMMENT ON COLUMN "health_plans"."species_id" IS 'Especie objetivo';
COMMENT ON COLUMN "health_plans"."schedule" IS 'Reglas {edad/estación, producto, dosis}';
COMMENT ON COLUMN "health_plans"."is_active" IS 'Plan vigente';
COMMENT ON COLUMN "health_plans"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "health_plans"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "health_plans"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "health_plans"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "mortalities" IS 'Registro de muerte de un animal con causa.';
COMMENT ON COLUMN "mortalities"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "mortalities"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "mortalities"."animal_id" IS 'Animal fallecido (uno por animal)';
COMMENT ON COLUMN "mortalities"."died_at" IS 'Fecha de muerte';
COMMENT ON COLUMN "mortalities"."cause_diagnosis_id" IS 'Causa presunta/confirmada';
COMMENT ON COLUMN "mortalities"."necropsy" IS 'Se realizó necropsia';
COMMENT ON COLUMN "mortalities"."lab_sample_id" IS 'Muestra enviada a laboratorio';
COMMENT ON COLUMN "mortalities"."estimated_loss" IS 'Pérdida económica estimada';
COMMENT ON COLUMN "mortalities"."notes" IS 'Detalle';
COMMENT ON COLUMN "mortalities"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "mortalities"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "mortalities"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "mortalities"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "weighings" IS 'Pesaje de un animal. Serie temporal para curvas de crecimiento y GDP.';
COMMENT ON COLUMN "weighings"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "weighings"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "weighings"."animal_id" IS 'Animal pesado';
COMMENT ON COLUMN "weighings"."weighed_at" IS 'Fecha/hora del pesaje';
COMMENT ON COLUMN "weighings"."weight_kg" IS 'Peso en kg (unidad canónica SI)';
COMMENT ON COLUMN "weighings"."method" IS 'Método de obtención';
COMMENT ON COLUMN "weighings"."device_id" IS 'Báscula/dispositivo';
COMMENT ON COLUMN "weighings"."adg_since_last" IS 'Ganancia diaria de peso desde el pesaje anterior (calculada)';
COMMENT ON COLUMN "weighings"."body_condition" IS 'Condición corporal (escala 1-5 o 1-9)';
COMMENT ON COLUMN "weighings"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "weighings"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "weighings"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "weighings"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "milk_production_daily" IS 'Producción láctea diaria por animal (o por ordeño agregado).';
COMMENT ON COLUMN "milk_production_daily"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "milk_production_daily"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "milk_production_daily"."animal_id" IS 'Vaca';
COMMENT ON COLUMN "milk_production_daily"."production_date" IS 'Día de producción';
COMMENT ON COLUMN "milk_production_daily"."total_liters" IS 'Litros totales del día';
COMMENT ON COLUMN "milk_production_daily"."milking_count" IS 'Número de ordeños';
COMMENT ON COLUMN "milk_production_daily"."device_id" IS 'Medidor de leche/robot';
COMMENT ON COLUMN "milk_production_daily"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "milk_production_daily"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "milk_production_daily"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "milk_production_daily"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "milk_quality_tests" IS 'Análisis de calidad de leche (grasa, proteína, RCS) por animal o tanque.';
COMMENT ON COLUMN "milk_quality_tests"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "milk_quality_tests"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "milk_quality_tests"."animal_id" IS 'Animal (control lechero individual)';
COMMENT ON COLUMN "milk_quality_tests"."tank_id" IS 'Tanque (muestra de bulk)';
COMMENT ON COLUMN "milk_quality_tests"."sample_date" IS 'Fecha de muestra';
COMMENT ON COLUMN "milk_quality_tests"."fat_pct" IS '% grasa';
COMMENT ON COLUMN "milk_quality_tests"."protein_pct" IS '% proteína';
COMMENT ON COLUMN "milk_quality_tests"."scc" IS 'Recuento de células somáticas (células/mL)';
COMMENT ON COLUMN "milk_quality_tests"."lab_sample_id" IS 'Muestra de laboratorio';
COMMENT ON COLUMN "milk_quality_tests"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "milk_quality_tests"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "milk_quality_tests"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "milk_quality_tests"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "milk_tanks" IS 'Tanques de frío de leche (bulk).';
COMMENT ON COLUMN "milk_tanks"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "milk_tanks"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "milk_tanks"."farm_id" IS 'Finca';
COMMENT ON COLUMN "milk_tanks"."name" IS 'Identificación del tanque';
COMMENT ON COLUMN "milk_tanks"."capacity_liters" IS 'Capacidad';
COMMENT ON COLUMN "milk_tanks"."device_id" IS 'Sensor de temperatura/volumen';
COMMENT ON COLUMN "milk_tanks"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "milk_tanks"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "milk_tanks"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "milk_tanks"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "milk_deliveries" IS 'Entrega/venta de leche a la industria con liquidación.';
COMMENT ON COLUMN "milk_deliveries"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "milk_deliveries"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "milk_deliveries"."tank_id" IS 'Tanque de origen';
COMMENT ON COLUMN "milk_deliveries"."delivered_at" IS 'Fecha de recolección';
COMMENT ON COLUMN "milk_deliveries"."liters" IS 'Litros entregados';
COMMENT ON COLUMN "milk_deliveries"."buyer_id" IS 'Industria compradora';
COMMENT ON COLUMN "milk_deliveries"."price_per_liter" IS 'Precio liquidado por litro';
COMMENT ON COLUMN "milk_deliveries"."sale_id" IS 'Venta contable asociada';
COMMENT ON COLUMN "milk_deliveries"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "milk_deliveries"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "milk_deliveries"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "milk_deliveries"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "carcass_records" IS 'Datos de faena/canal del animal (producción de carne).';
COMMENT ON COLUMN "carcass_records"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "carcass_records"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "carcass_records"."animal_id" IS 'Animal faenado';
COMMENT ON COLUMN "carcass_records"."slaughter_date" IS 'Fecha de faena';
COMMENT ON COLUMN "carcass_records"."slaughterhouse_id" IS 'Frigorífico';
COMMENT ON COLUMN "carcass_records"."hot_carcass_weight_kg" IS 'Peso de canal caliente';
COMMENT ON COLUMN "carcass_records"."dressing_pct" IS 'Rendimiento de canal (%)';
COMMENT ON COLUMN "carcass_records"."fat_grade" IS 'Grado de terminación/grasa';
COMMENT ON COLUMN "carcass_records"."conformation" IS 'Conformación (EUROP u otra)';
COMMENT ON COLUMN "carcass_records"."marbling" IS 'Marmoleo';
COMMENT ON COLUMN "carcass_records"."sale_id" IS 'Liquidación de venta asociada';
COMMENT ON COLUMN "carcass_records"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "carcass_records"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "carcass_records"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "carcass_records"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "shearing_records" IS 'Registro de esquila (ovinos): peso y calidad de vellón.';
COMMENT ON COLUMN "shearing_records"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "shearing_records"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "shearing_records"."animal_id" IS 'Animal esquilado';
COMMENT ON COLUMN "shearing_records"."shearing_date" IS 'Fecha de esquila';
COMMENT ON COLUMN "shearing_records"."fleece_weight_kg" IS 'Peso del vellón';
COMMENT ON COLUMN "shearing_records"."micron" IS 'Finura (micras)';
COMMENT ON COLUMN "shearing_records"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "shearing_records"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "shearing_records"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "shearing_records"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "rations" IS 'Ración/dieta formulada reutilizable.';
COMMENT ON COLUMN "rations"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "rations"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "rations"."name" IS 'Nombre de la ración';
COMMENT ON COLUMN "rations"."target_category_id" IS 'Categoría destino';
COMMENT ON COLUMN "rations"."dry_matter_pct" IS '% materia seca';
COMMENT ON COLUMN "rations"."metabolizable_energy" IS 'Energía metabolizable (Mcal/kg)';
COMMENT ON COLUMN "rations"."crude_protein_pct" IS '% proteína bruta';
COMMENT ON COLUMN "rations"."cost_per_kg" IS 'Costo por kg (calculado de ingredientes)';
COMMENT ON COLUMN "rations"."is_active" IS 'Ración vigente';
COMMENT ON COLUMN "rations"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "rations"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "rations"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "rations"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "ration_ingredients" IS 'Ingredientes de una ración (N:M con inventario).';
COMMENT ON COLUMN "ration_ingredients"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "ration_ingredients"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "ration_ingredients"."ration_id" IS 'Ración';
COMMENT ON COLUMN "ration_ingredients"."inventory_item_id" IS 'Insumo/ingrediente';
COMMENT ON COLUMN "ration_ingredients"."pct" IS 'Proporción en la mezcla (%)';
COMMENT ON COLUMN "ration_ingredients"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "ration_ingredients"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "ration_ingredients"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "ration_ingredients"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "feed_deliveries" IS 'Entrega/consumo de alimento a un lote (con costeo).';
COMMENT ON COLUMN "feed_deliveries"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "feed_deliveries"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "feed_deliveries"."lot_id" IS 'Lote alimentado';
COMMENT ON COLUMN "feed_deliveries"."ration_id" IS 'Ración entregada';
COMMENT ON COLUMN "feed_deliveries"."delivered_at" IS 'Fecha de entrega';
COMMENT ON COLUMN "feed_deliveries"."quantity_kg" IS 'Cantidad entregada (kg MS o tal cual)';
COMMENT ON COLUMN "feed_deliveries"."animals_count" IS 'Número de animales en el lote ese día';
COMMENT ON COLUMN "feed_deliveries"."total_cost" IS 'Costo de la entrega';
COMMENT ON COLUMN "feed_deliveries"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "feed_deliveries"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "feed_deliveries"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "feed_deliveries"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "grazing_records" IS 'Registro de pastoreo: ocupación de un potrero por un lote.';
COMMENT ON COLUMN "grazing_records"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "grazing_records"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "grazing_records"."paddock_id" IS 'Potrero pastoreado';
COMMENT ON COLUMN "grazing_records"."lot_id" IS 'Lote';
COMMENT ON COLUMN "grazing_records"."entry_date" IS 'Entrada al potrero';
COMMENT ON COLUMN "grazing_records"."exit_date" IS 'Salida; NULL = en curso';
COMMENT ON COLUMN "grazing_records"."pre_grazing_kg_dm_ha" IS 'Biomasa disponible al ingreso (kg MS/ha)';
COMMENT ON COLUMN "grazing_records"."post_grazing_kg_dm_ha" IS 'Residuo a la salida';
COMMENT ON COLUMN "grazing_records"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "grazing_records"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "grazing_records"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "grazing_records"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "paddocks" IS 'Potrero/parcela georreferenciada dentro de una finca.';
COMMENT ON COLUMN "paddocks"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "paddocks"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "paddocks"."farm_id" IS 'Finca';
COMMENT ON COLUMN "paddocks"."name" IS 'Nombre del potrero';
COMMENT ON COLUMN "paddocks"."boundary" IS 'Polígono del potrero (PostGIS)';
COMMENT ON COLUMN "paddocks"."area_ha" IS 'Superficie en hectáreas (calculada del polígono)';
COMMENT ON COLUMN "paddocks"."pasture_type" IS 'Tipo de pastura/forraje predominante';
COMMENT ON COLUMN "paddocks"."carrying_capacity" IS 'Capacidad de carga (UA/ha)';
COMMENT ON COLUMN "paddocks"."water_source" IS 'Fuente de agua';
COMMENT ON COLUMN "paddocks"."is_active" IS 'Potrero en uso';
COMMENT ON COLUMN "paddocks"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "paddocks"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "paddocks"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "paddocks"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "crops" IS 'Ciclo de cultivo en una parcela.';
COMMENT ON COLUMN "crops"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "crops"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "crops"."paddock_id" IS 'Parcela sembrada';
COMMENT ON COLUMN "crops"."crop_type" IS 'Cultivo (maíz, soja, pastura, sorgo…)';
COMMENT ON COLUMN "crops"."variety" IS 'Variedad/híbrido';
COMMENT ON COLUMN "crops"."planting_date" IS 'Fecha de siembra';
COMMENT ON COLUMN "crops"."expected_harvest_date" IS 'Cosecha estimada';
COMMENT ON COLUMN "crops"."area_ha" IS 'Superficie sembrada';
COMMENT ON COLUMN "crops"."status" IS 'Estado del ciclo';
COMMENT ON COLUMN "crops"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "crops"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "crops"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "crops"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "crop_operations" IS 'Labor agrícola sobre un cultivo (siembra, fertilización, fumigación, cosecha).';
COMMENT ON COLUMN "crop_operations"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "crop_operations"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "crop_operations"."crop_id" IS 'Cultivo';
COMMENT ON COLUMN "crop_operations"."operation_type" IS 'Tipo de labor';
COMMENT ON COLUMN "crop_operations"."performed_at" IS 'Fecha de ejecución';
COMMENT ON COLUMN "crop_operations"."inventory_item_id" IS 'Insumo aplicado (semilla, fertilizante, agroquímico)';
COMMENT ON COLUMN "crop_operations"."quantity" IS 'Cantidad de insumo';
COMMENT ON COLUMN "crop_operations"."machinery_id" IS 'Maquinaria utilizada';
COMMENT ON COLUMN "crop_operations"."operator_id" IS 'Operario';
COMMENT ON COLUMN "crop_operations"."cost" IS 'Costo de la labor';
COMMENT ON COLUMN "crop_operations"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "crop_operations"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "crop_operations"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "crop_operations"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "harvests" IS 'Resultado de cosecha de un cultivo.';
COMMENT ON COLUMN "harvests"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "harvests"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "harvests"."crop_id" IS 'Cultivo cosechado';
COMMENT ON COLUMN "harvests"."harvest_date" IS 'Fecha de cosecha';
COMMENT ON COLUMN "harvests"."yield_quantity" IS 'Rendimiento total';
COMMENT ON COLUMN "harvests"."yield_unit" IS 'Unidad (ton, kg, fardos)';
COMMENT ON COLUMN "harvests"."yield_per_ha" IS 'Rendimiento por hectárea';
COMMENT ON COLUMN "harvests"."moisture_pct" IS '% humedad';
COMMENT ON COLUMN "harvests"."destination_item_id" IS 'Ítem de inventario donde ingresa la cosecha';
COMMENT ON COLUMN "harvests"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "harvests"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "harvests"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "harvests"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "soil_analyses" IS 'Análisis de suelo de una parcela.';
COMMENT ON COLUMN "soil_analyses"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "soil_analyses"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "soil_analyses"."paddock_id" IS 'Parcela muestreada';
COMMENT ON COLUMN "soil_analyses"."sample_date" IS 'Fecha de muestreo';
COMMENT ON COLUMN "soil_analyses"."ph" IS 'pH';
COMMENT ON COLUMN "soil_analyses"."organic_matter_pct" IS '% materia orgánica';
COMMENT ON COLUMN "soil_analyses"."nutrients" IS 'Mapa nutriente→valor (N, P, K…)';
COMMENT ON COLUMN "soil_analyses"."lab_sample_id" IS 'Muestra de laboratorio';
COMMENT ON COLUMN "soil_analyses"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "soil_analyses"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "soil_analyses"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "soil_analyses"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "warehouses" IS 'Almacén/depósito físico de insumos.';
COMMENT ON COLUMN "warehouses"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "warehouses"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "warehouses"."farm_id" IS 'Finca';
COMMENT ON COLUMN "warehouses"."name" IS 'Nombre del depósito';
COMMENT ON COLUMN "warehouses"."location" IS 'Ubicación';
COMMENT ON COLUMN "warehouses"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "warehouses"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "warehouses"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "warehouses"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "inventory_categories" IS 'Categoría de ítem de inventario (jerárquica).';
COMMENT ON COLUMN "inventory_categories"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "inventory_categories"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "inventory_categories"."parent_id" IS 'Categoría padre';
COMMENT ON COLUMN "inventory_categories"."name" IS 'Nombre';
COMMENT ON COLUMN "inventory_categories"."kind" IS 'Naturaleza del ítem';
COMMENT ON COLUMN "inventory_categories"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "inventory_categories"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "inventory_categories"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "inventory_categories"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "inventory_items" IS 'Ítem de inventario (insumo, medicamento, semilla, combustible, producto).';
COMMENT ON COLUMN "inventory_items"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "inventory_items"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "inventory_items"."category_id" IS 'Categoría';
COMMENT ON COLUMN "inventory_items"."name" IS 'Nombre del ítem';
COMMENT ON COLUMN "inventory_items"."sku" IS 'Código interno';
COMMENT ON COLUMN "inventory_items"."unit" IS 'Unidad de medida base';
COMMENT ON COLUMN "inventory_items"."track_batches" IS 'Requiere control por lote/vencimiento';
COMMENT ON COLUMN "inventory_items"."reorder_point" IS 'Punto de reposición para alertas';
COMMENT ON COLUMN "inventory_items"."standard_cost" IS 'Costo estándar unitario';
COMMENT ON COLUMN "inventory_items"."is_active" IS 'Ítem activo';
COMMENT ON COLUMN "inventory_items"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "inventory_items"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "inventory_items"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "inventory_items"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "inventory_batches" IS 'Lote de un ítem con vencimiento (medicamentos, agroquímicos).';
COMMENT ON COLUMN "inventory_batches"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "inventory_batches"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "inventory_batches"."item_id" IS 'Ítem';
COMMENT ON COLUMN "inventory_batches"."batch_number" IS 'Número de lote del proveedor';
COMMENT ON COLUMN "inventory_batches"."expiry_date" IS 'Fecha de vencimiento';
COMMENT ON COLUMN "inventory_batches"."supplier_id" IS 'Proveedor de origen';
COMMENT ON COLUMN "inventory_batches"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "inventory_batches"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "inventory_batches"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "inventory_batches"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "stock_levels" IS 'Existencia actual de un ítem (opcionalmente por lote) en un depósito.';
COMMENT ON COLUMN "stock_levels"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "stock_levels"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "stock_levels"."item_id" IS 'Ítem';
COMMENT ON COLUMN "stock_levels"."warehouse_id" IS 'Depósito';
COMMENT ON COLUMN "stock_levels"."batch_id" IS 'Lote (si aplica)';
COMMENT ON COLUMN "stock_levels"."quantity" IS 'Cantidad disponible';
COMMENT ON COLUMN "stock_levels"."avg_cost" IS 'Costo promedio ponderado';
COMMENT ON COLUMN "stock_levels"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "stock_levels"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "stock_levels"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "stock_levels"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "stock_movements" IS 'Movimiento de stock (entrada, salida, ajuste, transferencia). Kardex.';
COMMENT ON COLUMN "stock_movements"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "stock_movements"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "stock_movements"."item_id" IS 'Ítem';
COMMENT ON COLUMN "stock_movements"."warehouse_id" IS 'Depósito afectado';
COMMENT ON COLUMN "stock_movements"."batch_id" IS 'Lote';
COMMENT ON COLUMN "stock_movements"."movement_type" IS 'Tipo de movimiento';
COMMENT ON COLUMN "stock_movements"."quantity" IS 'Cantidad (positiva; el tipo define el signo)';
COMMENT ON COLUMN "stock_movements"."unit_cost" IS 'Costo unitario del movimiento';
COMMENT ON COLUMN "stock_movements"."occurred_at" IS 'Fecha del movimiento';
COMMENT ON COLUMN "stock_movements"."reference_type" IS 'Entidad que lo originó (purchase, treatment, feed_delivery…)';
COMMENT ON COLUMN "stock_movements"."reference_id" IS 'ID de la entidad de origen';
COMMENT ON COLUMN "stock_movements"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "stock_movements"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "stock_movements"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "stock_movements"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "assets" IS 'Activo fijo genérico (instalaciones, equipos, mejoras).';
COMMENT ON COLUMN "assets"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "assets"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "assets"."farm_id" IS 'Finca';
COMMENT ON COLUMN "assets"."name" IS 'Nombre del activo';
COMMENT ON COLUMN "assets"."type" IS 'Tipo';
COMMENT ON COLUMN "assets"."acquisition_date" IS 'Fecha de compra';
COMMENT ON COLUMN "assets"."acquisition_cost" IS 'Costo de adquisición';
COMMENT ON COLUMN "assets"."useful_life_years" IS 'Vida útil para depreciación';
COMMENT ON COLUMN "assets"."residual_value" IS 'Valor residual';
COMMENT ON COLUMN "assets"."status" IS 'Estado';
COMMENT ON COLUMN "assets"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "assets"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "assets"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "assets"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "machinery" IS 'Maquinaria y vehículos (subtipo de activo con telemetría).';
COMMENT ON COLUMN "machinery"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "machinery"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "machinery"."asset_id" IS 'Activo contable asociado';
COMMENT ON COLUMN "machinery"."farm_id" IS 'Finca';
COMMENT ON COLUMN "machinery"."name" IS 'Nombre/identificación';
COMMENT ON COLUMN "machinery"."type" IS 'Tipo de máquina';
COMMENT ON COLUMN "machinery"."make" IS 'Marca';
COMMENT ON COLUMN "machinery"."model" IS 'Modelo';
COMMENT ON COLUMN "machinery"."year" IS 'Año de fabricación';
COMMENT ON COLUMN "machinery"."plate" IS 'Patente/placa';
COMMENT ON COLUMN "machinery"."engine_hours" IS 'Horómetro actual';
COMMENT ON COLUMN "machinery"."odometer_km" IS 'Kilometraje actual';
COMMENT ON COLUMN "machinery"."device_id" IS 'Dispositivo de telemetría (GPS/ISOBUS)';
COMMENT ON COLUMN "machinery"."status" IS 'Estado';
COMMENT ON COLUMN "machinery"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "machinery"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "machinery"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "machinery"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "maintenance_records" IS 'Mantenimiento de maquinaria/activo (preventivo o correctivo).';
COMMENT ON COLUMN "maintenance_records"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "maintenance_records"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "maintenance_records"."machinery_id" IS 'Máquina';
COMMENT ON COLUMN "maintenance_records"."asset_id" IS 'Activo (si no es maquinaria)';
COMMENT ON COLUMN "maintenance_records"."type" IS 'Tipo de mantenimiento';
COMMENT ON COLUMN "maintenance_records"."performed_at" IS 'Fecha';
COMMENT ON COLUMN "maintenance_records"."description" IS 'Trabajo realizado';
COMMENT ON COLUMN "maintenance_records"."engine_hours" IS 'Horómetro al momento';
COMMENT ON COLUMN "maintenance_records"."cost" IS 'Costo total';
COMMENT ON COLUMN "maintenance_records"."next_due_date" IS 'Próximo mantenimiento programado';
COMMENT ON COLUMN "maintenance_records"."performed_by" IS 'Taller/mecánico';
COMMENT ON COLUMN "maintenance_records"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "maintenance_records"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "maintenance_records"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "maintenance_records"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "fuel_logs" IS 'Registro de carga/consumo de combustible.';
COMMENT ON COLUMN "fuel_logs"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "fuel_logs"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "fuel_logs"."machinery_id" IS 'Máquina repostada';
COMMENT ON COLUMN "fuel_logs"."fueled_at" IS 'Fecha de carga';
COMMENT ON COLUMN "fuel_logs"."item_id" IS 'Ítem combustible (descuenta stock)';
COMMENT ON COLUMN "fuel_logs"."liters" IS 'Litros cargados';
COMMENT ON COLUMN "fuel_logs"."odometer_km" IS 'Kilometraje al cargar';
COMMENT ON COLUMN "fuel_logs"."engine_hours" IS 'Horómetro al cargar';
COMMENT ON COLUMN "fuel_logs"."unit_cost" IS 'Costo por litro';
COMMENT ON COLUMN "fuel_logs"."total_cost" IS 'Costo total';
COMMENT ON COLUMN "fuel_logs"."operator_id" IS 'Operario';
COMMENT ON COLUMN "fuel_logs"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "fuel_logs"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "fuel_logs"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "fuel_logs"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "labs" IS 'Laboratorio externo o interno que procesa muestras.';
COMMENT ON COLUMN "labs"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "labs"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "labs"."name" IS 'Nombre del laboratorio';
COMMENT ON COLUMN "labs"."type" IS 'Especialidad';
COMMENT ON COLUMN "labs"."contact" IS 'Datos de contacto';
COMMENT ON COLUMN "labs"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "labs"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "labs"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "labs"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "lab_samples" IS 'Muestra enviada a laboratorio (sangre, tejido, leche, suelo, pelo).';
COMMENT ON COLUMN "lab_samples"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "lab_samples"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "lab_samples"."lab_id" IS 'Laboratorio destino';
COMMENT ON COLUMN "lab_samples"."sample_type" IS 'Tipo de muestra';
COMMENT ON COLUMN "lab_samples"."animal_id" IS 'Animal de origen (si aplica)';
COMMENT ON COLUMN "lab_samples"."paddock_id" IS 'Parcela de origen (suelo)';
COMMENT ON COLUMN "lab_samples"."collected_at" IS 'Fecha de colecta';
COMMENT ON COLUMN "lab_samples"."sent_at" IS 'Fecha de envío';
COMMENT ON COLUMN "lab_samples"."status" IS 'Estado';
COMMENT ON COLUMN "lab_samples"."barcode" IS 'Código de la muestra';
COMMENT ON COLUMN "lab_samples"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "lab_samples"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "lab_samples"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "lab_samples"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "lab_results" IS 'Resultado de un análisis de laboratorio.';
COMMENT ON COLUMN "lab_results"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "lab_results"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "lab_results"."sample_id" IS 'Muestra analizada';
COMMENT ON COLUMN "lab_results"."test_code" IS 'Prueba realizada (paternidad, genotipo, brucelosis…)';
COMMENT ON COLUMN "lab_results"."result_value" IS 'Resultado (valor o interpretación)';
COMMENT ON COLUMN "lab_results"."result_data" IS 'Datos estructurados detallados';
COMMENT ON COLUMN "lab_results"."reference_range" IS 'Rango de referencia';
COMMENT ON COLUMN "lab_results"."is_abnormal" IS 'Fuera de rango';
COMMENT ON COLUMN "lab_results"."reported_at" IS 'Fecha del informe';
COMMENT ON COLUMN "lab_results"."document_id" IS 'Informe PDF adjunto';
COMMENT ON COLUMN "lab_results"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "lab_results"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "lab_results"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "lab_results"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "business_partners" IS 'Tercero comercial: cliente, proveedor o ambos. Base común de la agenda comercial.';
COMMENT ON COLUMN "business_partners"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "business_partners"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "business_partners"."company_id" IS 'Empresa dueña de la relación';
COMMENT ON COLUMN "business_partners"."type" IS 'Rol comercial';
COMMENT ON COLUMN "business_partners"."name" IS 'Nombre/razón social';
COMMENT ON COLUMN "business_partners"."tax_id" IS 'Identificación fiscal';
COMMENT ON COLUMN "business_partners"."email" IS 'Email de contacto';
COMMENT ON COLUMN "business_partners"."phone" IS 'Teléfono';
COMMENT ON COLUMN "business_partners"."address" IS 'Dirección estructurada';
COMMENT ON COLUMN "business_partners"."credit_limit" IS 'Límite de crédito otorgado';
COMMENT ON COLUMN "business_partners"."is_active" IS 'Relación activa';
COMMENT ON COLUMN "business_partners"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "business_partners"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "business_partners"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "business_partners"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "customers" IS 'Perfil de cliente (extiende business_partners con datos de venta).';
COMMENT ON COLUMN "customers"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "customers"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "customers"."partner_id" IS 'Tercero comercial';
COMMENT ON COLUMN "customers"."segment" IS 'Segmento de cliente';
COMMENT ON COLUMN "customers"."payment_terms_days" IS 'Plazo de pago acordado';
COMMENT ON COLUMN "customers"."price_list_id" IS 'Lista de precios asignada';
COMMENT ON COLUMN "customers"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "customers"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "customers"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "customers"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "suppliers" IS 'Perfil de proveedor (extiende business_partners).';
COMMENT ON COLUMN "suppliers"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "suppliers"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "suppliers"."partner_id" IS 'Tercero comercial';
COMMENT ON COLUMN "suppliers"."category" IS 'Rubro que provee';
COMMENT ON COLUMN "suppliers"."payment_terms_days" IS 'Plazo de pago a proveedor';
COMMENT ON COLUMN "suppliers"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "suppliers"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "suppliers"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "suppliers"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "contacts" IS 'Persona de contacto dentro de un tercero comercial.';
COMMENT ON COLUMN "contacts"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "contacts"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "contacts"."partner_id" IS 'Tercero';
COMMENT ON COLUMN "contacts"."name" IS 'Nombre';
COMMENT ON COLUMN "contacts"."role" IS 'Cargo';
COMMENT ON COLUMN "contacts"."email" IS 'Email';
COMMENT ON COLUMN "contacts"."phone" IS 'Teléfono';
COMMENT ON COLUMN "contacts"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "contacts"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "contacts"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "contacts"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "price_lists" IS 'Lista de precios para productos/servicios.';
COMMENT ON COLUMN "price_lists"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "price_lists"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "price_lists"."company_id" IS 'Empresa';
COMMENT ON COLUMN "price_lists"."name" IS 'Nombre de la lista';
COMMENT ON COLUMN "price_lists"."currency" IS 'Moneda';
COMMENT ON COLUMN "price_lists"."valid_from" IS 'Vigencia desde';
COMMENT ON COLUMN "price_lists"."valid_until" IS 'Vigencia hasta';
COMMENT ON COLUMN "price_lists"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "price_lists"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "price_lists"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "price_lists"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "purchases" IS 'Orden/factura de compra a un proveedor.';
COMMENT ON COLUMN "purchases"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "purchases"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "purchases"."company_id" IS 'Empresa compradora';
COMMENT ON COLUMN "purchases"."supplier_partner_id" IS 'Proveedor';
COMMENT ON COLUMN "purchases"."document_number" IS 'Número de factura/remito';
COMMENT ON COLUMN "purchases"."purchase_date" IS 'Fecha de la compra';
COMMENT ON COLUMN "purchases"."currency" IS 'Moneda';
COMMENT ON COLUMN "purchases"."subtotal" IS 'Subtotal sin impuestos';
COMMENT ON COLUMN "purchases"."tax_total" IS 'Total de impuestos';
COMMENT ON COLUMN "purchases"."total" IS 'Total de la compra';
COMMENT ON COLUMN "purchases"."status" IS 'Estado';
COMMENT ON COLUMN "purchases"."journal_entry_id" IS 'Asiento contable generado';
COMMENT ON COLUMN "purchases"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "purchases"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "purchases"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "purchases"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "purchase_lines" IS 'Renglón de una compra.';
COMMENT ON COLUMN "purchase_lines"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "purchase_lines"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "purchase_lines"."purchase_id" IS 'Compra';
COMMENT ON COLUMN "purchase_lines"."item_id" IS 'Ítem comprado';
COMMENT ON COLUMN "purchase_lines"."animal_id" IS 'Animal comprado (compra de ganado)';
COMMENT ON COLUMN "purchase_lines"."description" IS 'Descripción libre';
COMMENT ON COLUMN "purchase_lines"."quantity" IS 'Cantidad';
COMMENT ON COLUMN "purchase_lines"."unit_price" IS 'Precio unitario';
COMMENT ON COLUMN "purchase_lines"."tax_rate" IS 'Alícuota de impuesto';
COMMENT ON COLUMN "purchase_lines"."line_total" IS 'Total del renglón';
COMMENT ON COLUMN "purchase_lines"."warehouse_id" IS 'Depósito de ingreso';
COMMENT ON COLUMN "purchase_lines"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "purchase_lines"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "purchase_lines"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "purchase_lines"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "sales" IS 'Venta a un cliente (animales, leche, productos, servicios).';
COMMENT ON COLUMN "sales"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "sales"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "sales"."company_id" IS 'Empresa vendedora';
COMMENT ON COLUMN "sales"."customer_partner_id" IS 'Cliente';
COMMENT ON COLUMN "sales"."document_number" IS 'Número de comprobante';
COMMENT ON COLUMN "sales"."sale_date" IS 'Fecha de venta';
COMMENT ON COLUMN "sales"."type" IS 'Tipo de venta';
COMMENT ON COLUMN "sales"."currency" IS 'Moneda';
COMMENT ON COLUMN "sales"."subtotal" IS 'Subtotal';
COMMENT ON COLUMN "sales"."tax_total" IS 'Impuestos';
COMMENT ON COLUMN "sales"."total" IS 'Total';
COMMENT ON COLUMN "sales"."status" IS 'Estado';
COMMENT ON COLUMN "sales"."journal_entry_id" IS 'Asiento contable generado';
COMMENT ON COLUMN "sales"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "sales"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "sales"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "sales"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "sale_lines" IS 'Renglón de una venta.';
COMMENT ON COLUMN "sale_lines"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "sale_lines"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "sale_lines"."sale_id" IS 'Venta';
COMMENT ON COLUMN "sale_lines"."item_id" IS 'Ítem vendido';
COMMENT ON COLUMN "sale_lines"."animal_id" IS 'Animal vendido';
COMMENT ON COLUMN "sale_lines"."description" IS 'Descripción';
COMMENT ON COLUMN "sale_lines"."quantity" IS 'Cantidad (o kg en ventas por peso)';
COMMENT ON COLUMN "sale_lines"."unit_price" IS 'Precio unitario';
COMMENT ON COLUMN "sale_lines"."weight_kg" IS 'Peso vendido (ganado en pie/canal)';
COMMENT ON COLUMN "sale_lines"."tax_rate" IS 'Alícuota';
COMMENT ON COLUMN "sale_lines"."line_total" IS 'Total del renglón';
COMMENT ON COLUMN "sale_lines"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "sale_lines"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "sale_lines"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "sale_lines"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "invoices" IS 'Factura/comprobante fiscal emitido o recibido.';
COMMENT ON COLUMN "invoices"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "invoices"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "invoices"."company_id" IS 'Empresa';
COMMENT ON COLUMN "invoices"."direction" IS 'Emitida o recibida';
COMMENT ON COLUMN "invoices"."sale_id" IS 'Venta asociada';
COMMENT ON COLUMN "invoices"."purchase_id" IS 'Compra asociada';
COMMENT ON COLUMN "invoices"."partner_id" IS 'Tercero';
COMMENT ON COLUMN "invoices"."invoice_number" IS 'Número fiscal';
COMMENT ON COLUMN "invoices"."issue_date" IS 'Fecha de emisión';
COMMENT ON COLUMN "invoices"."due_date" IS 'Vencimiento';
COMMENT ON COLUMN "invoices"."currency" IS 'Moneda';
COMMENT ON COLUMN "invoices"."total" IS 'Total facturado';
COMMENT ON COLUMN "invoices"."tax_authority_status" IS 'Estado ante el fisco (CFDI/CAE/NF-e)';
COMMENT ON COLUMN "invoices"."status" IS 'Estado';
COMMENT ON COLUMN "invoices"."document_id" IS 'PDF del comprobante';
COMMENT ON COLUMN "invoices"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "invoices"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "invoices"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "invoices"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "contracts" IS 'Contrato comercial (suministro, capitalización, arrendamiento, servicios).';
COMMENT ON COLUMN "contracts"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "contracts"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "contracts"."company_id" IS 'Empresa';
COMMENT ON COLUMN "contracts"."partner_id" IS 'Contraparte';
COMMENT ON COLUMN "contracts"."type" IS 'Tipo de contrato';
COMMENT ON COLUMN "contracts"."start_date" IS 'Inicio';
COMMENT ON COLUMN "contracts"."end_date" IS 'Fin';
COMMENT ON COLUMN "contracts"."terms" IS 'Términos';
COMMENT ON COLUMN "contracts"."value" IS 'Valor del contrato';
COMMENT ON COLUMN "contracts"."status" IS 'Estado';
COMMENT ON COLUMN "contracts"."document_id" IS 'Documento firmado';
COMMENT ON COLUMN "contracts"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "contracts"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "contracts"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "contracts"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "market_prices" IS 'Precios de mercado de referencia (hacienda, leche, granos).';
COMMENT ON COLUMN "market_prices"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "market_prices"."tenant_id" IS 'NULL = referencia pública; valor = registro propio';
COMMENT ON COLUMN "market_prices"."product" IS 'Producto (novillo gordo, ternero, leche, soja)';
COMMENT ON COLUMN "market_prices"."market" IS 'Mercado/plaza';
COMMENT ON COLUMN "market_prices"."price_date" IS 'Fecha';
COMMENT ON COLUMN "market_prices"."price" IS 'Precio';
COMMENT ON COLUMN "market_prices"."currency" IS 'Moneda';
COMMENT ON COLUMN "market_prices"."unit" IS 'Unidad de referencia';
COMMENT ON COLUMN "market_prices"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "market_prices"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "market_prices"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "market_prices"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "chart_of_accounts" IS 'Plan de cuentas contable por empresa.';
COMMENT ON COLUMN "chart_of_accounts"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "chart_of_accounts"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "chart_of_accounts"."company_id" IS 'Empresa';
COMMENT ON COLUMN "chart_of_accounts"."code" IS 'Código de cuenta';
COMMENT ON COLUMN "chart_of_accounts"."name" IS 'Nombre de la cuenta';
COMMENT ON COLUMN "chart_of_accounts"."type" IS 'Naturaleza contable';
COMMENT ON COLUMN "chart_of_accounts"."parent_id" IS 'Cuenta padre (jerarquía)';
COMMENT ON COLUMN "chart_of_accounts"."is_postable" IS 'Admite asientos directos';
COMMENT ON COLUMN "chart_of_accounts"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "chart_of_accounts"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "chart_of_accounts"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "chart_of_accounts"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "cost_centers" IS 'Centro de costo. Puede llegar hasta el nivel de animal para costo/kg real.';
COMMENT ON COLUMN "cost_centers"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "cost_centers"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "cost_centers"."company_id" IS 'Empresa';
COMMENT ON COLUMN "cost_centers"."name" IS 'Nombre del centro';
COMMENT ON COLUMN "cost_centers"."level" IS 'Nivel de agregación';
COMMENT ON COLUMN "cost_centers"."farm_id" IS 'Finca asociada';
COMMENT ON COLUMN "cost_centers"."reference_id" IS 'ID de la entidad (lote/animal/potrero) según nivel';
COMMENT ON COLUMN "cost_centers"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "cost_centers"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "cost_centers"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "cost_centers"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "fiscal_periods" IS 'Período contable con estado de apertura/cierre.';
COMMENT ON COLUMN "fiscal_periods"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "fiscal_periods"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "fiscal_periods"."company_id" IS 'Empresa';
COMMENT ON COLUMN "fiscal_periods"."name" IS 'Nombre (2026-06)';
COMMENT ON COLUMN "fiscal_periods"."start_date" IS 'Inicio';
COMMENT ON COLUMN "fiscal_periods"."end_date" IS 'Fin';
COMMENT ON COLUMN "fiscal_periods"."status" IS 'Estado';
COMMENT ON COLUMN "fiscal_periods"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "fiscal_periods"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "fiscal_periods"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "fiscal_periods"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "journal_entries" IS 'Asiento contable (partida doble). Cabecera.';
COMMENT ON COLUMN "journal_entries"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "journal_entries"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "journal_entries"."company_id" IS 'Empresa';
COMMENT ON COLUMN "journal_entries"."period_id" IS 'Período contable';
COMMENT ON COLUMN "journal_entries"."entry_date" IS 'Fecha del asiento';
COMMENT ON COLUMN "journal_entries"."reference" IS 'Referencia/glosa';
COMMENT ON COLUMN "journal_entries"."source_type" IS 'Origen (sale, purchase, payroll, manual…)';
COMMENT ON COLUMN "journal_entries"."source_id" IS 'ID de la entidad de origen';
COMMENT ON COLUMN "journal_entries"."currency" IS 'Moneda del asiento';
COMMENT ON COLUMN "journal_entries"."status" IS 'Estado';
COMMENT ON COLUMN "journal_entries"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "journal_entries"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "journal_entries"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "journal_entries"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "journal_lines" IS 'Renglón del asiento (débito o crédito). La suma debe balancear.';
COMMENT ON COLUMN "journal_lines"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "journal_lines"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "journal_lines"."entry_id" IS 'Asiento';
COMMENT ON COLUMN "journal_lines"."account_id" IS 'Cuenta imputada';
COMMENT ON COLUMN "journal_lines"."cost_center_id" IS 'Centro de costo';
COMMENT ON COLUMN "journal_lines"."debit" IS 'Importe al debe';
COMMENT ON COLUMN "journal_lines"."credit" IS 'Importe al haber';
COMMENT ON COLUMN "journal_lines"."currency_amount" IS 'Importe en moneda original';
COMMENT ON COLUMN "journal_lines"."exchange_rate" IS 'Tasa aplicada';
COMMENT ON COLUMN "journal_lines"."description" IS 'Detalle del renglón';
COMMENT ON COLUMN "journal_lines"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "journal_lines"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "journal_lines"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "journal_lines"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "payments" IS 'Cobro o pago de dinero (tesorería). Aplica a facturas.';
COMMENT ON COLUMN "payments"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "payments"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "payments"."company_id" IS 'Empresa';
COMMENT ON COLUMN "payments"."direction" IS 'Cobro (inbound) o pago (outbound)';
COMMENT ON COLUMN "payments"."partner_id" IS 'Tercero';
COMMENT ON COLUMN "payments"."payment_date" IS 'Fecha';
COMMENT ON COLUMN "payments"."amount" IS 'Importe';
COMMENT ON COLUMN "payments"."currency" IS 'Moneda';
COMMENT ON COLUMN "payments"."method" IS 'Medio de pago';
COMMENT ON COLUMN "payments"."account_id" IS 'Cuenta de tesorería';
COMMENT ON COLUMN "payments"."journal_entry_id" IS 'Asiento generado';
COMMENT ON COLUMN "payments"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "payments"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "payments"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "payments"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "payment_allocations" IS 'Aplicación de un pago a una o varias facturas.';
COMMENT ON COLUMN "payment_allocations"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "payment_allocations"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "payment_allocations"."payment_id" IS 'Pago';
COMMENT ON COLUMN "payment_allocations"."invoice_id" IS 'Factura aplicada';
COMMENT ON COLUMN "payment_allocations"."amount" IS 'Importe aplicado';
COMMENT ON COLUMN "payment_allocations"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "payment_allocations"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "payment_allocations"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "payment_allocations"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "budgets" IS 'Presupuesto por empresa/período.';
COMMENT ON COLUMN "budgets"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "budgets"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "budgets"."company_id" IS 'Empresa';
COMMENT ON COLUMN "budgets"."name" IS 'Nombre del presupuesto';
COMMENT ON COLUMN "budgets"."fiscal_year" IS 'Año presupuestado';
COMMENT ON COLUMN "budgets"."status" IS 'Estado';
COMMENT ON COLUMN "budgets"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "budgets"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "budgets"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "budgets"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "budget_lines" IS 'Línea de presupuesto por cuenta/centro de costo/mes.';
COMMENT ON COLUMN "budget_lines"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "budget_lines"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "budget_lines"."budget_id" IS 'Presupuesto';
COMMENT ON COLUMN "budget_lines"."account_id" IS 'Cuenta';
COMMENT ON COLUMN "budget_lines"."cost_center_id" IS 'Centro de costo';
COMMENT ON COLUMN "budget_lines"."month" IS 'Mes (1-12)';
COMMENT ON COLUMN "budget_lines"."amount" IS 'Monto presupuestado';
COMMENT ON COLUMN "budget_lines"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "budget_lines"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "budget_lines"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "budget_lines"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "bank_accounts" IS 'Cuenta bancaria de la empresa.';
COMMENT ON COLUMN "bank_accounts"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "bank_accounts"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "bank_accounts"."company_id" IS 'Empresa';
COMMENT ON COLUMN "bank_accounts"."name" IS 'Alias de la cuenta';
COMMENT ON COLUMN "bank_accounts"."bank_name" IS 'Banco';
COMMENT ON COLUMN "bank_accounts"."account_number" IS 'Número de cuenta (cifrado)';
COMMENT ON COLUMN "bank_accounts"."currency" IS 'Moneda';
COMMENT ON COLUMN "bank_accounts"."ledger_account_id" IS 'Cuenta contable asociada';
COMMENT ON COLUMN "bank_accounts"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "bank_accounts"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "bank_accounts"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "bank_accounts"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "employees" IS 'Empleado o contratista de la finca.';
COMMENT ON COLUMN "employees"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "employees"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "employees"."company_id" IS 'Empresa empleadora';
COMMENT ON COLUMN "employees"."user_id" IS 'Cuenta de usuario vinculada (si accede al sistema)';
COMMENT ON COLUMN "employees"."full_name" IS 'Nombre completo';
COMMENT ON COLUMN "employees"."role" IS 'Puesto (capataz, ordeñador, tractorista)';
COMMENT ON COLUMN "employees"."employment_type" IS 'Tipo de vínculo';
COMMENT ON COLUMN "employees"."hire_date" IS 'Fecha de ingreso';
COMMENT ON COLUMN "employees"."termination_date" IS 'Fecha de egreso';
COMMENT ON COLUMN "employees"."is_active" IS 'Empleado activo';
COMMENT ON COLUMN "employees"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "employees"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "employees"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "employees"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "work_logs" IS 'Registro de jornada/tarea de un empleado.';
COMMENT ON COLUMN "work_logs"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "work_logs"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "work_logs"."employee_id" IS 'Empleado';
COMMENT ON COLUMN "work_logs"."work_date" IS 'Fecha';
COMMENT ON COLUMN "work_logs"."hours" IS 'Horas trabajadas';
COMMENT ON COLUMN "work_logs"."task_id" IS 'Tarea asociada';
COMMENT ON COLUMN "work_logs"."farm_id" IS 'Finca';
COMMENT ON COLUMN "work_logs"."notes" IS 'Detalle';
COMMENT ON COLUMN "work_logs"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "work_logs"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "work_logs"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "work_logs"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "payroll_runs" IS 'Corrida de nómina de un período.';
COMMENT ON COLUMN "payroll_runs"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "payroll_runs"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "payroll_runs"."company_id" IS 'Empresa';
COMMENT ON COLUMN "payroll_runs"."period" IS 'Mes liquidado';
COMMENT ON COLUMN "payroll_runs"."status" IS 'Estado';
COMMENT ON COLUMN "payroll_runs"."total_amount" IS 'Total de la nómina';
COMMENT ON COLUMN "payroll_runs"."journal_entry_id" IS 'Asiento contable';
COMMENT ON COLUMN "payroll_runs"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "payroll_runs"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "payroll_runs"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "payroll_runs"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "payroll_items" IS 'Detalle de nómina por empleado.';
COMMENT ON COLUMN "payroll_items"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "payroll_items"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "payroll_items"."payroll_run_id" IS 'Corrida de nómina';
COMMENT ON COLUMN "payroll_items"."employee_id" IS 'Empleado';
COMMENT ON COLUMN "payroll_items"."gross" IS 'Bruto';
COMMENT ON COLUMN "payroll_items"."deductions" IS 'Deducciones';
COMMENT ON COLUMN "payroll_items"."net" IS 'Neto a pagar';
COMMENT ON COLUMN "payroll_items"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "payroll_items"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "payroll_items"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "payroll_items"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "tasks" IS 'Tarea/actividad planificada o realizada (trabajo de campo, recordatorio operativo).';
COMMENT ON COLUMN "tasks"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "tasks"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "tasks"."farm_id" IS 'Finca';
COMMENT ON COLUMN "tasks"."title" IS 'Título de la tarea';
COMMENT ON COLUMN "tasks"."description" IS 'Detalle';
COMMENT ON COLUMN "tasks"."type" IS 'Categoría';
COMMENT ON COLUMN "tasks"."due_date" IS 'Fecha/hora de vencimiento';
COMMENT ON COLUMN "tasks"."priority" IS 'Prioridad';
COMMENT ON COLUMN "tasks"."status" IS 'Estado';
COMMENT ON COLUMN "tasks"."assigned_to" IS 'Responsable';
COMMENT ON COLUMN "tasks"."related_type" IS 'Entidad relacionada (animal, lot, machinery…)';
COMMENT ON COLUMN "tasks"."related_id" IS 'ID de la entidad relacionada';
COMMENT ON COLUMN "tasks"."completed_at" IS 'Fecha de finalización';
COMMENT ON COLUMN "tasks"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "tasks"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "tasks"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "tasks"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "calendar_events" IS 'Evento de calendario (cita, visita veterinaria, entrega) con recurrencia.';
COMMENT ON COLUMN "calendar_events"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "calendar_events"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "calendar_events"."farm_id" IS 'Finca';
COMMENT ON COLUMN "calendar_events"."title" IS 'Título';
COMMENT ON COLUMN "calendar_events"."starts_at" IS 'Inicio';
COMMENT ON COLUMN "calendar_events"."ends_at" IS 'Fin';
COMMENT ON COLUMN "calendar_events"."all_day" IS 'Evento de día completo';
COMMENT ON COLUMN "calendar_events"."recurrence_rule" IS 'Regla RRULE (iCal) para recurrencia';
COMMENT ON COLUMN "calendar_events"."location" IS 'Lugar';
COMMENT ON COLUMN "calendar_events"."created_by" IS 'Creador';
COMMENT ON COLUMN "calendar_events"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "calendar_events"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "calendar_events"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "alert_rules" IS 'Regla declarativa que dispara alertas (condición → acción).';
COMMENT ON COLUMN "alert_rules"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "alert_rules"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "alert_rules"."farm_id" IS 'Finca (NULL = toda la organización)';
COMMENT ON COLUMN "alert_rules"."name" IS 'Nombre de la regla';
COMMENT ON COLUMN "alert_rules"."category" IS 'Dominio';
COMMENT ON COLUMN "alert_rules"."condition" IS 'Condición declarativa (JSONLogic/CEL)';
COMMENT ON COLUMN "alert_rules"."severity" IS 'Severidad';
COMMENT ON COLUMN "alert_rules"."is_active" IS 'Regla activa';
COMMENT ON COLUMN "alert_rules"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "alert_rules"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "alert_rules"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "alert_rules"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "alerts" IS 'Alerta generada por una regla o por el sistema.';
COMMENT ON COLUMN "alerts"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "alerts"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "alerts"."rule_id" IS 'Regla que la disparó';
COMMENT ON COLUMN "alerts"."category" IS 'Dominio';
COMMENT ON COLUMN "alerts"."severity" IS 'Severidad';
COMMENT ON COLUMN "alerts"."title" IS 'Título';
COMMENT ON COLUMN "alerts"."message" IS 'Detalle';
COMMENT ON COLUMN "alerts"."related_type" IS 'Entidad afectada';
COMMENT ON COLUMN "alerts"."related_id" IS 'ID de la entidad';
COMMENT ON COLUMN "alerts"."status" IS 'Estado';
COMMENT ON COLUMN "alerts"."triggered_at" IS 'Momento del disparo';
COMMENT ON COLUMN "alerts"."resolved_at" IS 'Momento de resolución';
COMMENT ON COLUMN "alerts"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "alerts"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "alerts"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "alerts"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "notifications" IS 'Notificación entregada a un usuario por uno o varios canales.';
COMMENT ON COLUMN "notifications"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "notifications"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "notifications"."user_id" IS 'Destinatario';
COMMENT ON COLUMN "notifications"."channel" IS 'Canal de entrega';
COMMENT ON COLUMN "notifications"."title" IS 'Título';
COMMENT ON COLUMN "notifications"."body" IS 'Cuerpo';
COMMENT ON COLUMN "notifications"."alert_id" IS 'Alerta de origen (si aplica)';
COMMENT ON COLUMN "notifications"."status" IS 'Estado de entrega';
COMMENT ON COLUMN "notifications"."sent_at" IS 'Enviada';
COMMENT ON COLUMN "notifications"."read_at" IS 'Leída';
COMMENT ON COLUMN "notifications"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "notifications"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "notifications"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "notifications"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "notification_preferences" IS 'Preferencias de notificación por usuario (canales, horarios silenciosos).';
COMMENT ON COLUMN "notification_preferences"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "notification_preferences"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "notification_preferences"."user_id" IS 'Usuario';
COMMENT ON COLUMN "notification_preferences"."category" IS 'Categoría de eventos';
COMMENT ON COLUMN "notification_preferences"."channels" IS 'Canales habilitados para la categoría';
COMMENT ON COLUMN "notification_preferences"."quiet_hours" IS 'Franja de no-molestar';
COMMENT ON COLUMN "notification_preferences"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "notification_preferences"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "notification_preferences"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "notification_preferences"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "files" IS 'Objeto de almacenamiento genérico (S3). Base de fotos, videos y documentos.';
COMMENT ON COLUMN "files"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "files"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "files"."bucket_key" IS 'Ruta del objeto en el almacenamiento';
COMMENT ON COLUMN "files"."file_name" IS 'Nombre original';
COMMENT ON COLUMN "files"."mime_type" IS 'Tipo MIME';
COMMENT ON COLUMN "files"."media_type" IS 'Clasificación de alto nivel';
COMMENT ON COLUMN "files"."size_bytes" IS 'Tamaño en bytes';
COMMENT ON COLUMN "files"."checksum" IS 'Hash del contenido (integridad/dedupe)';
COMMENT ON COLUMN "files"."width" IS 'Ancho (imagen/video)';
COMMENT ON COLUMN "files"."height" IS 'Alto';
COMMENT ON COLUMN "files"."duration_seconds" IS 'Duración (video/audio)';
COMMENT ON COLUMN "files"."taken_at" IS 'Fecha de captura (EXIF)';
COMMENT ON COLUMN "files"."location" IS 'Geoetiqueta (EXIF GPS)';
COMMENT ON COLUMN "files"."uploaded_by" IS 'Quién subió el archivo';
COMMENT ON COLUMN "files"."sync_status" IS 'Estado de subida offline';
COMMENT ON COLUMN "files"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "files"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "files"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "files"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "attachments" IS 'Vínculo polimórfico entre un archivo y cualquier entidad del sistema.';
COMMENT ON COLUMN "attachments"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "attachments"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "attachments"."file_id" IS 'Archivo';
COMMENT ON COLUMN "attachments"."entity_type" IS 'Tabla de la entidad (animals, treatments, sales…)';
COMMENT ON COLUMN "attachments"."entity_id" IS 'ID de la entidad';
COMMENT ON COLUMN "attachments"."role" IS 'Papel del adjunto';
COMMENT ON COLUMN "attachments"."caption" IS 'Descripción';
COMMENT ON COLUMN "attachments"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "attachments"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "attachments"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "attachments"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "documents" IS 'Documento formal con metadatos (contratos, certificados, informes, guías).';
COMMENT ON COLUMN "documents"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "documents"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "documents"."file_id" IS 'Archivo del documento';
COMMENT ON COLUMN "documents"."type" IS 'Tipo documental';
COMMENT ON COLUMN "documents"."title" IS 'Título';
COMMENT ON COLUMN "documents"."issued_by" IS 'Emisor';
COMMENT ON COLUMN "documents"."issue_date" IS 'Fecha de emisión';
COMMENT ON COLUMN "documents"."expiry_date" IS 'Vencimiento (certificados/permisos)';
COMMENT ON COLUMN "documents"."entity_type" IS 'Entidad relacionada';
COMMENT ON COLUMN "documents"."entity_id" IS 'ID de la entidad';
COMMENT ON COLUMN "documents"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "documents"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "documents"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "documents"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "device_types" IS 'Catálogo de tipos de dispositivo soportados.';
COMMENT ON COLUMN "device_types"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "device_types"."code" IS 'Código (rfid_reader, scale, collar, weather, water_sensor, gps_tracker)';
COMMENT ON COLUMN "device_types"."name" IS 'Nombre';
COMMENT ON COLUMN "device_types"."category" IS 'Categoría funcional';
COMMENT ON COLUMN "device_types"."protocol" IS 'Protocolo de comunicación';
COMMENT ON COLUMN "device_types"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "device_types"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "device_types"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "device_types"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "devices" IS 'Dispositivo IoT registrado por el tenant.';
COMMENT ON COLUMN "devices"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "devices"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "devices"."farm_id" IS 'Finca donde opera';
COMMENT ON COLUMN "devices"."device_type_id" IS 'Tipo de dispositivo';
COMMENT ON COLUMN "devices"."serial_number" IS 'Número de serie/identificador único';
COMMENT ON COLUMN "devices"."name" IS 'Alias';
COMMENT ON COLUMN "devices"."gateway_id" IS 'Gateway al que reporta (autoreferencia)';
COMMENT ON COLUMN "devices"."assigned_animal_id" IS 'Animal portador (collares/bolus)';
COMMENT ON COLUMN "devices"."assigned_machinery_id" IS 'Máquina asociada (telemetría)';
COMMENT ON COLUMN "devices"."firmware_version" IS 'Versión de firmware';
COMMENT ON COLUMN "devices"."battery_level" IS 'Nivel de batería (%)';
COMMENT ON COLUMN "devices"."last_seen_at" IS 'Último contacto';
COMMENT ON COLUMN "devices"."status" IS 'Estado';
COMMENT ON COLUMN "devices"."cert_fingerprint" IS 'Huella del certificado X.509 (autenticación MQTT)';
COMMENT ON COLUMN "devices"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "devices"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "devices"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "devices"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "sensor_readings" IS 'Lectura de sensor (hypertable de series de tiempo). Alto volumen.';
COMMENT ON COLUMN "sensor_readings"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "sensor_readings"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "sensor_readings"."device_id" IS 'Dispositivo emisor';
COMMENT ON COLUMN "sensor_readings"."metric" IS 'Métrica (temperature, activity, rumination, water_level, weight)';
COMMENT ON COLUMN "sensor_readings"."value" IS 'Valor normalizado (unidad SI)';
COMMENT ON COLUMN "sensor_readings"."unit" IS 'Unidad';
COMMENT ON COLUMN "sensor_readings"."recorded_at" IS 'Marca temporal de la medición';
COMMENT ON COLUMN "sensor_readings"."location" IS 'Ubicación si el sensor la reporta';
COMMENT ON TABLE "gps_positions" IS 'Posición GPS de un animal, máquina o dispositivo (tracking). Hypertable.';
COMMENT ON COLUMN "gps_positions"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "gps_positions"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "gps_positions"."device_id" IS 'Dispositivo GPS';
COMMENT ON COLUMN "gps_positions"."animal_id" IS 'Animal (collar GPS)';
COMMENT ON COLUMN "gps_positions"."machinery_id" IS 'Máquina';
COMMENT ON COLUMN "gps_positions"."position" IS 'Coordenada (lat/lon)';
COMMENT ON COLUMN "gps_positions"."altitude" IS 'Altitud (m)';
COMMENT ON COLUMN "gps_positions"."speed" IS 'Velocidad (km/h)';
COMMENT ON COLUMN "gps_positions"."heading" IS 'Rumbo (grados)';
COMMENT ON COLUMN "gps_positions"."recorded_at" IS 'Momento de la posición';
COMMENT ON TABLE "geofences" IS 'Cerca virtual/geocerca para alertas de entrada o salida.';
COMMENT ON COLUMN "geofences"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "geofences"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "geofences"."farm_id" IS 'Finca';
COMMENT ON COLUMN "geofences"."name" IS 'Nombre';
COMMENT ON COLUMN "geofences"."boundary" IS 'Polígono de la geocerca';
COMMENT ON COLUMN "geofences"."trigger" IS 'Evento que dispara alerta';
COMMENT ON COLUMN "geofences"."is_active" IS 'Activa';
COMMENT ON COLUMN "geofences"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "geofences"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "geofences"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "geofences"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "trace_events" IS 'Evento de trazabilidad con hash encadenado, listo para anclaje blockchain.';
COMMENT ON COLUMN "trace_events"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "trace_events"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "trace_events"."subject_type" IS 'Tipo de sujeto trazado';
COMMENT ON COLUMN "trace_events"."subject_id" IS 'ID del sujeto';
COMMENT ON COLUMN "trace_events"."event_type" IS 'Tipo (birth, movement, treatment, slaughter, sale…)';
COMMENT ON COLUMN "trace_events"."occurred_at" IS 'Momento del hecho';
COMMENT ON COLUMN "trace_events"."payload" IS 'Datos del evento (formato EPCIS-compatible)';
COMMENT ON COLUMN "trace_events"."prev_hash" IS 'Hash del evento anterior de la cadena del sujeto';
COMMENT ON COLUMN "trace_events"."event_hash" IS 'Hash de este evento';
COMMENT ON COLUMN "trace_events"."anchor_id" IS 'Lote de anclaje en blockchain';
COMMENT ON COLUMN "trace_events"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "trace_events"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "trace_events"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "trace_events"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "compliance_reports" IS 'Reporte regulatorio enviado a una autoridad (movimientos, sanidad, censos).';
COMMENT ON COLUMN "compliance_reports"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "compliance_reports"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "compliance_reports"."company_id" IS 'Empresa reportante';
COMMENT ON COLUMN "compliance_reports"."farm_id" IS 'Finca';
COMMENT ON COLUMN "compliance_reports"."authority" IS 'Autoridad destino (SENASA, ICA, NLIS…)';
COMMENT ON COLUMN "compliance_reports"."report_type" IS 'Tipo de declaración';
COMMENT ON COLUMN "compliance_reports"."period_start" IS 'Inicio del período reportado';
COMMENT ON COLUMN "compliance_reports"."period_end" IS 'Fin del período';
COMMENT ON COLUMN "compliance_reports"."status" IS 'Estado';
COMMENT ON COLUMN "compliance_reports"."submitted_at" IS 'Fecha de envío';
COMMENT ON COLUMN "compliance_reports"."external_ref" IS 'Folio/acuse de la autoridad';
COMMENT ON COLUMN "compliance_reports"."document_id" IS 'Comprobante';
COMMENT ON COLUMN "compliance_reports"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "compliance_reports"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "compliance_reports"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "compliance_reports"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "movement_guides" IS 'Guía/permiso de movilización de ganado (documento oficial de transporte).';
COMMENT ON COLUMN "movement_guides"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "movement_guides"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "movement_guides"."company_id" IS 'Empresa';
COMMENT ON COLUMN "movement_guides"."guide_number" IS 'Número oficial de la guía';
COMMENT ON COLUMN "movement_guides"."from_farm_id" IS 'Origen';
COMMENT ON COLUMN "movement_guides"."to_partner_id" IS 'Destino (cliente/otra finca)';
COMMENT ON COLUMN "movement_guides"."issued_at" IS 'Fecha de emisión';
COMMENT ON COLUMN "movement_guides"."animal_count" IS 'Cantidad de animales';
COMMENT ON COLUMN "movement_guides"."status" IS 'Estado';
COMMENT ON COLUMN "movement_guides"."document_id" IS 'Documento oficial';
COMMENT ON COLUMN "movement_guides"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "movement_guides"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "movement_guides"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "movement_guides"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "certifications" IS 'Certificación de la finca/animal (orgánico, bienestar, libre de enfermedad).';
COMMENT ON COLUMN "certifications"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "certifications"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "certifications"."entity_type" IS 'Sujeto certificado';
COMMENT ON COLUMN "certifications"."entity_id" IS 'ID del sujeto';
COMMENT ON COLUMN "certifications"."scheme" IS 'Esquema de certificación';
COMMENT ON COLUMN "certifications"."issuer" IS 'Certificadora';
COMMENT ON COLUMN "certifications"."valid_from" IS 'Vigencia desde';
COMMENT ON COLUMN "certifications"."valid_until" IS 'Vigencia hasta';
COMMENT ON COLUMN "certifications"."status" IS 'Estado';
COMMENT ON COLUMN "certifications"."document_id" IS 'Certificado';
COMMENT ON COLUMN "certifications"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "certifications"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "certifications"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "certifications"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "blockchain_anchors" IS 'Lote de anclaje: raíz Merkle de trace_events publicada en una red blockchain.';
COMMENT ON COLUMN "blockchain_anchors"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "blockchain_anchors"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "blockchain_anchors"."merkle_root" IS 'Raíz Merkle del lote de eventos';
COMMENT ON COLUMN "blockchain_anchors"."event_count" IS 'Número de eventos anclados';
COMMENT ON COLUMN "blockchain_anchors"."network" IS 'Red utilizada';
COMMENT ON COLUMN "blockchain_anchors"."tx_hash" IS 'Hash de la transacción en la cadena';
COMMENT ON COLUMN "blockchain_anchors"."block_number" IS 'Número de bloque';
COMMENT ON COLUMN "blockchain_anchors"."anchored_at" IS 'Momento de confirmación';
COMMENT ON COLUMN "blockchain_anchors"."status" IS 'Estado';
COMMENT ON COLUMN "blockchain_anchors"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "blockchain_anchors"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "blockchain_anchors"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "blockchain_anchors"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "verifiable_credentials" IS 'Credencial verificable (W3C VC) emitida o recibida (certificados sanitarios digitales).';
COMMENT ON COLUMN "verifiable_credentials"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "verifiable_credentials"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "verifiable_credentials"."subject_type" IS 'Sujeto de la credencial';
COMMENT ON COLUMN "verifiable_credentials"."subject_id" IS 'ID del sujeto';
COMMENT ON COLUMN "verifiable_credentials"."credential_type" IS 'Tipo (HealthCertificate, WelfareCredential…)';
COMMENT ON COLUMN "verifiable_credentials"."issuer_did" IS 'DID del emisor';
COMMENT ON COLUMN "verifiable_credentials"."payload" IS 'Credencial firmada (JSON-LD)';
COMMENT ON COLUMN "verifiable_credentials"."issued_at" IS 'Emisión';
COMMENT ON COLUMN "verifiable_credentials"."expires_at" IS 'Expiración';
COMMENT ON COLUMN "verifiable_credentials"."status" IS 'Estado';
COMMENT ON COLUMN "verifiable_credentials"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "verifiable_credentials"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "verifiable_credentials"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "verifiable_credentials"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "ml_models" IS 'Modelo de ML registrado y versionado (registry).';
COMMENT ON COLUMN "ml_models"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "ml_models"."name" IS 'Nombre del modelo (weight_prediction, heat_detection…)';
COMMENT ON COLUMN "ml_models"."version" IS 'Versión';
COMMENT ON COLUMN "ml_models"."task_type" IS 'Tipo de tarea';
COMMENT ON COLUMN "ml_models"."status" IS 'Estado del ciclo de vida';
COMMENT ON COLUMN "ml_models"."metrics" IS 'Métricas de evaluación';
COMMENT ON COLUMN "ml_models"."artifact_uri" IS 'Ubicación del artefacto (ONNX/registry)';
COMMENT ON COLUMN "ml_models"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "ml_models"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "ml_models"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "ml_models"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "predictions" IS 'Predicción/inferencia producida por un modelo sobre una entidad.';
COMMENT ON COLUMN "predictions"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "predictions"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "predictions"."model_id" IS 'Modelo que la generó';
COMMENT ON COLUMN "predictions"."entity_type" IS 'Entidad objetivo (animal, lot, paddock…)';
COMMENT ON COLUMN "predictions"."entity_id" IS 'ID de la entidad';
COMMENT ON COLUMN "predictions"."prediction_type" IS 'Qué predice (expected_weight, heat_probability, disease_risk)';
COMMENT ON COLUMN "predictions"."value" IS 'Resultado (valor + intervalo de confianza)';
COMMENT ON COLUMN "predictions"."confidence" IS 'Confianza (0-1)';
COMMENT ON COLUMN "predictions"."explanation" IS 'Factores principales (explicabilidad)';
COMMENT ON COLUMN "predictions"."predicted_at" IS 'Momento de la inferencia';
COMMENT ON COLUMN "predictions"."valid_until" IS 'Vigencia de la predicción';
COMMENT ON COLUMN "predictions"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "predictions"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "predictions"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "predictions"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "ai_conversations" IS 'Sesión del copiloto conversacional con un usuario.';
COMMENT ON COLUMN "ai_conversations"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "ai_conversations"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "ai_conversations"."user_id" IS 'Usuario';
COMMENT ON COLUMN "ai_conversations"."farm_id" IS 'Contexto de finca';
COMMENT ON COLUMN "ai_conversations"."channel" IS 'Superficie';
COMMENT ON COLUMN "ai_conversations"."started_at" IS 'Inicio de la sesión';
COMMENT ON COLUMN "ai_conversations"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "ai_conversations"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "ai_conversations"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "ai_conversations"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "ai_messages" IS 'Mensaje dentro de una conversación del copiloto.';
COMMENT ON COLUMN "ai_messages"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "ai_messages"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "ai_messages"."conversation_id" IS 'Conversación';
COMMENT ON COLUMN "ai_messages"."role" IS 'Emisor';
COMMENT ON COLUMN "ai_messages"."content" IS 'Contenido del mensaje';
COMMENT ON COLUMN "ai_messages"."tool_calls" IS 'Herramientas invocadas (function calling)';
COMMENT ON COLUMN "ai_messages"."created_at" IS 'Momento';
COMMENT ON COLUMN "ai_messages"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "ai_messages"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "ai_messages"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "image_analyses" IS 'Análisis de visión por computador sobre una imagen/video (score corporal, conteo, ID biométrico).';
COMMENT ON COLUMN "image_analyses"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "image_analyses"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "image_analyses"."file_id" IS 'Imagen/video analizado';
COMMENT ON COLUMN "image_analyses"."model_id" IS 'Modelo de visión';
COMMENT ON COLUMN "image_analyses"."analysis_type" IS 'Tipo de análisis';
COMMENT ON COLUMN "image_analyses"."animal_id" IS 'Animal detectado/objetivo';
COMMENT ON COLUMN "image_analyses"."result" IS 'Resultado estructurado';
COMMENT ON COLUMN "image_analyses"."confidence" IS 'Confianza';
COMMENT ON COLUMN "image_analyses"."analyzed_at" IS 'Momento';
COMMENT ON COLUMN "image_analyses"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "image_analyses"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "image_analyses"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "image_analyses"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "marketplace_listings" IS 'Publicación en el marketplace (venta de animales, genética, insumos, servicios).';
COMMENT ON COLUMN "marketplace_listings"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "marketplace_listings"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "marketplace_listings"."company_id" IS 'Empresa vendedora';
COMMENT ON COLUMN "marketplace_listings"."type" IS 'Tipo de oferta';
COMMENT ON COLUMN "marketplace_listings"."title" IS 'Título de la publicación';
COMMENT ON COLUMN "marketplace_listings"."description" IS 'Descripción';
COMMENT ON COLUMN "marketplace_listings"."animal_id" IS 'Animal ofertado (si aplica)';
COMMENT ON COLUMN "marketplace_listings"."semen_batch_id" IS 'Genética ofertada';
COMMENT ON COLUMN "marketplace_listings"."price" IS 'Precio';
COMMENT ON COLUMN "marketplace_listings"."currency" IS 'Moneda';
COMMENT ON COLUMN "marketplace_listings"."location" IS 'Ubicación de la oferta';
COMMENT ON COLUMN "marketplace_listings"."status" IS 'Estado';
COMMENT ON COLUMN "marketplace_listings"."published_at" IS 'Fecha de publicación';
COMMENT ON COLUMN "marketplace_listings"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "marketplace_listings"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "marketplace_listings"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "marketplace_listings"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "marketplace_media" IS 'Fotos/videos de una publicación del marketplace.';
COMMENT ON COLUMN "marketplace_media"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "marketplace_media"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "marketplace_media"."listing_id" IS 'Publicación';
COMMENT ON COLUMN "marketplace_media"."file_id" IS 'Archivo media';
COMMENT ON COLUMN "marketplace_media"."position" IS 'Orden de visualización';
COMMENT ON COLUMN "marketplace_media"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "marketplace_media"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "marketplace_media"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "marketplace_media"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "marketplace_inquiries" IS 'Consulta/oferta de un comprador sobre una publicación.';
COMMENT ON COLUMN "marketplace_inquiries"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "marketplace_inquiries"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "marketplace_inquiries"."listing_id" IS 'Publicación';
COMMENT ON COLUMN "marketplace_inquiries"."from_user_id" IS 'Usuario interesado';
COMMENT ON COLUMN "marketplace_inquiries"."message" IS 'Mensaje';
COMMENT ON COLUMN "marketplace_inquiries"."offer_price" IS 'Precio ofertado';
COMMENT ON COLUMN "marketplace_inquiries"."status" IS 'Estado';
COMMENT ON COLUMN "marketplace_inquiries"."created_at" IS 'Fecha';
COMMENT ON COLUMN "marketplace_inquiries"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "marketplace_inquiries"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "marketplace_inquiries"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "marketplace_transactions" IS 'Transacción cerrada en el marketplace (enlaza con venta/compra).';
COMMENT ON COLUMN "marketplace_transactions"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "marketplace_transactions"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "marketplace_transactions"."listing_id" IS 'Publicación';
COMMENT ON COLUMN "marketplace_transactions"."buyer_company_id" IS 'Empresa compradora';
COMMENT ON COLUMN "marketplace_transactions"."amount" IS 'Monto acordado';
COMMENT ON COLUMN "marketplace_transactions"."currency" IS 'Moneda';
COMMENT ON COLUMN "marketplace_transactions"."sale_id" IS 'Venta contable del vendedor';
COMMENT ON COLUMN "marketplace_transactions"."status" IS 'Estado';
COMMENT ON COLUMN "marketplace_transactions"."closed_at" IS 'Cierre';
COMMENT ON COLUMN "marketplace_transactions"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "marketplace_transactions"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "marketplace_transactions"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "marketplace_transactions"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "courses" IS 'Curso de capacitación (formación de productores/empleados).';
COMMENT ON COLUMN "courses"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "courses"."tenant_id" IS 'NULL = curso público del catálogo; valor = curso propio';
COMMENT ON COLUMN "courses"."title" IS 'Título';
COMMENT ON COLUMN "courses"."description" IS 'Descripción';
COMMENT ON COLUMN "courses"."category" IS 'Categoría (sanidad, reproducción, pasturas, uso de la app)';
COMMENT ON COLUMN "courses"."language" IS 'Idioma';
COMMENT ON COLUMN "courses"."level" IS 'Nivel';
COMMENT ON COLUMN "courses"."is_published" IS 'Publicado';
COMMENT ON COLUMN "courses"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "courses"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "courses"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "courses"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "course_modules" IS 'Módulo/lección dentro de un curso.';
COMMENT ON COLUMN "course_modules"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "course_modules"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "course_modules"."course_id" IS 'Curso';
COMMENT ON COLUMN "course_modules"."title" IS 'Título del módulo';
COMMENT ON COLUMN "course_modules"."content_type" IS 'Tipo de contenido';
COMMENT ON COLUMN "course_modules"."file_id" IS 'Archivo de contenido (video/pdf)';
COMMENT ON COLUMN "course_modules"."body" IS 'Contenido textual';
COMMENT ON COLUMN "course_modules"."position" IS 'Orden';
COMMENT ON COLUMN "course_modules"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "course_modules"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "course_modules"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "course_modules"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "course_enrollments" IS 'Inscripción de un usuario a un curso, con progreso.';
COMMENT ON COLUMN "course_enrollments"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "course_enrollments"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "course_enrollments"."course_id" IS 'Curso';
COMMENT ON COLUMN "course_enrollments"."user_id" IS 'Usuario inscrito';
COMMENT ON COLUMN "course_enrollments"."progress_pct" IS 'Avance (%)';
COMMENT ON COLUMN "course_enrollments"."completed_at" IS 'Finalización';
COMMENT ON COLUMN "course_enrollments"."certificate_document_id" IS 'Certificado emitido';
COMMENT ON COLUMN "course_enrollments"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "course_enrollments"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "course_enrollments"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "course_enrollments"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "sync_devices" IS 'Dispositivo cliente (móvil/tablet) que sincroniza datos offline.';
COMMENT ON COLUMN "sync_devices"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "sync_devices"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "sync_devices"."user_id" IS 'Usuario dueño del dispositivo';
COMMENT ON COLUMN "sync_devices"."platform" IS 'Plataforma';
COMMENT ON COLUMN "sync_devices"."app_version" IS 'Versión de la app';
COMMENT ON COLUMN "sync_devices"."device_name" IS 'Nombre del equipo';
COMMENT ON COLUMN "sync_devices"."last_sync_at" IS 'Última sincronización exitosa';
COMMENT ON COLUMN "sync_devices"."sync_cursor" IS 'Cursor/secuencia del último changeset aplicado';
COMMENT ON COLUMN "sync_devices"."push_token" IS 'Token de notificaciones push';
COMMENT ON COLUMN "sync_devices"."status" IS 'Estado';
COMMENT ON COLUMN "sync_devices"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "sync_devices"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "sync_devices"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "sync_devices"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "sync_changesets" IS 'Paquete de operaciones offline enviado por un dispositivo (unidad de sincronización).';
COMMENT ON COLUMN "sync_changesets"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "sync_changesets"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "sync_changesets"."sync_device_id" IS 'Dispositivo emisor';
COMMENT ON COLUMN "sync_changesets"."seq" IS 'Secuencia local del dispositivo';
COMMENT ON COLUMN "sync_changesets"."hlc" IS 'Reloj lógico híbrido del changeset';
COMMENT ON COLUMN "sync_changesets"."operations" IS 'Lista de operaciones (upsert/delete por entidad)';
COMMENT ON COLUMN "sync_changesets"."status" IS 'Estado de procesamiento';
COMMENT ON COLUMN "sync_changesets"."received_at" IS 'Recepción en el servidor';
COMMENT ON COLUMN "sync_changesets"."applied_at" IS 'Aplicación';
COMMENT ON COLUMN "sync_changesets"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "sync_changesets"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "sync_changesets"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "sync_changesets"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "sync_conflicts" IS 'Conflicto de sincronización que requiere resolución (semántica o manual).';
COMMENT ON COLUMN "sync_conflicts"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "sync_conflicts"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "sync_conflicts"."changeset_id" IS 'Changeset conflictivo';
COMMENT ON COLUMN "sync_conflicts"."entity_type" IS 'Entidad en conflicto';
COMMENT ON COLUMN "sync_conflicts"."entity_id" IS 'ID de la entidad';
COMMENT ON COLUMN "sync_conflicts"."conflict_type" IS 'Tipo de conflicto';
COMMENT ON COLUMN "sync_conflicts"."resolution" IS 'Cómo se resolvió';
COMMENT ON COLUMN "sync_conflicts"."resolved_by" IS 'Quién resolvió (si manual)';
COMMENT ON COLUMN "sync_conflicts"."resolved_at" IS 'Momento de resolución';
COMMENT ON COLUMN "sync_conflicts"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "sync_conflicts"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "sync_conflicts"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "sync_conflicts"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "audit_logs" IS 'Bitácora de auditoría inmutable de acciones sobre datos sensibles y administración.';
COMMENT ON COLUMN "audit_logs"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "audit_logs"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "audit_logs"."user_id" IS 'Actor';
COMMENT ON COLUMN "audit_logs"."action" IS 'Acción (create, update, delete, login, export…)';
COMMENT ON COLUMN "audit_logs"."entity_type" IS 'Entidad afectada';
COMMENT ON COLUMN "audit_logs"."entity_id" IS 'ID de la entidad';
COMMENT ON COLUMN "audit_logs"."changes" IS 'Diff antes/después';
COMMENT ON COLUMN "audit_logs"."ip_address" IS 'IP de origen';
COMMENT ON COLUMN "audit_logs"."user_agent" IS 'Cliente/navegador';
COMMENT ON COLUMN "audit_logs"."occurred_at" IS 'Momento';
COMMENT ON TABLE "system_settings" IS 'Configuración por tenant (clave-valor tipada).';
COMMENT ON COLUMN "system_settings"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "system_settings"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "system_settings"."key" IS 'Clave de configuración';
COMMENT ON COLUMN "system_settings"."value" IS 'Valor';
COMMENT ON COLUMN "system_settings"."scope" IS 'Alcance';
COMMENT ON COLUMN "system_settings"."scope_id" IS 'ID del alcance (empresa/finca)';
COMMENT ON COLUMN "system_settings"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "system_settings"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "system_settings"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "system_settings"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "feature_flags" IS 'Estado de banderas de funcionalidad por tenant.';
COMMENT ON COLUMN "feature_flags"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "feature_flags"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "feature_flags"."flag_key" IS 'Clave de la feature';
COMMENT ON COLUMN "feature_flags"."is_enabled" IS 'Habilitada';
COMMENT ON COLUMN "feature_flags"."rollout_pct" IS 'Porcentaje de despliegue gradual';
COMMENT ON COLUMN "feature_flags"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "feature_flags"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "feature_flags"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "feature_flags"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "webhooks" IS 'Suscripción saliente a eventos para integraciones del tenant.';
COMMENT ON COLUMN "webhooks"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "webhooks"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "webhooks"."url" IS 'Endpoint de destino';
COMMENT ON COLUMN "webhooks"."events" IS 'Eventos suscritos';
COMMENT ON COLUMN "webhooks"."secret" IS 'Secreto HMAC para firmar los envíos';
COMMENT ON COLUMN "webhooks"."is_active" IS 'Activo';
COMMENT ON COLUMN "webhooks"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "webhooks"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "webhooks"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "webhooks"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "webhook_deliveries" IS 'Intento de entrega de un webhook (con reintentos).';
COMMENT ON COLUMN "webhook_deliveries"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "webhook_deliveries"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "webhook_deliveries"."webhook_id" IS 'Webhook';
COMMENT ON COLUMN "webhook_deliveries"."event_type" IS 'Evento entregado';
COMMENT ON COLUMN "webhook_deliveries"."payload" IS 'Cuerpo enviado';
COMMENT ON COLUMN "webhook_deliveries"."response_status" IS 'Código HTTP de respuesta';
COMMENT ON COLUMN "webhook_deliveries"."attempts" IS 'Número de intentos';
COMMENT ON COLUMN "webhook_deliveries"."status" IS 'Estado';
COMMENT ON COLUMN "webhook_deliveries"."delivered_at" IS 'Entrega exitosa';
COMMENT ON COLUMN "webhook_deliveries"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "webhook_deliveries"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "webhook_deliveries"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "webhook_deliveries"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
COMMENT ON TABLE "integrations" IS 'Conexión configurada con un sistema externo (contabilidad, básculas, autoridad).';
COMMENT ON COLUMN "integrations"."id" IS 'Identificador único (UUID; usar UUID v7 vía pg_uuidv7 en producción)';
COMMENT ON COLUMN "integrations"."tenant_id" IS 'Organización propietaria (aislamiento multi-tenant, RLS)';
COMMENT ON COLUMN "integrations"."company_id" IS 'Empresa';
COMMENT ON COLUMN "integrations"."provider" IS 'Proveedor (quickbooks, xero, tru_test, senasa…)';
COMMENT ON COLUMN "integrations"."config" IS 'Configuración (cifrada donde corresponde)';
COMMENT ON COLUMN "integrations"."status" IS 'Estado';
COMMENT ON COLUMN "integrations"."last_sync_at" IS 'Última sincronización';
COMMENT ON COLUMN "integrations"."created_at" IS 'Fecha de creación del registro';
COMMENT ON COLUMN "integrations"."updated_at" IS 'Fecha de última modificación';
COMMENT ON COLUMN "integrations"."created_by" IS 'Usuario que creó el registro';
COMMENT ON COLUMN "integrations"."deleted_at" IS 'Baja lógica (soft delete); NULL = vigente';
