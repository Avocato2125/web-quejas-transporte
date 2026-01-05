const winston = require('winston');
const path = require('path');
const fs = require('fs');

// Asegurar que existan los directorios de logs en producción
const logDirs = [
    path.join('logs'),
    path.join('logs', 'security'),
    path.join('logs', 'audit')
];

try {
    logDirs.forEach(dir => {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    });
} catch (e) {
    // En caso de fallo creando directorios, continuar con consola
}

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
        }),
        // Transporte de Consola
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(), // Colores para leer mejor
                winston.format.simple()
            )
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
        }),
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.simple()
            )
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
        }),
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.simple()
            )
        })
    ]
});

// Los transportes de consola ya están incluidos en la configuración inicial
// No es necesario agregar condicionalmente

module.exports = {
    mainLogger,
    securityLogger,
    auditLogger
};