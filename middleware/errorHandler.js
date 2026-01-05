/**
 * Middleware de Manejo de Errores Profesional
 * Centraliza el manejo de errores y logging
 */

const winston = require('winston');

/**
 * Middleware para manejar errores de forma centralizada
 * @param {Error} err - Error capturado
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 * @param {Function} next - Next middleware function
 */
function errorHandler(err, req, res, next) {
    // Log del error
    winston.error('Error capturado:', {
        message: err.message,
        stack: err.stack,
        url: req.url,
        method: req.method,
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        timestamp: new Date().toISOString()
    });

    // Determinar tipo de error y respuesta apropiada
    let statusCode = 500;
    let message = 'Error interno del servidor';
    let details = null;

    // Errores de validación Joi
    if (err.isJoi) {
        statusCode = 400;
        message = 'Datos de entrada inválidos';
        details = err.details.map(detail => ({
            field: detail.path.join('.'),
            message: detail.message
        }));
    }

    // Errores de base de datos
    else if (err.code && err.code.startsWith('23')) {
        statusCode = 400;
        message = 'Error de integridad de datos';
    }

    // Errores de autenticación
    else if (err.name === 'JsonWebTokenError') {
        statusCode = 401;
        message = 'Token de acceso inválido';
    }

    else if (err.name === 'TokenExpiredError') {
        statusCode = 401;
        message = 'Token de acceso expirado';
    }

    // Errores de permisos
    else if (err.name === 'UnauthorizedError') {
        statusCode = 403;
        message = 'Acceso denegado';
    }

    // Errores de rate limiting
    else if (err.status === 429) {
        statusCode = 429;
        message = 'Demasiadas solicitudes';
    }

    // Errores de archivos no encontrados
    else if (err.code === 'ENOENT') {
        statusCode = 404;
        message = 'Recurso no encontrado';
    }

    // Errores de sintaxis JSON
    else if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
        statusCode = 400;
        message = 'JSON inválido en el cuerpo de la solicitud';
    }

    // Preparar respuesta
    const response = {
        success: false,
        error: message,
        timestamp: new Date().toISOString()
    };

    // Agregar detalles en desarrollo
    if (process.env.NODE_ENV === 'development') {
        response.details = details || err.message;
        response.stack = err.stack;
    }

    // Agregar ID de error para tracking
    const errorId = generateErrorId();
    response.errorId = errorId;

    // Log adicional con ID de error
    winston.error(`Error ID ${errorId}:`, {
        statusCode,
        message,
        url: req.url,
        method: req.method,
        ip: req.ip
    });

    res.status(statusCode).json(response);
}

/**
 * Middleware para manejar rutas no encontradas
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 * @param {Function} next - Next middleware function
 */
function notFoundHandler(req, res, next) {
    // Responder directamente con 404 sin generar una excepción
    res.status(404).json({
        success: false,
        message: `Ruta no encontrada: ${req.method} ${req.originalUrl}`
    });
}

/**
 * Middleware para validar errores de async/await
 * @param {Function} fn - Función async a envolver
 * @returns {Function} - Función envuelta con manejo de errores
 */
function asyncHandler(fn) {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
}

/**
 * Genera un ID único para el error
 * @returns {string} - ID único del error
 */
function generateErrorId() {
    return `ERR_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Middleware para logging de requests
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 * @param {Function} next - Next middleware function
 */
function requestLogger(req, res, next) {
    const start = Date.now();
    
    res.on('finish', () => {
        const duration = Date.now() - start;
        const logData = {
            method: req.method,
            url: req.url,
            status: res.statusCode,
            duration: `${duration}ms`,
            ip: req.ip,
            userAgent: req.get('User-Agent'),
            timestamp: new Date().toISOString()
        };

        if (res.statusCode >= 400) {
            winston.warn('Request con error:', logData);
        } else {
            winston.info('Request procesada:', logData);
        }
    });

    next();
}

module.exports = {
    errorHandler,
    notFoundHandler,
    asyncHandler,
    requestLogger
};
