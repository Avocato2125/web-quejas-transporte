// server.js (Versión 4.7 - Ruta PUT mejorada y lista para el dashboard)

require('dotenv').config();
const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';

if (!process.env.DATABASE_URL) {
    console.error('❌ ERROR CRÍTICO: La variable de entorno DATABASE_URL no está definida.');
    process.exit(1);
}

// Middlewares (sin cambios)
const allowedOrigins = [ process.env.CORS_ORIGIN, `https://${process.env.RAILWAY_STATIC_URL}` ].filter(Boolean);
app.use(cors({
    origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin) || NODE_ENV === 'development') {
            callback(null, true);
        } else {
            callback(new Error('Origen no permitido por la política de CORS'));
        }
    }
}));
const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100, standardHeaders: true, legacyHeaders: false, message: { success: false, error: 'Demasiadas solicitudes.' } });
app.use('/api/', apiLimiter); // Aplicar limiter a todas las rutas API
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Configuración de la Base de Datos (sin cambios)
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});
pool.query('SELECT NOW()').then(() => console.log('✅ Conexión a la base de datos PostgreSQL exitosa.')).catch(err => { console.error('❌ ERROR: No se pudo conectar a la base de datos.', err); process.exit(1); });

function generarFolio() {
    const fecha = new Date();
    const anio = fecha.getFullYear();
    const mes = String(fecha.getMonth() + 1).padStart(2, '0');
    const dia = String(fecha.getDate()).padStart(2, '0');
    const aleatorio = crypto.randomBytes(2).toString('hex').toUpperCase();
    return `QJ-${anio}${mes}${dia}-${aleatorio}`;
}

const QUEJAS_CONFIG = {
    'Retraso': { tableName: 'quejas_retraso', fields: ['detalles_retraso', 'direccion_subida', 'hora_programada', 'hora_llegada', 'metodo_transporte_alterno', 'monto_gastado', 'hora_llegada_planta'] },
    'Mal trato': { tableName: 'quejas_mal_trato', fields: ['nombre_conductor_maltrato', 'detalles_maltrato'] },
    'Inseguridad': { tableName: 'quejas_inseguridad', fields: ['detalles_inseguridad', 'ubicacion_inseguridad'] },
    'Unidad en mal estado': { tableName: 'quejas_unidad_mal_estado', fields: ['numero_unidad_malestado', 'tipo_falla', 'detalles_malestado'] },
    'Otro': { tableName: 'quejas_otro', fields: ['detalles_otro'] }
};

// Rutas GET y POST (sin cambios)
app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'index.html')); });
app.post('/enviar-queja', async (req, res) => { /* ...código sin cambios... */ });
app.get('/api/quejas', async (req, res) => { /* ...código sin cambios... */ });

// =================================================================
// 🔥 RUTA PUT REFACTORIZADA 🔥
// Ahora es más genérica y segura.
// =================================================================
app.put('/api/queja/resolver', async (req, res) => {
    try {
        const { id, tabla_origen, resolucion, estado = 'Revisada' } = req.body;

        // Validaciones de seguridad
        if (!id || !tabla_origen || !resolucion) {
            return res.status(400).json({ success: false, error: 'Faltan datos requeridos (id, tabla_origen, resolucion).' });
        }
        
        // Lista blanca de tablas permitidas para evitar inyección SQL
        const tablasPermitidas = Object.values(QUEJAS_CONFIG).map(c => c.tableName);
        if (!tablasPermitidas.includes(tabla_origen)) {
            return res.status(400).json({ success: false, error: 'Nombre de tabla no válido.' });
        }

        const query = `
            UPDATE ${tabla_origen}
            SET estado_queja = $1, resolucion = $2, fecha_resolucion = NOW()
            WHERE id = $3
            RETURNING *;
        `;
        
        const result = await pool.query(query, [estado, resolucion, id]);

        if (result.rowCount === 0) {
            return res.status(404).json({ success: false, error: 'Queja no encontrada.' });
        }

        console.log(`✅ Queja ${id} de la tabla ${tabla_origen} actualizada.`);
        res.status(200).json({ success: true, queja: result.rows[0] });

    } catch (error) {
        console.error('❌ Error al resolver la queja:', error);
        res.status(500).json({ success: false, error: 'Error interno del servidor.' });
    }
});


// Rutas de Utilidad y Manejo de Errores (sin cambios)
app.get('/health', (req, res) => { res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() }); });
app.use((req, res, next) => { res.status(404).json({ success: false, error: `Ruta no encontrada: ${req.originalUrl}` }); });
app.use((error, req, res, next) => { console.error('❌ ERROR NO MANEJADO:', error); res.status(500).json({ success: false, error: 'Ha ocurrido un error inesperado en el servidor.' }); });

// Arranque del Servidor (sin cambios)
const server = app.listen(PORT, () => { console.log(`🚀 Servidor de Quejas v4.7 corriendo en http://localhost:${PORT} en modo ${NODE_ENV}`); });
const gracefulShutdown = () => { server.close(() => { pool.end(() => { process.exit(0); }); }); };
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);