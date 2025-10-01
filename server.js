// server.js (Versión 6.4 - CORREGIDO)

require('dotenv').config();

// --- Dependencias ---
const express = require('express');
const path = require('path');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const helmet = require('helmet');
const { Pool } = require('pg');
const Joi = require('joi');
const crypto = require('crypto');
const winston = require('winston');
const puppeteer = require('puppeteer');
const fs = require('fs');

// --- Configuración ---
const validateEnv = require('./config/env.validation');
const { mainLogger: logger, securityLogger, auditLogger } = require('./config/logger');

// Validar variables de entorno
const env = validateEnv();
const { sanitizeRequestBody, sanitizeQueryParams, sanitizeForFrontend } = require('./middleware/sanitization');
const { errorHandler, notFoundHandler, requestLogger } = require('./middleware/errorHandler');
const { validateQueja } = require('./middleware/validation');

// --- INICIALIZACIÓN Y CONFIGURACIÓN ---
const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';

// --- Middlewares de Seguridad ---
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
            fontSrc: ["'self'", 'https://fonts.gstatic.com'],
            scriptSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", 'data:']
        }
    },
    xFrameOptions: { action: 'deny' },
    xContentTypeOptions: true,
    xXssProtection: true,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true
    }
}));

const allowedOrigins = [ 
    process.env.CORS_ORIGIN, 
    `https://${process.env.RAILWAY_STATIC_URL}` 
].filter(Boolean);

app.use(cors({ 
    origin: (origin, callback) => { 
        if (!origin || allowedOrigins.includes(origin) || NODE_ENV === 'development') { 
            callback(null, true); 
        } else { 
            logger.warn(`Origen bloqueado por CORS: ${origin}`); 
            callback(new Error('Origen no permitido por CORS')); 
        } 
    }, 
    credentials: true 
}));

// Rate Limiting
const { configureRateLimiting } = require('./middleware/rateLimiting');
const { loginLimiter, quejaLimiter, generalLimiter } = configureRateLimiting(logger);

// --- Middlewares Generales ---
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// --- Middlewares de Sanitización y Logging ---
app.use(sanitizeRequestBody);
app.use(sanitizeQueryParams);
app.use(requestLogger);

// Validar variables de entorno requeridas (solo en producción)
if (NODE_ENV === 'production') {
    const requiredEnvVars = ['DATABASE_URL', 'JWT_SECRET', 'REFRESH_JWT_SECRET'];
    const missingVars = requiredEnvVars.filter(envVar => !process.env[envVar]);
    
    if (missingVars.length > 0) {
        logger.error(`ERROR CRÍTICO: Variables de entorno faltantes: ${missingVars.join(', ')}`);
        process.exit(1);
    }
} else {
    // En desarrollo, solo mostrar warnings
    const requiredEnvVars = ['DATABASE_URL', 'JWT_SECRET', 'REFRESH_JWT_SECRET'];
    requiredEnvVars.forEach(envVar => { 
        if (!process.env[envVar]) { 
            logger.warn(`Variable de entorno ${envVar} no definida. Algunas funcionalidades pueden no funcionar.`); 
        } 
    });
}

const JWT_SECRET = process.env.JWT_SECRET;
const REFRESH_JWT_SECRET = process.env.REFRESH_JWT_SECRET;

// --- Configuración de la Base de Datos ---
let pool = null;

if (process.env.DATABASE_URL) {
    pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000
    });

    pool.query('SELECT NOW()')
        .then(async () => {
            logger.info('Conexión a PostgreSQL exitosa');

            // Verificar que existan tablas clave; si no, ejecutar esquema automáticamente
            try {
                const check = await pool.query("SELECT COUNT(*)::int AS count FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('users','quejas_retraso','resoluciones')");
                const count = check.rows?.[0]?.count || 0;
                if (count < 3) {
                    logger.warn('Tablas clave no encontradas. Ejecutando esquema para inicializar la base de datos...');
                    const schemaPath = path.join(__dirname, 'database', 'schema.sql');
                    const schemaSql = fs.readFileSync(schemaPath, 'utf8');
                    await pool.query(schemaSql);
                    logger.info('Esquema ejecutado correctamente. Tablas creadas.');
                }
            } catch (schemaErr) {
                logger.error('Error asegurando el esquema de base de datos:', { error: schemaErr.message });
            }
        })
        .catch(err => {
            logger.error('Error conectando a PostgreSQL', { error: err.message });
            logger.warn('Continuando sin base de datos...');
        });
} else {
    logger.warn('DATABASE_URL no definida. La aplicación funcionará sin base de datos.');
}

// --- Configuración de Quejas ---
const ALLOWED_TABLES = {
    'quejas_retraso': true,
    'quejas_mal_trato': true,
    'quejas_inseguridad': true,
    'quejas_unidad_mal_estado': true,
    'quejas_otro': true
};

const QUEJAS_CONFIG = {
    'Retraso': { 
        tableName: 'quejas_retraso', 
        fields: ['detalles_retraso', 'direccion_subida', 'hora_programada', 'hora_llegada', 'metodo_transporte_alterno', 'monto_gastado', 'hora_llegada_planta'] 
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

// --- VALIDACIÓN SIMPLIFICADA ---
const baseQuejaSchema = Joi.object({
    numero_empleado: Joi.string().required(),
    empresa: Joi.string().required(),
    ruta: Joi.string().allow(null, ''),
    colonia: Joi.string().allow(null, ''),
    turno: Joi.string().allow(null, ''),
    tipo: Joi.string().valid(...Object.keys(QUEJAS_CONFIG)).required(),
    latitud: Joi.number().allow(null, ''),
    longitud: Joi.number().allow(null, ''),
    numero_unidad: Joi.string().allow(null, '')
});

const quejaSchemas = {
    'Retraso': baseQuejaSchema.keys({
        detalles_retraso: Joi.string().allow(null, ''),
        direccion_subida: Joi.string().allow(null, ''),
        hora_programada: Joi.string().allow(null, ''),
        hora_llegada: Joi.string().allow(null, ''),
        metodo_transporte_alterno: Joi.string().allow(null, ''),
        monto_gastado: Joi.number().allow(null, ''),
        hora_llegada_planta: Joi.string().allow(null, '')
    }),
    'Mal trato': baseQuejaSchema.keys({
        nombre_conductor_maltrato: Joi.string().allow(null, ''),
        detalles_maltrato: Joi.string().allow(null, '')
    }),
    'Inseguridad': baseQuejaSchema.keys({
        detalles_inseguridad: Joi.string().allow(null, ''),
        ubicacion_inseguridad: Joi.string().allow(null, '')
    }),
    'Unidad en mal estado': baseQuejaSchema.keys({
        numero_unidad_malestado: Joi.string().allow(null, ''),
        tipo_falla: Joi.string().allow(null, ''),
        detalles_malestado: Joi.string().allow(null, '')
    }),
    'Otro': baseQuejaSchema.keys({
        detalles_otro: Joi.string().allow(null, '')
    })
};

// --- MIDDLEWARE DE AUTENTICACIÓN ---
const { authenticateToken, requireRole, verifyRefreshToken } = require('./middleware/auth');

// --- FUNCIÓN PARA GENERAR FOLIO ---
function generarFolio() {
    const fecha = new Date();
    const anio = fecha.getFullYear();
    const mes = String(fecha.getMonth() + 1).padStart(2, '0');
    const dia = String(fecha.getDate()).padStart(2, '0');
    const aleatorio = crypto.randomBytes(3).toString('hex').toUpperCase();
    return `QJ-${anio}${mes}${dia}-${aleatorio}`;
}

// --- RUTAS DEL SERVIDOR ---
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- Health Check Simple para Railway ---
app.get('/health-simple', (req, res) => {
    res.status(200).json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        version: '6.4.0'
    });
});

// --- Endpoint de Salud ---
app.get('/health', async (req, res) => {
    try {
        const healthCheck = {
            status: 'healthy',
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            environment: NODE_ENV,
            version: '6.4.0',
            services: {
                database: 'unknown',
                memory: {
                    used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
                    total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
                    unit: 'MB'
                }
            }
        };

        // Verificar conexión a la base de datos con timeout
        if (pool) {
            try {
                const dbPromise = pool.query('SELECT 1');
                const timeoutPromise = new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Database timeout')), 5000)
                );
                
                await Promise.race([dbPromise, timeoutPromise]);
                healthCheck.services.database = 'connected';
            } catch (dbError) {
                healthCheck.services.database = 'disconnected';
                healthCheck.status = 'degraded';
                healthCheck.errors = {
                    database: dbError.message
                };
            }
        } else {
            healthCheck.services.database = 'not_configured';
            healthCheck.status = 'degraded';
            healthCheck.errors = {
                database: 'DATABASE_URL not configured'
            };
        }

        // En producción, siempre devolver 200 para el health check básico
        // El status 'degraded' indica problemas pero no impide el funcionamiento
        const statusCode = NODE_ENV === 'production' ? 200 : 
                          (healthCheck.status === 'healthy' ? 200 : 503);
        
        res.status(statusCode).json(healthCheck);

    } catch (error) {
        logger.error('Error en health check:', error);
        res.status(500).json({
            status: 'unhealthy',
            timestamp: new Date().toISOString(),
            error: 'Internal server error'
        });
    }
});

// --- RUTAS DE AUTENTICACIÓN ---
const authRoutes = require('./routes/auth.routes')(pool, logger, loginLimiter, authenticateToken, verifyRefreshToken);
app.use('/api/auth', authRoutes);
// Alias para compatibilidad: permitir /api/login, /api/logout, /api/refresh-token
app.use('/api', authRoutes);

// --- RUTAS DE QUEJAS ---
const quejasRoutes = require('./routes/quejas.routes.js')(pool, logger, quejaLimiter, authenticateToken, requireRole, quejaSchemas, QUEJAS_CONFIG, ALLOWED_TABLES, generarFolio, sanitizeForFrontend, puppeteer, fs, path);
app.use('/', quejasRoutes);

// --- Middlewares de Manejo de Errores (deben ir al final) ---
app.use(notFoundHandler);
app.use(errorHandler);

// --- Arranque del Servidor ---
const server = app.listen(PORT, () => {
    logger.info(`Servidor de Quejas v6.4 iniciado en puerto ${PORT} en modo ${NODE_ENV}`);
});

// --- Manejo de Señales Graceful Shutdown ---
const gracefulShutdown = (signal) => {
    logger.info(`Recibida señal ${signal}. Iniciando cierre elegante...`);
    server.close(() => {
        logger.info('Servidor HTTP cerrado.');
        pool.end(() => {
            logger.info('Pool de base de datos cerrado.');
            process.exit(0);
        });
    });
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('unhandledRejection', (reason, promise) => {
    logger.error('Promesa rechazada no manejada:', { reason, promise });
});

process.on('uncaughtException', (error) => {
    logger.error('Excepción no capturada:', { error: error.message, stack: error.stack });
    shutdown(1);
});

async function shutdown(code = 0) {
    logger.info('Iniciando proceso de apagado...');
    if (server) {
        await new Promise(resolve => server.close(resolve));
    }
    try {
        if (pool) {
            await pool.end();
            logger.info('Conexión a la base de datos cerrada correctamente');
        }
    } catch (err) {
        logger.error('Error al cerrar la conexión con la base de datos:', err);
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
    process.exit(code);
}
