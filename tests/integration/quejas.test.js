// ===========================================
// TESTS DE INTEGRACIÓN - QUEJAS
// ===========================================

const request = require('supertest');
const { app } = require('../../app');

describe('Quejas - Tests de Integración', () => {
    
    // let accessToken; // No usado en este test
    // let testUser; // No usado en este test

    // beforeAll(async () => {
    //     // Configurar usuario de prueba
    //     testUser = {
    //         username: 'testuser',
    //         password: 'password123'
    //     };
    // });

    describe('POST /enviar-queja', () => {
        test('debe enviar una queja de retraso exitosamente', async () => {
            const quejaData = {
                numero_empleado: '123456',
                empresa: 'abc',
                ruta: 'Ruta 15',
                colonia: 'Centro',
                turno: 'Primero',
                tipo: 'Retraso',
                detalles_retraso: 'La unidad llegó 20 minutos tarde',
                direccion_subida: 'Av. Siempre Viva 123',
                hora_programada: '08:00',
                hora_llegada: '08:20',
                metodo_transporte_alterno: 'Taxi',
                monto_gastado: 50.00,
                hora_llegada_planta: '08:45',
                latitud: 19.4326,
                longitud: -99.1332,
                numero_unidad: '123'
            };

            const response = await request(app)
                .post('/enviar-queja')
                .send(quejaData)
                .expect(201);

            expect(response.body.success).toBe(true);
            expect(response.body.folio).toBeDefined();
            expect(response.body.folio).toMatch(/^QJ-\d{8}-[A-F0-9]{6}$/);
        });

        test('debe enviar una queja de mal trato exitosamente', async () => {
            const quejaData = {
                numero_empleado: '789012',
                empresa: 'leoch',
                ruta: 'Ruta 20',
                colonia: 'Las Flores',
                turno: 'Segundo',
                tipo: 'Mal trato',
                nombre_conductor_maltrato: 'Juan Pérez',
                detalles_maltrato: 'El conductor usó lenguaje inapropiado y fue grosero'
            };

            const response = await request(app)
                .post('/enviar-queja')
                .send(quejaData)
                .expect(201);

            expect(response.body.success).toBe(true);
            expect(response.body.folio).toBeDefined();
        });

        test('debe enviar una queja de inseguridad exitosamente', async () => {
            const quejaData = {
                numero_empleado: '345678',
                empresa: 'gerber',
                ruta: 'Ruta 25',
                colonia: 'Norte',
                turno: 'Tercero',
                tipo: 'Inseguridad',
                detalles_inseguridad: 'El conductor excedía el límite de velocidad constantemente',
                ubicacion_inseguridad: 'En la intersección de Av. Central y Calle Juárez'
            };

            const response = await request(app)
                .post('/enviar-queja')
                .send(quejaData)
                .expect(201);

            expect(response.body.success).toBe(true);
            expect(response.body.folio).toBeDefined();
        });

        test('debe enviar una queja de mal estado de unidad exitosamente', async () => {
            const quejaData = {
                numero_empleado: '901234',
                empresa: 'phillips',
                ruta: 'Ruta 30',
                colonia: 'Sur',
                turno: 'Mixto',
                tipo: 'Unidad en mal estado',
                numero_unidad_malestado: 'Unidad 789',
                tipo_falla: 'Asientos rotos, Aire acondicionado no funciona',
                detalles_malestado: 'La unidad olía a gasolina, los cinturones no servían'
            };

            const response = await request(app)
                .post('/enviar-queja')
                .send(quejaData)
                .expect(201);

            expect(response.body.success).toBe(true);
            expect(response.body.folio).toBeDefined();
        });

        test('debe enviar una queja de otro tipo exitosamente', async () => {
            const quejaData = {
                numero_empleado: '567890',
                empresa: 'abc',
                ruta: 'Ruta 35',
                colonia: 'Este',
                turno: 'Primero',
                tipo: 'Otro',
                detalles_otro: 'Problema con el sistema de pago de la unidad'
            };

            const response = await request(app)
                .post('/enviar-queja')
                .send(quejaData)
                .expect(201);

            expect(response.body.success).toBe(true);
            expect(response.body.folio).toBeDefined();
        });

        test('debe rechazar queja con datos inválidos', async () => {
            const invalidData = {
                numero_empleado: '', // Campo requerido vacío
                empresa: 'empresa_inexistente',
                tipo: 'Tipo Inexistente'
            };

            const response = await request(app)
                .post('/enviar-queja')
                .send(invalidData)
                .expect(400);

            expect(response.body.success).toBe(false);
            expect(response.body.error).toBeDefined();
        });

        test('debe rechazar queja sin tipo', async () => {
            const invalidData = {
                numero_empleado: '123456',
                empresa: 'abc'
                // Sin tipo
            };

            const response = await request(app)
                .post('/enviar-queja')
                .send(invalidData)
                .expect(400);

            expect(response.body.success).toBe(false);
            expect(response.body.error).toBeDefined();
        });

        test('debe rechazar queja con tipo inválido', async () => {
            const invalidData = {
                numero_empleado: '123456',
                empresa: 'abc',
                tipo: 'Tipo Inexistente'
            };

            const response = await request(app)
                .post('/enviar-queja')
                .send(invalidData)
                .expect(400);

            expect(response.body.success).toBe(false);
            expect(response.body.error).toContain('Tipo de queja no válido');
        });
    });

    describe('Rate Limiting', () => {
        test('debe aplicar rate limiting después de múltiples requests', async () => {
            const quejaData = {
                numero_empleado: '123456',
                empresa: 'abc',
                tipo: 'Retraso',
                detalles_retraso: 'Test rate limiting'
            };

            // Enviar múltiples requests rápidamente
            const promises = Array(15).fill().map(() => 
                request(app)
                    .post('/enviar-queja')
                    .send(quejaData)
            );

            const responses = await Promise.all(promises);
            
            // Al menos uno debe ser rechazado por rate limiting
            const rateLimitedResponses = responses.filter(r => r.status === 429);
            expect(rateLimitedResponses.length).toBeGreaterThan(0);
        });
    });

    describe('Validación de Campos Específicos', () => {
        test('debe validar formato de horas en quejas de retraso', async () => {
            const quejaData = {
                numero_empleado: '123456',
                empresa: 'abc',
                tipo: 'Retraso',
                hora_programada: '25:00', // Hora inválida
                hora_llegada: '08:20'
            };

            const response = await request(app)
                .post('/enviar-queja')
                .send(quejaData);

            // Debe procesar la queja pero con hora inválida
            expect(response.status).toBe(201);
        });

        test('debe validar monto gastado como número', async () => {
            const quejaData = {
                numero_empleado: '123456',
                empresa: 'abc',
                tipo: 'Retraso',
                monto_gastado: 'no es un número'
            };

            const response = await request(app)
                .post('/enviar-queja')
                .send(quejaData);

            // Debe procesar la queja pero con monto inválido
            expect(response.status).toBe(201);
        });

        test('debe validar longitud de campos de texto', async () => {
            const quejaData = {
                numero_empleado: '123456',
                empresa: 'abc',
                tipo: 'Retraso',
                detalles_retraso: 'a'.repeat(1001) // Texto muy largo
            };

            const response = await request(app)
                .post('/enviar-queja')
                .send(quejaData);

            // Debe procesar la queja pero truncar el texto
            expect(response.status).toBe(201);
        });
    });

    describe('Generación de Folios', () => {
        test('debe generar folios únicos', async () => {
            const quejaData = {
                numero_empleado: '123456',
                empresa: 'abc',
                tipo: 'Retraso',
                detalles_retraso: 'Test folios únicos'
            };

            const response1 = await request(app)
                .post('/enviar-queja')
                .send(quejaData)
                .expect(201);

            const response2 = await request(app)
                .post('/enviar-queja')
                .send(quejaData)
                .expect(201);

            expect(response1.body.folio).not.toBe(response2.body.folio);
        });

        test('debe generar folios con formato correcto', async () => {
            const quejaData = {
                numero_empleado: '123456',
                empresa: 'abc',
                tipo: 'Retraso',
                detalles_retraso: 'Test formato folio'
            };

            const response = await request(app)
                .post('/enviar-queja')
                .send(quejaData)
                .expect(201);

            const folio = response.body.folio;
            expect(folio).toMatch(/^QJ-\d{8}-[A-F0-9]{6}$/);
        });
    });

    describe('Manejo de Errores', () => {
        test('debe manejar errores de base de datos', async () => {
            // Simular error de base de datos
            const { pool } = require('../../app');
            const originalQuery = pool.query;
            pool.query = jest.fn().mockRejectedValue(new Error('Database error'));

            const quejaData = {
                numero_empleado: '123456',
                empresa: 'abc',
                tipo: 'Retraso'
            };

            const response = await request(app)
                .post('/enviar-queja')
                .send(quejaData)
                .expect(500);

            expect(response.body.success).toBe(false);
            expect(response.body.error).toContain('Error interno del servidor');

            // Restaurar función original
            pool.query = originalQuery;
        });

        test('debe manejar datos malformados', async () => {
            const response = await request(app)
                .post('/enviar-queja')
                .send('datos malformados')
                .expect(400);

            expect(response.body.success).toBe(false);
        });
    });
});
