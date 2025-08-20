// server.js (Versión 4.9 - Con tabla de resoluciones y transacciones)

require('dotenv').config();

// --- Dependencias ---
const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');

// --- Inicialización de la App ---
const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';

// --- Verificación de Variables Críticas ---
if (!process.env.DATABASE_URL) {
    console.error('❌ ERROR CRÍTICO: La variable de entorno DATABASE_URL no está definida.');
    process.exit(1);
}

// --- Middlewares de Seguridad ---
const allowedOrigins = [
    process.env.CORS_ORIGIN,
    `https://${process.env.RAILWAY_STATIC_URL}`
].filter(Boolean);

app.use(cors({
    origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin) || NODE_ENV === 'development') {
            callback(null, true);
        } else {
            callback(new Error('Origen no permitido por la política de CORS'));
        }
    }
}));

const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: 'Demasiadas solicitudes enviadas. Por favor, intente de nuevo en 15 minutos.' }
});

app.use('/api/', apiLimiter);

// --- Middlewares Generales ---
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// --- Configuración de la Base de Datos PostgreSQL ---
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

pool.query('SELECT NOW()')
    .then(() => console.log('✅ Conexión a la base de datos PostgreSQL exitosa.'))
    .catch(err => {
        console.error('❌ ERROR: No se pudo conectar a la base de datos PostgreSQL.', err);
        process.exit(1);
    });

// --- Función para Generar Folio Único ---
function generarFolio() {
    const fecha = new Date();
    const anio = fecha.getFullYear();
    const mes = String(fecha.getMonth() + 1).padStart(2, '0');
    const dia = String(fecha.getDate()).padStart(2, '0');
    const aleatorio = crypto.randomBytes(2).toString('hex').toUpperCase();
    return `QJ-${anio}${mes}${dia}-${aleatorio}`;
}

// --- Configuración de Quejas ---
const QUEJAS_CONFIG = {
    'Retraso': { tableName: 'quejas_retraso', fields: ['detalles_retraso', 'direccion_subida', 'hora_programada', 'hora_llegada', 'metodo_transporte_alterno', 'monto_gastado', 'hora_llegada_planta'] },
    'Mal trato': { tableName: 'quejas_mal_trato', fields: ['nombre_conductor_maltrato', 'detalles_maltrato'] },
    'Inseguridad': { tableName: 'quejas_inseguridad', fields: ['detalles_inseguridad', 'ubicacion_inseguridad'] },
    'Unidad en mal estado': { tableName: 'quejas_unidad_mal_estado', fields: ['numero_unidad_malestado', 'tipo_falla', 'detalles_malestado'] },
    'Otro': { tableName: 'quejas_otro', fields: ['detalles_otro'] }
};

// --- RUTAS DEL SERVIDOR ---

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/enviar-queja', async (req, res) => {
    try {
        const { tipo, numero_empleado, empresa, ruta, colonia, turno, latitud, longitud, numero_unidad, ...detalles } = req.body;
        const config = QUEJAS_CONFIG[tipo];
        if (!config) { return res.status(400).json({ success: false, error: 'El tipo de queja especificado no es válido.' }); }
        const nuevoFolio = generarFolio();
        const commonFields = ['numero_empleado', 'empresa', 'ruta', 'colonia', 'turno', 'tipo', 'latitud', 'longitud', 'numero_unidad', 'folio'];
        const specificFields = config.fields;
        const allFieldNames = [...commonFields, ...specificFields];
        const allValues = [
            numero_empleado, empresa, ruta, colonia, turno, tipo,
            latitud || null, longitud || null, numero_unidad || null, nuevoFolio,
            ...specificFields.map(field => (detalles[field] === '' ? null : detalles[field]))
        ];
        const queryFields = allFieldNames.join(', ');
        const queryValuePlaceholders = allFieldNames.map((_, i) => `$${i + 1}`).join(', ');
        const query = `INSERT INTO ${config.tableName} (${queryFields}) VALUES (${queryValuePlaceholders}) RETURNING id;`;
        const result = await pool.query(query, allValues);
        console.log(`✅ Queja registrada en tabla '${config.tableName}' con ID: ${result.rows[0].id} y Folio: ${nuevoFolio}`);
        res.status(201).json({ success: true, message: "¡Queja registrada con éxito!", folio: nuevoFolio });
    } catch (error) {
        console.error('❌ Error al procesar la queja:', error);
        if (error.code === '23505') { return res.status(500).json({ success: false, error: 'Error al generar un folio único. Por favor, inténtelo de nuevo.' }); }
        res.status(500).json({ success: false, error: 'Error interno del servidor al procesar la solicitud.' });
    }
});

app.get('/api/quejas', async (req, res) => {
    try {
        const tableNames = Object.values(QUEJAS_CONFIG).map(c => c.tableName);
        const queries = tableNames.map(tableName => pool.query(`SELECT *, '${tableName}' as tabla_origen FROM ${tableName}`));
        const results = await Promise.all(queries);
        const allQuejas = results.flatMap(result => result.rows);
        allQuejas.sort((a, b) => new Date(b.fecha_creacion) - new Date(a.fecha_creacion));
        res.status(200).json(allQuejas);
    } catch (error) {
        console.error('❌ Error al obtener las quejas:', error);
        res.status(500).json({ success: false, error: 'Error al consultar la base de datos.' });
    }
});

// =================================================================
// 🔥 RUTA PUT ACTUALIZADA PARA USAR TRANSACCIONES 🔥
// =================================================================
app.put('/api/queja/resolver', async (req, res) => {
    const client = await pool.connect(); // Obtiene un cliente del pool para la transacción

    try {
        const { id, tabla_origen, folio, resolucion, estado = 'Revisada' } = req.body;

        if (!id || !tabla_origen || !folio || !resolucion) {
            return res.status(400).json({ success: false, error: 'Faltan datos requeridos (id, tabla_origen, folio, resolucion).' });
        }
        
        const tablasPermitidas = Object.values(QUEJAS_CONFIG).map(c => c.tableName);
        if (!tablasPermitidas.includes(tabla_origen)) {
            return res.status(400).json({ success: false, error: 'Nombre de tabla no válido.' });
        }

        // 1. Inicia la transacción
        await client.query('BEGIN');

        // 2. Actualiza el estado en la tabla original de la queja
        const updateQuery = `UPDATE ${tabla_origen} SET estado_queja = $1 WHERE id = $2;`;
        await client.query(updateQuery, [estado, id]);

        // 3. Inserta el registro en la nueva tabla de resoluciones
        const insertQuery = `INSERT INTO resoluciones (folio_queja, texto_resolucion, responsable) VALUES ($1, $2, $3);`;
        await client.query(insertQuery, [folio, resolucion, 'Administrador']);

        // 4. Si ambas operaciones tuvieron éxito, confirma la transacción
        await client.query('COMMIT');

        console.log(`✅ Queja con folio ${folio} actualizada y resolución registrada.`);
        res.status(200).json({ success: true, message: 'Queja resuelta y registrada.' });

    } catch (error) {
        // 5. Si cualquier operación falla, revierte todos los cambios
        await client.query('ROLLBACK');
        console.error('❌ Error en la transacción, cambios revertidos:', error);
        res.status(500).json({ success: false, error: 'Error interno del servidor al procesar la resolución.' });
    } finally {
        // 6. Libera al cliente de vuelta al pool
        client.release();
    }
});

// --- Rutas de Utilidad y Manejo de Errores ---
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use((req, res, next) => {
    res.status(404).json({ success: false, error: `Ruta no encontrada: ${req.originalUrl}` });
});

app.use((error, req, res, next) => {
    console.error('❌ ERROR NO MANEJADO:', error);
    res.status(500).json({ success: false, error: 'Ha ocurrido un error inesperado en el servidor.' });
});

// --- Arranque del Servidor ---
const server = app.listen(PORT, () => {
    console.log(`🚀 Servidor de Quejas v4.9 corriendo en http://localhost:${PORT} en modo ${NODE_ENV}`);
});

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