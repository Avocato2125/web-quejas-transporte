const winston = require('winston');
const path = require('path');

// Configuración base para todos los loggers
const baseLogConfig = {
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
    ),
    defaultMeta: { service: 'quejas-system' }
};

// Logger principal
const mainLogger = winston.createLogger({
    ...baseLogConfig,
    transports: [
        new winston.transports.File({ 
            filename: path.join('logs', 'error.log'),
            level: 'error',
            maxsize: 5242880,
            maxFiles: 5,
            handleExceptions: true
        }),
        new winston.transports.File({ 
            filename: path.join('logs', 'combined.log'),
            maxsize: 5242880,
            maxFiles: 5
        })
    ]
});

// Logger de seguridad
const securityLogger = winston.createLogger({
    ...baseLogConfig,
    transports: [
        new winston.transports.File({ 
            filename: path.join('logs', 'security', 'security.log'),
            maxsize: 5242880,
            maxFiles: 5
        })
    ]
});

// Logger de auditoría
const auditLogger = winston.createLogger({
    ...baseLogConfig,
    transports: [
        new winston.transports.File({ 
            filename: path.join('logs', 'audit', 'audit.log'),
            maxsize: 5242880,
            maxFiles: 5
        })
    ]
});

// Agregar console transport en desarrollo
if (process.env.NODE_ENV !== 'production') {
    const consoleFormat = winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
    );
    
    [mainLogger, securityLogger, auditLogger].forEach(logger => {
        logger.add(new winston.transports.Console({ format: consoleFormat }));
    });
}

module.exports = {
    mainLogger,
    securityLogger,
    auditLogger
};