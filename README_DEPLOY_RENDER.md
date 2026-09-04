# EmpoderArte V2.1 — Publicación en Render

Esta versión está preparada para desplegarse como aplicación Node/Express con PostgreSQL.

## Archivos importantes
- `server.js`: backend y API.
- `public/index.html`: interfaz completa.
- `package.json`: dependencias de producción.
- `render.yaml`: configuración de Render (web + PostgreSQL).

## Credenciales iniciales
- Usuario: `director@empoderarte.local`
- Contraseña: `empoderarte`

**Cámbialas después del primer acceso.**

## Publicación
1. Sube el contenido de esta carpeta a un repositorio privado de GitHub.
2. En Render crea un nuevo Blueprint y selecciona el repositorio.
3. Render leerá `render.yaml`, creará el servicio web y la base PostgreSQL.
4. Espera a que termine el primer deploy.
5. Abre la URL `.onrender.com` que Render asigna al servicio.

## Nota de plan
El archivo usa `plan: free` como configuración inicial. La disponibilidad y características de los planes gratuitos pueden cambiar. Para una academia con datos importantes se recomienda un plan de base de datos con persistencia adecuada.
