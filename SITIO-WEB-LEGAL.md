# SellPointy — aviso de privacidad y términos

> **ESTADO (2026-09-19): SIN HUECOS — PUBLICABLE.** Carlos decidió operar como
> **persona física con actividad empresarial** (para poder facturar), así que el
> responsable ya no es «SellPointy, S.A. de C.V.» —que era provisional— sino
> **Carlos Hernandez Hernandez**, con «SellPointy» como nombre comercial. Domicilio:
> San Francisco Chilpan, Tultitlán, Estado de México. Jurisdicción: tribunales del
> Estado de México. Correos, que ya EXISTEN (Cloudflare Email Routing → su Gmail):
> `privacy@sellpointy.com` y `contact@sellpointy.com`. Publicado con fecha del
> 19 de septiembre de 2026.
>
> **Dos cosas que cambian con esta decisión y conviene tener presentes:** quien
> responde ahora es Carlos con su patrimonio personal, no una sociedad — la
> cláusula de límite de responsabilidad (T12) es la primera que debería ver un
> abogado —; y el domicilio queda PUBLICADO en el aviso y en el pie de los correos
> comerciales. Si un día se constituye una sociedad, se cambia aquí (P1 y T1) y en
> `apps/api/src/modules/mail/templates/sender-identity.ts`.
>
> **Sigue fuera, a propósito:** una línea sobre facturas (CFDI) en T4. El plazo
> para pedirla lo define Carlos con su contador.
>
> Lo que sigue de esta cabecera es el registro de cómo se preparó el texto; las
> tablas de «datos que solo tú puedes darme» quedaron resueltas.

> **Estado (2026-09-18): texto maestro en español APROBADO por Carlos; inglés y
> francés traducidos de él.** Salida de `F11-SITE-DEF-10`. **No se publica mientras
> quede un `[[hueco]]`** — ver §1.
>
> **DECISIÓN DE CARLOS (2026-09-18): opción C — se publica SIN revisión de un
> abogado.** Se le ofrecieron tres caminos (que un abogado lo redacte, que lo revise,
> o publicar sin revisión) y eligió el tercero, con el riesgo a su cargo.
>
> **Lo que eso significa, dicho sin adornos:** este texto lo escribió un asistente
> de IA con cuidado y con la estructura que piden las leyes que cita, **pero no es
> asesoría legal y nadie con cédula lo ha validado.** Es razonable para arrancar un
> producto pequeño; **no** es un escudo. El día que SellPointy tenga clientes en
> Quebec, un módulo clínico en producción o un conflicto con un cliente, la primera
> hora de un abogado se paga sola. Las tres partes donde un error sale más caro
> están marcadas con 🔴.

## 0. Lo que encontré al prepararlo — y es más grande que el sitio

**La APLICACIÓN no tiene términos ni aviso de privacidad, y el registro no pide
aceptar nada.** Verificado el 2026-09-18: no hay una sola mención de «términos» o
«privacidad» en los textos de `apps/web`, ni un campo de aceptación en el alta.

Eso ya es un hueco hoy, con o sin sitio, por dos razones:

1. **SellPointy ya guarda datos personales:** los de los usuarios de cada negocio y
   —más delicado— **los de los clientes de esos negocios**. En México eso exige un
   aviso de privacidad desde el primer dato.
2. 🔴 **El módulo de Consultorio médico guarda historias clínicas.** Son **datos
   personales sensibles** (LFPDPPP, art. 3), la categoría con más protección: piden
   consentimiento **expreso y por escrito** del paciente, y en México el expediente
   clínico electrónico tiene además su propia norma (NOM-024-SSA3). **Este borrador
   NO cubre eso.** Lo deja fuera a propósito, remitiéndolo a un acuerdo aparte (§T8),
   porque es el punto donde improvisar es más peligroso. **Si ese módulo ya lo usa
   un médico con pacientes reales, esto es lo primero que debería ver un abogado.**

Por eso estos documentos **no son «los del sitio»: son los de SellPointy**, y se
enlazan desde el sitio **y desde el registro de la aplicación**, con una casilla de
aceptación que hoy no existe. Las tareas nuevas están en `IMPLEMENTACION.md`
(`F11-SITE-LEGAL`).

## 1. Los datos que solo tú puedes darme

El texto de abajo tiene `[[huecos]]`. Sin esto no se puede publicar — no por
formalidad: **un aviso de privacidad sin responsable identificado no es un aviso.**

| # | Dato | Para qué |
|---|---|---|
| 1 | ~~¿Quién es el responsable?~~ → **«SellPointy, S.A. de C.V.», PROVISIONAL** (Carlos, 2026-09-18: «por ahora… pero anota que debo cambiarlo») | La ley mexicana exige identificar al responsable |
| 2 | **Domicilio** (puede ser fiscal; ciudad y estado como mínimo) | Ídem; es donde alguien ejerce sus derechos |
| 3 | **Correo para privacidad** — espera al dominio: `privacidad@sellpointy.com` | Por ahí llegan las solicitudes de acceso, corrección y borrado |
| 4 | ~~¿Dónde está el servidor?~~ → **Ciudad de México** (Carlos, 2026-09-18) | La base de datos vive en México; lo que sale del país son el respaldo, los correos y los avisos de error |
| 5 | ~~¿Hay reembolsos?~~ → **No, salvo que el servicio haya estado inutilizable por causa nuestra** (Carlos, 2026-09-18) | Es decisión de negocio, no legal |
| 6 | ~~¿Cuánto se guarda a un prospecto?~~ → **24 meses, y se borra solo** (Carlos, 2026-09-18) | La ley pide no guardar datos «para siempre» |
| 7 | **Ciudad cuyos tribunales aplican** en caso de conflicto | Cláusula de jurisdicción |

> 🔴 **CANDADO DE PUBLICACIÓN — la razón social es provisional.** Carlos pidió poner
> «SellPointy, S.A. de C.V.» **por ahora** y anotar que debe cambiarla. Sirve para
> que el borrador se lea completo; **no sirve para publicar.** Un aviso de privacidad
> que nombra como responsable a una sociedad que no existe —o que no es la que de
> verdad opera el servicio— es peor que un hueco: identifica mal al responsable, que
> es justo lo primero que la ley pide, y deja sin validez a quién obliga el contrato
> de los términos. **Antes de publicar va el nombre REAL:** el de la sociedad ya
> constituida, o el de Carlos como persona física si todavía no hay sociedad. Cada
> aparición está marcada `[[⚠️ PROVISIONAL — cambiar]]` y `F11-SITE-LEGAL-01` no se
> cierra mientras quede una.

Lo que **sí** verifiqué solo, en el código y la infraestructura:

| Proveedor | Para qué | Qué datos ve |
|---|---|---|
| **Vultr** — **Ciudad de México** | El servidor donde vive todo | Todos |
| **Cloudflare R2** — fuera de México | El respaldo nocturno de la base | Todos, cifrados en tránsito. **⚠️ No verifiqué en qué región está el depósito**: se elige al crearlo, y conviene saberlo |
| **Resend** — Estados Unidos | Enviar los correos | Nombre, correo y el contenido del mensaje |
| **Sentry** — Estados Unidos o Unión Europea | Avisar de errores de la aplicación | Datos técnicos del error |

---

## AVISO DE PRIVACIDAD

*Última actualización: 19 de septiembre de 2026*

### P1. Quién es responsable de tus datos

**Carlos Hernandez Hernandez**, persona física con actividad empresarial que opera bajo el nombre
comercial **SellPointy** («**SellPointy**», «nosotros»), con domicilio en
San Francisco Chilpan, Tultitlán, Estado de México, México, es responsable del tratamiento de tus datos personales. Para
cualquier asunto de privacidad escríbenos a privacy@sellpointy.com.

### P2. Qué datos recabamos

**Si nos escribes desde el sitio:** tu nombre, tu correo, tu país, el plan que te
interesa y, si los das, el giro de tu negocio y tu mensaje.

**Si creas una cuenta:** tu nombre, tu correo y tu contraseña (que guardamos
cifrada y no podemos leer), los datos de tu negocio y lo que captures al usar
SellPointy: productos, ventas, compras, existencias, proveedores y los datos de tus
propios clientes.

**Lo que NO recabamos:** no usamos cookies de publicidad ni de seguimiento. Para
saber si el sitio funciona contamos eventos —un clic, un formulario enviado— **sin
guardar tu dirección IP, tu navegador ni nada que te identifique.** No recabamos
datos personales sensibles a través del sitio.

### P3. Para qué los usamos

**Finalidades necesarias** (sin ellas no podemos atenderte): responder a tu
solicitud; crear y operar tu cuenta; cobrar y registrar tus pagos; darte soporte;
avisarte de cambios en el servicio o en estos documentos; y cumplir obligaciones
legales.

**Finalidad opcional:** escribirte sobre novedades de SellPointy. Solo lo hacemos
si lo aceptaste, y **puedes negarte o arrepentirte cuando quieras** escribiendo a
privacy@sellpointy.com o desde el enlace de baja de cada correo. Negarte no
afecta el servicio.

### P4. Con quién los compartimos

**No vendemos ni rentamos tus datos.** **Tu información se guarda en servidores
ubicados en la Ciudad de México.** Para prestarte el servicio nos apoyamos en
proveedores que la tratan por nuestra cuenta y bajo obligación de confidencialidad:
el hospedaje del servidor (Vultr, en México), el respaldo diario de la información
(Cloudflare), el envío de correos (Resend) y el monitoreo de errores de la
aplicación (Sentry). **Estos tres últimos operan fuera de México**, principalmente
en Estados Unidos; al usar SellPointy consientes esa transferencia, que es
necesaria para que el servicio funcione y para que tu información esté respaldada.

También podemos entregarlos cuando una autoridad competente lo exija conforme a la ley.

### P5. 🔴 El catálogo compartido de productos

SellPointy mantiene un catálogo común de **códigos de barras con el nombre del
producto** —el que viene impreso en el empaque— para que cualquier negocio pueda
dar de alta un producto con solo escanearlo. **Cuando escribes el nombre de un
producto cuyo código todavía no está en ese catálogo, ese nombre y su código pueden
incorporarse a él** y sugerírsele a otros negocios.

**Eso es todo lo que se comparte.** No forman parte del catálogo, ni se comparten
jamás: tus precios, tus costos, tus ventas, tus existencias, tus proveedores, tus
clientes ni dato alguno que identifique a tu negocio. El catálogo no dice quién
aportó cada nombre.

### P6. Tus derechos (ARCO)

Puedes **acceder** a tus datos, **rectificarlos**, **cancelarlos** u **oponerte** a
su uso, y revocar tu consentimiento. Escríbenos a privacy@sellpointy.com con tu
nombre, el correo de tu cuenta y qué necesitas. **Te respondemos en un máximo de
20 días hábiles**, y si procede lo hacemos efectivo en los 15 días hábiles
siguientes. Si crees que no te atendimos bien, puedes acudir a la autoridad de
protección de datos de tu país.

### P7. Cuánto tiempo los guardamos

Los datos de tu cuenta, mientras la tengas y el tiempo que la ley fiscal nos
obligue después. Si nos escribiste y nunca creaste una cuenta, **24 meses**, y
después se borran de forma automática.

### P8. Si eres residente de Canadá

Además de lo anterior: solo te escribimos con fines comerciales si diste tu
**consentimiento expreso**, y guardamos cuándo y qué aceptaste; cada correo trae
una forma de darte de baja que atendemos en **10 días hábiles**. La persona
responsable de la protección de los datos personales es Carlos Hernandez Hernandez,
privacy@sellpointy.com. Tus datos pueden tratarse fuera de Canadá y de tu
provincia.

### P9. Menores de edad

SellPointy es para negocios. No está dirigido a menores de 18 años y no recabamos
sus datos a sabiendas.

### P10. Cambios a este aviso

Si lo cambiamos, publicamos la nueva versión aquí con su fecha. Si el cambio es
importante, te avisamos por correo antes de que entre en vigor.

---

## TÉRMINOS Y CONDICIONES

*Última actualización: 19 de septiembre de 2026*

### T1. Qué es esto

Estos términos son el acuerdo entre tú y **Carlos Hernandez Hernandez**, persona física con actividad
empresarial que opera bajo el nombre comercial **SellPointy** («**SellPointy**») para usar el sitio `sellpointy.com` y la aplicación
`app.sellpointy.com` (el «**Servicio**»). **Al crear una cuenta o usar el Servicio
los aceptas.** Si lo usas en nombre de un negocio, declaras que puedes obligarlo.

### T2. El Servicio

SellPointy es una aplicación en línea de punto de venta, inventario y compras. Lo
que incluye depende del plan que contrates, tal como se describe en el sitio al
momento de contratar. Mejoramos el Servicio continuamente: podemos agregar, cambiar
o retirar funciones, y si retiramos una que pagas te avisamos con anticipación.

### T3. Tu cuenta

Eres responsable de lo que se haga con tu cuenta y de mantener tu contraseña en
secreto. Los datos que nos des deben ser verdaderos. Tú decides a quién de tu
equipo le das acceso y con qué permisos. Avísanos de inmediato si crees que alguien
entró sin tu permiso.

### T4. Prueba gratis, planes y pagos

- **Prueba:** al crear tu cuenta tienes **14 días** con todas las funciones, sin
  costo y sin dar una tarjeta.
- **Pago:** los planes se pagan **por adelantado, por transferencia**, cada mes o
  cada año. El pago anual equivale a diez meses. Activamos tu plan cuando
  confirmamos el pago.
- **Si no pagas a tiempo:** tienes **10 días de gracia**. Después tu cuenta pasa a
  un modo limitado de consulta. **No borramos tu información por falta de pago.**
- **Cambios de precio:** te avisamos al menos 30 días antes, y no afectan el
  periodo que ya pagaste.
- **Reembolsos:** los periodos ya pagados **no se reembolsan**, salvo que el Servicio
  haya estado inutilizable por causa nuestra; en ese caso te devolvemos la parte
  proporcional al tiempo afectado. Antes de pagar tuviste 14 días para probarlo
  completo y sin costo.
- **Impuestos:** los precios no incluyen los impuestos que correspondan en tu país,
  salvo que se indique lo contrario.

### T5. Tu información es tuya

**Todo lo que captures en SellPointy es tuyo**: tus productos, precios, ventas,
existencias, proveedores y clientes. Nos das permiso de almacenarlo y procesarlo
**solo para prestarte el Servicio**. No lo vendemos, no lo compartimos y no lo
usamos para nada más, con la única salvedad de la cláusula T6. Puedes exportar tus
reportes cuando quieras.

### T6. 🔴 El catálogo compartido de productos

Para que dar de alta un producto sea tan rápido como escanearlo, SellPointy
mantiene un catálogo común de códigos de barras con su nombre comercial. **Al usar
el Servicio aceptas que el nombre que captures para un código de barras que aún no
esté en ese catálogo pueda incorporarse a él** y sugerirse a otros usuarios, sin
atribución y sin costo. Esa autorización es permanente respecto de los nombres ya
incorporados, **y se limita a eso**: el código de barras y el nombre del producto,
que son datos públicos impresos en su empaque. Nada más de tu negocio entra a ese
catálogo.

### T7. Los datos personales de TUS clientes

Si capturas datos de tus clientes o empleados, **tú eres el responsable de esos
datos** ante ellos y ante la ley —incluido tener tu propio aviso de privacidad— y
SellPointy actúa solo como **encargado**, tratándolos por tu cuenta y conforme a
tus instrucciones. Nos comprometemos a mantenerlos confidenciales, a protegerlos
con medidas razonables y a no usarlos para fines propios.

### T8. 🔴 Módulos a la medida

Los módulos hechos a la medida —como Recepción o Consultorio médico— se rigen por
un **acuerdo por separado**, que prevalece sobre estos términos en lo que difiera.
En particular, **el tratamiento de datos de salud no está cubierto por este
documento**: requiere ese acuerdo, y es responsabilidad de quien los capture cumplir
las normas sanitarias y de protección de datos de su país.

### T9. Uso aceptable

No puedes usar SellPointy para algo ilegal; intentar entrar a cuentas o datos
ajenos; interferir con el Servicio o sobrecargarlo; copiarlo, revenderlo o hacerle
ingeniería inversa; ni capturar contenido que infrinja derechos de otros. Podemos
suspender una cuenta que lo haga.

### T10. Disponibilidad y respaldos

Trabajamos para que el Servicio esté siempre disponible y respaldamos tu
información todos los días. Aun así, **se ofrece «tal cual»**: no garantizamos que
nunca falle ni que esté libre de errores. Puede haber interrupciones por
mantenimiento o por causas fuera de nuestro control.

### T11. Propiedad intelectual

El software, la marca y el diseño de SellPointy son nuestros. Estos términos te dan
un derecho de uso mientras tengas una cuenta activa, no la propiedad de nada de eso.
Tu información es tuya (T5).

### T12. 🔴 Límite de responsabilidad

Hasta donde la ley lo permita: SellPointy no responde por ganancias no obtenidas,
pérdida de datos ni daños indirectos derivados del uso del Servicio; y nuestra
responsabilidad total se limita a **lo que nos hayas pagado en los 12 meses
anteriores** al hecho que la origine. SellPointy es una herramienta de gestión: **no
sustituye a tu contador** ni te releva de tus obligaciones fiscales, y los impuestos
que configura son un punto de partida que debes verificar.

### T13. Terminar

Puedes dejar de usar SellPointy cuando quieras. Nosotros podemos suspender o cerrar
una cuenta que incumpla estos términos. Al cerrar tu cuenta puedes pedirnos que
**borremos tu información**; lo hacemos salvo lo que la ley nos obligue a conservar.

### T14. Cambios a estos términos

Podemos actualizarlos. Si el cambio es importante te avisamos por correo al menos
15 días antes. Seguir usando el Servicio después significa que los aceptas.

### T15. Ley aplicable

Estos términos se rigen por las leyes de **México**. Cualquier controversia se
somete a los tribunales del Estado de México, salvo que la ley de protección al
consumidor de tu país te dé un derecho que no pueda renunciarse.

### T16. Contacto

contact@sellpointy.com

---

# ENGLISH — `/en-us/` and `/en-ca/`

> Translated from the Spanish master. **Spanish is the governing version**; this
> one exists so English-speaking customers can read what they are agreeing to.
> The product terms match the app in English (*receipt*, *quotes*, *My plan*).

## PRIVACY NOTICE

*Last updated: September 19, 2026*

**P1. Who is responsible for your data.** **Carlos Hernandez Hernandez**, an individual doing business as **SellPointy** (“**SellPointy**”, “we”), located
at San Francisco Chilpan, Tultitlán, State of Mexico, Mexico, is responsible for processing your personal data. For any privacy
matter, write to privacy@sellpointy.com.

**P2. What we collect.** *If you write to us from the website:* your name, email,
country, the plan you are interested in and, if you provide them, your type of
business and your message. *If you create an account:* your name, email and
password (stored encrypted; we cannot read it), your business details, and what you
enter while using SellPointy: products, sales, purchases, stock, suppliers and your
own customers' details. *What we do NOT collect:* we use no advertising or tracking
cookies. To learn whether the website works we count events — a click, a form sent —
**without storing your IP address, your browser or anything that identifies you.**
We collect no sensitive personal data through the website.

**P3. What we use it for.** *Necessary purposes:* answering your request; creating
and running your account; billing and recording your payments; supporting you;
telling you about changes to the service or to these documents; and meeting legal
obligations. *Optional purpose:* writing to you about SellPointy news. We only do so
if you agreed, and **you can refuse or change your mind at any time** by writing to
privacy@sellpointy.com or using the unsubscribe link in each email. Refusing does not
affect the service.

**P4. Who we share it with.** **We do not sell or rent your data.** **Your
information is stored on servers located in Mexico City.** To provide the service we
rely on providers that process it on our behalf and under a duty of confidentiality:
server hosting (Vultr, in Mexico), daily backups (Cloudflare), email delivery
(Resend) and application error monitoring (Sentry). **The last three operate outside
Mexico**, mainly in the United States; by using SellPointy you consent to that
transfer, which is necessary for the service to work and for your information to be
backed up. We may also disclose data when a competent authority lawfully requires it.

**P5. 🔴 The shared product catalog.** SellPointy maintains a common catalog of
**barcodes with the product name** — the one printed on the package — so any business
can add a product just by scanning it. **When you type the name of a product whose
barcode is not yet in that catalog, that name and its barcode may be added to it**
and suggested to other businesses. **That is all that is shared.** Never part of the
catalog, and never shared: your prices, costs, sales, stock, suppliers, customers, or
anything that identifies your business. The catalog does not say who contributed
each name.

**P6. Your rights.** You may **access** your data, **correct** it, **delete** it or
**object** to its use, and withdraw your consent. Write to privacy@sellpointy.com with
your name, your account email and what you need. **We reply within 20 business
days**, and where the request applies we carry it out within the following 15
business days. If you feel we did not handle it properly, you may contact the data
protection authority in your country.

**P7. How long we keep it.** Your account data, for as long as you have the account
and for as long afterwards as tax law requires. If you wrote to us and never created
an account, **24 months**, after which it is deleted automatically.

**P8. If you live in Canada.** In addition: we only send you commercial messages if
you gave your **express consent**, and we keep a record of when and what you agreed
to; every email includes a way to unsubscribe, which we honor within **10 business
days**. The person responsible for the protection of personal information is
Carlos Hernandez Hernandez, privacy@sellpointy.com. Your data may be processed outside Canada and
outside your province.

**P9. Minors.** SellPointy is for businesses. It is not directed at anyone under 18,
and we do not knowingly collect their data.

**P10. Changes.** If we change this notice we publish the new version here with its
date. If the change is significant, we tell you by email before it takes effect.

## TERMS AND CONDITIONS

*Last updated: September 19, 2026*

**T1. What this is.** These terms are the agreement between you and **Carlos Hernandez Hernandez**, an individual doing
business as **SellPointy** (“**SellPointy**”) for using the website `sellpointy.com` and the application
`app.sellpointy.com` (the “**Service**”). **By creating an account or using the
Service you accept them.** If you use it on behalf of a business, you confirm you can
bind it.

**T2. The Service.** SellPointy is an online application for point of sale,
inventory and purchasing. What it includes depends on the plan you choose, as
described on the website when you sign up. We improve the Service continuously: we
may add, change or remove features, and if we remove one you pay for, we give you
advance notice.

**T3. Your account.** You are responsible for what is done with your account and for
keeping your password secret. The information you give us must be true. You decide
who on your team gets access and with what permissions. Tell us right away if you
think someone got in without your permission.

**T4. Free trial, plans and payments.** *Trial:* when you create your account you get
**14 days** with every feature, at no cost and without giving a card. *Payment:*
plans are paid **in advance, by bank transfer**, monthly or yearly; the yearly price
equals ten months. We activate your plan once we confirm the payment. *If you don't
pay on time:* you have a **10-day grace period**, after which your account moves to a
limited, read-only mode. **We do not delete your information for non-payment.**
*Price changes:* we tell you at least 30 days ahead, and they never affect a period
you already paid for. *Refunds:* periods already paid for are **not refunded**, unless
the Service was unusable because of us; in that case we refund the share
corresponding to the time affected. Before paying, you had 14 days to try it in full
at no cost. *Taxes:* prices do not include any taxes that apply in your country,
unless stated otherwise.

**T5. Your information is yours.** **Everything you enter in SellPointy is yours**:
your products, prices, sales, stock, suppliers and customers. You give us permission
to store and process it **only to provide the Service**. We do not sell it, share it
or use it for anything else, with the sole exception of clause T6. You can export
your reports whenever you want.

**T6. 🔴 The shared product catalog.** To make adding a product as fast as scanning
it, SellPointy maintains a common catalog of barcodes with their trade name. **By
using the Service you agree that the name you enter for a barcode not yet in that
catalog may be added to it** and suggested to other users, without attribution and at
no cost. That permission is permanent for names already added, **and it is limited to
that**: the barcode and the product name, which are public information printed on its
package. Nothing else from your business enters that catalog.

**T7. Your customers' personal data.** If you enter data about your customers or
employees, **you are responsible for that data** to them and under the law —
including having your own privacy notice — and SellPointy acts only as a
**processor**, handling it on your behalf and on your instructions. We commit to
keeping it confidential, protecting it with reasonable measures and not using it for
our own purposes.

**T8. 🔴 Custom modules.** Custom-built modules — such as Reception or Medical
practice — are governed by a **separate agreement**, which prevails over these terms
wherever they differ. In particular, **the processing of health data is not covered
by this document**: it requires that agreement, and whoever enters such data is
responsible for complying with the health and data-protection rules of their country.

**T9. Acceptable use.** You may not use SellPointy for anything illegal; try to
access other people's accounts or data; interfere with or overload the Service; copy,
resell or reverse-engineer it; or enter content that infringes someone else's rights.
We may suspend an account that does.

**T10. Availability and backups.** We work to keep the Service available at all times
and we back up your information every day. Even so, **it is provided “as is”**: we do
not guarantee it will never fail or be free of errors. There may be interruptions for
maintenance or for reasons beyond our control.

**T11. Intellectual property.** SellPointy's software, brand and design are ours.
These terms give you a right to use them while your account is active, not ownership
of any of it. Your information is yours (T5).

**T12. 🔴 Limitation of liability.** To the extent the law allows: SellPointy is not
liable for lost profits, loss of data or indirect damages arising from use of the
Service; and our total liability is limited to **what you paid us in the 12 months
before** the event giving rise to it. SellPointy is a management tool: **it does not
replace your accountant** or relieve you of your tax obligations, and the taxes it
sets up are a starting point that you must verify.

**T13. Ending.** You may stop using SellPointy whenever you want. We may suspend or
close an account that breaches these terms. When you close your account you may ask
us to **delete your information**; we do so except for what the law requires us to keep.

**T14. Changes to these terms.** We may update them. If the change is significant we
tell you by email at least 15 days ahead. Continuing to use the Service afterwards
means you accept them.

**T15. Governing law.** These terms are governed by the laws of **Mexico**. Any
dispute is submitted to the courts of the State of Mexico, unless the consumer protection law
of your country gives you a right that cannot be waived.

**T16. Contact.** contact@sellpointy.com

---

# FRANÇAIS — `/fr-ca/`

> Traduit du texte maître en espagnol, en **français neutre** et au « vous »
> (décision de Carlos). **La version espagnole fait foi.** La Loi 25 du Québec exige
> que cet avis existe en français **avec la même qualité** que dans les autres
> langues : c'est la raison d'être de cette section.

## POLITIQUE DE CONFIDENTIALITÉ

*Dernière mise à jour : 19 septembre 2026*

**P1. Qui est responsable de vos données.** **Carlos Hernandez Hernandez**, personne physique exerçant une activité commerciale sous le nom
commercial **SellPointy** (« **SellPointy** », « nous »),
dont l'adresse est San Francisco Chilpan, Tultitlán, État de Mexico, Mexique, est responsable du traitement de vos données
personnelles. Pour toute question relative à la confidentialité, écrivez à
privacy@sellpointy.com.

**P2. Les données que nous recueillons.** *Si vous nous écrivez depuis le site :*
votre nom, votre courriel, votre pays, le forfait qui vous intéresse et, si vous les
indiquez, votre type de commerce et votre message. *Si vous créez un compte :* votre
nom, votre courriel et votre mot de passe (conservé chiffré, nous ne pouvons pas le
lire), les renseignements de votre commerce et ce que vous saisissez en utilisant
SellPointy : produits, ventes, achats, stocks, fournisseurs et les données de vos
propres clients. *Ce que nous ne recueillons PAS :* nous n'utilisons aucun témoin
publicitaire ni de suivi. Pour savoir si le site fonctionne, nous comptons des
événements — un clic, un formulaire envoyé — **sans conserver votre adresse IP, votre
navigateur ni aucun élément permettant de vous identifier.** Nous ne recueillons
aucune donnée personnelle sensible par l'intermédiaire du site.

**P3. À quoi elles servent.** *Finalités nécessaires :* répondre à votre demande ;
créer et exploiter votre compte ; facturer et enregistrer vos paiements ; vous
assister ; vous informer des changements apportés au service ou à ces documents ; et
respecter nos obligations légales. *Finalité facultative :* vous écrire au sujet des
nouveautés de SellPointy. Nous ne le faisons que si vous l'avez accepté, et **vous
pouvez refuser ou changer d'avis à tout moment** en écrivant à
privacy@sellpointy.com ou au moyen du lien de désabonnement de chaque
courriel. Un refus n'a aucune incidence sur le service.

**P4. Avec qui nous les partageons.** **Nous ne vendons ni ne louons vos données.**
**Vos informations sont conservées sur des serveurs situés à Mexico.** Pour fournir
le service, nous faisons appel à des fournisseurs qui les traitent pour notre compte
et sous obligation de confidentialité : l'hébergement du serveur (Vultr, au
Mexique), la sauvegarde quotidienne (Cloudflare), l'envoi des courriels (Resend) et
la surveillance des erreurs de l'application (Sentry). **Ces trois derniers exercent
leurs activités hors du Mexique**, principalement aux États-Unis ; en utilisant
SellPointy, vous consentez à ce transfert, nécessaire au fonctionnement du service et
à la sauvegarde de vos informations. Nous pouvons aussi communiquer des données
lorsqu'une autorité compétente l'exige conformément à la loi.

**P5. 🔴 Le catalogue de produits partagé.** SellPointy tient un catalogue commun de
**codes-barres accompagnés du nom du produit** — celui qui est imprimé sur
l'emballage — afin que tout commerce puisse ajouter un produit simplement en le
scannant. **Lorsque vous saisissez le nom d'un produit dont le code-barres ne figure
pas encore dans ce catalogue, ce nom et son code-barres peuvent y être ajoutés** et
proposés à d'autres commerces. **C'est tout ce qui est partagé.** Ne font jamais
partie du catalogue, et ne sont jamais partagés : vos prix, vos coûts, vos ventes,
vos stocks, vos fournisseurs, vos clients, ni aucun élément permettant d'identifier
votre commerce. Le catalogue n'indique pas qui a fourni chaque nom.

**P6. Vos droits.** Vous pouvez **accéder** à vos données, les **rectifier**, les
**supprimer** ou vous **opposer** à leur utilisation, et retirer votre consentement.
Écrivez à privacy@sellpointy.com en indiquant votre nom, le courriel de
votre compte et votre demande. **Nous répondons dans un délai de 20 jours
ouvrables** et, si la demande est recevable, nous y donnons suite dans les 15 jours
ouvrables suivants. Si vous estimez que votre demande n'a pas été traitée
correctement, vous pouvez vous adresser à l'autorité de protection des données de
votre pays.

**P7. Durée de conservation.** Les données de votre compte, tant que vous le
conservez et aussi longtemps que la législation fiscale l'exige par la suite. Si vous
nous avez écrit sans jamais créer de compte, **24 mois**, après quoi elles sont
supprimées automatiquement.

**P8. Si vous résidez au Canada.** En plus de ce qui précède : nous ne vous envoyons
des messages commerciaux que si vous avez donné votre **consentement exprès**, et
nous conservons la trace de la date et de l'objet de ce consentement ; chaque
courriel comporte un moyen de se désabonner, que nous respectons dans un délai de
**10 jours ouvrables**. La personne responsable de la protection des renseignements
personnels est Carlos Hernandez Hernandez, privacy@sellpointy.com. Vos données peuvent être
traitées à l'extérieur du Canada et de votre province.

**P9. Mineurs.** SellPointy s'adresse aux commerces. Il n'est pas destiné aux
personnes de moins de 18 ans et nous ne recueillons pas sciemment leurs données.

**P10. Modifications.** Si nous modifions cette politique, nous publions ici la
nouvelle version avec sa date. Si le changement est important, nous vous en informons
par courriel avant son entrée en vigueur.

## CONDITIONS GÉNÉRALES

*Dernière mise à jour : 19 septembre 2026*

**T1. Objet.** Les présentes conditions constituent l'accord entre vous et **Carlos Hernandez Hernandez**, personne physique
exerçant une activité commerciale sous le nom commercial **SellPointy** (« **SellPointy** ») pour l'utilisation du site `sellpointy.com` et de l'application
`app.sellpointy.com` (le « **Service** »). **En créant un compte ou en utilisant le
Service, vous les acceptez.** Si vous l'utilisez au nom d'un commerce, vous déclarez
avoir le pouvoir de l'engager.

**T2. Le Service.** SellPointy est une application en ligne de point de vente, de
gestion des stocks et d'achats. Son contenu dépend du forfait choisi, tel que décrit
sur le site au moment de la souscription. Nous améliorons le Service en continu :
nous pouvons ajouter, modifier ou retirer des fonctions, et si nous en retirons une
que vous payez, nous vous en avisons à l'avance.

**T3. Votre compte.** Vous êtes responsable de l'utilisation de votre compte et de la
confidentialité de votre mot de passe. Les renseignements fournis doivent être
exacts. Vous décidez qui, dans votre équipe, y a accès et avec quelles permissions.
Informez-nous sans délai si vous pensez que quelqu'un y a accédé sans votre autorisation.

**T4. Essai gratuit, forfaits et paiements.** *Essai :* à la création de votre compte,
vous disposez de **14 jours** avec toutes les fonctionnalités, sans frais et sans
fournir de carte. *Paiement :* les forfaits se paient **d'avance, par virement
bancaire**, au mois ou à l'année ; le prix annuel équivaut à dix mois. Nous activons
votre forfait dès confirmation du paiement. *En cas de retard :* vous disposez d'un
**délai de grâce de 10 jours**, après quoi votre compte passe en mode limité, en
consultation seule. **Nous ne supprimons pas vos informations pour défaut de
paiement.** *Changements de prix :* nous vous en informons au moins 30 jours à
l'avance, et ils ne touchent jamais une période déjà payée. *Remboursements :* les
périodes déjà payées **ne sont pas remboursées**, sauf si le Service a été
inutilisable par notre faute ; dans ce cas, nous remboursons la part correspondant à
la durée touchée. Avant de payer, vous avez eu 14 jours pour l'essayer en entier,
sans frais. *Taxes :* les prix n'incluent pas les taxes applicables dans votre pays,
sauf indication contraire.

**T5. Vos informations vous appartiennent.** **Tout ce que vous saisissez dans
SellPointy vous appartient** : vos produits, prix, ventes, stocks, fournisseurs et
clients. Vous nous autorisez à les conserver et à les traiter **uniquement pour
fournir le Service**. Nous ne les vendons pas, ne les partageons pas et ne les
utilisons à aucune autre fin, à la seule exception de la clause T6. Vous pouvez
exporter vos rapports à tout moment.

**T6. 🔴 Le catalogue de produits partagé.** Pour qu'ajouter un produit soit aussi
rapide que de le scanner, SellPointy tient un catalogue commun de codes-barres avec
leur nom commercial. **En utilisant le Service, vous acceptez que le nom saisi pour
un code-barres ne figurant pas encore dans ce catalogue puisse y être ajouté** et
proposé à d'autres utilisateurs, sans attribution et sans frais. Cette autorisation
est permanente pour les noms déjà ajoutés, **et elle se limite à cela** : le
code-barres et le nom du produit, qui sont des renseignements publics imprimés sur
son emballage. Rien d'autre de votre commerce n'entre dans ce catalogue.

**T7. Les données personnelles de VOS clients.** Si vous saisissez des données sur
vos clients ou vos employés, **vous êtes responsable de ces données** envers eux et
devant la loi — y compris pour disposer de votre propre politique de
confidentialité — et SellPointy n'agit qu'à titre de **sous-traitant**, en les
traitant pour votre compte et selon vos instructions. Nous nous engageons à les
garder confidentielles, à les protéger par des mesures raisonnables et à ne pas les
utiliser à nos propres fins.

**T8. 🔴 Modules sur mesure.** Les modules conçus sur mesure — comme Réception ou
Cabinet médical — sont régis par un **accord distinct**, qui prévaut sur les
présentes conditions en cas de divergence. En particulier, **le traitement de données
de santé n'est pas couvert par ce document** : il exige cet accord, et la personne
qui saisit ces données est responsable du respect des règles sanitaires et de
protection des données de son pays.

**T9. Utilisation acceptable.** Vous ne pouvez pas utiliser SellPointy à des fins
illégales ; tenter d'accéder aux comptes ou aux données d'autrui ; perturber ou
surcharger le Service ; le copier, le revendre ou en faire l'ingénierie inverse ; ni
saisir un contenu portant atteinte aux droits d'autrui. Nous pouvons suspendre un
compte qui le fait.

**T10. Disponibilité et sauvegardes.** Nous faisons en sorte que le Service soit
toujours accessible et nous sauvegardons vos informations chaque jour. Néanmoins,
**il est fourni « tel quel »** : nous ne garantissons pas qu'il ne tombera jamais en
panne ni qu'il sera exempt d'erreurs. Des interruptions peuvent survenir pour
maintenance ou pour des raisons indépendantes de notre volonté.

**T11. Propriété intellectuelle.** Le logiciel, la marque et le design de SellPointy
nous appartiennent. Les présentes conditions vous accordent un droit d'utilisation
tant que votre compte est actif, et non la propriété de ces éléments. Vos
informations vous appartiennent (T5).

**T12. 🔴 Limitation de responsabilité.** Dans la mesure permise par la loi :
SellPointy ne répond pas des pertes de profits, des pertes de données ni des dommages
indirects découlant de l'utilisation du Service ; et notre responsabilité totale se
limite à **ce que vous nous avez payé au cours des 12 mois précédant** le fait
générateur. SellPointy est un outil de gestion : **il ne remplace pas votre
comptable** et ne vous dégage pas de vos obligations fiscales, et les taxes qu'il
configure sont un point de départ que vous devez vérifier.

**T13. Fin de l'utilisation.** Vous pouvez cesser d'utiliser SellPointy à tout moment.
Nous pouvons suspendre ou fermer un compte qui enfreint ces conditions. À la
fermeture de votre compte, vous pouvez nous demander de **supprimer vos
informations** ; nous le faisons, sauf pour ce que la loi nous oblige à conserver.

**T14. Modifications.** Nous pouvons mettre ces conditions à jour. Si le changement
est important, nous vous en informons par courriel au moins 15 jours à l'avance.
Continuer d'utiliser le Service par la suite signifie que vous les acceptez.

**T15. Droit applicable.** Les présentes conditions sont régies par les lois du
**Mexique**. Tout litige est soumis aux tribunaux de l'État de Mexico, sauf si la loi sur
la protection du consommateur de votre pays vous accorde un droit auquel il est
impossible de renoncer.

**T16. Contact.** contact@sellpointy.com

---

## Lo que cada ley exige, y dónde quedó

| Ley | Exige | Dónde |
|---|---|---|
| **LFPDPPP** (México) | Responsable y domicilio | P1 |
| | Datos que se recaban; si hay sensibles | P2 |
| | Finalidades, separando necesarias de opcionales | P3 |
| | Transferencias | P4, P5 |
| | Medio para derechos ARCO y para revocar | P6 |
| | Cómo se avisan los cambios | P10 |
| **CASL** (Canadá) | Consentimiento expreso, registrado | P8 + la casilla del formulario, nunca marcada |
| | Identificar al remitente y forma de baja | P8 + pie de cada correo |
| **Ley 25** (Quebec) | Responsable de datos nombrado | P8 |
| | Aviso de transferencia fuera de la provincia | P8 |
| | El aviso, **en francés y de la misma calidad** | ✅ Sección FRANÇAIS, completa y con las mismas cláusulas |

## Lo que este borrador NO resuelve

1. 🔴 **Los datos de salud del módulo de Consultorio.** Fuera de alcance a propósito (§0, T8).
2. 🔴 **Si en Quebec se puede vender una aplicación que no está en francés.** Sin
   abogado, la pregunta sigue abierta. **Lo prudente, y lo que recomiendo: que
   `/fr-ca/` salga DESPUÉS de las otras cuatro versiones**, cuando el francés esté en
   la aplicación — que tú mismo dijiste que viene. Publicar antes es el riesgo más
   evitable de todo el sitio.
3. **La facturación fiscal.** Estos términos no tocan CFDI ni facturas.
4. **Que el límite de responsabilidad (T12) aguante ante un juez.** Las leyes de
   consumo de cada país pueden recortarlo; es una cláusula estándar, no una garantía.
