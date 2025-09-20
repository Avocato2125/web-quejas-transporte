# Sistema de Gestión de Quejas de Transporte

Sistema web para la gestión de quejas relacionadas con el transporte de personal, desarrollado con Node.js, Express y PostgreSQL.

## Características

- **Formulario de quejas** para empleados con 5 tipos diferentes
- **Panel de administración** para gestión de quejas
- **Autenticación JWT** con refresh tokens
- **Validación robusta** de datos
- **Rate limiting** para protección
- **Logging detallado** con Winston
- **Interfaz responsive** y moderna

## 🛠️ Tecnologías

- **Backend**: Node.js, Express.js
- **Base de datos**: PostgreSQL
- **Autenticación**: JWT, bcrypt
- **Validación**: Joi
- **Logging**: Winston
- **Seguridad**: Helmet, CORS, Rate Limiting
- **Frontend**: HTML5, CSS3, JavaScript vanilla

## 📦 Instalación

### Prerrequisitos

- Node.js >= 16.0.0
- npm >= 8.0.0
- PostgreSQL >= 12.0

### Pasos de instalación

1. **Clonar el repositorio**
```bash
git clone https://github.com/tu-usuario/sistema-quejas-transporte.git
cd sistema-quejas-transporte
```

2. **Instalar dependencias**
```bash
npm install
```

3. **Configurar variables de entorno**
```bash
cp .env.example .env
# Editar .env con tus configuraciones
```

4. **Configurar base de datos**
```bash
# Crear base de datos PostgreSQL
createdb quejas_transporte

# Ejecutar scripts de inicialización (ver sección Base de Datos)
```

5. **Iniciar el servidor**
```bash
# Desarrollo
npm run dev

# Producción
npm start
```

## ⚙️ Configuración

### Variables de Entorno

Crear archivo `.env` con las siguientes variables:

```env
# Base de datos
DATABASE_URL=postgresql://usuario:password@localhost:5432/quejas_transporte

# JWT Secrets
JWT_SECRET=tu_jwt_secret_muy_seguro_aqui
REFRESH_JWT_SECRET=tu_refresh_jwt_secret_muy_seguro_aqui

# CORS
CORS_ORIGIN=http://localhost:3000

# Railway (opcional)
RAILWAY_STATIC_URL=tu-app.railway.app

# Entorno
NODE_ENV=development
PORT=3000
```

### Base de Datos

El sistema utiliza 5 tablas especializadas para diferentes tipos de quejas:

- `quejas_retraso` - Quejas por retrasos
- `quejas_mal_trato` - Quejas por mal trato
- `quejas_inseguridad` - Quejas por inseguridad
- `quejas_unidad_mal_estado` - Quejas por mal estado de unidades
- `quejas_otro` - Otras quejas

Ver `database/schema.sql` para la estructura completa.

## Uso

### Para Empleados

1. Acceder a `http://localhost:3000`
2. Completar el formulario de queja
3. Seleccionar el tipo de queja
4. Llenar los campos específicos
5. Enviar y guardar el folio generado

### Para Administradores

1. Acceder a `http://localhost:3000/login.html`
2. Iniciar sesión con credenciales de administrador
3. Revisar quejas pendientes en el dashboard
4. Resolver quejas con comentarios

## 🔒 Seguridad

- Autenticación JWT con refresh tokens
- Rate limiting en endpoints críticos
- Validación de entrada con Joi
- Sanitización de datos
- Headers de seguridad con Helmet
- CORS configurado
- Logging de seguridad

## API Endpoints

### Públicos
- `POST /enviar-queja` - Enviar nueva queja
- `GET /health` - Health check

### Autenticados
- `POST /api/login` - Iniciar sesión
- `POST /api/logout` - Cerrar sesión
- `GET /api/quejas` - Obtener quejas
- `PUT /api/queja/resolver` - Resolver queja

## 🧪 Testing

```bash
# Ejecutar tests
npm test

# Tests con coverage
npm run test:coverage

# Tests de integración
npm run test:integration
```

## 📝 Logs

Los logs se guardan en:
- `logs/combined.log` - Todos los logs
- `logs/error.log` - Solo errores

## Despliegue

### Railway (Recomendado)

1. **Conectar repositorio a Railway**
   - Ir a [Railway.app](https://railway.app)
   - Crear nuevo proyecto desde GitHub
   - Conectar este repositorio

2. **Configurar variables de entorno en Railway**
   ```env
   DATABASE_URL=postgresql://postgres:rscXLPWWHFXCLhardKMrmXwZhPvjgYVO@postgres.railway.internal:5432/railway
   JWT_SECRET=K7L8X9QwE3R4T5Y6U7I8O9P0A1S2D3F4G5H6J7K8L9Z0X1C2V3B4N5M6Q7W8E9R0
   REFRESH_JWT_SECRET=M3N4B5V6C7X8Z9A0S1D2F3G4H5J6K7L8Q9W0E1R2T3Y4U5I6O7P8A9S0D1F2G3H4
   NODE_ENV=production
   PORT=3000
   ```

3. **Desplegar automáticamente**
   - Railway detectará automáticamente el `package.json`
   - Ejecutará `npm install` y `npm start`
   - La aplicación estará disponible en la URL proporcionada por Railway

### Docker

```bash
# Construir imagen
docker build -t quejas-transporte .

# Ejecutar contenedor
docker run -p 3000:3000 --env-file .env quejas-transporte
```

## 🤝 Contribución

1. Fork el proyecto
2. Crear rama para feature (`git checkout -b feature/nueva-funcionalidad`)
3. Commit cambios (`git commit -m 'Agregar nueva funcionalidad'`)
4. Push a la rama (`git push origin feature/nueva-funcionalidad`)
5. Abrir Pull Request

## 📄 Licencia

Este proyecto está bajo la Licencia ISC.

## 🆘 Soporte

Para soporte técnico:
- Crear issue en GitHub
- Email: soporte@empresa.com
- Documentación: [Wiki del proyecto](https://github.com/Avocato2125/web-quejas-transporte/wiki)

## Roadmap

- [ ] Sistema de notificaciones por email
- [ ] Dashboard con estadísticas
- [ ] API para integración con otros sistemas
- [ ] Aplicación móvil
- [ ] Inteligencia artificial para clasificación

---

**Versión actual**: 6.4  
**Última actualización**: $(date)
