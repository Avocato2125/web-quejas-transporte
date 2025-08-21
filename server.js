// server.js (Versión 6.3 - CORREGIDO Rate Limiting para Testing)

console.log("DATABASE_URL que está usando el servidor:", process.env.DATABASE_URL);
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

const requiredEnvVars = ['DATABASE_URL', 'JWT_SECRET', 'REFRESH_JWT_SECRET'];
requiredEnvVars.forEach(envVar => { 
    if (!process.env[envVar]) { 
        console.error(`❌ ERROR CRÍTICO: Variable de entorno ${envVar} no definida.`); 
        process.exit(1); 
    } 
});

const JWT_SECRET = process.env.JWT_SECRET;
const REFRESH_JWT_SECRET = process.env.REFRESH_JWT_SECRET;

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
    logger.add(new winston.transports.Console({ 
        format: winston.format.combine(winston.format.colorize(), winston.format.simple()) 
    }));
}

// --- Middlewares de Seguridad ---
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

// 🔥 CORRECCIÓN CRÍTICA: Rate Limiting aumentado para testing
const loginLimiter = rateLimit({ 
    windowMs: 15 * 60 * 1000, 
    max: 50, // ← AUMENTADO DE 5 A 50 PARA TESTING
    skipSuccessfulRequests: true, 
    message: { success: false, error: 'Demasiados intentos de login.' },
    handler: (req, res) => {
        logger.warn(`Rate limit alcanzado para login desde IP: ${req.ip}`);
        res.status(429).json({ success: false, error: 'Demasiados intentos de login. Intente en 15 minutos.' });
    }
});

const quejaLimiter = rateLimit({ 
    windowMs: 60 * 1000, 
    max: 3, 
    message: { success: false, error: 'Límite de quejas por minuto alcanzado.' } 
});

app.use('/api/', rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }));

// --- Middlewares Generales ---
app.use(express.json({ limit: '1mb' })); // Reducido de 10mb
app.use(express.static(path.join(__dirname, 'public')));

// --- Configuración de la Base de Datos ---
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000
});

pool.query('SELECT NOW()')
    .then(() => logger.info('✅ Conexión a PostgreSQL exitosa'))
    .catch(err => {
        logger.error('❌ Error conectando a PostgreSQL', { error: err.message });
        process.exit(1);
    });

// --- Configuración de Quejas CON VALIDACIÓN DE TABLA ---
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

// --- ESQUEMAS DE VALIDACIÓN COMPLETOS ---
const baseQuejaSchema = Joi.object({
    numero_empleado: Joi.string().pattern(/^\d{4,10}$/).required().messages({
        'string.pattern.base': 'Número de empleado debe contener solo dígitos (4-10 caracteres)'
    }),
    empresa: Joi.string().min(2).max(100).trim().required(),
    ruta: Joi.string().max(50).trim().required(),
    colonia: Joi.string().max(100).trim().required(),
    turno: Joi.string().valid('Primero', 'Segundo', 'Tercero', 'Mixto').required(),
    tipo: Joi.string().valid(...Object.keys(QUEJAS_CONFIG)).required(),
    latitud: Joi.number().min(-90).max(90).allow(null),
    longitud: Joi.number().min(-180).max(180).allow(null),
    numero_unidad: Joi.string().max(20).trim().allow(null, '')
});

const quejaSchemas = {
    'Retraso': baseQuejaSchema.keys({
        detalles_retraso: Joi.string().max(500).trim().required(),
        direccion_subida: Joi.string().max(200).trim().required(),
        hora_programada: Joi.string().pattern(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/).required(),
        hora_llegada: Joi.string().pattern(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/).required(),
        metodo_transporte_alterno: Joi.string().max(100).trim().allow(null, ''),
        monto_gastado: Joi.number().min(0).max(10000).allow(null),
        hora_llegada_planta: Joi.string().pattern(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/).allow(null, '')
    }),
    'Mal trato': baseQuejaSchema.keys({
        nombre_conductor_maltrato: Joi.string().max(100).trim().allow(null, ''),
        detalles_maltrato: Joi.string().max(500).trim().required()
    }),
    'Inseguridad': baseQuejaSchema.keys({
        detalles_inseguridad: Joi.string().max(500).trim().required(),
        ubicacion_inseguridad: Joi.string().max(200).trim().required()
    }),
    'Unidad en mal estado': baseQuejaSchema.keys({
        numero_unidad_malestado: Joi.string().max(20).trim().required(),
        tipo_falla: Joi.string().valid('Mecánica', 'Eléctrica', 'Carrocería', 'Limpieza', 'Otro').required(),
        detalles_malestado: Joi.string().max(500).trim().required()
    }),
    'Otro': baseQuejaSchema.keys({
        detalles_otro: Joi.string().max(500).trim().required()
    })
};

// --- MIDDLEWARE DE AUTENTICACIÓN JWT MEJORADO ---
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        logger.warn(`Intento de acceso sin token desde IP: ${req.ip}`);
        return res.status(401).json({ success: false, error: 'Token de acceso requerido' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            logger.warn(`Token inválido desde IP: ${req.ip}, Error: ${err.message}`);
            return res.status(403).json({ success: false, error: 'Token inválido o expirado' });
        }
        req.user = user;
        next();
    });
};

// MIDDLEWARE DE AUTORIZACIÓN POR ROLES
const requireRole = (roles) => {
    return (req, res, next) => {
        if (!roles.includes(req.user.role)) {
            logger.warn(`Acceso denegado para usuario ${req.user.username} con rol ${req.user.role}`);
            return res.status(403).json({ success: false, error: 'Permisos insuficientes' });
        }
        next();
    };
};

// --- FUNCIÓN PARA GENERAR FOLIO SEGURA ---
function generarFolio() {
    const fecha = new Date();
    const anio = fecha.getFullYear();
    const mes = String(fecha.getMonth() + 1).padStart(2, '0');
    const dia = String(fecha.getDate()).padStart(2, '0');
    const aleatorio = crypto.randomBytes(3).toString('hex').toUpperCase(); // Más entropía
    return `QJ-${anio}${mes}${dia}-${aleatorio}`;
}

// --- RUTAS DEL SERVIDOR ---

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// LOGIN SEGURO CON HASH DE CONTRASEÑAS
app.post('/api/login', loginLimiter, async (req, res) => {
    const schema = Joi.object({
        username: Joi.string().alphanum().min(3).max(30).required(),
        password: Joi.string().min(8).max(128).required()
    });

    const { error } = schema.validate(req.body);
    if (error) {
        return res.status(400).json({ 
            success: false, 
            error: error.details.map(d => d.message).join(', ') 
        });
    }

    const { username, password } = req.body;

    try {
        const result = await pool.query(
            'SELECT id, username, password_hash, role, active FROM users WHERE username = $1 AND active = true',
            [username]
        );

        if (result.rows.length === 0) {
            logger.warn(`Intento de login fallido para usuario: ${username} desde IP: ${req.ip}`);
            return res.status(401).json({ success: false, error: 'Credenciales inválidas' });
        }

        const user = result.rows[0];
        const validPassword = await bcrypt.compare(password, user.password_hash);

        if (!validPassword) {
            logger.warn(`Contraseña incorrecta para usuario: ${username} desde IP: ${req.ip}`);
            return res.status(401).json({ success: false, error: 'Credenciales inválidas' });
        }

        // Generar tokens
        const accessToken = jwt.sign(
            { 
                userId: user.id, 
                username: user.username, 
                role: user.role 
            },
            JWT_SECRET,
            { expiresIn: '15m' }
        );

        const refreshToken = jwt.sign(
            { userId: user.id },
            REFRESH_JWT_SECRET,
            { expiresIn: '7d' }
        );

        // Guardar refresh token hasheado en BD
        const hashedRefreshToken = await bcrypt.hash(refreshToken, 10);
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        
        await pool.query(
            'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
            [user.id, hashedRefreshToken, expiresAt]
        );

        logger.info(`Login exitoso para usuario: ${username} desde IP: ${req.ip}`);
        res.json({ 
            success: true, 
            accessToken, 
            refreshToken,
            user: { username: user.username, role: user.role }
        });

    } catch (error) {
        logger.error('Error en login:', { error: error.message, username });
        res.status(500).json({ success: false, error: 'Error interno del servidor' });
    }
});

// REFRESH TOKEN ENDPOINT
app.post('/api/refresh', async (req, res) => {
    const { refreshToken } = req.body;
    
    if (!refreshToken) {
        return res.status(401).json({ success: false, error: 'Refresh token requerido' });
    }

    try {
        const decoded = jwt.verify(refreshToken, REFRESH_JWT_SECRET);
        
        // Verificar que el token existe en la BD y no ha expirado
        const result = await pool.query(
            'SELECT rt.*, u.username, u.role FROM refresh_tokens rt JOIN users u ON rt.user_id = u.id WHERE rt.user_id = $1 AND rt.expires_at > NOW()',
            [decoded.userId]
        );

        let validToken = false;
        for (const tokenRecord of result.rows) {
            if (await bcrypt.compare(refreshToken, tokenRecord.token_hash)) {
                validToken = true;
                break;
            }
        }

        if (!validToken) {
            return res.status(403).json({ success: false, error: 'Refresh token inválido' });
        }

        const user = result.rows[0];
        const newAccessToken = jwt.sign(
            { 
                userId: user.user_id, 
                username: user.username, 
                role: user.role 
            },
            JWT_SECRET,
            { expiresIn: '15m' }
        );

        res.json({ success: true, accessToken: newAccessToken });

    } catch (error) {
        logger.error('Error en refresh token:', error);
        res.status(403).json({ success: false, error: 'Refresh token inválido' });
    }
});

// ENVÍO DE QUEJA CON VALIDACIÓN COMPLETA
app.post('/enviar-queja', quejaLimiter, async (req, res) => {
    const { tipo } = req.body;
    
    // Validar con el esquema específico del tipo de queja
    const schema = quejaSchemas[tipo];
    if (!schema) {
        return res.status(400).json({ 
            success: false, 
            error: 'Tipo de queja no válido' 
        });
    }

    const { error } = schema.validate(req.body, { abortEarly: false, allowUnknown: true });
    if (error) {
        const errores = error.details.map(d => d.message).join(', ');
        logger.warn(`Intento de envío de queja con datos inválidos: ${errores}`, { 
            ip: req.ip, 
            body: req.body 
        });
        return res.status(400).json({ 
            success: false, 
            error: `Datos inválidos: ${errores}` 
        });
    }

    try {
        const { numero_empleado, empresa, ruta, colonia, turno, latitud, longitud, numero_unidad, ...detalles } = req.body;
        const config = QUEJAS_CONFIG[tipo];
        
        // VALIDACIÓN ADICIONAL DE SEGURIDAD
        if (!ALLOWED_TABLES[config.tableName]) {
            throw new Error(`Tabla no permitida: ${config.tableName}`);
        }

        const nuevoFolio = generarFolio();
        
        // 🔥 CONVERSIÓN AUTOMÁTICA DE HORAS A TIMESTAMPS
        const today = new Date().toISOString().split('T')[0]; // Obtener fecha actual YYYY-MM-DD
        
        // Convertir campos de hora a timestamps si existen
        const horaFields = ['hora_programada', 'hora_llegada', 'hora_llegada_planta'];
        horaFields.forEach(field => {
            if (detalles[field] && detalles[field] !== '') {
                // Si es solo hora (HH:MM), convertir a timestamp completo
                if (detalles[field].match(/^\d{1,2}:\d{2}$/)) {
                    detalles[field] = `${today} ${detalles[field]}:00`;
                }
            }
        });
        
        const commonFields = ['numero_empleado', 'empresa', 'ruta', 'colonia', 'turno', 'tipo', 'latitud', 'longitud', 'numero_unidad', 'folio'];
        const specificFields = config.fields;
        const allFieldNames = [...commonFields, ...specificFields];
        const allValues = [
            numero_empleado, empresa, ruta, colonia, turno, tipo,
            latitud || null, longitud || null, numero_unidad || null, nuevoFolio,
            ...specificFields.map(field => (detalles[field] === '' ? null : detalles[field]))
        ];
        
        const queryFields = allFieldNames.join(', ');
        const queryValuePlaceholders = allFieldNames.map((_, i) => `${i + 1}`).join(', ');
        
        // Usar query preparado con nombre de tabla validado
        const query = `INSERT INTO ${config.tableName} (${queryFields}) VALUES (${queryValuePlaceholders}) RETURNING id;`;
        
        const result = await pool.query(query, allValues);
        
        logger.info(`Queja registrada exitosamente`, { 
            folio: nuevoFolio, 
            tabla: config.tableName, 
            id: result.rows[0].id,
            ip: req.ip
        });
        
        res.status(201).json({ 
            success: true, 
            message: "¡Queja registrada con éxito!", 
            folio: nuevoFolio 
        });
        
    } catch (error) {
        logger.error('Error al procesar la queja:', { 
            error: error.message, 
            stack: error.stack,
            body: req.body,
            ip: req.ip
        });
        
        if (error.code === '23505') {
            return res.status(500).json({ 
                success: false, 
                error: 'Error al generar un folio único. Por favor, inténtelo de nuevo.' 
            });
        }
        
        res.status(500).json({ 
            success: false, 
            error: 'Error interno del servidor al procesar la solicitud.' 
        });
    }
});

// OBTENER QUEJAS CON PAGINACIÓN Y FILTROS
app.get('/api/quejas', authenticateToken, async (req, res) => {
    try {
        const { page = 1, limit = 50, tipo, estado, desde, hasta } = req.query;
        
        // Validar parámetros de paginación
        const pageNum = parseInt(page);
        const limitNum = Math.min(parseInt(limit), 100); // Máximo 100 registros
        const offset = (pageNum - 1) * limitNum;

        const tableNames = Object.values(QUEJAS_CONFIG)
            .map(c => c.tableName)
            .filter(tableName => ALLOWED_TABLES[tableName]);

        let queries = tableNames.map(tableName => {
            let baseQuery = `SELECT *, '${tableName}' as tabla_origen FROM ${tableName}`;
            let whereConditions = [];
            let queryParams = [];
            let paramIndex = 1;

            if (estado) {
                whereConditions.push(`estado_queja = $${paramIndex++}`);
                queryParams.push(estado);
            }

            if (desde) {
                whereConditions.push(`fecha_creacion >= $${paramIndex++}`);
                queryParams.push(desde);
            }

            if (hasta) {
                whereConditions.push(`fecha_creacion <= $${paramIndex++}`);
                queryParams.push(hasta);
            }

            if (whereConditions.length > 0) {
                baseQuery += ` WHERE ${whereConditions.join(' AND ')}`;
            }

            baseQuery += ` ORDER BY fecha_creacion DESC LIMIT $${paramIndex++} OFFSET $${paramIndex}`;
            queryParams.push(limitNum, offset);

            return pool.query(baseQuery, queryParams);
        });

        if (tipo && QUEJAS_CONFIG[tipo]) {
            const config = QUEJAS_CONFIG[tipo];
            queries = [pool.query(`SELECT *, '${config.tableName}' as tabla_origen FROM ${config.tableName} ORDER BY fecha_creacion DESC LIMIT $1 OFFSET $2`, [limitNum, offset])];
        }

        const results = await Promise.all(queries);
        const allQuejas = results.flatMap(result => result.rows);
        
        allQuejas.sort((a, b) => new Date(b.fecha_creacion) - new Date(a.fecha_creacion));

        res.status(200).json({
            success: true,
            data: allQuejas,
            pagination: {
                page: pageNum,
                limit: limitNum,
                total: allQuejas.length
            }
        });

    } catch (error) {
        logger.error('Error al obtener las quejas:', { error: error.message });
        res.status(500).json({ success: false, error: 'Error al consultar la base de datos.' });
    }
});

// RESOLVER QUEJA CON AUTENTICACIÓN Y AUTORIZACIÓN
app.put('/api/queja/resolver', authenticateToken, requireRole(['admin', 'supervisor']), async (req, res) => {
    const client = await pool.connect();
    
    try {
        const { id, tabla_origen, folio, resolucion, estado = 'Revisada' } = req.body;
        const responsable = req.user.username;

        // Validación de entrada
        const schema = Joi.object({
            id: Joi.number().integer().positive().required(),
            tabla_origen: Joi.string().valid(...Object.values(QUEJAS_CONFIG).map(c => c.tableName)).required(),
            folio: Joi.string().pattern(/^QJ-\d{8}-[A-F0-9]{6}$/).required(),
            resolucion: Joi.string().min(10).max(1000).required(),
            estado: Joi.string().valid('Revisada', 'Resuelta', 'Cerrada').default('Revisada')
        });

        const { error } = schema.validate(req.body);
        if (error) {
            return res.status(400).json({ 
                success: false, 
                error: error.details.map(d => d.message).join(', ') 
            });
        }
        
        // Validación adicional de seguridad
        if (!ALLOWED_TABLES[tabla_origen]) {
            return res.status(400).json({ 
                success: false, 
                error: 'Nombre de tabla no válido.' 
            });
        }

        await client.query('BEGIN');

        // Verificar que la queja existe
        const checkQuery = `SELECT id, folio FROM ${tabla_origen} WHERE id = $1 AND folio = $2`;
        const checkResult = await client.query(checkQuery, [id, folio]);
        
        if (checkResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ 
                success: false, 
                error: 'Queja no encontrada.' 
            });
        }

        // Actualizar estado de la queja
        const updateQuery = `UPDATE ${tabla_origen} SET estado_queja = $1, fecha_actualizacion = NOW() WHERE id = $2`;
        await client.query(updateQuery, [estado, id]);

        // Insertar resolución
        const insertQuery = `INSERT INTO resoluciones (folio_queja, texto_resolucion, responsable, fecha_resolucion) VALUES ($1, $2, $3, NOW())`;
        await client.query(insertQuery, [folio, resolucion, responsable]);

        await client.query('COMMIT');
        
        logger.info(`Queja resuelta exitosamente`, { 
            folio, 
            responsable, 
            estado,
            ip: req.ip
        });
        
        res.status(200).json({ 
            success: true, 
            message: 'Queja resuelta y registrada exitosamente.' 
        });

    } catch (error) {
        await client.query('ROLLBACK');
        logger.error('Error en la transacción de resolución:', { 
            error: error.message,
            body: req.body,
            user: req.user?.username,
            ip: req.ip
        });
        res.status(500).json({ 
            success: false, 
            error: 'Error interno del servidor al procesar la resolución.' 
        });
    } finally {
        client.release();
    }
});

// LOGOUT SEGURO (invalidar refresh tokens)
app.post('/api/logout', authenticateToken, async (req, res) => {
    try {
        await pool.query(
            'DELETE FROM refresh_tokens WHERE user_id = $1',
            [req.user.userId]
        );
        
        logger.info(`Usuario ${req.user.username} cerró sesión desde IP: ${req.ip}`);
        res.json({ success: true, message: 'Sesión cerrada exitosamente' });
    } catch (error) {
        logger.error('Error en logout:', error);
        res.status(500).json({ success: false, error: 'Error interno del servidor' });
    }
});

// --- Rutas de Utilidad ---
app.get('/health', (req, res) => {
    res.status(200).json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        version: '6.0'
    });
});

// Middleware para rutas no encontradas
app.use((req, res, next) => {
    logger.warn(`Ruta no encontrada: ${req.method} ${req.originalUrl} desde IP: ${req.ip}`);
    res.status(404).json({ 
        success: false, 
        error: `Ruta no encontrada: ${req.originalUrl}` 
    });
});

// Manejo global de errores
app.use((error, req, res, next) => {
    logger.error('ERROR NO MANEJADO:', { 
        error: error.message, 
        stack: error.stack,
        url: req.originalUrl,
        method: req.method,
        ip: req.ip
    });
    res.status(500).json({ 
        success: false, 
        error: 'Ha ocurrido un error inesperado en el servidor.' 
    });
});

// --- Arranque del Servidor ---
const server = app.listen(PORT, () => {
    logger.info(`🚀 Servidor de Quejas v6.0 iniciado en puerto ${PORT} en modo ${NODE_ENV}`);
});

// Graceful shutdown mejorado
const gracefulShutdown = (signal) => {
    logger.info(`Recibida señal ${signal}. Iniciando cierre elegante...`);
    
    server.close((err) => {
        if (err) {
            logger.error('Error cerrando servidor HTTP:', err);
            process.exit(1);
        }
        
        logger.info('Servidor HTTP cerrado.');
        
        pool.end((err) => {
            if (err) {
                logger.error('Error cerrando pool de BD:', err);
                process.exit(1);
            }
            
            logger.info('Pool de base de datos cerrado.');
            process.exit(0);
        });
    });
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Manejo de promesas rechazadas no capturadas
process.on('unhandledRejection', (reason, promise) => {
    logger.error('Promesa rechazada no manejada:', { reason, promise });
});

process.on('uncaughtException', (error) => {
    logger.error('Excepción no capturada:', { error: error.message, stack: error.stack });
    process.exit(1);
});