const { mainLogger: logger } = require('../config/logger');

// Wrapper para manejar errores en rutas async
const asyncHandler = (fn) => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch((error) => {
        logger.error('Error en ruta:', {
            error: error.message,
            stack: error.stack,
            path: req.path,
            method: req.method
        });
        
        // Si ya se envió una respuesta, no intentar enviar otra
        if (res.headersSent) {
            return next(error);
        }

        // Manejar diferentes tipos de errores
        if (error.name === 'ValidationError') {
            return res.status(400).json({
                success: false,
                error: 'Error de validación',
                details: error.details || error.message
            });
        }

        if (error.name === 'UnauthorizedError') {
            return res.status(401).json({
                success: false,
                error: 'No autorizado'
            });
        }

        if (error.name === 'ForbiddenError') {
            return res.status(403).json({
                success: false,
                error: 'Acceso denegado'
            });
        }

        // Error por defecto
        res.status(500).json({
            success: false,
            error: process.env.NODE_ENV === 'production' 
                ? 'Error interno del servidor' 
                : error.message
        });
    });
};

// Middleware para validación de parámetros
const validateParams = (schema) => async (req, res, next) => {
    try {
        const validated = await schema.validateAsync(req.params);
        req.params = validated;
        next();
    } catch (error) {
        res.status(400).json({
            success: false,
            error: 'Parámetros inválidos',
            details: error.details.map(d => d.message)
        });
    }
};

// Middleware para validación de query
const validateQuery = (schema) => async (req, res, next) => {
    try {
        const validated = await schema.validateAsync(req.query);
        req.query = validated;
        next();
    } catch (error) {
        res.status(400).json({
            success: false,
            error: 'Query inválido',
            details: error.details.map(d => d.message)
        });
    }
};

// Middleware para validación de body
const validateBody = (schema) => async (req, res, next) => {
    try {
        const validated = await schema.validateAsync(req.body);
        req.body = validated;
        next();
    } catch (error) {
        res.status(400).json({
            success: false,
            error: 'Body inválido',
            details: error.details.map(d => d.message)
        });
    }
};

module.exports = {
    asyncHandler,
    validateParams,
    validateQuery,
    validateBody
};