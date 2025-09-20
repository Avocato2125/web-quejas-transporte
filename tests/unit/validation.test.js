// ===========================================
// TESTS UNITARIOS - VALIDACIÓN
// ===========================================

const Joi = require('joi');

describe('Validación - Tests Unitarios', () => {
    
    describe('Validación de Quejas Base', () => {
        const baseQuejaSchema = Joi.object({
            numero_empleado: Joi.string().required(),
            empresa: Joi.string().required(),
            ruta: Joi.string().allow(null, ''),
            colonia: Joi.string().allow(null, ''),
            turno: Joi.string().allow(null, ''),
            tipo: Joi.string().valid('Retraso', 'Mal trato', 'Inseguridad', 'Unidad en mal estado', 'Otro').required(),
            latitud: Joi.number().allow(null, ''),
            longitud: Joi.number().allow(null, ''),
            numero_unidad: Joi.string().allow(null, '')
        });

        test('debe validar datos de queja válidos', () => {
            const validData = {
                numero_empleado: '123456',
                empresa: 'abc',
                ruta: 'Ruta 15',
                colonia: 'Centro',
                turno: 'Primero',
                tipo: 'Retraso',
                latitud: 19.4326,
                longitud: -99.1332,
                numero_unidad: '123'
            };

            const { error } = baseQuejaSchema.validate(validData);
            expect(error).toBeUndefined();
        });

        test('debe rechazar datos sin número de empleado', () => {
            const invalidData = {
                empresa: 'abc',
                tipo: 'Retraso'
            };

            const { error } = baseQuejaSchema.validate(invalidData);
            expect(error).toBeDefined();
            expect(error.details[0].message).toContain('numero_empleado');
        });

        test('debe rechazar datos sin empresa', () => {
            const invalidData = {
                numero_empleado: '123456',
                tipo: 'Retraso'
            };

            const { error } = baseQuejaSchema.validate(invalidData);
            expect(error).toBeDefined();
            expect(error.details[0].message).toContain('empresa');
        });

        test('debe rechazar tipo de queja inválido', () => {
            const invalidData = {
                numero_empleado: '123456',
                empresa: 'abc',
                tipo: 'Tipo Inexistente'
            };

            const { error } = baseQuejaSchema.validate(invalidData);
            expect(error).toBeDefined();
            expect(error.details[0].message).toContain('tipo');
        });

        test('debe permitir campos opcionales vacíos', () => {
            const validData = {
                numero_empleado: '123456',
                empresa: 'abc',
                ruta: '',
                colonia: null,
                turno: '',
                tipo: 'Retraso',
                latitud: null,
                longitud: '',
                numero_unidad: null
            };

            const { error } = baseQuejaSchema.validate(validData);
            expect(error).toBeUndefined();
        });
    });

    describe('Validación de Quejas de Retraso', () => {
        const retrasoSchema = Joi.object({
            numero_empleado: Joi.string().required(),
            empresa: Joi.string().required(),
            ruta: Joi.string().allow(null, ''),
            colonia: Joi.string().allow(null, ''),
            turno: Joi.string().allow(null, ''),
            tipo: Joi.string().valid('Retraso').required(),
            latitud: Joi.number().allow(null, ''),
            longitud: Joi.number().allow(null, ''),
            numero_unidad: Joi.string().allow(null, ''),
            detalles_retraso: Joi.string().allow(null, ''),
            direccion_subida: Joi.string().allow(null, ''),
            hora_programada: Joi.string().allow(null, ''),
            hora_llegada: Joi.string().allow(null, ''),
            metodo_transporte_alterno: Joi.string().allow(null, ''),
            monto_gastado: Joi.number().allow(null, ''),
            hora_llegada_planta: Joi.string().allow(null, '')
        });

        test('debe validar queja de retraso completa', () => {
            const validData = {
                numero_empleado: '123456',
                empresa: 'abc',
                tipo: 'Retraso',
                detalles_retraso: 'La unidad llegó 20 minutos tarde',
                direccion_subida: 'Av. Siempre Viva 123',
                hora_programada: '08:00',
                hora_llegada: '08:20',
                metodo_transporte_alterno: 'Taxi',
                monto_gastado: 50.00,
                hora_llegada_planta: '08:45'
            };

            const { error } = retrasoSchema.validate(validData);
            expect(error).toBeUndefined();
        });

        test('debe validar queja de retraso mínima', () => {
            const validData = {
                numero_empleado: '123456',
                empresa: 'abc',
                tipo: 'Retraso'
            };

            const { error } = retrasoSchema.validate(validData);
            expect(error).toBeUndefined();
        });
    });

    describe('Validación de Quejas de Mal Trato', () => {
        const malTratoSchema = Joi.object({
            numero_empleado: Joi.string().required(),
            empresa: Joi.string().required(),
            ruta: Joi.string().allow(null, ''),
            colonia: Joi.string().allow(null, ''),
            turno: Joi.string().allow(null, ''),
            tipo: Joi.string().valid('Mal trato').required(),
            latitud: Joi.number().allow(null, ''),
            longitud: Joi.number().allow(null, ''),
            numero_unidad: Joi.string().allow(null, ''),
            nombre_conductor_maltrato: Joi.string().allow(null, ''),
            detalles_maltrato: Joi.string().allow(null, '')
        });

        test('debe validar queja de mal trato completa', () => {
            const validData = {
                numero_empleado: '123456',
                empresa: 'abc',
                tipo: 'Mal trato',
                nombre_conductor_maltrato: 'Juan Pérez',
                detalles_maltrato: 'El conductor usó lenguaje inapropiado'
            };

            const { error } = malTratoSchema.validate(validData);
            expect(error).toBeUndefined();
        });
    });

    describe('Validación de Login', () => {
        const loginSchema = Joi.object({
            username: Joi.string().alphanum().min(3).max(30).trim().required(),
            password: Joi.string().min(8).max(128).trim().required()
        });

        test('debe validar credenciales válidas', () => {
            const validData = {
                username: 'admin',
                password: 'password123'
            };

            const { error } = loginSchema.validate(validData);
            expect(error).toBeUndefined();
        });

        test('debe rechazar username muy corto', () => {
            const invalidData = {
                username: 'ab',
                password: 'password123'
            };

            const { error } = loginSchema.validate(invalidData);
            expect(error).toBeDefined();
            expect(error.details[0].message).toContain('username');
        });

        test('debe rechazar password muy corto', () => {
            const invalidData = {
                username: 'admin',
                password: '123'
            };

            const { error } = loginSchema.validate(invalidData);
            expect(error).toBeDefined();
            expect(error.details[0].message).toContain('password');
        });

        test('debe rechazar username con caracteres especiales', () => {
            const invalidData = {
                username: 'admin@123',
                password: 'password123'
            };

            const { error } = loginSchema.validate(invalidData);
            expect(error).toBeDefined();
            expect(error.details[0].message).toContain('username');
        });

        test('debe rechazar datos vacíos', () => {
            const invalidData = {
                username: '',
                password: ''
            };

            const { error } = loginSchema.validate(invalidData);
            expect(error).toBeDefined();
        });
    });

    describe('Validación de Resolución de Queja', () => {
        const resolucionSchema = Joi.object({
            id: Joi.number().integer().positive().required(),
            tabla_origen: Joi.string().required(),
            folio: Joi.string().required(),
            resolucion: Joi.string().min(10).required(),
            estado: Joi.string().valid('Revisada', 'En Proceso', 'Escalada').optional()
        });

        test('debe validar resolución válida', () => {
            const validData = {
                id: 1,
                tabla_origen: 'quejas_retraso',
                folio: 'QJ-20241201-ABC123',
                resolucion: 'Se contactó al conductor y se implementaron medidas correctivas',
                estado: 'Revisada'
            };

            const { error } = resolucionSchema.validate(validData);
            expect(error).toBeUndefined();
        });

        test('debe rechazar resolución muy corta', () => {
            const invalidData = {
                id: 1,
                tabla_origen: 'quejas_retraso',
                folio: 'QJ-20241201-ABC123',
                resolucion: 'OK'
            };

            const { error } = resolucionSchema.validate(invalidData);
            expect(error).toBeDefined();
            expect(error.details[0].message).toContain('resolucion');
        });

        test('debe rechazar ID inválido', () => {
            const invalidData = {
                id: -1,
                tabla_origen: 'quejas_retraso',
                folio: 'QJ-20241201-ABC123',
                resolucion: 'Resolución válida con suficiente texto'
            };

            const { error } = resolucionSchema.validate(invalidData);
            expect(error).toBeDefined();
            expect(error.details[0].message).toContain('id');
        });
    });

    describe('Sanitización de Datos', () => {
        test('debe sanitizar caracteres especiales', () => {
            const maliciousInput = '<script>alert("xss")</script>';
            const sanitized = maliciousInput.replace(/[&<>"'/]/g, (match) => {
                const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#x27;', '/': '&#x2F;' };
                return map[match]; // eslint-disable-line security/detect-object-injection
            });

            expect(sanitized).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;&#x2F;script&gt;');
        });

        test('debe validar longitud de campos', () => {
            const longString = 'a'.repeat(1001);
            const schema = Joi.string().max(1000);

            const { error } = schema.validate(longString);
            expect(error).toBeDefined();
            expect(error.details[0].message).toContain('length');
        });

        test('debe validar formato de email (si se implementa)', () => {
            const emailSchema = Joi.string().email();
            
            const validEmail = 'test@example.com';
            const invalidEmail = 'invalid-email';

            expect(emailSchema.validate(validEmail).error).toBeUndefined();
            expect(emailSchema.validate(invalidEmail).error).toBeDefined();
        });
    });
});
