// server.js (Versión 4.5 - Añadidos campos de transporte alterno)

// Carga las variables de entorno del archivo .env para uso local.
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
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: 'Demasiadas solicitudes enviadas. Por favor, intente de nuevo en 15 minutos.' }
});

app.use('/enviar-queja', apiLimiter);
app.use('/api/quejas/:tipo/:id/resolver', apiLimiter);

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

// =================================================================
// 🔥 PATRÓN DE MAPEO: CONFIGURACIÓN CENTRALIZADA DE QUEJAS 🔥
// =================================================================
const QUEJAS_CONFIG = {
    'Retraso': {
        tableName: 'quejas_retraso',
        // --- CAMBIO CLAVE AQUÍ ---
        fields: [
            'detalles_retraso', 
            'direccion_subida', 
            'hora_programada', 
            'hora_llegada',
            'metodo_transporte_alterno', // <-- Añadido
            'monto_gastado',             // <-- Añadido
            'hora_llegada_planta'      // <-- Añadido
        ]
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

// --- RUTAS DEL SERVIDOR ---

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// La ruta POST no necesita cambios lógicos, ya que el patrón de mapeo se encarga de todo.
app.post('/enviar-queja', async (req, res) => {
    try {
        const { tipo, numero_empleado, empresa, ruta, colonia, turno, latitud, longitud, numero_unidad, ...detalles } = req.body;
        
        const config = QUEJAS_CONFIG[tipo];
        if (!config) {
            return res.status(400).json({ success: false, error: 'El tipo de queja especificado no es válido.' });
        }

        const nuevoFolio = generarFolio();
        const commonFields = ['numero_empleado', 'empresa', 'ruta', 'colonia', 'turno', 'tipo', 'latitud', 'longitud', 'numero_unidad', 'folio'];
        const specificFields = config.fields;
        
        const allFieldNames = [...commonFields, ...specificFields];
        const allValues = [
            numero_empleado, empresa, ruta, colonia, turno, tipo,
            latitud || null,
            longitud || null,
            numero_unidad || null,
            nuevoFolio,
            ...specificFields.map(field => detalles[field] || null)
        ];

        const queryFields = allFieldNames.join(', ');
        const queryValuePlaceholders = allFieldNames.map((_, i) => `$${i + 1}`).join(', ');

        const query = `
            INSERT INTO ${config.tableName} (${queryFields})
            VALUES (${queryValuePlaceholders})
            RETURNING id;
        `;
        
        const result = await pool.query(query, allValues);

        console.log(`✅ Queja registrada en tabla '${config.tableName}' con ID: ${result.rows[0].id} y Folio: ${nuevoFolio}`);
        
        res.status(201).json({ 
            success: true, 
            message: "¡Queja registrada con éxito!",
            folio: nuevoFolio 
        });

    } catch (error) {
        console.error('❌ Error al procesar la queja:', error);
        if (error.code === '23505') {
            return res.status(500).json({ success: false, error: 'Error al generar un folio único. Por favor, inténtelo de nuevo.' });
        }
        res.status(500).json({ success: false, error: 'Error interno del servidor al procesar la solicitud.' });
    }
});

// El resto de las rutas no necesitan cambios
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
    console.log('🚀 ==================================================');
    console.log(`  Servidor de Quejas v4.5 - Transporte Alterno`);
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