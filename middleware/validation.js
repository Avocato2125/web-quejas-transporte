const { quejaSchemas } = require('../schemas/validation');
const logger = require('../config/logger');

const validateQueja = (req, res, next) => {
    const tipo = req.body.tipo;
    const schema = quejaSchemas[tipo];
    
    if (!schema) {
        return res.status(400).json({
            success: false,
            error: 'Tipo de queja inválido'
        });
    }

    try {
        const { error } = schema.validate(req.body, { abortEarly: false });
        if (error) {
            return res.status(400).json({
                success: false,
                error: 'Error de validación',
                details: error.details.map(detail => detail.message)
            });
        }
        next();
    } catch (err) {
        logger.error('Error en validación:', err);
        res.status(500).json({
            success: false,
            error: 'Error interno en validación'
        });
    }
};

module.exports = {
    validateQueja
};