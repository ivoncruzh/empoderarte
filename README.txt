EMPODERARTE V2.1 — SISTEMA WEB

Incluye:
- Base de datos SQLite persistente
- Usuarios Director / Recepción
- Alumnos y matrícula automática
- Expedientes e historial
- Pagos, recibos y actualización de vencimiento
- Alertas de vencimiento en dashboard
- Asistencia
- Promociones
- Beneficios
- Credencial digital con QR (solo matrícula)
- Reportes
- Auditoría

INICIO LOCAL
1. Instala Node.js 20+.
2. Abre una terminal en esta carpeta.
3. Ejecuta: npm install
4. Ejecuta: npm start
5. Abre: http://localhost:3000

ACCESO INICIAL
Correo: director@empoderarte.local
Contraseña: empoderarte

PRODUCCIÓN
Antes de publicar en Internet cambia JWT_SECRET por una clave larga y aleatoria y configura una base de datos persistente. SQLite sirve para una primera instalación; para crecimiento multiusuario conviene migrar a PostgreSQL.

NOTA QR
La credencial genera un QR externo con la matrícula. No incluye datos personales. En producción se recomienda generar QR desde el backend y, si se requiere validación pública, crear una ruta segura de verificación.
