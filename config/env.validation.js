const Joi = require('joi');

const envSchema = Joi.object({
    // Variables de Base de Datos
    DATABASE_URL: Joi.string().uri().required(),
    DB_MAX_CONNECTIONS: Joi.number().default(20),
    DB_IDLE_TIMEOUT: Joi.number().default(30000),

    // Variables de JWT
    JWT_SECRET: Joi.string().min(32).required(),
    REFRESH_JWT_SECRET: Joi.string().min(32).required(),
    JWT_EXPIRY: Joi.string().default('15m'),
    REFRESH_TOKEN_EXPIRY: Joi.string().default('7d'),

    // Variables de Servidor
    PORT: Joi.number().default(3000),
    NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
    
    // Variables de Seguridad
    RATE_LIMIT_WINDOW: Joi.number().default(900000), // 15 minutos
    RATE_LIMIT_MAX: Joi.number().default(100),
    LOGIN_RATE_LIMIT_MAX: Joi.number().default(5),
    
    // Variables de Logging
    LOG_LEVEL: Joi.string().valid('error', 'warn', 'info', 'debug').default('info'),
    MAX_LOG_SIZE: Joi.number().default(5242880), // 5MB
    MAX_LOG_FILES: Joi.number().default(5)
});

function validateEnv() {
    const { error, value } = envSchema.validate(process.env, {
        allowUnknown: true,
        abortEarly: false
    });

    if (error) {
        const errorMessage = error.details.map(detail => detail.message).join('\n');
        throw new Error(`Error en la configuración de variables de entorno:\n${errorMessage}`);
    }

    // Asignar valores por defecto
    process.env = {
        ...process.env,
        ...value
    };

    return value;
}

module.exports = validateEnv;