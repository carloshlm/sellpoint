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
   clínico electrónico tiene además su propia norma (NOM-024-SSA3). La primera
   versión (2026-09-19) lo dejó fuera, remitiéndolo a un «acuerdo aparte» que nunca
   se escribió. **Desde el 2026-09-21 ese acuerdo existe: es el Anexo A (A1–A11),
   dentro de los Términos.** Reparte las obligaciones —el médico es el responsable,
   SellPointy el encargado— y dice con honestidad que SellPointy NO está certificado
   conforme a la NOM-024 (A6). **Un texto no sustituye a esa certificación: sigue
   PENDIENTE, y sigue siendo lo primero que debería ver un abogado.**

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

*Última actualización: 21 de septiembre de 2026*

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

### P3. Los datos que nuestros clientes capturan sobre otras personas

Los negocios que usan SellPointy capturan datos de sus propios clientes,
empleados, proveedores y —en el módulo de Consultorio médico— pacientes. **De esos
datos el responsable es ese negocio o ese profesional, no SellPointy**: nosotros
solo los guardamos y los procesamos por su cuenta, como encargado, y no los usamos
para nada propio.

Si eres cliente o paciente de alguien que usa SellPointy y quieres ver, corregir o
borrar tus datos, **pídeselo a ese negocio o a ese profesional**: es quien decide
sobre ellos y quien tiene su propio aviso de privacidad. Si nos escribes a
nosotros, le hacemos llegar tu solicitud.

### P4. Para qué los usamos

**Finalidades necesarias** (sin ellas no podemos atenderte): responder a tu
solicitud; crear y operar tu cuenta; cobrar y registrar tus pagos; darte soporte;
avisarte de cambios en el servicio o en estos documentos; y cumplir obligaciones
legales.

**Finalidad opcional:** escribirte sobre novedades de SellPointy. Solo lo hacemos
si lo aceptaste, y **puedes negarte o arrepentirte cuando quieras** escribiendo a
privacy@sellpointy.com o desde el enlace de baja de cada correo. Negarte no
afecta el servicio.

### P5. Con quién los compartimos

**No vendemos ni rentamos tus datos.** **Tu información se guarda en servidores
ubicados en la Ciudad de México.** Para prestarte el servicio nos apoyamos en
proveedores que la tratan por nuestra cuenta y bajo obligación de confidencialidad:
el hospedaje del servidor (Vultr, en México), el respaldo diario de la información
(Cloudflare), el envío de correos (Resend) y el monitoreo de errores de la
aplicación (Sentry). **Estos tres últimos operan fuera de México**, principalmente
en Estados Unidos; al usar SellPointy consientes esa transferencia, que es
necesaria para que el servicio funcione y para que tu información esté respaldada.

También podemos entregarlos cuando una autoridad competente lo exija conforme a la ley.

### P6. 🔴 El catálogo compartido de productos

SellPointy mantiene un catálogo común de **códigos de barras con el nombre del
producto** —el que viene impreso en el empaque— para que cualquier negocio pueda
dar de alta un producto con solo escanearlo. **Cuando escribes el nombre de un
producto cuyo código todavía no está en ese catálogo, ese nombre y su código pueden
incorporarse a él** y sugerírsele a otros negocios.

**Eso es todo lo que se comparte.** No forman parte del catálogo, ni se comparten
jamás: tus precios, tus costos, tus ventas, tus existencias, tus proveedores, tus
clientes ni dato alguno que identifique a tu negocio. El catálogo no dice quién
aportó cada nombre.

### P7. Tus derechos (ARCO)

Puedes **acceder** a tus datos, **rectificarlos**, **cancelarlos** u **oponerte** a
su uso, y revocar tu consentimiento. Escríbenos a privacy@sellpointy.com con tu
nombre, el correo de tu cuenta y qué necesitas. **Te respondemos en un máximo de
20 días hábiles**, y si procede lo hacemos efectivo en los 15 días hábiles
siguientes. Si crees que no te atendimos bien, puedes acudir a la autoridad de
protección de datos de tu país.

### P8. Cuánto tiempo los guardamos

Los datos de tu cuenta, mientras la tengas y el tiempo que la ley fiscal nos
obligue después. Si nos escribiste y nunca creaste una cuenta, **24 meses**, y
después se borran de forma automática.

### P9. Si eres residente de Canadá

Además de lo anterior: solo te escribimos con fines comerciales si diste tu
**consentimiento expreso**, y guardamos cuándo y qué aceptaste; cada correo trae
una forma de darte de baja que atendemos en **10 días hábiles**. La persona
responsable de la protección de los datos personales es Carlos Hernandez Hernandez,
privacy@sellpointy.com. Tus datos pueden tratarse fuera de Canadá y de tu
provincia.

### P10. Menores de edad

SellPointy es para negocios. No está dirigido a menores de 18 años y no recabamos
sus datos a sabiendas.

### P11. Cambios a este aviso

Si lo cambiamos, publicamos la nueva versión aquí con su fecha. Si el cambio es
importante, te avisamos por correo antes de que entre en vigor.

---

## TÉRMINOS Y CONDICIONES

*Última actualización: 21 de septiembre de 2026*

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

### T5. Tu información es tuya, y es tu responsabilidad

**Todo lo que captures en SellPointy es tuyo**: tus productos, precios, ventas,
existencias, proveedores, clientes y cualquier otro registro. Nos das permiso de
almacenarlo y procesarlo **solo para prestarte el Servicio**. No lo vendemos, no lo
compartimos y no lo usamos para nada más, con la única salvedad de la cláusula T6.
Puedes exportar tus reportes cuando quieras.

Por lo mismo, **tú eres el único responsable de esa información**: de que sea
verdadera y esté completa, de tener derecho a capturarla, y del uso que tú y las
personas a las que les des acceso hagan de ella. SellPointy no revisa, valida ni
corrige lo que capturas, y no responde por las decisiones que tomes con base en
ello.

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

Si capturas datos de tus clientes, pacientes, proveedores o empleados, **tú eres el
responsable de esos datos** ante ellos y ante la ley, y SellPointy actúa solo como
**encargado**: los trata por tu cuenta y conforme a tus instrucciones, que son usar
el Servicio como está construido.

**Lo que te toca a ti:** tener tu propio aviso de privacidad y dárselo a esas
personas; obtener su consentimiento cuando la ley lo pida, y en la forma en que lo
pida; atender sus solicitudes de acceso, rectificación, cancelación y oposición; y
capturar solo los datos que de verdad necesitas.

**Lo que nos toca a nosotros:** mantener esos datos confidenciales; protegerlos con
medidas de seguridad administrativas, técnicas y físicas razonables; no usarlos
para fines propios; usar proveedores de infraestructura (como el alojamiento) que
queden obligados a lo mismo; avisarte sin demora injustificada si sabemos de una
vulneración que los afecte; y, si una de esas personas nos escribe a nosotros,
remitirte su solicitud para que la atiendas.

### T8. Tus usuarios y sus accesos

Tú decides quién entra a tu cuenta y qué puede ver. Eres responsable de lo que
haga cada persona a la que le des acceso, de que cada quien use su propio usuario
y no uno compartido, de cuidar las contraseñas y de **quitar el acceso a quien
deje de trabajar contigo**. Lo que se haga con un usuario de tu cuenta se entiende
hecho por ti.

### T9. 🔴 Módulos especializados

Algunos módulos —como Recepción o Consultorio médico— sirven para actividades que
tienen sus propias leyes. Esos módulos se rigen, **además de estas cláusulas, por
su Anexo**, que forma parte de estos términos y prevalece en lo que difiera. Si tu
actividad está regulada, **cumplir esa regulación es tu responsabilidad**, no de
SellPointy: nosotros te damos una herramienta de registro, no asesoría legal,
fiscal, médica ni de ningún otro tipo.

### T10. Uso aceptable

No puedes usar SellPointy para algo ilegal; intentar entrar a cuentas o datos
ajenos; interferir con el Servicio o sobrecargarlo; copiarlo, revenderlo o hacerle
ingeniería inversa; ni capturar contenido que infrinja derechos de otros. Podemos
suspender una cuenta que lo haga.

Tampoco puedes capturar datos que no tengas derecho a tener, ni **guardar datos de
salud u otros datos sensibles fuera de un módulo hecho para eso** (por ejemplo, en
las notas de una venta o en la ficha de un cliente del punto de venta).

### T11. Disponibilidad y respaldos

Trabajamos para que el Servicio esté siempre disponible y respaldamos tu
información todos los días. Aun así, **se ofrece «tal cual»**: no garantizamos que
nunca falle ni que esté libre de errores. Puede haber interrupciones por
mantenimiento o por causas fuera de nuestro control.

### T12. Propiedad intelectual

El software, la marca y el diseño de SellPointy son nuestros. Estos términos te dan
un derecho de uso mientras tengas una cuenta activa, no la propiedad de nada de eso.
Tu información es tuya (T5).

### T13. 🔴 Límite de responsabilidad

Hasta donde la ley lo permita: SellPointy no responde por ganancias no obtenidas,
pérdida de datos ni daños indirectos derivados del uso del Servicio; y nuestra
responsabilidad total se limita a **lo que nos hayas pagado en los 12 meses
anteriores** al hecho que la origine. SellPointy es una herramienta de gestión: **no
sustituye a tu contador** ni te releva de tus obligaciones fiscales, y los impuestos
que configura son un punto de partida que debes verificar.

SellPointy tampoco sustituye a tu abogado ni a ningún otro profesional. Nada de lo
que el Servicio muestra, calcula o imprime es una recomendación profesional.

### T14. 🔴 Si alguien nos reclama por tu información

Si un tercero —un cliente tuyo, un paciente, un empleado, una autoridad— nos
reclama, nos demanda o nos sanciona por la información que capturaste, por el uso
que le diste o porque incumpliste una ley que te tocaba cumplir a ti, **tú te haces
cargo**: nos sacas en paz y a salvo y cubres los gastos razonables que eso nos
cause, incluidos los de defensa. Esto no aplica a lo que sea culpa nuestra.

### T15. Terminar

Puedes dejar de usar SellPointy cuando quieras. Nosotros podemos suspender o cerrar
una cuenta que incumpla estos términos. **Antes de cerrar tu cuenta, exporta lo que
necesites conservar**: si la ley te obliga a guardar ciertos registros, esa
obligación es tuya y sigue contigo aunque ya no uses el Servicio.

Al cerrar tu cuenta dejamos de usar tu información y puedes pedirnos que la
**borremos**; lo hacemos salvo lo que la ley nos obligue a conservar, que mantenemos
bloqueado —sin usarlo y sin que nadie entre a la cuenta— durante ese plazo, y
después lo eliminamos.

### T16. Cambios a estos términos

Podemos actualizarlos. Si el cambio es importante te avisamos por correo al menos
15 días antes. Seguir usando el Servicio después significa que los aceptas.

### T17. Ley aplicable

Estos términos se rigen por las leyes de **México**. Cualquier controversia se
somete a los tribunales del Estado de México, salvo que la ley de protección al
consumidor de tu país te dé un derecho que no pueda renunciarse.

### T18. Contacto

contact@sellpointy.com

### A1. Anexo A — Módulo de Consultorio médico (México)

Este Anexo forma parte de estos términos. Aplica a quien use el módulo de
Consultorio médico, que se ofrece solo en México. En lo que difiera de las
cláusulas anteriores, manda este Anexo.

### A2. Qué es este módulo, y qué no es

Es una **herramienta de registro** para tu consulta: expedientes, notas, recetas,
órdenes y el cobro de lo que atiendes. **No es un dispositivo médico.** No
diagnostica, no recomienda tratamientos y **no verifica dosis, interacciones,
alergias ni contraindicaciones**. Todo lo que quede escrito en un expediente, en una
receta o en una orden es una decisión profesional tuya, no del sistema.

### A3. Quién puede usarlo

Solo profesionales de la salud que puedan ejercer legalmente en México, y el
personal que trabaje bajo su responsabilidad. **Tú garantizas** que cada persona
que atienda pacientes con tu cuenta tiene su título y su cédula profesional
vigentes, y que los datos profesionales que captures son verdaderos.

### A4. Los datos de tus pacientes son datos sensibles, y tú eres el responsable

Los datos de salud son **datos personales sensibles**, la categoría que la ley de
protección de datos personales más protege. Frente a tus pacientes y frente a la
autoridad, **el responsable de esos datos eres tú**; SellPointy es solo el
encargado (cláusula T7). Eso quiere decir que, **antes de capturar el primer dato
de un paciente**, te toca a ti:

- darle tu **aviso de privacidad integral**, que diga que tratas datos de salud;
- obtener su **consentimiento expreso y por escrito** para tratarlos, y guardarlo;
- si es menor de edad o no puede decidir por sí mismo, obtenerlo de quien lo
  represente;
- atender tú sus solicitudes sobre sus datos.

Por nuestra parte, los datos de tus pacientes **no entran al catálogo compartido,
no se usan para estadísticas que identifiquen a nadie y no se usan para ningún fin
propio.**

### A5. El expediente clínico es tu obligación

Integrar el expediente, que tenga el contenido que pide la **NOM-004-SSA3-2012** y
**conservarlo al menos cinco años desde el último acto médico** son obligaciones
tuyas como prestador del servicio. SellPointy no revisa que un expediente esté
completo ni que cumpla la norma.

Por eso: **antes de cerrar tu cuenta o de dejar de pagar, exporta tus
expedientes.** Si dejas de usar SellPointy, la obligación de conservarlos sigue
siendo tuya, y no garantizamos que puedas consultarlos después de cerrar la cuenta.

### A6. 🔴 Sobre la NOM-024-SSA3-2012

La NOM-024-SSA3-2012 regula los sistemas de expediente clínico electrónico en
México y prevé su certificación. **SellPointy no está certificado conforme a esa
norma.** Decidir si una herramienta sin esa certificación es adecuada para tu
práctica, y para las obligaciones que tú tengas, es tu responsabilidad. Si tu
institución o tu autoridad sanitaria te exige un sistema certificado, no uses este
módulo como tu expediente oficial.

### A7. Recetas y órdenes

La receta y la orden que imprimes las **emites tú**, con tu nombre, tu cédula y tu
firma. Tú respondes de su contenido. El módulo **no genera recetarios especiales**
ni los formatos que la autoridad sanitaria exige para medicamentos controlados: si
recetas uno, hazlo por el medio que la ley pide, no con SellPointy.

### A8. No es para urgencias

El Servicio puede fallar o no estar disponible (cláusula T11). **No dependas de
SellPointy para atender una urgencia** ni para una decisión que no pueda esperar:
ten siempre una forma de atender a tus pacientes sin el sistema.

### A9. Secreto profesional y accesos

El secreto profesional es tuyo. Tú decides quién de tu equipo puede ver
expedientes, con los roles y permisos del Servicio; cada persona entra con su
propio usuario; y le quitas el acceso a quien deje de trabajar contigo (cláusula
T8). Nuestro personal no consulta expedientes, salvo que tú lo pidas para resolver
un problema o que una autoridad competente lo ordene por escrito.

### A10. Si hay una vulneración

Si sabemos de una vulneración de seguridad que afecte los datos de tus pacientes,
**te avisamos sin demora injustificada** y te damos la información que tengamos.
**Avisar a tus pacientes te toca a ti**, como responsable de sus datos.

### A11. Si alguien reclama

La cláusula T14 aplica por completo a este módulo: si un paciente, un familiar o
una autoridad nos reclama por la atención que diste, por lo que escribiste en un
expediente o en una receta, o porque no tenías el consentimiento o el aviso de
privacidad que la ley te pide, **tú te haces cargo** y nos sacas en paz y a salvo.

---

# ENGLISH — `/en-us/` and `/en-ca/`

> Translated from the Spanish master. **Spanish is the governing version**; this
> one exists so English-speaking customers can read what they are agreeing to.
> The product terms match the app in English (*receipt*, *quotes*, *My plan*).

## PRIVACY NOTICE

*Last updated: September 21, 2026*

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

**P3. Data our customers enter about other people.** The businesses that use
SellPointy enter data about their own customers, employees, suppliers and — in the
Medical practice module — patients. **That business or professional is responsible
for that data, not SellPointy**: we only store and process it on their behalf, as a
processor, and we do not use it for anything of our own. If you are a customer or a
patient of someone who uses SellPointy and you want to see, correct or delete your
data, **ask that business or professional**: they decide about it and they have
their own privacy notice. If you write to us, we pass your request on to them.

**P4. What we use it for.** *Necessary purposes:* answering your request; creating
and running your account; billing and recording your payments; supporting you;
telling you about changes to the service or to these documents; and meeting legal
obligations. *Optional purpose:* writing to you about SellPointy news. We only do so
if you agreed, and **you can refuse or change your mind at any time** by writing to
privacy@sellpointy.com or using the unsubscribe link in each email. Refusing does not
affect the service.

**P5. Who we share it with.** **We do not sell or rent your data.** **Your
information is stored on servers located in Mexico City.** To provide the service we
rely on providers that process it on our behalf and under a duty of confidentiality:
server hosting (Vultr, in Mexico), daily backups (Cloudflare), email delivery
(Resend) and application error monitoring (Sentry). **The last three operate outside
Mexico**, mainly in the United States; by using SellPointy you consent to that
transfer, which is necessary for the service to work and for your information to be
backed up. We may also disclose data when a competent authority lawfully requires it.

**P6. 🔴 The shared product catalog.** SellPointy maintains a common catalog of
**barcodes with the product name** — the one printed on the package — so any business
can add a product just by scanning it. **When you type the name of a product whose
barcode is not yet in that catalog, that name and its barcode may be added to it**
and suggested to other businesses. **That is all that is shared.** Never part of the
catalog, and never shared: your prices, costs, sales, stock, suppliers, customers, or
anything that identifies your business. The catalog does not say who contributed
each name.

**P7. Your rights.** You may **access** your data, **correct** it, **delete** it or
**object** to its use, and withdraw your consent. Write to privacy@sellpointy.com with
your name, your account email and what you need. **We reply within 20 business
days**, and where the request applies we carry it out within the following 15
business days. If you feel we did not handle it properly, you may contact the data
protection authority in your country.

**P8. How long we keep it.** Your account data, for as long as you have the account
and for as long afterwards as tax law requires. If you wrote to us and never created
an account, **24 months**, after which it is deleted automatically.

**P9. If you live in Canada.** In addition: we only send you commercial messages if
you gave your **express consent**, and we keep a record of when and what you agreed
to; every email includes a way to unsubscribe, which we honor within **10 business
days**. The person responsible for the protection of personal information is
Carlos Hernandez Hernandez, privacy@sellpointy.com. Your data may be processed outside Canada and
outside your province.

**P10. Minors.** SellPointy is for businesses. It is not directed at anyone under 18,
and we do not knowingly collect their data.

**P11. Changes.** If we change this notice we publish the new version here with its
date. If the change is significant, we tell you by email before it takes effect.

## TERMS AND CONDITIONS

*Last updated: September 21, 2026*

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

**T5. Your information is yours, and it is your responsibility.** **Everything you
enter in SellPointy is yours**: your products, prices, sales, stock, suppliers,
customers and any other record. You give us permission to store and process it
**only to provide the Service**. We do not sell it, share it or use it for anything
else, with the sole exception of clause T6. You can export your reports whenever you
want.

For the same reason, **you are solely responsible for that information**: that it is
true and complete, that you have the right to enter it, and for the use that you and
the people you give access to make of it. SellPointy does not review, validate or
correct what you enter, and is not liable for the decisions you make based on it.

**T6. 🔴 The shared product catalog.** To make adding a product as fast as scanning
it, SellPointy maintains a common catalog of barcodes with their trade name. **By
using the Service you agree that the name you enter for a barcode not yet in that
catalog may be added to it** and suggested to other users, without attribution and at
no cost. That permission is permanent for names already added, **and it is limited to
that**: the barcode and the product name, which are public information printed on its
package. Nothing else from your business enters that catalog.

**T7. Your customers' personal data.** If you enter data about your customers,
patients, suppliers or employees, **you are responsible for that data** to them and
under the law, and SellPointy acts only as a **processor**: it handles the data on
your behalf and on your instructions, which are to use the Service as it is built.

**Your part:** having your own privacy notice and giving it to those people;
obtaining their consent when the law requires it, in the form it requires; handling
their requests to access, correct, delete or object; and entering only the data you
really need.

**Our part:** keeping that data confidential; protecting it with reasonable
administrative, technical and physical security measures; not using it for our own
purposes; using infrastructure providers (such as hosting) bound to the same; telling
you without undue delay if we learn of a breach that affects it; and, if one of those
people writes to us, passing the request on to you so you can handle it.

**T8. Your users and their access.** You decide who gets into your account and what
they can see. You are responsible for what each person you give access to does, for
each person using their own user and not a shared one, for keeping passwords safe and
for **removing access from anyone who stops working with you**. Whatever is done with
a user of your account is deemed done by you.

**T9. 🔴 Specialized modules.** Some modules — such as Reception or Medical
practice — serve activities that have their own laws. Those modules are governed,
**in addition to these clauses, by their Annex**, which is part of these terms and
prevails wherever they differ. If your activity is regulated, **complying with that
regulation is your responsibility**, not SellPointy's: we give you a record-keeping
tool, not legal, tax, medical or any other kind of advice.

**T10. Acceptable use.** You may not use SellPointy for anything illegal; try to
access other people's accounts or data; interfere with or overload the Service; copy,
resell or reverse-engineer it; or enter content that infringes someone else's rights.
We may suspend an account that does.

Nor may you enter data you have no right to hold, or **keep health data or other
sensitive data outside a module built for it** (for example, in the notes of a sale
or in a point-of-sale customer record).

**T11. Availability and backups.** We work to keep the Service available at all times
and we back up your information every day. Even so, **it is provided “as is”**: we do
not guarantee it will never fail or be free of errors. There may be interruptions for
maintenance or for reasons beyond our control.

**T12. Intellectual property.** SellPointy's software, brand and design are ours.
These terms give you a right to use them while your account is active, not ownership
of any of it. Your information is yours (T5).

**T13. 🔴 Limitation of liability.** To the extent the law allows: SellPointy is not
liable for lost profits, loss of data or indirect damages arising from use of the
Service; and our total liability is limited to **what you paid us in the 12 months
before** the event giving rise to it. SellPointy is a management tool: **it does not
replace your accountant** or relieve you of your tax obligations, and the taxes it
sets up are a starting point that you must verify.

SellPointy does not replace your lawyer or any other professional either. Nothing the
Service shows, calculates or prints is professional advice.

**T14. 🔴 If someone makes a claim against us over your information.** If a third
party — a customer of yours, a patient, an employee, an authority — makes a claim
against us, sues us or fines us because of the information you entered, the use you
made of it, or a law that was yours to comply with, **you take care of it**: you
hold us harmless and cover the reasonable costs it causes us, including defense
costs. This does not apply to what is our fault.

**T15. Ending.** You may stop using SellPointy whenever you want. We may suspend or
close an account that breaches these terms. **Before closing your account, export
what you need to keep**: if the law requires you to keep certain records, that
obligation is yours and stays with you even after you stop using the Service.

When you close your account we stop using your information and you may ask us to
**delete it**; we do so except for what the law requires us to keep, which we hold
blocked — unused, and with no one able to enter the account — for that period, and
then delete.

**T16. Changes to these terms.** We may update them. If the change is significant we
tell you by email at least 15 days ahead. Continuing to use the Service afterwards
means you accept them.

**T17. Governing law.** These terms are governed by the laws of **Mexico**. Any
dispute is submitted to the courts of the State of Mexico, unless the consumer protection law
of your country gives you a right that cannot be waived.

**T18. Contact.** contact@sellpointy.com

**A1. Annex A — Medical practice module (Mexico).** This Annex is part of these
terms. It applies to anyone who uses the Medical practice module, which is offered
only in Mexico. Wherever it differs from the clauses above, this Annex prevails.

**A2. What this module is, and what it is not.** It is a **record-keeping tool** for
your practice: patient records, notes, prescriptions, orders and charging for what
you provide. **It is not a medical device.** It does not diagnose, does not recommend
treatments and **does not check doses, interactions, allergies or
contraindications**. Everything written in a record, a prescription or an order is
your professional decision, not the system's.

**A3. Who may use it.** Only health professionals who may legally practice in Mexico,
and staff working under their responsibility. **You guarantee** that every person who
sees patients with your account holds a valid degree and professional license
(cédula profesional), and that the professional details you enter are true.

**A4. Your patients' data is sensitive data, and you are responsible for it.** Health
data is **sensitive personal data**, the category that data-protection law protects
most. To your patients and to the authority, **you are the one responsible for that
data**; SellPointy is only the processor (clause T7). That means that, **before
entering a patient's first piece of data**, it is up to you to:

- give them your **full privacy notice**, stating that you process health data;
- obtain their **express written consent** to process it, and keep it;
- if they are a minor or cannot decide for themselves, obtain it from whoever
  represents them;
- handle their requests about their data yourself.

For our part, your patients' data **does not enter the shared catalog, is not used
for statistics that identify anyone, and is not used for any purpose of our own.**

**A5. The clinical record is your obligation.** Putting the record together, making
sure it has the content required by **NOM-004-SSA3-2012** and **keeping it for at
least five years from the last medical act** are your obligations as the provider of
the service. SellPointy does not check that a record is complete or that it meets the
standard. So: **before closing your account or stopping payment, export your
records.** If you stop using SellPointy, the obligation to keep them is still yours,
and we do not guarantee that you will be able to consult them after the account is
closed.

**A6. 🔴 About NOM-024-SSA3-2012.** NOM-024-SSA3-2012 regulates electronic clinical
record systems in Mexico and provides for their certification. **SellPointy is not
certified under that standard.** Deciding whether a tool without that certification
is suitable for your practice, and for the obligations you have, is your
responsibility. If your institution or your health authority requires a certified
system, do not use this module as your official record.

**A7. Prescriptions and orders.** The prescription and the order you print are
**issued by you**, with your name, your license number and your signature. You answer
for their content. The module **does not produce special prescription forms** or the
formats the health authority requires for controlled medicines: if you prescribe
one, do it by the means the law requires, not with SellPointy.

**A8. Not for emergencies.** The Service may fail or be unavailable (clause T11). **Do
not depend on SellPointy to handle an emergency** or a decision that cannot wait:
always have a way to see your patients without the system.

**A9. Professional secrecy and access.** Professional secrecy is yours. You decide who
on your team can see records, with the Service's roles and permissions; each person
signs in with their own user; and you remove access from anyone who stops working
with you (clause T8). Our staff do not look at records, unless you ask us to in order
to solve a problem or a competent authority orders it in writing.

**A10. If there is a breach.** If we learn of a security breach that affects your
patients' data, **we tell you without undue delay** and give you the information we
have. **Telling your patients is up to you**, as the one responsible for their data.

**A11. If someone makes a claim.** Clause T14 applies in full to this module: if a
patient, a relative or an authority makes a claim against us over the care you gave,
what you wrote in a record or a prescription, or because you did not have the consent
or the privacy notice the law requires of you, **you take care of it** and hold us
harmless.

---

# FRANÇAIS — `/fr-ca/`

> Traduit du texte maître en espagnol, en **français neutre** et au « vous »
> (décision de Carlos). **La version espagnole fait foi.** La Loi 25 du Québec exige
> que cet avis existe en français **avec la même qualité** que dans les autres
> langues : c'est la raison d'être de cette section.

## POLITIQUE DE CONFIDENTIALITÉ

*Dernière mise à jour : 21 septembre 2026*

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

**P3. Les données que nos clients saisissent sur d'autres personnes.** Les commerces
qui utilisent SellPointy saisissent des données sur leurs propres clients, employés,
fournisseurs et — dans le module Cabinet médical — patients. **C'est ce commerce ou
ce professionnel qui est responsable de ces données, et non SellPointy** : nous ne
faisons que les conserver et les traiter pour son compte, à titre de sous-traitant,
et nous ne les utilisons à aucune fin propre. Si vous êtes client ou patient d'une
personne qui utilise SellPointy et que vous souhaitez consulter, corriger ou
supprimer vos données, **adressez-vous à ce commerce ou à ce professionnel** : c'est
lui qui en décide et qui dispose de sa propre politique de confidentialité. Si vous
nous écrivez, nous lui transmettons votre demande.

**P4. À quoi elles servent.** *Finalités nécessaires :* répondre à votre demande ;
créer et exploiter votre compte ; facturer et enregistrer vos paiements ; vous
assister ; vous informer des changements apportés au service ou à ces documents ; et
respecter nos obligations légales. *Finalité facultative :* vous écrire au sujet des
nouveautés de SellPointy. Nous ne le faisons que si vous l'avez accepté, et **vous
pouvez refuser ou changer d'avis à tout moment** en écrivant à
privacy@sellpointy.com ou au moyen du lien de désabonnement de chaque
courriel. Un refus n'a aucune incidence sur le service.

**P5. Avec qui nous les partageons.** **Nous ne vendons ni ne louons vos données.**
**Vos informations sont conservées sur des serveurs situés à Mexico.** Pour fournir
le service, nous faisons appel à des fournisseurs qui les traitent pour notre compte
et sous obligation de confidentialité : l'hébergement du serveur (Vultr, au
Mexique), la sauvegarde quotidienne (Cloudflare), l'envoi des courriels (Resend) et
la surveillance des erreurs de l'application (Sentry). **Ces trois derniers exercent
leurs activités hors du Mexique**, principalement aux États-Unis ; en utilisant
SellPointy, vous consentez à ce transfert, nécessaire au fonctionnement du service et
à la sauvegarde de vos informations. Nous pouvons aussi communiquer des données
lorsqu'une autorité compétente l'exige conformément à la loi.

**P6. 🔴 Le catalogue de produits partagé.** SellPointy tient un catalogue commun de
**codes-barres accompagnés du nom du produit** — celui qui est imprimé sur
l'emballage — afin que tout commerce puisse ajouter un produit simplement en le
scannant. **Lorsque vous saisissez le nom d'un produit dont le code-barres ne figure
pas encore dans ce catalogue, ce nom et son code-barres peuvent y être ajoutés** et
proposés à d'autres commerces. **C'est tout ce qui est partagé.** Ne font jamais
partie du catalogue, et ne sont jamais partagés : vos prix, vos coûts, vos ventes,
vos stocks, vos fournisseurs, vos clients, ni aucun élément permettant d'identifier
votre commerce. Le catalogue n'indique pas qui a fourni chaque nom.

**P7. Vos droits.** Vous pouvez **accéder** à vos données, les **rectifier**, les
**supprimer** ou vous **opposer** à leur utilisation, et retirer votre consentement.
Écrivez à privacy@sellpointy.com en indiquant votre nom, le courriel de
votre compte et votre demande. **Nous répondons dans un délai de 20 jours
ouvrables** et, si la demande est recevable, nous y donnons suite dans les 15 jours
ouvrables suivants. Si vous estimez que votre demande n'a pas été traitée
correctement, vous pouvez vous adresser à l'autorité de protection des données de
votre pays.

**P8. Durée de conservation.** Les données de votre compte, tant que vous le
conservez et aussi longtemps que la législation fiscale l'exige par la suite. Si vous
nous avez écrit sans jamais créer de compte, **24 mois**, après quoi elles sont
supprimées automatiquement.

**P9. Si vous résidez au Canada.** En plus de ce qui précède : nous ne vous envoyons
des messages commerciaux que si vous avez donné votre **consentement exprès**, et
nous conservons la trace de la date et de l'objet de ce consentement ; chaque
courriel comporte un moyen de se désabonner, que nous respectons dans un délai de
**10 jours ouvrables**. La personne responsable de la protection des renseignements
personnels est Carlos Hernandez Hernandez, privacy@sellpointy.com. Vos données peuvent être
traitées à l'extérieur du Canada et de votre province.

**P10. Mineurs.** SellPointy s'adresse aux commerces. Il n'est pas destiné aux
personnes de moins de 18 ans et nous ne recueillons pas sciemment leurs données.

**P11. Modifications.** Si nous modifions cette politique, nous publions ici la
nouvelle version avec sa date. Si le changement est important, nous vous en informons
par courriel avant son entrée en vigueur.

## CONDITIONS GÉNÉRALES

*Dernière mise à jour : 21 septembre 2026*

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

**T5. Vos informations vous appartiennent, et vous en êtes responsable.** **Tout ce
que vous saisissez dans SellPointy vous appartient** : vos produits, prix, ventes,
stocks, fournisseurs, clients et tout autre enregistrement. Vous nous autorisez à les
conserver et à les traiter **uniquement pour fournir le Service**. Nous ne les
vendons pas, ne les partageons pas et ne les utilisons à aucune autre fin, à la seule
exception de la clause T6. Vous pouvez exporter vos rapports à tout moment.

Pour la même raison, **vous êtes le seul responsable de ces informations** : de leur
exactitude et de leur caractère complet, de votre droit de les saisir, et de l'usage
que vous et les personnes à qui vous donnez accès en faites. SellPointy ne révise, ne
valide et ne corrige pas ce que vous saisissez, et ne répond pas des décisions que
vous prenez sur cette base.

**T6. 🔴 Le catalogue de produits partagé.** Pour qu'ajouter un produit soit aussi
rapide que de le scanner, SellPointy tient un catalogue commun de codes-barres avec
leur nom commercial. **En utilisant le Service, vous acceptez que le nom saisi pour
un code-barres ne figurant pas encore dans ce catalogue puisse y être ajouté** et
proposé à d'autres utilisateurs, sans attribution et sans frais. Cette autorisation
est permanente pour les noms déjà ajoutés, **et elle se limite à cela** : le
code-barres et le nom du produit, qui sont des renseignements publics imprimés sur
son emballage. Rien d'autre de votre commerce n'entre dans ce catalogue.

**T7. Les données personnelles de VOS clients.** Si vous saisissez des données sur
vos clients, patients, fournisseurs ou employés, **vous êtes responsable de ces
données** envers eux et devant la loi, et SellPointy n'agit qu'à titre de
**sous-traitant** : il les traite pour votre compte et selon vos instructions, qui
consistent à utiliser le Service tel qu'il est conçu.

**Ce qui vous revient :** disposer de votre propre politique de confidentialité et la
remettre à ces personnes ; obtenir leur consentement lorsque la loi l'exige, et dans
la forme qu'elle exige ; traiter leurs demandes d'accès, de rectification, de
suppression et d'opposition ; et ne saisir que les données réellement nécessaires.

**Ce qui nous revient :** garder ces données confidentielles ; les protéger par des
mesures de sécurité administratives, techniques et physiques raisonnables ; ne pas
les utiliser à nos propres fins ; recourir à des fournisseurs d'infrastructure (comme
l'hébergement) tenus aux mêmes obligations ; vous aviser sans retard injustifié si
nous apprenons qu'un incident les touche ; et, si l'une de ces personnes nous écrit,
vous transmettre sa demande pour que vous la traitiez.

**T8. Vos utilisateurs et leurs accès.** Vous décidez qui entre dans votre compte et
ce que chacun peut voir. Vous êtes responsable de ce que fait chaque personne à qui
vous donnez accès, du fait que chacun utilise son propre utilisateur et non un
utilisateur partagé, de la protection des mots de passe et du **retrait de l'accès à
toute personne qui cesse de travailler avec vous**. Ce qui est fait avec un
utilisateur de votre compte est réputé fait par vous.

**T9. 🔴 Modules spécialisés.** Certains modules — comme Réception ou Cabinet
médical — servent à des activités qui ont leurs propres lois. Ces modules sont régis,
**en plus des présentes clauses, par leur Annexe**, qui fait partie des présentes
conditions et prévaut en cas de divergence. Si votre activité est réglementée, **le
respect de cette réglementation relève de votre responsabilité**, et non de celle de
SellPointy : nous vous fournissons un outil de tenue de dossiers, et non des conseils
juridiques, fiscaux, médicaux ou de toute autre nature.

**T10. Utilisation acceptable.** Vous ne pouvez pas utiliser SellPointy à des fins
illégales ; tenter d'accéder aux comptes ou aux données d'autrui ; perturber ou
surcharger le Service ; le copier, le revendre ou en faire l'ingénierie inverse ; ni
saisir un contenu portant atteinte aux droits d'autrui. Nous pouvons suspendre un
compte qui le fait.

Vous ne pouvez pas non plus saisir des données que vous n'avez pas le droit de
détenir, ni **conserver des données de santé ou d'autres données sensibles hors d'un
module conçu pour cela** (par exemple, dans les notes d'une vente ou dans la fiche
d'un client du point de vente).

**T11. Disponibilité et sauvegardes.** Nous faisons en sorte que le Service soit
toujours accessible et nous sauvegardons vos informations chaque jour. Néanmoins,
**il est fourni « tel quel »** : nous ne garantissons pas qu'il ne tombera jamais en
panne ni qu'il sera exempt d'erreurs. Des interruptions peuvent survenir pour
maintenance ou pour des raisons indépendantes de notre volonté.

**T12. Propriété intellectuelle.** Le logiciel, la marque et le design de SellPointy
nous appartiennent. Les présentes conditions vous accordent un droit d'utilisation
tant que votre compte est actif, et non la propriété de ces éléments. Vos
informations vous appartiennent (T5).

**T13. 🔴 Limitation de responsabilité.** Dans la mesure permise par la loi :
SellPointy ne répond pas des pertes de profits, des pertes de données ni des dommages
indirects découlant de l'utilisation du Service ; et notre responsabilité totale se
limite à **ce que vous nous avez payé au cours des 12 mois précédant** le fait
générateur. SellPointy est un outil de gestion : **il ne remplace pas votre
comptable** et ne vous dégage pas de vos obligations fiscales, et les taxes qu'il
configure sont un point de départ que vous devez vérifier.

SellPointy ne remplace pas non plus votre avocat ni aucun autre professionnel. Rien
de ce que le Service affiche, calcule ou imprime ne constitue un conseil
professionnel.

**T14. 🔴 Si quelqu'un nous met en cause au sujet de vos informations.** Si un tiers —
l'un de vos clients, un patient, un employé, une autorité — nous adresse une
réclamation, nous poursuit ou nous sanctionne en raison des informations que vous
avez saisies, de l'usage que vous en avez fait ou d'une loi qu'il vous appartenait de
respecter, **vous en assumez la charge** : vous nous dégagez de toute responsabilité
et couvrez les frais raisonnables que cela nous occasionne, y compris les frais de
défense. Cela ne s'applique pas à ce qui relève de notre faute.

**T15. Fin de l'utilisation.** Vous pouvez cesser d'utiliser SellPointy à tout moment.
Nous pouvons suspendre ou fermer un compte qui enfreint ces conditions. **Avant de
fermer votre compte, exportez ce que vous devez conserver** : si la loi vous oblige à
garder certains documents, cette obligation est la vôtre et vous suit même après la
fin de votre utilisation du Service.

À la fermeture de votre compte, nous cessons d'utiliser vos informations et vous
pouvez nous demander de les **supprimer** ; nous le faisons, sauf pour ce que la loi
nous oblige à conserver, que nous gardons bloqué — sans l'utiliser et sans que
personne puisse entrer dans le compte — pendant ce délai, puis que nous supprimons.

**T16. Modifications.** Nous pouvons mettre ces conditions à jour. Si le changement
est important, nous vous en informons par courriel au moins 15 jours à l'avance.
Continuer d'utiliser le Service par la suite signifie que vous les acceptez.

**T17. Droit applicable.** Les présentes conditions sont régies par les lois du
**Mexique**. Tout litige est soumis aux tribunaux de l'État de Mexico, sauf si la loi sur
la protection du consommateur de votre pays vous accorde un droit auquel il est
impossible de renoncer.

**T18. Contact.** contact@sellpointy.com

**A1. Annexe A — Module Cabinet médical (Mexique).** La présente Annexe fait partie
des présentes conditions. Elle s'applique à toute personne qui utilise le module
Cabinet médical, offert uniquement au Mexique. En cas de divergence avec les clauses
qui précèdent, la présente Annexe prévaut.

**A2. Ce qu'est ce module, et ce qu'il n'est pas.** C'est un **outil de tenue de
dossiers** pour votre cabinet : dossiers, notes, ordonnances, prescriptions d'examens
et facturation de vos actes. **Ce n'est pas un dispositif médical.** Il ne pose pas de
diagnostic, ne recommande pas de traitement et **ne vérifie ni les doses, ni les
interactions, ni les allergies, ni les contre-indications**. Tout ce qui est écrit
dans un dossier, une ordonnance ou une prescription est votre décision
professionnelle, et non celle du système.

**A3. Qui peut l'utiliser.** Uniquement les professionnels de la santé autorisés à
exercer légalement au Mexique, et le personnel qui travaille sous leur
responsabilité. **Vous garantissez** que chaque personne qui reçoit des patients avec
votre compte détient un diplôme et un permis d'exercice (cédula profesional) en
vigueur, et que les renseignements professionnels que vous saisissez sont exacts.

**A4. Les données de vos patients sont des données sensibles, et vous en êtes responsable.** Les données de santé sont des **données personnelles sensibles**, la
catégorie que la loi sur la protection des données protège le plus. Envers vos
patients et devant l'autorité, **le responsable de ces données, c'est vous** ;
SellPointy n'est que le sous-traitant (clause T7). Cela signifie que, **avant de
saisir la première donnée d'un patient**, il vous revient de :

- lui remettre votre **politique de confidentialité complète**, indiquant que vous
  traitez des données de santé ;
- obtenir son **consentement exprès et écrit** pour les traiter, et le conserver ;
- s'il est mineur ou ne peut pas décider par lui-même, l'obtenir de la personne qui
  le représente ;
- traiter vous-même ses demandes concernant ses données.

Pour notre part, les données de vos patients **n'entrent pas dans le catalogue
partagé, ne servent pas à des statistiques permettant d'identifier qui que ce soit
et ne servent à aucune fin propre.**

**A5. Le dossier clinique est votre obligation.** Constituer le dossier, veiller à ce
qu'il ait le contenu exigé par la **NOM-004-SSA3-2012** et **le conserver au moins
cinq ans à compter du dernier acte médical** sont vos obligations à titre de
prestataire du service. SellPointy ne vérifie pas qu'un dossier est complet ni qu'il
respecte la norme. Par conséquent : **avant de fermer votre compte ou de cesser de
payer, exportez vos dossiers.** Si vous cessez d'utiliser SellPointy, l'obligation de
les conserver reste la vôtre, et nous ne garantissons pas que vous pourrez les
consulter après la fermeture du compte.

**A6. 🔴 À propos de la NOM-024-SSA3-2012.** La NOM-024-SSA3-2012 encadre les
systèmes de dossier clinique électronique au Mexique et prévoit leur certification.
**SellPointy n'est pas certifié selon cette norme.** Décider si un outil sans cette
certification convient à votre pratique, et aux obligations qui sont les vôtres,
relève de votre responsabilité. Si votre établissement ou votre autorité sanitaire
exige un système certifié, n'utilisez pas ce module comme dossier officiel.

**A7. Ordonnances et prescriptions.** L'ordonnance et la prescription que vous
imprimez sont **émises par vous**, avec votre nom, votre numéro de permis et votre
signature. Vous répondez de leur contenu. Le module **ne produit pas d'ordonnanciers
spéciaux** ni les formulaires que l'autorité sanitaire exige pour les médicaments
contrôlés : si vous en prescrivez un, faites-le par le moyen que la loi exige, et non
avec SellPointy.

**A8. Pas pour les urgences.** Le Service peut tomber en panne ou être indisponible
(clause T11). **Ne dépendez pas de SellPointy pour traiter une urgence** ni pour une
décision qui ne peut pas attendre : ayez toujours un moyen de recevoir vos patients
sans le système.

**A9. Secret professionnel et accès.** Le secret professionnel est le vôtre. Vous
décidez qui, dans votre équipe, peut voir les dossiers, à l'aide des rôles et des
permissions du Service ; chaque personne se connecte avec son propre utilisateur ; et
vous retirez l'accès à toute personne qui cesse de travailler avec vous (clause T8).
Notre personnel ne consulte pas les dossiers, sauf si vous le demandez pour résoudre
un problème ou si une autorité compétente l'ordonne par écrit.

**A10. En cas d'incident de sécurité.** Si nous apprenons qu'un incident de sécurité
touche les données de vos patients, **nous vous avisons sans retard injustifié** et
vous communiquons les renseignements dont nous disposons. **Aviser vos patients vous
revient**, à titre de responsable de leurs données.

**A11. Si quelqu'un nous met en cause.** La clause T14 s'applique intégralement à ce
module : si un patient, un proche ou une autorité nous met en cause en raison des
soins que vous avez donnés, de ce que vous avez écrit dans un dossier ou une
ordonnance, ou parce que vous n'aviez pas le consentement ou la politique de
confidentialité que la loi exige de vous, **vous en assumez la charge** et nous
dégagez de toute responsabilité.

---

## Lo que cada ley exige, y dónde quedó

| Ley | Exige | Dónde |
|---|---|---|
| **LFPDPPP** (México) | Responsable y domicilio | P1 |
| | Datos que se recaban; si hay sensibles | P2 |
| | De quién son los datos que capturan los clientes (responsable vs. encargado) | P3, T7, A4 |
| | Finalidades, separando necesarias de opcionales | P4 |
| | Transferencias | P5, P6 |
| | Medio para derechos ARCO y para revocar | P7 |
| | Cómo se avisan los cambios | P11 |
| **CASL** (Canadá) | Consentimiento expreso, registrado | P9 + la casilla del formulario, nunca marcada |
| | Identificar al remitente y forma de baja | P9 + pie de cada correo |
| **Ley 25** (Quebec) | Responsable de datos nombrado | P9 |
| | Aviso de transferencia fuera de la provincia | P9 |
| | El aviso, **en francés y de la misma calidad** | ✅ Sección FRANÇAIS, completa y con las mismas cláusulas |

## Lo que este borrador NO resuelve

1. 🔴 **PENDIENTE DE CARLOS — certificar SellPointy conforme a la NOM-024-SSA3-2012**
   (anotado el 2026-09-21). Es la norma mexicana de los sistemas de expediente clínico
   electrónico y prevé su certificación. El Anexo A lo dice sin rodeos (A6: «SellPointy
   no está certificado») y deja la decisión al médico, pero **una cláusula no hace que
   el producto cumpla la norma**: mientras no se certifique, ofrecer el módulo de
   Consultorio es el riesgo legal más serio de SellPointy. Primer paso: que un abogado
   diga qué exposición real hay hoy y qué pide el trámite. El día que se certifique,
   A6 se reescribe y sube la versión de los términos. Tarea `F9-CLINIC-NOM024-01`.
2. **El Anexo A no lo revisó un abogado.** Lo redactó Claude y Carlos lo aprobó el
   2026-09-21, con el riesgo a su cargo, igual que el resto de estos documentos.
   Lo más delicado: A6 (NOM-024), T14 (indemnización) y A4 (consentimiento).
3. **La aceptación del Anexo no queda registrada aparte.** Hoy se acepta con los
   Términos (la pared de `TermsGate`). Lo más sólido sería pedirla AL ACTIVAR el
   módulo, guardando quién, cuándo y qué versión. Tarea `F9-CLINIC-NOM024-02`.
4. 🔴 **Si en Quebec se puede vender una aplicación que no está en francés.** Sin
   abogado, la pregunta sigue abierta. **Lo prudente, y lo que recomiendo: que
   `/fr-ca/` salga DESPUÉS de las otras cuatro versiones**, cuando el francés esté en
   la aplicación — que tú mismo dijiste que viene. Publicar antes es el riesgo más
   evitable de todo el sitio.
5. **La facturación fiscal.** Estos términos no tocan CFDI ni facturas.
6. **Que el límite de responsabilidad (T13) aguante ante un juez.** Las leyes de
   consumo de cada país pueden recortarlo; es una cláusula estándar, no una garantía.
