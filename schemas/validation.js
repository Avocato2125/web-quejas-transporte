const Joi = require('joi');

// Patrones de validación
const PATTERNS = {
    EMPLOYEE_NUMBER: /^[A-Z0-9]{6,10}$/,
    UNIT_NUMBER: /^[A-Z0-9]{3,8}$/,
    TIME: /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/
};

// Lista de empresas válidas
const VALID_COMPANIES = [
    'TECSA',
    'SERTEC',
    'ATASA',
    'UTSA'
];

// Esquema base mejorado
const baseQuejaSchema = Joi.object({
    numero_empleado: Joi.string()
        .pattern(PATTERNS.EMPLOYEE_NUMBER)
        .required()
        .messages({
            'string.pattern.base': 'El número de empleado debe tener entre 6 y 10 caracteres alfanuméricos',
            'any.required': 'El número de empleado es requerido'
        }),
    
    empresa: Joi.string()
        .valid(...VALID_COMPANIES)
        .required()
        .messages({
            'any.only': 'Empresa no válida',
            'any.required': 'La empresa es requerida'
        }),
    
    ruta: Joi.string()
        .max(50)
        .pattern(/^[A-Za-z0-9\s-]+$/)
        .allow(null, '')
        .messages({
            'string.max': 'La ruta no puede exceder 50 caracteres',
            'string.pattern.base': 'La ruta contiene caracteres no válidos'
        }),
    
    colonia: Joi.string()
        .max(100)
        .pattern(/^[A-Za-z0-9\s\.,-]+$/)
        .allow(null, '')
        .messages({
            'string.max': 'La colonia no puede exceder 100 caracteres',
            'string.pattern.base': 'La colonia contiene caracteres no válidos'
        }),

    turno: Joi.string()
        .valid('MATUTINO', 'VESPERTINO', 'NOCTURNO')
        .allow(null, '')
        .messages({
            'any.only': 'Turno no válido'
        }),

    tipo: Joi.string()
        .required()
        .messages({
            'any.required': 'El tipo de queja es requerido',
            'any.only': 'Tipo de queja no válido'
        }),

    latitud: Joi.number()
        .min(-90)
        .max(90)
        .allow(null, '')
        .messages({
            'number.min': 'Latitud inválida',
            'number.max': 'Latitud inválida'
        }),

    longitud: Joi.number()
        .min(-180)
        .max(180)
        .allow(null, '')
        .messages({
            'number.min': 'Longitud inválida',
            'number.max': 'Longitud inválida'
        }),

    numero_unidad: Joi.string()
        .pattern(PATTERNS.UNIT_NUMBER)
        .allow(null, '')
        .messages({
            'string.pattern.base': 'Número de unidad inválido'
        })
});

// Esquemas específicos mejorados
const quejaSchemas = {
    'Retraso': baseQuejaSchema.keys({
        detalles_retraso: Joi.string().max(500).allow(null, ''),
        direccion_subida: Joi.string().max(200).allow(null, ''),
        hora_programada: Joi.string().pattern(PATTERNS.TIME).allow(null, ''),
        hora_llegada: Joi.string().pattern(PATTERNS.TIME).allow(null, ''),
        metodo_transporte_alterno: Joi.string().max(100).allow(null, ''),
        monto_gastado: Joi.number().min(0).max(1000).allow(null, ''),
        hora_llegada_planta: Joi.string().pattern(PATTERNS.TIME).allow(null, '')
    }),

    'Mal trato': baseQuejaSchema.keys({
        nombre_conductor_maltrato: Joi.string().max(100).allow(null, ''),
        detalles_maltrato: Joi.string().max(500).required()
    }),

    'Inseguridad': baseQuejaSchema.keys({
        detalles_inseguridad: Joi.string().max(500).required(),
        ubicacion_inseguridad: Joi.string().max(200).required()
    }),

    'Unidad en mal estado': baseQuejaSchema.keys({
        numero_unidad_malestado: Joi.string().pattern(PATTERNS.UNIT_NUMBER).required(),
        tipo_falla: Joi.string().max(100).required(),
        detalles_malestado: Joi.string().max(500).required()
    }),

    'Otro': baseQuejaSchema.keys({
        detalles_otro: Joi.string().max(500).required()
    })
};

module.exports = {
    baseQuejaSchema,
    quejaSchemas,
    PATTERNS,
    VALID_COMPANIES
};