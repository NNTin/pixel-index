-- #63: a distinguishable audit action for POST /api/v1/admin/backup/import,
-- rather than a bulk restore silently recording as 'layout.create'/'layout.replace'.
ALTER TYPE "public"."audit_action" ADD VALUE 'layout.import' BEFORE 'report.create';