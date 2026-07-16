CONTROL DE INVENTARIOS
Para el desarrollo del sistema para el control de inventario se contempla la siguiente 1er fase:
 Catálogos
o Productos
o Almacenes
 Movimientos
o Entradas
o Salidas
o Inventario
 Reportes
 Sistema
o Usuarios de Sistema
CATÁLOGOS
Los catálogos deben ser definidos muy detalladamente por el cliente. Estos catálogos se pueden
cargar a la base de datos desde un Excel o uno a uno desde el sistema.
Catálogo de productos
Se definen por el cliente los campos e información que describen al producto. Tomando como
base que el tipo de producto es “medicamento” la propuesta de campos para el catálogo es la
siguiente:
- UPC (Código de Barras)
- Nombre Comercial
- Sustancia Activa
- Laboratorio
- Forma Farmacéutica (Tableta, Cápsula, Solución, Comprimido, Suspensión, Gel, etc.)
- Tipo de Medicamento (Genérico, Patente)
- Registro SSA
- Grupo o Clasificación Artículo 226 LGS (I, II, III, IV, V)
Catálogo de almacenes
Se definen los campos relacionados a los almacenes/sucursales.
- Nombre de Almacén
- Calle
- Número
- Colonia
- Municipio/Alcaldía
- Estado
- Código Postal
MOVIMIENTOS
Esta sección básicamente comprende la parte operativa.
Entradas
Se realizan las entradas de medicamento y se suman las cantidades al stock del almacén.
Existen 3 tipos de entradas por operación:
- Entrada por Factura
- Entrada por Ajuste
- Entrada por Traspaso
Entrada por Factura – Se hace una entrada al almacén seleccionado (Número de documento,
Fecha de documento, Proveedor, Costo de entrada).
Entrada por Ajuste – Se utiliza para una entrada extraordinaria (Persona que autoriza, Motivo de
ajuste).
Entrada por Traspaso – Es una entrada por un traspaso desde otro almacén (Folio de traspaso,
Persona que autoriza).
Salidas
Se realizan las salidas de medicamento y se restan las cantidades al stock del almacén.
Existen 3 tipos de salidas por operación:
- Salida por Ajuste
- Salida por Traspaso
Salida por Ajuste – Se utiliza para una salida de medicamento extraordinaria (Persona que
autoriza, Motivo de ajuste).
Salida por Traspaso – Es una salida por traspaso hacia otro almacén (Almacén destino, Persona
que autoriza).
Inventario
Esta operación realiza una salida del inventario total del almacén que se encuentra en sistema y
una entrada por los medicamentos que se tienen en el inventario total actual.
Para ingresar medicamentos al inventario se puede realizar desde un archivo Excel con las
siguientes columnas.
- Código de Barras
- Lote
- Caducidad
- Cantidad
- Almacén
- Ubicación (En caso que se tengan definidos racks de ubicación en el almacén)
REPORTES
El sistema puede ser capaz de visualizar los reportes en sistema o descargarlo en formato Excel si
es necesario. Los reportes contemplados son:
- Stock por Almacén
- Catálogo de Productos
- Catálogo de Almacenes
- Usuarios de Sistema
SISTEMA
Aquí se define todo lo relacionado a los usuarios y permisos de sistema.
Usuarios de Sistema
Se tienen que dar de alta los usuarios que van a operar el sistema con la siguiente información:
- Número de Empleado
- Nombre
- Apellido Paterno
- Apellido Materno
- Correo Electrónico
- Contraseña
Una vez esté registrado el usuario de sistema se tienen que asignar los permisos necesarios para
realizar cualquier tipo de movimiento, operación o poder visualizar algún reporte.