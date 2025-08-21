// server.js (Versión 6.1 - Implementación Segura y Funcional)

require('dotenv').config();

// --- Dependencias ---
const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const Joi = require('joi');
const winston = require('winston');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const helmet = require('helmet');

// --- INICIALIZACIÓN Y CONFIGURACIÓN ---
const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';

// VARIABLES DE ENTORNO OBLIGATORIAS
const requiredEnvVars = ['DATABASE_URL', 'JWT_SECRET', 'REFRESH_JWT_SECRET'];
requiredEnvVars.forEach(envVar => {
    if (!process.env[envVar]) {
        console.error(`❌ ERROR CRÍTICO: Variable de entorno ${envVar} no definida.`);
        process.exit(1);
    }
});

const JWT_SECRET = process.env.JWT_SECRET;
const REFRESH_JWT_SECRET = process.env.REFRESH_JWT_SECRET;

// --- Logging con Winston MEJORADO ---
const logger = winston.createLogger({
    level: NODE_ENV === 'production' ? 'info' : 'debug',
    format: winston.format.combine(winston.format.timestamp(), winston.format.errors({ stack: true }), winston.format.json()),
    defaultMeta: { service: 'quejas-system' },
    transports: [
        new winston.transports.File({ filename: 'logs/error.log', level: 'error', maxsize: 5242880, maxFiles: 5, handleExceptions: true }),
        new winston.transports.File({ filename: 'logs/combined.log', maxsize: 5242880, maxFiles: 5 })
    ]
});
if (NODE_ENV !== 'production') {
    logger.add(new winston.transports.Console({ format: winston.format.combine(winston.format.colorize(), winston.format.simple()) }));
}

// --- Middlewares de Seguridad MEJORADOS ---
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            ...helmet.contentSecurityPolicy.getDefaultDirectives(),
            "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            "font-src": ["'self'", "https://fonts.gstatic.com"],
            "script-src": ["'self'", "'unsafe-inline'"],
            "img-src": ["'self'", "data:"]
        }
    }
}));

const allowedOrigins = [ process.env.CORS_ORIGIN, `https://${process.env.RAILWAY_STATIC_URL}` ].filter(Boolean);
app.use(cors({
    origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin) || NODE_ENV === 'development') {
            callback(null, true);
        } else {
            logger.warn(`Origen bloqueado por CORS: ${origin}`);
            callback(new Error('Origen no permitido por la política de CORS'));
        }
    },
    credentials: true
}));

// RATE LIMITING ESPECÍFICO
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 5, skipSuccessfulRequests: true, message: { success: false, error: 'Demasiados intentos de login.' } });
const quejaLimiter = rateLimit({ windowMs: 60 * 1000, max: 3, message: { success: false, error: 'Límite de quejas por minuto alcanzado.' } });
app.use('/api/', rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }));

// --- Middlewares Generales ---
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// --- Configuración de la Base de Datos ---
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    max: 20, idleTimeoutMillis: 30000, connectionTimeoutMillis: 2000
});
pool.query('SELECT NOW()').then(() => logger.info('✅ Conexión a PostgreSQL exitosa')).catch(err => { logger.error('❌ Error conectando a PostgreSQL', { error: err.message }); process.exit(1); });

// --- Lógica de Negocio y Configuración ---
const ALLOWED_TABLES = { 'quejas_retraso': true, 'quejas_mal_trato': true, 'quejas_inseguridad': true, 'quejas_unidad_mal_estado': true, 'quejas_otro': true };
const QUEJAS_CONFIG = {
    'Retraso': { tableName: 'quejas_retraso', fields: ['detalles_retraso', 'direccion_subida', 'hora_programada', 'hora_llegada', 'metodo_transporte_alterno', 'monto_gastado', 'hora_llegada_planta'] },
    'Mal trato': { tableName: 'quejas_mal_trato', fields: ['nombre_conductor_maltrato', 'detalles_maltrato'] },
    'Inseguridad': { tableName: 'quejas_inseguridad', fields: ['detalles_inseguridad', 'ubicacion_inseguridad'] },
    'Unidad en mal estado': { tableName: 'quejas_unidad_mal_estado', fields: ['numero_unidad_malestado', 'tipo_falla', 'detalles_malestado'] },
    'Otro': { tableName: 'quejas_otro', fields: ['detalles_otro'] }
};
const baseQuejaSchema = Joi.object({
    numero_empleado: Joi.string().pattern(/^\d{4,10}$/).required().messages({'string.pattern.base': 'Número de empleado debe contener solo dígitos (4-10 caracteres)'}),
    empresa: Joi.string().min(2).max(100).trim().required(),
    ruta: Joi.string().max(50).trim().required(),
    colonia: Joi.string().max(100).trim().required(),
    turno: Joi.string().valid('Primero', 'Segundo', 'Tercero', 'Mixto').required(),
    tipo: Joi.string().valid(...Object.keys(QUEJAS_CONFIG)).required(),
    latitud: Joi.number().min(-90).max(90).allow(null, ''),
    longitud: Joi.number().min(-180).max(180).allow(null, ''),
    numero_unidad: Joi.string().max(20).trim().allow(null, '')
});
const quejaSchemas = {
    'Retraso': baseQuejaSchema.keys({
        detalles_retraso: Joi.string().max(500).trim().required(),
        direccion_subida: Joi.string().max(200).trim().required(),
        hora_programada: Joi.string().pattern(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/).required(),
        hora_llegada: Joi.string().pattern(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/).required(),
        metodo_transporte_alterno: Joi.string().max(100).trim().allow(null, ''),
        monto_gastado: Joi.number().min(0).max(10000).allow(null, ''),
        hora_llegada_planta: Joi.string().pattern(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/).allow(null, '')
    }),
    'Mal trato': baseQuejaSchema.keys({ nombre_conductor_maltrato: Joi.string().max(100).trim().allow(null, ''), detalles_maltrato: Joi.string().max(500).trim().required() }),
    'Inseguridad': baseQuejaSchema.keys({ detalles_inseguridad: Joi.string().max(500).trim().required(), ubicacion_inseguridad: Joi.string().max(200).trim().required() }),
    'Unidad en mal estado': baseQuejaSchema.keys({ numero_unidad_malestado: Joi.string().max(20).trim().allow(null, ''), tipo_falla: Joi.string().max(200).trim().required(), detalles_malestado: Joi.string().max(500).trim().required() }),
    'Otro': baseQuejaSchema.keys({ detalles_otro: Joi.string().max(500).trim().required() })
};
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) { logger.warn(`Intento de acceso sin token desde IP: ${req.ip}`); return res.status(401).json({ success: false, error: 'Token de acceso requerido' }); }
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) { logger.warn(`Token inválido desde IP: ${req.ip}, Error: ${err.message}`); return res.status(403).json({ success: false, error: 'Token inválido o expirado' }); }
        req.user = user;
        next();
    });
};
const requireRole = (roles) => {
    return (req, res, next) => {
        if (!roles.includes(req.user.role)) {
            logger.warn(`Acceso denegado para usuario ${req.user.username} con rol ${req.user.role}`);
            return res.status(403).json({ success: false, error: 'Permisos insuficientes' });
        }
        next();
    };
};
function generarFolio() {
    const fecha = new Date();
    const anio = fecha.getFullYear();
    const mes = String(fecha.getMonth() + 1).padStart(2, '0');
    const dia = String(fecha.getDate()).padStart(2, '0');
    const aleatorio = crypto.randomBytes(3).toString('hex').toUpperCase();
    return `QJ-${anio}${mes}${dia}-${aleatorio}`;
}

// --- RUTAS DEL SERVIDOR ---
app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'index.html')); });
app.post('/api/login', loginLimiter, async (req, res) => { /* ... (código sin cambios) ... */ });
app.post('/api/refresh', async (req, res) => { /* ... (código sin cambios) ... */ });
app.post('/enviar-queja', quejaLimiter, async (req, res) => {
    const { tipo } = req.body;
    const schema = quejaSchemas[tipo];
    if (!schema) { return res.status(400).json({ success: false, error: 'Tipo de queja no válido' }); }
    const { error } = schema.validate(req.body, { abortEarly: false, allowUnknown: true });
    if (error) {
        const errores = error.details.map(d => d.message).join(', ');
        logger.warn(`Intento de envío de queja con datos inválidos: ${errores}`, { ip: req.ip });
        return res.status(400).json({ success: false, error: `Datos inválidos: ${errores}` });
    }
    try {
        const { numero_empleado, empresa, ruta, colonia, turno, latitud, longitud, numero_unidad, ...detalles } = req.body;
        const config = QUEJAS_CONFIG[tipo];
        if (!ALLOWED_TABLES[config.tableName]) { throw new Error(`Tabla no permitida: ${config.tableName}`); }
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
        logger.info(`Queja registrada exitosamente`, { folio: nuevoFolio, tabla: config.tableName, id: result.rows[0].id, ip: req.ip });
        res.status(201).json({ success: true, message: "¡Queja registrada con éxito!", folio: nuevoFolio });
    } catch (error) {
        logger.error('Error al procesar la queja:', { error: error.message, stack: error.stack, body: req.body, ip: req.ip });
        if (error.code === '23505') { return res.status(500).json({ success: false, error: 'Error al generar un folio único.' }); }
        res.status(500).json({ success: false, error: 'Error interno del servidor.' });
    }
});
app.get('/api/quejas', authenticateToken, async (req, res) => { /* ... (código sin cambios) ... */ });
app.put('/api/queja/resolver', authenticateToken, requireRole(['admin', 'supervisor']), async (req, res) => { /* ... (código sin cambios) ... */ });
app.post('/api/logout', authenticateToken, async (req, res) => { /* ... (código sin cambios) ... */ });

// --- RUTAS DE UTILIDAD Y MANEJO DE ERRORES ---
app.get('/health', (req, res) => { res.status(200).json({ status: 'ok', version: '6.1' }); });
app.use((req, res, next) => { logger.warn(`Ruta no encontrada: ${req.method} ${req.originalUrl} desde IP: ${req.ip}`); res.status(404).json({ success: false, error: `Ruta no encontrada` }); });
app.use((error, req, res, next) => { logger.error('ERROR NO MANEJADO:', { error: error.message, stack: error.stack }); res.status(500).json({ success: false, error: 'Error inesperado.' }); });

// --- ARRANQUE DEL SERVIDOR ---
const server = app.listen(PORT, () => { logger.info(`🚀 Servidor de Quejas v6.1 iniciado en puerto ${PORT} en modo ${NODE_ENV}`); });
const gracefulShutdown = (signal) => { /* ... (código sin cambios) ... */ };
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('unhandledRejection', (reason, promise) => { logger.error('Promesa rechazada no manejada:', { reason }); });
process.on('uncaughtException', (error) => { logger.error('Excepción no capturada:', { error: error.message, stack: error.stack }); process.exit(1); });