# Servicios a Contratar — SellPoint

> **TL;DR:** para poner SellPoint en producción para los 2 clientes iniciales necesitás contratar HOY **2 servicios de pago** (Hetzner + dominio) y **2 gratuitos** (Cloudflare, GitHub). Total: **~$7-8 USD/mes + ~$10 USD/año de dominio**. Todo lo demás se contrata por fase, cuando el plan lo pida.
>
> Decisiones de respaldo: Bitácora 2026-08-03 (`decision/deploy-vultr`, `decision/storage-imagenes-r2` en engram). Este doc es el resumen operativo — si diverge de la Bitácora, manda la Bitácora.

---

## 1. Contratar AHORA (para F0-DEPLOY)

| # | Servicio | Plan exacto | Costo | Para qué |
|---|----------|-------------|-------|----------|
| 1 | **Hetzner Cloud** | **CPX11** (2 vCPU AMD / 2GB), región **Ashburn, VA (us-east)**, Ubuntu LTS | **~$6-7/mes** (IPv4 incl.) | El servidor: API + Web + Postgres + Redis en Docker Compose. Un solo server para TODOS los clientes (multi-tenant). ~50-70ms desde CDMX — aceptable; si en producción real el POS se siente pesado, migrar a Vultr HF CDMX (~$12, ~15ms) es cuestión de horas: stack 100% portable (Compose + GHCR + pg_dump) |
| 2 | **Dominio** | `.com` en Cloudflare Registrar (precio de costo) o Namecheap | **~$10/año** (~$1/mes) | HTTPS obligatorio (Web Bluetooth y cámara del POS lo exigen) |
| 3 | **Cloudflare** | Plan **Free** + **R2** habilitado | **$0/mes** | DNS del dominio + R2 para backups nocturnos de Postgres (10GB gratis). ⚠️ R2 pide tarjeta para habilitarse, pero el free tier es real |
| 4 | **GitHub** | Plan Free (ya lo tenés) | **$0/mes** | Repo + GHCR (registry de imágenes Docker) + Actions (2,000 min/mes gratis alcanzan de sobra para CI+deploy) |

**Total mensual hoy: ~$7-8 USD** (≈ $130-145 MXN). Contra referencia: la EC2 dada de baja costaba $17.11/mes sin poder correr el stack.

### Checklist de contratación (en orden)

- [ ] Crear cuenta Hetzner (https://accounts.hetzner.com/signUp — puede pedir verificación de identidad, es normal) → server CPX11 en Ashburn, Ubuntu LTS, con SSH key desde el inicio
- [ ] Comprar dominio → apuntar DNS a Cloudflare (plan Free)
- [ ] En Cloudflare: habilitar R2 → crear bucket `sellpoint-backups`
- [ ] A record del dominio → IP del VPS
- [ ] Con eso, arranca el módulo F0-DEPLOY del plan (13 tareas)

---

## 2. Se contrata DESPUÉS, por fase (no adelantar)

| Fase | Servicio | Plan | Costo estimado | Trigger |
|------|----------|------|----------------|---------|
| F2-PROD | **Cloudflare R2** (bucket adicional `sellpoint-images`) | mismo free tier | **$0** (catálogos de 2 clientes ≈ 1-2GB, el free tier da 10GB) | Upload de imágenes de productos |
| F5 | **Hetzner resize** (o migración a Vultr CDMX si la latencia ya molestaba) | CPX21 (3 vCPU / 4GB) | ~el doble del CPX11 (confirmar en consola) | Workers de BullMQ (exportaciones) o +clientes |
| F6 | **Sentry** | Free tier (5k errores/mes) | **$0** | Monitoreo de errores en prod |
| F7 | **Stripe** | Sin mensualidad | **% por transacción** (México: ~3.6% + $3 MXN por cargo) | Billing/suscripciones del SaaS |

**Sin decidir aún** (se decide en su fase, NO contratar): gestor de secretos F6 (sops/age gratis vs Infisical), destino de logs F6 (Loki self-hosted = $0 en el mismo VPS), email transaccional para F1-AUTH (reset de password — se evalúa al llegar).

---

## 3. Reglas de oro del presupuesto

1. **Un server, N clientes**: los clientes nuevos NO agregan costo de infra hasta que el volumen pida el resize — y para entonces ya hay ingresos que lo pagan.
2. **Nada de egress caro**: R2 sirve imágenes con egress $0. Nunca contratar S3/almacenamiento que cobre por descarga para contenido público.
3. **El backup no es opcional**: pg_dump nocturno a R2 desde el día 1 (F0-DEPLOY-13). Los snapshots del proveedor NO lo reemplazan — como mucho, snapshot manual antes de un cambio riesgoso.
4. **Cada servicio nuevo entra por la Bitácora**: si un módulo pide contratar algo que no está acá, primero decisión (engram + Bitácora), después tarjeta.

---

*Actualizado: 2026-08-04. Precios aproximados en USD — confirmar en el checkout de cada proveedor.*
