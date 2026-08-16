# SellPoint — Diagramas de Flujo

> Flujos críticos del sistema en notación Mermaid. Cada diagrama representa la secuencia exacta de pasos entre actores y sistemas.

> **Tip:** los diagramas Mermaid se renderizan automáticamente en GitHub, GitLab, VS Code (con extensión) y herramientas como Notion/Obsidian.

---

## Tabla de Contenidos

1. [Autenticación](#1-autenticación)
2. [Onboarding de Tenant](#2-onboarding-de-tenant)
3. [Gestión de Campos de Catálogo](#3-gestión-de-campos-de-catálogo)
4. [Creación de Producto](#4-creación-de-producto)
5. [Movimientos de Inventario](#5-movimientos-de-inventario)
6. [Venta en POS](#6-venta-en-pos)
7. [Inventario Físico](#7-inventario-físico)
8. [Generación de Reporte](#8-generación-de-reporte)
9. [Multi-Tenancy en Cada Request](#9-multi-tenancy-en-cada-request)

---

## 1. Autenticación

### 1.1 Login + Refresh Token Rotativo

```mermaid
sequenceDiagram
    autonumber
    actor U as Usuario
    participant F as Frontend (React)
    participant A as API (NestJS)
    participant R as Redis
    participant DB as PostgreSQL

    U->>F: Ingresa email + password
    F->>A: POST /auth/login { email, password }
    A->>DB: SELECT user WHERE email
    DB-->>A: user (con hash Argon2id)
    A->>A: argon2.verify(password, hash)

    alt Credenciales inválidas
        A-->>F: 401 Unauthorized
        F-->>U: "Credenciales incorrectas"
    else Credenciales válidas
        A->>A: Genera JWT access (15min) + refresh (7d)
        A->>R: SET refresh_token_id (familia)
        A->>DB: UPDATE user SET last_login = NOW()
        A-->>F: { accessToken } + Set-Cookie: refresh_token (httpOnly, Secure, SameSite=Strict)
        F->>F: Guarda accessToken en memoria (Zustand)
        F-->>U: Redirige a /dashboard
    end

    Note over F,A: Más tarde, accessToken expira (15 min)

    F->>A: GET /api/products (con accessToken expirado)
    A-->>F: 401 token_expired
    F->>A: POST /auth/refresh (cookie refresh enviada automáticamente)
    A->>R: GET refresh_token_id
    R-->>A: token válido

    A->>A: Rota refresh token (invalida anterior, crea nuevo)
    A->>R: SET nuevo refresh + revoca anterior

    alt Refresh ya rotado (reuse detectado)
        A->>R: Invalida TODA la familia de tokens
        A-->>F: 401 token_compromised
        F-->>U: Logout forzado
    else Refresh válido
        A-->>F: { accessToken nuevo } + Set-Cookie: nuevo refresh
        F->>A: Reintenta GET /api/products con nuevo accessToken
        A-->>F: 200 OK + data
    end
```

### 1.2 Logout

```mermaid
sequenceDiagram
    autonumber
    actor U as Usuario
    participant F as Frontend
    participant A as API
    participant R as Redis

    U->>F: Click "Cerrar sesión"
    F->>A: POST /auth/logout (con cookie refresh)
    A->>R: DEL refresh_token + marca revocado (TTL = remaining)
    A-->>F: 204 + Clear-Cookie: refresh_token
    F->>F: Limpia accessToken de memoria
    F-->>U: Redirige a /login
```

---

## 2. Onboarding de Tenant

```mermaid
flowchart TD
    Start([Visitante en /register]) --> FormReg[Llena formulario:<br/>nombre negocio, email, password]
    FormReg --> ValidatePwd{Password<br/>fuerte?}
    ValidatePwd -->|No| ShowReq[Muestra checklist<br/>requisitos]
    ShowReq --> FormReg
    ValidatePwd -->|Sí| EmailUnique{Email único?}
    EmailUnique -->|No| GenericMsg[Respuesta genérica<br/>'Si existe, recibirás email']
    EmailUnique -->|Sí| CreateUnverified[Crea tenant + user<br/>estado: no_verificado]
    CreateUnverified --> SendVerify[Envía email<br/>verificación 24h]
    SendVerify --> WaitClick[Usuario abre<br/>link de verificación]
    WaitClick --> Verify{Token válido<br/>y no expirado?}
    Verify -->|No| Resend[Opción de reenviar]
    Verify -->|Sí| ActivateUser[Marca user como verificado<br/>Asigna rol TenantAdmin]
    ActivateUser --> Wizard{Wizard de<br/>onboarding}

    Wizard --> Step1[Paso 1: Datos del negocio<br/>razón social, RFC, dirección, TZ]
    Step1 --> Step2[Paso 2: Plantilla schema<br/>Farmacia / Ferretería / Abarrotes / Custom]
    Step2 --> Step3[Paso 3: Crear primer almacén]
    Step3 --> Step4[Paso 4 opcional:<br/>Invitar usuarios]
    Step4 --> Done[Tenant marcado<br/>onboarded = true]
    Done --> Dashboard([Redirige a /dashboard])

    style Start fill:#e3f2fd
    style Dashboard fill:#c8e6c9
    style GenericMsg fill:#fff9c4
```

---

## 3. Gestión de Campos de Catálogo

> **Reescrito en la atomización de F2 (2026-08-16):** el flujo previo de versionado
> (publicar v2, migrar/forzar, `schema_drift`, Ajv) quedó **diferido** — decisión de
> Carlos: editor simple con guardas. Ver ARQUITECTURA § 3.3 y CU-CAT-01.

```mermaid
sequenceDiagram
    autonumber
    actor A as TenantAdmin
    participant F as Frontend
    participant API as API
    participant DB as PostgreSQL

    A->>F: Va a Catálogo → Schema
    F->>API: GET /catalogs (y campos del elegido)
    API->>DB: SELECT catalogs / catalog_fields WHERE tenant_id (RLS)
    API-->>F: catálogos + campos (estándar fijos + personalizados)
    F-->>A: Muestra editor

    A->>F: Agrega campo (etiqueta, tipo Texto/Numérico/Lookup, requerido)
    F->>API: POST /catalogs/:id/fields
    API->>API: key única por catálogo · lookup exige catálogo destino vivo
    API->>DB: INSERT catalog_field
    API-->>F: 201 — el form dinámico ya lo incluye

    A->>F: Quita un campo
    F->>API: DELETE /catalogs/:id/fields/:fieldId
    alt El campo tiene datos
        API-->>F: 409 { requiresConfirmation, count: N }
        F-->>A: "N registros tienen este campo.<br/>Se ocultará, no se borra."
        A->>F: Confirma
        F->>API: DELETE ... { confirm: true }
        API->>DB: UPDATE is_archived = true (valores intactos, restaurable)
    else Sin datos
        API->>DB: DELETE catalog_field
    end

    A->>F: Intenta cambiar el tipo de un campo con datos
    F-->>A: Bloqueado (motivo visible) — 409 en el API si lo fuerza
```

---

## 4. Creación de Producto

```mermaid
flowchart LR
    Start([Manager en<br/>Catálogo → Productos]) --> Click[Click 'Nuevo producto']
    Click --> LoadSchema[Frontend lee los campos<br/>del catálogo de productos]
    LoadSchema --> RenderForm[Renderiza formulario:<br/>campos estándar + dinámicos]
    RenderForm --> Fill[Manager completa campos]
    Fill --> Submit[Submit]
    Submit --> ValidateFront{Validación<br/>frontend Zod}
    ValidateFront -->|Fallo| ShowError1[Marca campos con error]
    ShowError1 --> Fill
    ValidateFront -->|OK| SendAPI[POST /products]

    SendAPI --> ValidateDTO{ZodValidationPipe<br/>DTO en NestJS}
    ValidateDTO -->|Fallo| Return400a[400 Bad Request]
    ValidateDTO -->|OK| LoadSchemaBack[Lee catalog_fields del<br/>catálogo de productos]
    LoadSchemaBack --> ValidateFields{Validador derivado<br/>de los campos}
    ValidateFields -->|Fallo| Return400b[400 con errores<br/>por campo]
    ValidateFields -->|OK| CheckSKU{SKU único<br/>en el tenant?}
    CheckSKU -->|No| Return409[409 Conflict]
    CheckSKU -->|OK| Insert[INSERT product + presentación<br/>base «Unidad ×1» con precio/costo<br/>stock = 0]
    Insert --> AuditLog[Audit log entry]
    AuditLog --> Return201[201 Created]
    Return201 --> SuccessUI[Toast 'Producto creado']
    SuccessUI --> End([Lista actualizada])

    style Start fill:#e3f2fd
    style End fill:#c8e6c9
    style Return400a fill:#ffcdd2
    style Return400b fill:#ffcdd2
    style Return409 fill:#ffcdd2
```

---

## 5. Movimientos de Inventario

### 5.1 Entrada Directa (transacción atómica, cualquier motivo)

```mermaid
sequenceDiagram
    autonumber
    actor M as Manager
    participant F as Frontend
    participant API as API
    participant DB as PostgreSQL

    M->>F: Va a Movimientos → Nueva Entrada Directa
    F->>API: GET /warehouses
    API-->>F: lista de almacenes (filtrada por scope)
    M->>F: Selecciona almacén destino
    M->>F: Elige motivo (invoice, adjustment, transfer, customer_return, production)

    alt motivo = invoice
        M->>F: Completa proveedor + costos por línea
    else motivo = transfer
        M->>F: Selecciona almacén origen<br/>(opcional: folio del Transfer)
        F->>API: GET /transfers/:folio/lines
        API-->>F: líneas pre-cargadas
    else otro motivo
        M->>F: Completa autorizador + nota explicativa
    end

    M->>F: Escanea código + ingresa cantidad
    F->>API: GET /products?barcode=XXX
    API-->>F: producto encontrado
    F->>F: Agrega línea al carrito

    Note over M,F: Repite para N productos

    M->>F: Click "Confirmar"
    F->>API: POST /inventory/entries<br/>{ warehouse, reason_code, reason_note,<br/>linked_warehouse_id?, transfer_id?, lines[] }

    API->>DB: BEGIN TRANSACTION

    loop por cada línea
        API->>DB: SELECT product (lock for update)
        API->>DB: INSERT stock_movement<br/>(direction='entry', reason_code, reason_note,<br/>linked_warehouse_id, transfer_id)
        API->>DB: UPDATE stock_by_warehouse<br/>SET quantity += línea.quantity
    end

    opt reason_code = 'transfer' y hay transfer_id
        API->>DB: UPDATE transfers<br/>SET status='completed', received_at=NOW()
    end

    API->>DB: INSERT audit_log
    API->>DB: COMMIT

    alt Fallo en transacción
        API->>DB: ROLLBACK
        API-->>F: 500 Internal Error
        F-->>M: "Error, volvé a intentar"
    else Éxito
        API-->>F: 201 { movementId }
        F-->>M: "Entrada confirmada"
    end
```

### 5.2 Salida Directa (transacción atómica, cualquier motivo)

```mermaid
sequenceDiagram
    autonumber
    actor M as Manager
    participant F as Frontend
    participant API as API
    participant DB as PostgreSQL

    M->>F: Va a Movimientos → Nueva Salida Directa
    M->>F: Selecciona almacén origen
    M->>F: Elige motivo (adjustment, transfer, loss, consumption, expired)

    alt motivo = transfer
        M->>F: Selecciona almacén destino
    else otro motivo
        M->>F: Completa autorizador + nota explicativa
    end

    M->>F: Agrega productos y cantidades
    M->>F: Click "Confirmar"
    F->>API: POST /inventory/exits<br/>{ warehouse, reason_code, reason_note,<br/>linked_warehouse_id?, lines[] }

    API->>DB: BEGIN TRANSACTION
    API->>DB: SELECT stock_by_warehouse FOR UPDATE
    API->>API: Valida stock suficiente por línea

    alt Stock insuficiente
        API->>DB: ROLLBACK
        API-->>F: 422 { product, available, requested }
        F-->>M: "Sin stock: producto X tiene Y disponibles"
    else Stock OK
        loop por cada línea
            API->>DB: INSERT stock_movement<br/>(direction='exit', reason_code, reason_note,<br/>linked_warehouse_id)
            API->>DB: UPDATE stock_by_warehouse<br/>SET quantity -= línea.quantity
        end

        opt reason_code = 'transfer'
            API->>DB: INSERT INTO transfers<br/>(origin, destination, status='in_transit',<br/>lines, created_by, created_at)
            Note over API,DB: Stock queda EN TRÁNSITO<br/>hasta confirmación del destino
        end

        API->>DB: INSERT audit_log
        API->>DB: COMMIT
        API-->>F: 201 { movementId, transferId? }
        F-->>M: "Salida confirmada"
    end
```

### 5.3 Traspaso entre Almacenes (proceso de 2 pasos con confirmación)

```mermaid
flowchart TD
    Start([Origen: Manager crea<br/>Salida Directa motivo=transfer]) --> A1[Selecciona almacén origen<br/>y almacén destino]
    A1 --> A2[Agrega productos y cantidades]
    A2 --> A3{Stock suficiente<br/>en origen?}
    A3 -->|No| A4[Bloquea confirmación<br/>con detalle del faltante]
    A4 --> A2
    A3 -->|Sí| A5[Confirma]
    A5 --> A6[TX: resta stock origen<br/>INSERT stock_movement direction=exit reason=transfer<br/>INSERT transfers status=in_transit<br/>linked_warehouse_id=destino]
    A6 --> Transit([📦 Stock EN TRÁNSITO<br/>visible en reportes y en<br/>vista 'Traspasos en tránsito'])

    Transit --> B1[Destino: Manager va a<br/>Movimientos → Traspasos en tránsito<br/>tab 'Pendientes de recibir']
    B1 --> B2[Selecciona el Transfer]
    B2 --> B3[Sistema carga líneas con<br/>cantidades enviadas]
    B3 --> B4[Verifica cantidades<br/>realmente recibidas]
    B4 --> B5{Cantidad recibida<br/>vs enviada?}
    B5 -->|Iguales| B6[Confirma 'sin diferencia']
    B5 -->|Menor| B7[Pide nota explicativa<br/>obligatoria sobre el faltante]
    B5 -->|Mayor| B8[❌ BLOQUEADO<br/>'Registrar excedente como<br/>Entrada Directa motivo ajuste']
    B8 --> B4
    B7 --> B6
    B6 --> B9[TX: suma stock destino con cantidades RECIBIDAS<br/>INSERT stock_movement direction=entry reason=transfer<br/>UPDATE transfers status=completed<br/>received_by, received_at<br/>discrepancies si hubo faltante]
    B9 --> Done([✅ Traspaso completado<br/>Ciclo cerrado, discrepancia auditada])

    Cancel{{Caso edge:<br/>traspaso nunca llega<br/>robo o pérdida total}}
    Transit -.-> Cancel
    Cancel -.-> CancelOk[TenantAdmin cancela<br/>Transfer status=canceled<br/>Stock NO retorna automáticamente<br/>queda como pérdida del origen<br/>hasta ajuste explícito]

    style Start fill:#fff3e0
    style Transit fill:#fff9c4
    style Done fill:#c8e6c9
    style Cancel fill:#ffcdd2
    style B8 fill:#ffcdd2
```

---

## 6. Venta en POS

```mermaid
sequenceDiagram
    autonumber
    actor S as POS_Seller
    participant F as Frontend (PWA)
    participant C as Cámara/Escáner
    participant API as API
    participant DB as PostgreSQL
    participant P as Impresora ESC/POS

    S->>F: Abre POS
    F->>API: GET /pos/session (turno actual)
    API-->>F: { sessionId, openedAt }

    S->>C: Escanea código de barras
    C-->>F: barcode = "7501..."
    F->>API: GET /products?barcode=7501...
    API-->>F: { producto, stock_disponible }

    alt Sin stock
        F-->>S: ⚠️ "Sin stock disponible"
    else Con stock
        F->>F: Agrega al carrito (Zustand)
        F-->>S: Muestra producto en carrito
    end

    Note over S,F: Repite escaneo para N productos

    S->>F: Click "Cobrar"
    F-->>S: Muestra modal de pago
    S->>F: Selecciona método (efectivo/tarjeta/transfer)
    S->>F: Ingresa monto recibido (si efectivo)
    F-->>S: Calcula vuelto
    S->>F: Confirma

    F->>API: POST /pos/sales { items, payment, sessionId }
    API->>DB: BEGIN TRANSACTION

    loop por cada item
        API->>DB: SELECT product FOR UPDATE
        alt Stock insuficiente (concurrencia)
            API->>DB: ROLLBACK
            API-->>F: 409 stock_changed
            F-->>S: "Otro vendedor descontó stock, revisa"
        end
    end

    API->>DB: INSERT sale + sale_items
    API->>DB: UPDATE product_stock<br/>(resta cantidades vendidas)
    API->>DB: INSERT stock_movements tipo='salida_venta'
    API->>DB: INSERT audit_log
    API->>DB: COMMIT
    API-->>F: 201 { saleId, ticket }

    alt Impresora USB/Red (desktop)
        F->>F: window.print() con CSS @page 58/80mm
        F-->>P: ESC/POS via diálogo nativo
    else Impresora Bluetooth (mobile/tablet)
        F->>F: Genera buffer ESC/POS<br/>(escpos-buffer)
        F->>P: Web Bluetooth API → write characteristic
    end

    P-->>S: Ticket impreso
    F->>F: Limpia carrito, listo para siguiente venta
```

---

## 7. Inventario Físico

```mermaid
flowchart TD
    Start([Manager: Movimientos →<br/>Inventario Físico → Nuevo]) --> SelWh[Selecciona almacén]
    SelWh --> Lock[Sistema bloquea<br/>movimientos sobre almacén]
    Lock --> Template[Descarga plantilla Excel:<br/>código, lote, caducidad,<br/>cantidad, ubicación]
    Template --> Count[Equipo cuenta físicamente<br/>llena el Excel]
    Count --> Upload[Sube archivo]

    Upload --> ParseFile{Parseo OK?}
    ParseFile -->|No| Errors[Muestra errores<br/>por fila]
    Errors --> Count
    ParseFile -->|Sí| Reconcile[Sistema compara:<br/>stock teórico vs contado]

    Reconcile --> Diff{Hay<br/>diferencias?}
    Diff -->|No| AutoOk[Aprueba automático]
    Diff -->|Sí| ShowReport[Muestra reporte<br/>de discrepancias]
    ShowReport --> Review[Manager revisa<br/>y aprueba o cancela]
    Review --> Approve{Aprueba?}
    Approve -->|No| Cancel([Cancela conteo])
    Approve -->|Sí| AutoOk

    AutoOk --> TX[TX atómica:<br/>1. Salida total stock teórico<br/>2. Entrada total stock contado<br/>3. Registra discrepancias en audit log]
    TX --> Unlock[Desbloquea almacén]
    Unlock --> Done([Inventario reconciliado])

    style Start fill:#e3f2fd
    style Done fill:#c8e6c9
    style Cancel fill:#ffcdd2
```

---

## 8. Generación de Reporte

```mermaid
sequenceDiagram
    autonumber
    actor V as Viewer
    participant F as Frontend
    participant API as API
    participant Q as Cola (Redis)
    participant W as Worker
    participant DB as PostgreSQL
    participant S3 as S3

    V->>F: Reportes → Stock por almacén
    V->>F: Aplica filtros
    F->>API: GET /reports/stock?warehouse=X&page=1

    alt Reporte ligero (<10k rows)
        API->>DB: SELECT con paginación
        DB-->>API: rows
        API-->>F: { data, total, page }
        F-->>V: Tabla server-side paginada
    else Reporte pesado (>10k rows o export)
        V->>F: Click "Exportar Excel"
        F->>API: POST /reports/stock/export
        API->>Q: Encola job { tenantId, userId, filters }
        API-->>F: 202 { jobId }
        F-->>V: "Generando, te avisamos"

        Q->>W: Procesa job
        W->>DB: SELECT (sin paginación)
        DB-->>W: full dataset
        W->>W: Genera .xlsx (exceljs)
        W->>S3: PUT report-{jobId}.xlsx<br/>(URL firmada, expira 1h)
        W->>API: Notifica completado (WebSocket o polling)
        API-->>F: Push notification + signed URL
        F-->>V: "Listo, descargar"
        V->>S3: Descarga vía URL firmada
    end
```

---

## 9. Multi-Tenancy en Cada Request

```mermaid
sequenceDiagram
    autonumber
    actor U as Usuario
    participant F as Frontend
    participant N as Nginx
    participant A as NestJS App
    participant MW as TenantMiddleware
    participant G as JwtAuthGuard
    participant P as PrismaService
    participant DB as PostgreSQL (RLS)

    U->>F: Click "Ver productos"
    F->>N: GET /api/products<br/>Authorization: Bearer accessToken
    N->>A: Forwarded request
    A->>G: JwtAuthGuard.canActivate()
    G->>G: Verifica firma JWT (RS256)
    G->>G: Extrae payload: { userId, tenantId, permissions }
    G-->>A: req.user = payload

    A->>MW: TenantContextMiddleware.use()
    MW->>P: PrismaService - obtiene conexión
    MW->>DB: SELECT set_config('app.tenant_id', $tenantId, true)
    DB-->>MW: OK (variable de sesión seteada)
    MW-->>A: next()

    A->>A: Controller: ProductsController.findAll()
    A->>P: prisma.product.findMany()
    P->>DB: SELECT * FROM products
    Note over DB: RLS aplica policy:<br/>WHERE tenant_id = current_setting('app.tenant_id')
    DB-->>P: SOLO productos del tenant actual
    P-->>A: products[]
    A-->>N: 200 { data: products }
    N-->>F: Response
    F-->>U: Muestra solo SUS productos

    Note over DB: Aunque el dev escriba<br/>SELECT * sin filtro,<br/>Postgres filtra automáticamente.<br/>IMPOSIBLE filtrar datos.
```

---

*Diagramas Mermaid de SellPoint. Editar este archivo regenera automáticamente las visualizaciones en GitHub y la mayoría de editores.*
