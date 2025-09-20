// server.js (Versión 6.4 - CORREGIDO PARA ENVÍO DE QUEJAS)

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
const puppeteer = require('puppeteer');
const htmlPdf = require('html-pdf-node');
const fs = require('fs');
const { sanitizeRequestBody, sanitizeQueryParams, sanitizeForFrontend } = require('./middleware/sanitization');
const { errorHandler, notFoundHandler, requestLogger } = require('./middleware/errorHandler');

// --- INICIALIZACIÓN Y CONFIGURACIÓN ---
const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';

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

// Validar variables de entorno requeridas
const requiredEnvVars = ['DATABASE_URL', 'JWT_SECRET', 'REFRESH_JWT_SECRET'];
requiredEnvVars.forEach(envVar => { 
    if (!process.env[envVar]) { 
        logger.error(`ERROR CRÍTICO: Variable de entorno ${envVar} no definida.`); 
        process.exit(1); 
    } 
});

const JWT_SECRET = process.env.JWT_SECRET;
const REFRESH_JWT_SECRET = process.env.REFRESH_JWT_SECRET;

// --- Middlewares de Seguridad ---
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ['\'self\''],
            styleSrc: ['\'self\'', '\'unsafe-inline\'', 'https://fonts.googleapis.com'],
            fontSrc: ['\'self\'', 'https://fonts.gstatic.com'],
            scriptSrc: ['\'self\'', '\'unsafe-inline\''],
            imgSrc: ['\'self\'', 'data:']
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
// Configuración de rate limiting basada en entorno
const isTestEnvironment = process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID !== undefined || process.env.npm_lifecycle_event === 'test';

const loginLimiter = rateLimit({ 
    windowMs: 15 * 60 * 1000, 
    max: isTestEnvironment ? 1000 : 50, // Límite alto para tests
    skipSuccessfulRequests: true, 
    message: { success: false, error: 'Demasiados intentos de login.' },
    handler: (req, res) => {
        logger.warn(`Rate limit alcanzado para login desde IP: ${req.ip}`);
        res.status(429).json({ success: false, error: 'Demasiados intentos de login. Intente en 15 minutos.' });
    }
});

const quejaLimiter = rateLimit({ 
    windowMs: 60 * 1000, 
    max: isTestEnvironment ? 1000 : 10, // Límite alto para tests
    message: { success: false, error: 'Límite de quejas por minuto alcanzado.' } 
});

// Rate limiting general para API
app.use('/api/', rateLimit({ 
    windowMs: 15 * 60 * 1000, 
    max: isTestEnvironment ? 10000 : 100 // Límite muy alto para tests
}));

// --- Middlewares Generales ---
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// --- Middlewares de Sanitización ---
app.use(sanitizeRequestBody);
app.use(sanitizeQueryParams);

// --- Middleware de Logging ---
app.use(requestLogger);

// --- Configuración de la Base de Datos ---
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

pool.query('SELECT NOW()')
    .then(() => logger.info('Conexión a PostgreSQL exitosa'))
    .catch(err => {
        logger.error('Error conectando a PostgreSQL', { error: err.message });
        logger.warn('Continuando en modo de desarrollo sin base de datos...');
        // No salir del proceso, continuar en modo desarrollo
    });

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

// Validación específica por tipo (simplificada)
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

const requireRole = (roles) => {
    return (req, res, next) => {
        if (!roles.includes(req.user.role)) {
            logger.warn(`Acceso denegado para usuario ${req.user.username} con rol ${req.user.role}`);
            return res.status(403).json({ success: false, error: 'Permisos insuficientes' });
        }
        next();
    };
};

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

        // Verificar conexión a base de datos
        try {
            await pool.query('SELECT 1');
            healthCheck.services.database = 'connected';
        } catch (dbError) {
            healthCheck.services.database = 'disconnected';
            healthCheck.status = 'degraded';
            healthCheck.errors = {
                database: dbError.message
            };
        }

        const statusCode = healthCheck.status === 'healthy' ? 200 : 503;
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

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// LOGIN
app.post('/api/login', loginLimiter, async (req, res) => {
    const schema = Joi.object({
        username: Joi.string().alphanum().min(3).max(30).trim().required(),
        password: Joi.string().min(8).max(128).trim().required()
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
            logger.warn(`Intento de login fallido para usuario: ${username}`);
            return res.status(401).json({ success: false, error: 'Credenciales inválidas' });
        }

        const user = result.rows[0];
        const validPassword = await bcrypt.compare(password, user.password_hash);

        if (!validPassword) {
            logger.warn(`Contraseña incorrecta para usuario: ${username}`);
            return res.status(401).json({ success: false, error: 'Credenciales inválidas' });
        }

        const accessToken = jwt.sign(
            { userId: user.id, username: user.username, role: user.role },
            JWT_SECRET,
            { expiresIn: '15m' }
        );

        const refreshToken = jwt.sign(
            { userId: user.id },
            REFRESH_JWT_SECRET,
            { expiresIn: '7d' }
        );

        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        await pool.query(
            'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
            [user.id, refreshToken, expiresAt]
        );

        logger.info(`Login exitoso para usuario: ${username}`);
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

// ENVÍO DE QUEJA CORREGIDO
app.post('/enviar-queja', quejaLimiter, async (req, res) => {
    logger.debug('Recibiendo queja:', req.body);
    
    try {
        const { tipo } = req.body;
        
        // Validar tipo de queja
        if (!tipo || !QUEJAS_CONFIG[tipo]) {
            return res.status(400).json({ 
                success: false, 
                error: 'Tipo de queja no válido. Tipos permitidos: ' + Object.keys(QUEJAS_CONFIG).join(', ')
            });
        }

        // Validar con esquema
        const schema = quejaSchemas[tipo];
        const { error } = schema.validate(req.body, { allowUnknown: true });
        
        if (error) {
            const errores = error.details.map(d => d.message).join(', ');
            logger.debug('Error de validación:', errores);
            return res.status(400).json({ 
                success: false, 
                error: `Datos inválidos: ${errores}` 
            });
        }

        const { numero_empleado, empresa, ruta, colonia, turno, latitud, longitud, numero_unidad, ...detalles } = req.body;
        const config = QUEJAS_CONFIG[tipo];
        
        // Validar tabla permitida
        if (!ALLOWED_TABLES[config.tableName]) {
            throw new Error(`Tabla no permitida: ${config.tableName}`);
        }

        const nuevoFolio = generarFolio();
        logger.debug('Folio generado:', nuevoFolio);

        // Conversión de horas a timestamps
        const today = new Date().toISOString().split('T')[0];
        const horaFields = ['hora_programada', 'hora_llegada', 'hora_llegada_planta'];
        
        horaFields.forEach(field => {
            if (detalles[field] && detalles[field] !== '') {
                if (detalles[field].match(/^\d{1,2}:\d{2}$/)) {
                    detalles[field] = `${today} ${detalles[field]}:00`;
                    logger.debug(`Convertido ${field}: ${detalles[field]}`);
                }
            }
        });

        // Preparar datos para insertar
        const commonFields = ['numero_empleado', 'empresa', 'ruta', 'colonia', 'turno', 'tipo', 'latitud', 'longitud', 'numero_unidad', 'folio'];
        const specificFields = config.fields;
        const allFieldNames = [...commonFields, ...specificFields];
        
        const allValues = [
            numero_empleado, 
            empresa, 
            ruta || null, 
            colonia || null, 
            turno || null, 
            tipo,
            latitud || null, 
            longitud || null, 
            numero_unidad || null, 
            nuevoFolio,
            ...specificFields.map(field => detalles[field] || null)
        ];

        logger.debug('Campos:', allFieldNames);
        logger.debug('Valores:', allValues);

        const queryFields = allFieldNames.join(', ');
        const queryValuePlaceholders = allFieldNames.map((_, i) => `$${i + 1}`).join(', ');
        const query = `INSERT INTO ${config.tableName} (${queryFields}) VALUES (${queryValuePlaceholders}) RETURNING id;`;
        
        logger.debug('Query SQL:', query);
        
        const result = await pool.query(query, allValues);
        
        logger.info('Queja registrada exitosamente', { 
            folio: nuevoFolio, 
            tabla: config.tableName, 
            id: result.rows[0].id,
            ip: req.ip
        });
        
        res.status(201).json({ 
            success: true, 
            message: '¡Queja registrada con éxito!', 
            folio: nuevoFolio 
        });
        
    } catch (error) {
        logger.error('Error completo:', error);
        logger.error('Error al procesar la queja:', { 
            error: error.message, 
            stack: error.stack,
            body: req.body,
            ip: req.ip
        });
        
        res.status(500).json({ 
            success: false, 
            error: 'Error interno del servidor: ' + error.message 
        });
    }
});

// OBTENER QUEJAS
app.get('/api/quejas', authenticateToken, async (req, res) => {
    try {
        const { page = 1, limit = 50, estado } = req.query;
        const pageNum = parseInt(page, 10);
        const limitNum = Math.min(parseInt(limit, 10), 100);
        const offset = (pageNum - 1) * limitNum;

        // Usar consulta directa a las tablas
        const tableNames = Object.values(QUEJAS_CONFIG).map(c => c.tableName);
        
        let queries;
        if (estado) {
            // Filtrar por estado específico
            queries = tableNames.map(tableName => 
                pool.query(`SELECT *, '${tableName}' as tabla_origen FROM ${tableName} WHERE estado_queja = $1 ORDER BY fecha_creacion DESC LIMIT $2 OFFSET $3`, 
                [estado, limitNum, offset])
            );
        } else {
            // Obtener todas las quejas sin filtrar por estado
            queries = tableNames.map(tableName => 
                pool.query(`SELECT *, '${tableName}' as tabla_origen FROM ${tableName} ORDER BY fecha_creacion DESC LIMIT $1 OFFSET $2`, 
                [limitNum, offset])
            );
        }

        const results = await Promise.all(queries);
        const allQuejas = results.flatMap(result => result.rows);
        
        allQuejas.sort((a, b) => new Date(b.fecha_creacion) - new Date(a.fecha_creacion));

        res.status(200).json({
            success: true,
            data: sanitizeForFrontend(allQuejas),
            pagination: { page: pageNum, limit: limitNum, total: allQuejas.length }
        });

    } catch (error) {
        logger.error('Error al obtener las quejas:', { error: error.message });
        res.status(500).json({ success: false, error: 'Error al consultar la base de datos.' });
    }
});

// GENERAR PDF DE QUEJA
app.get('/api/queja/pdf/:folio', authenticateToken, requireRole(['admin', 'supervisor']), async (req, res) => {
    const { folio } = req.params;
    
    try {
        // Buscar la queja en todas las tablas
        const tableNames = Object.values(QUEJAS_CONFIG).map(c => c.tableName);
        let queja = null;
        let tablaOrigen = null;
        
        for (const tableName of tableNames) {
            const result = await pool.query(`SELECT * FROM ${tableName} WHERE folio = $1`, [folio]);
            if (result.rows.length > 0) {
                queja = result.rows[0];
                tablaOrigen = tableName;
                break;
            }
        }
        
        if (!queja) {
            return res.status(404).json({ success: false, error: 'Queja no encontrada' });
        }
        
        // Buscar la resolución
        const resolucionResult = await pool.query(
            'SELECT * FROM resoluciones WHERE folio_queja = $1 ORDER BY fecha_resolucion DESC LIMIT 1',
            [folio]
        );
        
        const resolucion = resolucionResult.rows[0];
        if (!resolucion) {
            logger.warn('Intento de generar PDF sin resolución', { folio, ip: req.ip });
            return res.status(404).json({ success: false, error: 'No se encontró resolución para esta queja' });
        }
        
        // Preparar datos para el template
        const templateData = {
            folio: queja.folio,
            numero_empleado: queja.numero_empleado,
            empresa: queja.empresa,
            tipo: queja.tipo,
            fecha_creacion: new Date(queja.fecha_creacion).toLocaleDateString('es-MX', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            }),
            fechaReporte: new Date().toLocaleDateString('es-MX', {
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            }),
            responsable: resolucion.responsable,
            estado: queja.estado_queja,
            procedencia: resolucion.procedencia,
            procedencia_class: resolucion.procedencia === 'Procedió' ? 'procedio' : 'no-procedio',
            resolucion: resolucion.texto_resolucion,
            ruta: queja.ruta || null,
            numero_unidad: queja.numero_unidad || null,
            colonia: queja.colonia || null,
            turno: queja.turno || null,
            detalles_retraso: queja.detalles_retraso || null,
            detalles_maltrato: queja.detalles_maltrato || null,
            detalles_inseguridad: queja.detalles_inseguridad || null,
            detalles_malestado: queja.detalles_malestado || null,
            detalles_otro: queja.detalles_otro || null
        };
        
        // Log de datos para debugging
        logger.info('Datos del template:', { 
            folio: templateData.folio,
            responsable: templateData.responsable,
            procedencia: templateData.procedencia,
            procedencia_class: templateData.procedencia_class,
            hasResolucion: !!templateData.resolucion,
            hasDetalles: {
                retraso: !!templateData.detalles_retraso,
                maltrato: !!templateData.detalles_maltrato,
                inseguridad: !!templateData.detalles_inseguridad,
                malestado: !!templateData.detalles_malestado,
                otro: !!templateData.detalles_otro
            }
        });
        
                // Leer el template HTML
                const templatePath = path.join(__dirname, 'public', 'templates', 'reporte-queja.html');
                    
        let htmlTemplate = fs.readFileSync(templatePath, 'utf8');
        
        // Reemplazar variables en el template (simple template engine)
        logger.info('Iniciando procesamiento del template...');
        for (const [key, value] of Object.entries(templateData)) {
            const regex = new RegExp(`{{${key}}}`, 'g');
            const originalLength = htmlTemplate.length;
            htmlTemplate = htmlTemplate.replace(regex, value || '');
            const replaced = originalLength !== htmlTemplate.length;
            if (replaced) {
                logger.info(`Variable ${key} reemplazada:`, { value: value || 'null/undefined' });
            }
        }
        
        // Manejar condicionales {{#if}}
        logger.info('Procesando condicionales...');
        htmlTemplate = htmlTemplate.replace(/\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (match, condition, content) => {
            const hasCondition = !!templateData[condition];
            logger.info(`Condicional ${condition}:`, { hasCondition, contentLength: content.length });
            return hasCondition ? content : '';
        });
        
        // Verificar que no queden variables sin reemplazar
        const remainingVariables = htmlTemplate.match(/\{\{[^}]+\}\}/g);
        if (remainingVariables) {
            logger.warn('Variables sin reemplazar:', remainingVariables);
        } else {
            logger.info('Todas las variables fueron reemplazadas correctamente');
        }
        
                // Generar PDF con Puppeteer (configuración simplificada)
                logger.info('Iniciando Puppeteer...');
                const browser = await puppeteer.launch({
                    headless: true,
                    args: [
                        '--no-sandbox',
                        '--disable-setuid-sandbox',
                        '--disable-dev-shm-usage',
                        '--disable-accelerated-2d-canvas',
                        '--no-first-run',
                        '--no-zygote',
                        '--single-process',
                        '--disable-gpu',
                        '--disable-background-timer-throttling',
                        '--disable-backgrounding-occluded-windows',
                        '--disable-renderer-backgrounding',
                        '--disable-features=TranslateUI',
                        '--disable-ipc-flooding-protection',
                        '--memory-pressure-off',
                        '--max_old_space_size=4096'
                    ],
                    timeout: 30000,
                    protocolTimeout: 30000
                });
                
                logger.info('Creando nueva página...');
                const page = await browser.newPage();
                
                // Configurar viewport para consistencia
                logger.info('Configurando viewport...');
                await page.setViewport({ 
                    width: 1200, 
                    height: 800,
                    deviceScaleFactor: 1
                });
                
                // Configurar cache y recursos
                await page.setCacheEnabled(false);
                await page.setJavaScriptEnabled(true);
                
                // Cargar contenido y esperar a que todo esté listo
                logger.info('Cargando contenido HTML...');
                await page.setContent(htmlTemplate, { 
                    waitUntil: 'domcontentloaded',
                    timeout: 30000
                });
                
                // Esperar un poco más para asegurar que todo se renderice
                logger.info('Esperando renderizado adicional...');
                await new Promise(resolve => setTimeout(resolve, 1000));
                
                logger.info('Generando PDF...');
                const pdfBuffer = await page.pdf({
                    format: 'A4',
                    printBackground: true,
                    preferCSSPageSize: false,
                    margin: {
                        top: '20mm',
                        right: '15mm',
                        bottom: '20mm',
                        left: '15mm'
                    },
                    timeout: 30000,
                    displayHeaderFooter: false,
                    scale: 0.8
                });
                
                logger.info('PDF generado exitosamente', { 
                    bufferSize: pdfBuffer.length,
                    bufferSizeKB: Math.round(pdfBuffer.length / 1024),
                    isBuffer: Buffer.isBuffer(pdfBuffer),
                    bufferType: typeof pdfBuffer,
                    firstBytes: pdfBuffer.slice(0, 10).toString('hex')
                });
                
                await browser.close();
        
                // Enviar PDF como respuesta con headers optimizados
                res.setHeader('Content-Type', 'application/pdf');
                res.setHeader('Content-Disposition', `attachment; filename="reporte-queja-${folio}.pdf"`);
                res.setHeader('Content-Length', pdfBuffer.length);
                res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
                res.setHeader('Pragma', 'no-cache');
                res.setHeader('Expires', '0');
                res.setHeader('Accept-Ranges', 'bytes');
                res.setHeader('Content-Transfer-Encoding', 'binary');
                
                // Asegurar que sea un Buffer válido
                const buffer = Buffer.isBuffer(pdfBuffer) ? pdfBuffer : Buffer.from(pdfBuffer);
                res.send(buffer);
        
        logger.info('PDF generado exitosamente', { folio, responsable: req.user.username, ip: req.ip });
        
    } catch (error) {
        logger.error('Error al generar PDF:', { 
            error: error.message, 
            stack: error.stack,
            folio, 
            ip: req.ip 
        });
        
        // Cerrar browser si está abierto
        try {
            if (browser) {
                await browser.close();
            }
        } catch (closeError) {
            logger.warn('Error al cerrar browser:', closeError.message);
        }
        
        res.status(500).json({ 
            success: false, 
            error: 'Error al generar el reporte PDF',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// VISUALIZAR PDF DE QUEJA (sin descarga)
app.get('/api/queja/view/:folio', authenticateToken, requireRole(['admin', 'supervisor']), async (req, res) => {
    const { folio } = req.params;
    
    try {
        // Buscar la queja en todas las tablas
        const tableNames = Object.values(QUEJAS_CONFIG).map(c => c.tableName);
        let queja = null;
        let tablaOrigen = null;
        
        for (const tableName of tableNames) {
            const result = await pool.query(`SELECT * FROM ${tableName} WHERE folio = $1`, [folio]);
            if (result.rows.length > 0) {
                queja = result.rows[0];
                tablaOrigen = tableName;
                break;
            }
        }
        
        if (!queja) {
            logger.warn('Intento de visualizar PDF para queja no encontrada', { folio, ip: req.ip });
            return res.status(404).json({ success: false, error: 'Queja no encontrada' });
        }
        
        // Buscar la resolución
        const resolucionResult = await pool.query(
            'SELECT * FROM resoluciones WHERE folio_queja = $1 ORDER BY fecha_resolucion DESC LIMIT 1',
            [folio]
        );
        
        const resolucion = resolucionResult.rows[0];
        if (!resolucion) {
            logger.warn('Intento de visualizar PDF sin resolución', { folio, ip: req.ip });
            return res.status(404).json({ success: false, error: 'No se encontró resolución para esta queja' });
        }
        
        // Preparar datos para el template
        const templateData = {
            folio: queja.folio,
            numero_empleado: queja.numero_empleado,
            empresa: queja.empresa,
            tipo: queja.tipo,
            fecha_creacion: new Date(queja.fecha_creacion).toLocaleDateString('es-MX', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            }),
            fechaReporte: new Date().toLocaleDateString('es-MX', {
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            }),
            responsable: resolucion.responsable,
            estado: queja.estado_queja,
            procedencia: resolucion.procedencia,
            procedencia_class: resolucion.procedencia === 'Procedió' ? 'procedio' : 'no-procedio',
            resolucion: resolucion.texto_resolucion,
            ruta: queja.ruta || null,
            numero_unidad: queja.numero_unidad || null,
            colonia: queja.colonia || null,
            turno: queja.turno || null,
            detalles_retraso: queja.detalles_retraso || null,
            detalles_maltrato: queja.detalles_maltrato || null,
            detalles_inseguridad: queja.detalles_inseguridad || null,
            detalles_malestado: queja.detalles_malestado || null,
            detalles_otro: queja.detalles_otro || null
        };
        
        // Leer el template HTML
        const templatePath = path.join(__dirname, 'public', 'templates', 'reporte-queja.html');
        let htmlTemplate = fs.readFileSync(templatePath, 'utf8');
        
        // Reemplazar variables en el template
        for (const [key, value] of Object.entries(templateData)) {
            const regex = new RegExp(`{{${key}}}`, 'g');
            htmlTemplate = htmlTemplate.replace(regex, value || '');
        }
        
        // Manejar condicionales {{#if}}
        htmlTemplate = htmlTemplate.replace(/\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (match, condition, content) => {
            return templateData[condition] ? content : '';
        });
        
        // Enviar HTML para visualización
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(htmlTemplate);
        
        logger.info('HTML de queja enviado para visualización', { folio, responsable: req.user.username, ip: req.ip });
        
    } catch (error) {
        logger.error('Error al generar HTML de queja:', { 
            error: error.message, 
            stack: error.stack,
            folio, 
            ip: req.ip 
        });
        
        res.status(500).json({ 
            success: false, 
            error: 'Error al generar el reporte HTML',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// RESOLVER QUEJA
app.put('/api/queja/resolver', authenticateToken, requireRole(['admin', 'supervisor']), async (req, res) => {
    const client = await pool.connect();
    
    try {
        const { id, tabla_origen, folio, resolucion, procedencia, estado = 'Revisada' } = req.body;
        const responsable = req.user.username;

        if (!id || !tabla_origen || !folio || !resolucion || !procedencia) {
            return res.status(400).json({ 
                success: false, 
                error: 'Faltan datos requeridos: id, tabla_origen, folio, resolucion, procedencia' 
            });
        }

        // Validar que procedencia sea válida
        if (!['Procedio', 'No Procedio', 'Procedió', 'No Procedió'].includes(procedencia)) {
            return res.status(400).json({ 
                success: false, 
                error: 'Procedencia debe ser "Procedio" o "No Procedio"' 
            });
        }
        
        // Normalizar procedencia para la base de datos
        const procedenciaNormalizada = procedencia.includes('Procedio') ? 'Procedió' : 'No Procedió';

        if (!ALLOWED_TABLES[tabla_origen]) {
            return res.status(400).json({ 
                success: false, 
                error: 'Nombre de tabla no válido.' 
            });
        }

        await client.query('BEGIN');

        const checkQuery = `SELECT id, folio, estado_queja FROM ${tabla_origen} WHERE id = $1 AND folio = $2`;
        const checkResult = await client.query(checkQuery, [id, folio]);
        
        if (checkResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ 
                success: false, 
                error: 'Queja no encontrada.' 
            });
        }
        
        // Verificar que la queja esté pendiente
        if (checkResult.rows[0].estado_queja !== 'Pendiente') {
            await client.query('ROLLBACK');
            return res.status(400).json({ 
                success: false, 
                error: `La queja ya ha sido procesada. Estado actual: ${checkResult.rows[0].estado_queja}` 
            });
        }

        const updateQuery = `UPDATE ${tabla_origen} SET estado_queja = $1 WHERE id = $2`;
        await client.query(updateQuery, [estado, id]);

        const insertQuery = 'INSERT INTO resoluciones (folio_queja, texto_resolucion, responsable, procedencia) VALUES ($1, $2, $3, $4)';
        await client.query(insertQuery, [folio, resolucion, responsable, procedenciaNormalizada]);

        await client.query('COMMIT');
        
        logger.info('Queja resuelta exitosamente', { folio, responsable, estado, procedencia, ip: req.ip });
        res.status(200).json({ 
            success: true, 
            message: 'Queja resuelta y registrada exitosamente.' 
        });

    } catch (error) {
        await client.query('ROLLBACK');
        logger.error('Error en la transacción de resolución:', { error: error.message });
        res.status(500).json({ success: false, error: 'Error interno del servidor al procesar la resolución.' });
    } finally {
        client.release();
    }
});

// LOGOUT
app.post('/api/logout', authenticateToken, async (req, res) => {
    try {
        await pool.query('DELETE FROM refresh_tokens WHERE user_id = $1', [req.user.userId]);
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
        version: '6.4'  // ← VERSIÓN ACTUALIZADA
    });
});

app.use((req, res, _next) => {
    logger.warn(`Ruta no encontrada: ${req.method} ${req.originalUrl}`);
    res.status(404).json({ success: false, error: 'Ruta no encontrada' });
});

app.use((error, req, res, _next) => {
    logger.error('ERROR NO MANEJADO:', { error: error.message, stack: error.stack });
    res.status(500).json({ success: false, error: 'Error inesperado.' });
});

// --- Arranque del Servidor ---
const server = app.listen(PORT, () => {
    logger.info(`Servidor de Quejas v6.4 iniciado en puerto ${PORT} en modo ${NODE_ENV}`);
});

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

// --- Middlewares de Manejo de Errores (deben ir al final) ---
app.use(notFoundHandler);
app.use(errorHandler);

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('unhandledRejection', (reason, _promise) => {
    logger.error('Promesa rechazada no manejada:', { reason });
});
process.on('uncaughtException', (error) => {
    logger.error('Excepción no capturada:', { error: error.message, stack: error.stack });
    process.exit(1);
});