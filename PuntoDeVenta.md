# Proyecto: Sistema de Control de Inventarios y Punto de Venta (POS)

## 1. Descripción General
Desarrollo de un sistema web integral para la gestión de inventarios y ventas, diseñado bajo una arquitectura API-First para permitir una futura expansión a aplicaciones móviles nativas, operando inicialmente como una Progressive Web App (PWA).

## 2. Requerimientos Funcionales
### 2.1. Gestión de Usuarios y Seguridad
* **Autenticación:** Sistema de Login seguro con JWT (JSON Web Tokens).
* **Roles:** Diferenciación entre administradores (Backoffice) y vendedores (POS).
* **Seguridad:** Encriptación de contraseñas y middleware de protección de rutas.

### 2.2. Catálogo de Productos (Backoffice)
* **Gestión CRUD:** Administración completa de productos, precios y categorías.
* **Control de Stock:** Configuración de stock mínimo y alertas de bajo inventario.
* **Atributos:** Soporte para códigos de barras, SKUs e imágenes.

### 2.3. Control de Inventarios
* **Movimientos:** Registro automatizado de entradas (compras/devoluciones) y salidas (ventas/mermas).
* **Inventario Cíclico:** Módulo de auditoría para conteo físico aleatorio o por categorías con reporte de discrepancias automático.
* **Historial:** Trazabilidad total de cada producto (Kardex).

### 2.4. Punto de Venta (POS)
* **Interfaz PWA:** Diseño optimizado para móviles y tablets, instalable desde el navegador.
* **Venta Rápida:** Carrito de compras con búsqueda predictiva y escaneo de códigos de barras mediante la cámara.
* **Transacciones:** Procesamiento de pagos y actualización de inventario en tiempo real mediante transacciones atómicas de base de datos.

### 2.5. Impresión de Tickets
* **Formato ESC/POS:** Generación de tickets optimizados para papel térmico (58mm/80mm).
* **Conectividad:** * **PC:** Impresión vía USB o Red mediante el diálogo nativo del navegador.
    * **Móvil:** Impresión directa vía Web Bluetooth API o integración con apps puente (como RawBT).

## 3. Requerimientos Técnicos e Infraestructura
### 3.1. Tecnologías Propuestas
* **Backend:** Node.js con TypeScript (Express o NestJS).
* **Frontend:** React (Vite) con Tailwind CSS.
* **Base de Datos:** PostgreSQL para garantizar integridad referencial.

### 3.2. Despliegue en AWS
* **Servidor:** AWS EC2 (Ubuntu) gestionado con Docker y Docker Compose.
* **Proxy/SSL:** Nginx con certificado SSL de Let's Encrypt (indispensable para activar funciones de hardware en el navegador).
* **Persistencia:** Backups automáticos de la base de datos PostgreSQL.

## 4. Requerimientos de Movilidad
* **Capacidades PWA:** Archivo manifest, service workers para caché y funcionamiento offline, e icono de acceso directo.
* **Hardware:** Acceso a cámara para escaneo y Bluetooth para periféricos.

---
*Documento de requerimientos iniciales generado automáticamente.*
