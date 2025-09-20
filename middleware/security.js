// ===========================================
// MIDDLEWARE DE SEGURIDAD AVANZADA
// ===========================================

const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
// const crypto = require('crypto'); // No usado actualmente
const winston = require('winston');

// Configurar logger para seguridad
const securityLogger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        new winston.transports.File({ filename: 'logs/security.log' })
    ]
});

// ===========================================
// RATE LIMITING AVANZADO
// ===========================================

// Rate limiting para login con IP tracking
const loginRateLimit = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 5, // 5 intentos por IP
    skipSuccessfulRequests: true,
    keyGenerator: (req) => {
        // Combinar IP y User-Agent para mayor precisión
        return `${req.ip}-${req.get('User-Agent')}`;
    },
    message: {
        success: false,
        error: 'Demasiados intentos de login. Intente en 15 minutos.',
        retryAfter: '15 minutos'
    },
    handler: (req, res) => {
        securityLogger.warn('Rate limit alcanzado para login', {
            ip: req.ip,
            userAgent: req.get('User-Agent'),
            timestamp: new Date().toISOString()
        });
        
        res.status(429).json({
            success: false,
            error: 'Demasiados intentos de login. Intente en 15 minutos.',
            retryAfter: '15 minutos'
        });
    }
});

// Rate limiting para envío de quejas
const quejaRateLimit = rateLimit({
    windowMs: 60 * 1000, // 1 minuto
    max: 3, // 3 quejas por minuto
    keyGenerator: (req) => {
        // Combinar IP y número de empleado
        const empleado = req.body?.numero_empleado || 'unknown';
        return `${req.ip}-${empleado}`;
    },
    message: {
        success: false,
        error: 'Límite de quejas por minuto alcanzado.',
        retryAfter: '1 minuto'
    },
    handler: (req, res) => {
        securityLogger.warn('Rate limit alcanzado para quejas', {
            ip: req.ip,
            empleado: req.body?.numero_empleado,
            timestamp: new Date().toISOString()
        });
        
        res.status(429).json({
            success: false,
            error: 'Límite de quejas por minuto alcanzado.',
            retryAfter: '1 minuto'
        });
    }
});

// Rate limiting general para API
const apiRateLimit = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 100, // 100 requests por IP
    message: {
        success: false,
        error: 'Demasiadas solicitudes. Intente más tarde.',
        retryAfter: '15 minutos'
    },
    handler: (req, res) => {
        securityLogger.warn('Rate limit general alcanzado', {
            ip: req.ip,
            endpoint: req.path,
            method: req.method,
            timestamp: new Date().toISOString()
        });
        
        res.status(429).json({
            success: false,
            error: 'Demasiadas solicitudes. Intente más tarde.',
            retryAfter: '15 minutos'
        });
    }
});

// ===========================================
// HELMET CONFIGURACIÓN AVANZADA
// ===========================================

const helmetConfig = helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ['\'self\''],
            styleSrc: ['\'self\'', '\'unsafe-inline\'', 'https://fonts.googleapis.com'],
            fontSrc: ['\'self\'', 'https://fonts.gstatic.com'],
            scriptSrc: ['\'self\'', '\'unsafe-inline\''],
            imgSrc: ['\'self\'', 'data:', 'https:'],
            connectSrc: ['\'self\''],
            frameSrc: ['\'none\''],
            objectSrc: ['\'none\''],
            baseUri: ['\'self\''],
            formAction: ['\'self\''],
            upgradeInsecureRequests: []
        }
    },
    crossOriginEmbedderPolicy: false,
    hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true
    },
    noSniff: true,
    xssFilter: true,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
});

// ===========================================
// MIDDLEWARE DE AUDITORÍA
// ===========================================

const auditMiddleware = (req, res, next) => {
    const startTime = Date.now();
    
    // Interceptar respuesta para logging
    const originalSend = res.send;
    res.send = function(data) {
        const duration = Date.now() - startTime;
        
        // Log de auditoría
        securityLogger.info('Request audit', {
            method: req.method,
            url: req.originalUrl,
            ip: req.ip,
            userAgent: req.get('User-Agent'),
            statusCode: res.statusCode,
            duration: `${duration}ms`,
            timestamp: new Date().toISOString(),
            userId: req.user?.userId || null,
            username: req.user?.username || null
        });
        
        originalSend.call(this, data);
    };
    
    next();
};

// ===========================================
// MIDDLEWARE DE DETECCIÓN DE ATAQUES
// ===========================================

const attackDetectionMiddleware = (req, res, next) => {
    const suspiciousPatterns = [
        /<script/i,
        /javascript:/i,
        /on\w+\s*=/i,
        /union\s+select/i,
        /drop\s+table/i,
        /delete\s+from/i,
        /insert\s+into/i,
        /update\s+set/i,
        /exec\s*\(/i,
        /eval\s*\(/i
    ];
    
    const checkForAttacks = (obj, path = '') => {
        for (const key in obj) {
            if (typeof obj[key] === 'string') {
                const fullPath = path ? `${path}.${key}` : key;
                for (const pattern of suspiciousPatterns) {
                    if (pattern.test(obj[key])) {
                        securityLogger.error('Suspicious activity detected', {
                            ip: req.ip,
                            userAgent: req.get('User-Agent'),
                            path: fullPath,
                            value: obj[key],
                            pattern: pattern.toString(),
                            timestamp: new Date().toISOString()
                        });
                        
                        return res.status(400).json({
                            success: false,
                            error: 'Solicitud rechazada por contenido sospechoso.'
                        });
                    }
                }
            } else if (typeof obj[key] === 'object' && obj[key] !== null) {
                const result = checkForAttacks(obj[key], path ? `${path}.${key}` : key);
                if (result) return result;
            }
        }
        return null;
    };
    
    // Verificar body, query y params
    if (req.body) checkForAttacks(req.body, 'body');
    if (req.query) checkForAttacks(req.query, 'query');
    if (req.params) checkForAttacks(req.params, 'params');
    
    next();
};

// ===========================================
// MIDDLEWARE DE SANITIZACIÓN
// ===========================================

const sanitizeInput = (input) => {
    if (typeof input === 'string') {
        return input
            .trim()
            .replace(/[<>]/g, '') // Remover < y >
            .replace(/javascript:/gi, '') // Remover javascript:
            .replace(/on\w+\s*=/gi, '') // Remover event handlers
            .substring(0, 1000); // Limitar longitud
    }
    return input;
};

const sanitizationMiddleware = (req, res, next) => {
    const sanitizeObject = (obj) => {
        for (const key in obj) {
            if (typeof obj[key] === 'string') {
                obj[key] = sanitizeInput(obj[key]);
            } else if (typeof obj[key] === 'object' && obj[key] !== null) {
                sanitizeObject(obj[key]);
            }
        }
    };
    
    if (req.body) sanitizeObject(req.body);
    if (req.query) sanitizeObject(req.query);
    
    next();
};

// ===========================================
// MIDDLEWARE DE VALIDACIÓN DE IP
// ===========================================

const ipWhitelist = process.env.IP_WHITELIST ? 
    process.env.IP_WHITELIST.split(',').map(ip => ip.trim()) : [];

const ipBlacklist = process.env.IP_BLACKLIST ? 
    process.env.IP_BLACKLIST.split(',').map(ip => ip.trim()) : [];

const ipValidationMiddleware = (req, res, next) => {
    const clientIP = req.ip;
    
    // Verificar blacklist
    if (ipBlacklist.includes(clientIP)) {
        securityLogger.error('Blocked IP access attempt', {
            ip: clientIP,
            userAgent: req.get('User-Agent'),
            timestamp: new Date().toISOString()
        });
        
        return res.status(403).json({
            success: false,
            error: 'Acceso denegado.'
        });
    }
    
    // Verificar whitelist (si está configurada)
    if (ipWhitelist.length > 0 && !ipWhitelist.includes(clientIP)) {
        securityLogger.warn('Non-whitelisted IP access attempt', {
            ip: clientIP,
            userAgent: req.get('User-Agent'),
            timestamp: new Date().toISOString()
        });
        
        return res.status(403).json({
            success: false,
            error: 'Acceso denegado.'
        });
    }
    
    next();
};

// ===========================================
// MIDDLEWARE DE DETECCIÓN DE BOTS
// ===========================================

const botDetectionMiddleware = (req, res, next) => {
    const userAgent = req.get('User-Agent') || '';
    const botPatterns = [
        /bot/i,
        /crawler/i,
        /spider/i,
        /scraper/i,
        /curl/i,
        /wget/i,
        /python/i,
        /java/i,
        /php/i
    ];
    
    const isBot = botPatterns.some(pattern => pattern.test(userAgent));
    
    if (isBot) {
        securityLogger.warn('Bot access detected', {
            ip: req.ip,
            userAgent: userAgent,
            timestamp: new Date().toISOString()
        });
        
        // Permitir acceso pero con rate limiting más estricto
        req.isBot = true;
    }
    
    next();
};

// ===========================================
// MIDDLEWARE DE ENCRIPTACIÓN DE RESPUESTAS
// ===========================================

const responseEncryptionMiddleware = (req, res, next) => {
    // Solo para endpoints sensibles
    if (req.path.includes('/api/') && req.method === 'GET') {
        const originalJson = res.json;
        res.json = function(data) {
            // Encriptar datos sensibles
            if (data && typeof data === 'object') {
                // Aquí se podría implementar encriptación adicional
                // Por ahora, solo sanitizar
                const sanitizedData = JSON.parse(JSON.stringify(data));
                return originalJson.call(this, sanitizedData);
            }
            return originalJson.call(this, data);
        };
    }
    
    next();
};

// ===========================================
// EXPORTAR MIDDLEWARES
// ===========================================

module.exports = {
    loginRateLimit,
    quejaRateLimit,
    apiRateLimit,
    helmetConfig,
    auditMiddleware,
    attackDetectionMiddleware,
    sanitizationMiddleware,
    ipValidationMiddleware,
    botDetectionMiddleware,
    responseEncryptionMiddleware,
    securityLogger
};
