const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');

const createRateLimiter = (options) => {
    const {
        windowMs = 15 * 60 * 1000, // 15 minutos por defecto
        max = 100,
        message = 'Demasiadas peticiones',
        type = 'general',
        logger,
        keyGenerator // Opción para el generador de claves
    } = options;

    return rateLimit({
        windowMs,
        max,
        keyGenerator, // Usar el generador de claves si se proporciona
        message: { success: false, error: message },
        handler: (req, res) => {
            if (logger) {
                logger.warn(`Rate limit alcanzado - Tipo: ${type}`, {
                    ip: req.ip,
                    path: req.path,
                    userAgent: req.get('User-Agent'),
                    type
                });
            }
            
            res.status(429).json({
                success: false,
                error: message,
                retryAfter: Math.ceil(windowMs / 1000) // segundos
            });
        },
        skip: (req) => process.env.NODE_ENV === 'test',
        standardHeaders: true,
        legacyHeaders: false
    });
};

const configureRateLimiting = (logger) => {
    // Limiter para el login, usando IP y User-Agent
    const loginLimiter = createRateLimiter({
        windowMs: 15 * 60 * 1000,
        max: 5,
        message: 'Demasiados intentos de login. Por favor espere 15 minutos.',
        type: 'login',
        logger,
        keyGenerator: (req) => `${ipKeyGenerator(req)}-${req.get('User-Agent')}`
    });

    // Limiter para el envío de quejas, usando IP y número de empleado
    const quejaLimiter = createRateLimiter({
        windowMs: 60 * 1000,
        max: 3,
        message: 'Límite de quejas por minuto alcanzado. Por favor espere.',
        type: 'queja',
        logger,
        keyGenerator: (req) => {
            const empleado = req.body?.numero_empleado || 'unknown';
            return `${ipKeyGenerator(req)}-${empleado}`;
        }
    });

    // Limiter general para el resto de la API
    const generalLimiter = createRateLimiter({
        windowMs: 15 * 60 * 1000,
        max: 100,
        message: 'Demasiadas peticiones generales. Por favor espere.',
        type: 'general',
        logger
    });

    return {
        loginLimiter,
        quejaLimiter,
        generalLimiter
    };
};

module.exports = {
    configureRateLimiting
};
