// server.js (Versión 4.2 - Optimizada para arquitectura multi-tabla con patrón de mapeo)

// Carga las variables de entorno del archivo .env para uso local.
require('dotenv').config();

// --- Dependencias ---
const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const cors = require('cors'); // ✅ Usando la librería estándar para CORS
const rateLimit = require('express-rate-limit'); // ✅ Usando la librería estándar para Rate Limit

// --- Inicialización de la App ---
const app = express();
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';

// --- Verificación de Variables Críticas ---
if (!process.env.DATABASE_URL) {
    console.error('❌ ERROR CRÍTICO: La variable de entorno DATABASE_URL no está definida.');
    process.exit(1);
}

// --- Middlewares de Seguridad ---

// 1. Configuración de CORS
// Define los orígenes permitidos para las solicitudes.
const allowedOrigins = [
    process.env.CORS_ORIGIN,
    `https://${process.env.RAILWAY_STATIC_URL}`
].filter(Boolean); // .filter(Boolean) elimina valores nulos o undefined

app.use(cors({
    origin: (origin, callback) => {
        // Permite solicitudes sin origen (ej. Postman) y de dominios en la lista.
        // En desarrollo, permite cualquier origen para facilitar las pruebas locales.
        if (!origin || allowedOrigins.includes(origin) || NODE_ENV === 'development') {
            callback(null, true);
        } else {
            callback(new Error('Origen no permitido por la política de CORS'));
        }
    }
}));

// 2. Configuración de Rate Limiting
// Previene ataques de fuerza bruta o spam limitando las solicitudes.
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // Ventana de tiempo de 15 minutos
    max: 20, // Límite de 20 peticiones por IP en esa ventana
    standardHeaders: true, // Devuelve información del límite en las cabeceras `RateLimit-*`
    legacyHeaders: false, // Deshabilita las cabeceras `X-RateLimit-*` (obsoletas)
    message: { success: false, error: 'Demasiadas solicitudes enviadas. Por favor, intente de nuevo en 15 minutos.' }
});

// Aplicar el limiter solo a las rutas más sensibles
app.use('/enviar-queja', apiLimiter);
app.use('/api/quejas/:tipo/:id/resolver', apiLimiter);

// --- Middlewares Generales ---
app.use(express.json({ limit: '10mb' })); // Parsea cuerpos de solicitud JSON
app.use(express.static(path.join(__dirname, 'public'))); // Sirve archivos estáticos

// --- Configuración de la Base de Datos PostgreSQL ---
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false } // Requerido para conexiones en plataformas como Railway/Heroku
});

// Verificación inicial de la conexión
pool.query('SELECT NOW()')
    .then(() => console.log('✅ Conexión a la base de datos PostgreSQL exitosa.'))
    .catch(err => {
        console.error('❌ ERROR: No se pudo conectar a la base de datos PostgreSQL.', err);
        process.exit(1);
    });

// =================================================================
// 🔥 PATRÓN DE MAPEO: CONFIGURACIÓN CENTRALIZADA DE QUEJAS 🔥
// Esta es nuestra "fuente única de verdad" para la lógica de las quejas.
// =================================================================
const QUEJAS_CONFIG = {
    'Retraso': {
        tableName: 'quejas_retraso',
        fields: ['detalles_retraso', 'direccion_subida', 'hora_programada', 'hora_llegada']
    },
    'Mal trato': {
        tableName: 'quejas_mal_trato',
        fields: ['nombre_conductor_maltrato', 'detalles_maltrato']
    },
    'Inseguridad': {
        tableName: 'quejas_inseguridad',
        fields: ['detalles_inseguridad', 'ubicacion_inseguridad']
    },
    'Unidad en mal estado': {
        tableName: 'quejas_unidad_mal_estado',
        fields: ['numero_unidad_malestado', 'tipo_falla', 'detalles_malestado']
    },
    'Otro': {
        tableName: 'quejas_otro',
        fields: ['detalles_otro']
    }
};
// =================================================================

// --- RUTAS DEL SERVIDOR ---

// Ruta principal para servir el frontend
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// RUTA POST: Enviar quejas (Refactorizada con el patrón de mapeo)
app.post('/enviar-queja', async (req, res) => {
    try {
        const { tipo, numero_empleado, empresa, ruta, colonia, turno, latitud, longitud, ...detalles } = req.body;
        
        // 1. Validar que el tipo de queja exista en nuestra configuración
        const config = QUEJAS_CONFIG[tipo];
        if (!config) {
            return res.status(400).json({ success: false, error: 'El tipo de queja especificado no es válido.' });
        }

        // 2. Construir dinámicamente los campos y valores para la consulta
        const commonFields = ['numero_empleado', 'empresa', 'ruta', 'colonia', 'turno', 'tipo', 'latitud', 'longitud'];
        const specificFields = config.fields; // Campos específicos de este tipo de queja
        
        const allFieldNames = [...commonFields, ...specificFields];
        const allValues = [
            numero_empleado, empresa, ruta, colonia, turno, tipo, latitud || null, longitud || null,
            ...specificFields.map(field => detalles[field] || null) // Obtiene los valores de los detalles
        ];

        // 3. Crear la consulta SQL paramétrica para prevenir inyección SQL
        const queryFields = allFieldNames.join(', ');
        const queryValuePlaceholders = allFieldNames.map((_, i) => `$${i + 1}`).join(', ');

        const query = `
            INSERT INTO ${config.tableName} (${queryFields})
            VALUES (${queryValuePlaceholders})
            RETURNING id;
        `;
        
        // 4. Ejecutar la consulta en la base de datos
        const result = await pool.query(query, allValues);

        console.log(`✅ Queja registrada en la tabla '${config.tableName}' con ID: ${result.rows[0].id}`);
        res.status(201).json({ success: true, message: "¡Queja registrada con éxito!" }); // 201 Created

    } catch (error) {
        console.error('❌ Error al procesar la queja:', error);
        res.status(500).json({ success: false, error: 'Error interno del servidor al procesar la solicitud.' });
    }
});

// RUTA GET para obtener todas las quejas de todas las tablas
// Nota: Esta ruta aún usa el enfoque anterior. Se podría refactorizar de manera similar.
app.get('/api/quejas', async (req, res) => {
    try {
        const tableNames = Object.values(QUEJAS_CONFIG).map(c => c.tableName);
        const queries = tableNames.map(tableName => pool.query(`SELECT *, '${tableName}' as tabla_origen FROM ${tableName}`));
        
        const results = await Promise.all(queries);
        const allQuejas = results.flatMap(result => result.rows); // flatMap aplana el array de arrays

        // Ordenar por fecha de creación descendente
        allQuejas.sort((a, b) => new Date(b.fecha_creacion) - new Date(a.fecha_creacion));

        res.status(200).json(allQuejas);
    } catch (error) {
        console.error('❌ Error al obtener las quejas:', error);
        res.status(500).json({ success: false, error: 'Error al consultar la base de datos.' });
    }
});


// RUTA PUT para actualizar el estado de una queja
// Nota: Esta ruta también se beneficia del patrón de mapeo
app.put('/api/quejas/:tipo/:id/resolver', async (req, res) => {
    try {
        const { tipo, id } = req.params;
        const { resolucion, estado = 'Revisada' } = req.body;

        const config = Object.values(QUEJAS_CONFIG).find(c => c.tableName === `quejas_${tipo}`);
        if (!config) {
            return res.status(400).json({ success: false, error: 'Tipo de queja no válido.' });
        }
        
        if (!resolucion) {
            return res.status(400).json({ success: false, error: 'El campo de resolución es requerido.' });
        }

        const query = `
            UPDATE ${config.tableName}
            SET estado_queja = $1, resolucion = $2, fecha_resolucion = NOW()
            WHERE id = $3
            RETURNING *;
        `;
        
        const result = await pool.query(query, [estado, resolucion, id]);

        if (result.rowCount === 0) {
            return res.status(404).json({ success: false, error: 'Queja no encontrada.' });
        }

        console.log(`✅ Queja ${id} de la tabla ${config.tableName} actualizada.`);
        res.status(200).json({ success: true, queja: result.rows[0] });

    } catch (error) {
        console.error('❌ Error al resolver la queja:', error);
        res.status(500).json({ success: false, error: 'Error interno del servidor.' });
    }
});

// --- Rutas de Utilidad y Manejo de Errores ---

// Ruta para verificar el estado del servidor (Health Check)
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Middleware para manejar rutas no encontradas (404)
app.use((req, res, next) => {
    res.status(404).json({ success: false, error: `Ruta no encontrada: ${req.originalUrl}` });
});

// Middleware global para manejo de errores
app.use((error, req, res, next) => {
    console.error('❌ ERROR NO MANEJADO:', error);
    res.status(500).json({ success: false, error: 'Ha ocurrido un error inesperado en el servidor.' });
});

// --- Arranque del Servidor ---
const server = app.listen(PORT, () => {
    console.log('🚀 ==================================================');
    console.log(`  Servidor de Quejas v4.2`);
    console.log(`  Modo: ${NODE_ENV}`);
    console.log(`  Servidor corriendo en: http://localhost:${PORT}`);
    console.log('🚀 ==================================================');
});

// Cierre elegante del servidor y la base de datos
const gracefulShutdown = () => {
    console.log('Iniciando cierre elegante del servidor...');
    server.close(() => {
        console.log('Servidor HTTP cerrado.');
        pool.end(() => {
            console.log('Pool de la base de datos cerrado.');
            process.exit(0);
        });
    });
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);