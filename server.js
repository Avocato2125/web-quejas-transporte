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
const ALLOWED_TABLES = { /* ... (sin cambios) ... */ };
const QUEJAS_CONFIG = { /* ... (sin cambios) ... */ };
const baseQuejaSchema = Joi.object({ /* ... (sin cambios) ... */ });
const quejaSchemas = { /* ... (sin cambios) ... */ };
const authenticateToken = (req, res, next) => { /* ... (sin cambios) ... */ };
const requireRole = (roles) => { /* ... (sin cambios) ... */ };
function generarFolio() { /* ... (sin cambios) ... */ }

// --- RUTAS DEL SERVIDOR ---
app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'index.html')); });
app.post('/api/login', loginLimiter, async (req, res) => { /* ... (código sin cambios) ... */ });
app.post('/api/refresh', async (req, res) => { /* ... (código sin cambios) ... */ });
app.post('/enviar-queja', quejaLimiter, async (req, res) => { /* ... (código sin cambios) ... */ });
app.get('/api/quejas', authenticateToken, async (req, res) => { /* ... (código sin cambios) ... */ });
app.put('/api/queja/resolver', authenticateToken, requireRole(['admin', 'supervisor']), async (req, res) => { /* ... (código sin cambios) ... */ });
app.post('/api/logout', authenticateToken, async (req, res) => { /* ... (código sin cambios) ... */ });

// --- Rutas de Utilidad y Manejo de Errores ---
app.get('/health', (req, res) => { res.status(200).json({ status: 'ok', version: '6.1' }); });
app.use((req, res, next) => { logger.warn(`Ruta no encontrada: ${req.method} ${req.originalUrl} desde IP: ${req.ip}`); res.status(404).json({ success: false, error: `Ruta no encontrada` }); });
app.use((error, req, res, next) => { logger.error('ERROR NO MANEJADO:', { error: error.message, stack: error.stack }); res.status(500).json({ success: false, error: 'Error inesperado.' }); });

// --- Arranque del Servidor ---
const server = app.listen(PORT, () => { logger.info(`🚀 Servidor de Quejas v6.1 iniciado en puerto ${PORT} en modo ${NODE_ENV}`); });
const gracefulShutdown = (signal) => { /* ... (código sin cambios) ... */ };
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('unhandledRejection', (reason, promise) => { logger.error('Promesa rechazada no manejada:', { reason }); });
process.on('uncaughtException', (error) => { logger.error('Excepción no capturada:', { error: error.message, stack: error.stack }); process.exit(1); });