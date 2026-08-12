-- F1-RBAC / gate W3 del verify de f1-auth: el catálogo GLOBAL de permisos
-- vivía solo en prisma/seed.ts, un script manual que producción nunca corre.
-- Consecuencia real medida en prod: `permissions` con 0 filas →
-- TenantsService.provision() crea los roles del tenant nuevo pero sin
-- permisos que asignarles → todo JWT nace con permissions:[] y su dueño no
-- puede hacer nada.
--
-- Como data migration, el job `migrate` del pipeline lo aplica solo en cada
-- entorno. ON CONFLICT DO NOTHING la hace idempotente y no pisa
-- descripciones editadas a mano.
--
-- Alcance MÍNIMO de F1 (F1-RBAC-03/04/05 del tablero: CRUD de usuarios,
-- CRUD de roles, lectura de catálogo de permisos) — deliberadamente NO
-- incluye codes de módulos futuros (products/inventory/pos/reports) que
-- `prisma/seed.ts` sí trae para el tenant Demo de desarrollo. Esa
-- divergencia es aceptada por diseño: `role-catalog.ts`
-- (`resolveRolePermissionCodes`) construye cada rol a partir de lo que
-- EXISTA en el catálogo de cada entorno — un rol sin permisos porque su
-- módulo no se sembró todavía es degradación esperada, no un bug. Cuando
-- F2/F3 aterricen, su propia migración data-only agrega sus codes acá,
-- mismo patrón.
INSERT INTO permissions (code, module, description) VALUES
  ('users:read',   'users', 'Ver usuarios'),
  ('users:manage', 'users', 'Crear, editar, suspender usuarios'),
  ('roles:read',   'roles', 'Ver roles y permisos'),
  ('roles:manage', 'roles', 'Crear y editar roles')
ON CONFLICT (code) DO NOTHING;
