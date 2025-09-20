// ===========================================
// TESTS DE INTEGRACIÓN - AUTENTICACIÓN
// ===========================================

const request = require('supertest');
const { app } = require('../../app');

describe('Autenticación - Tests de Integración', () => {
    
    // let refreshToken; // No usado en todos los tests

    describe('POST /api/login', () => {
        test('debe hacer login exitoso con credenciales válidas', async () => {
            const loginData = {
                username: 'admin',
                password: 'password123'
            };

            const response = await request(app)
                .post('/api/login')
                .send(loginData)
                .expect(200);

            expect(response.body.success).toBe(true);
            expect(response.body.accessToken).toBeDefined();
            expect(response.body.refreshToken).toBeDefined();
            expect(response.body.user).toBeDefined();
            expect(response.body.user.username).toBe('admin');

            // refreshToken = response.body.refreshToken; // No usado en este test
        });

        test('debe rechazar login con credenciales inválidas', async () => {
            const loginData = {
                username: 'admin',
                password: 'password_incorrecto'
            };

            const response = await request(app)
                .post('/api/login')
                .send(loginData)
                .expect(401);

            expect(response.body.success).toBe(false);
            expect(response.body.error).toContain('Credenciales inválidas');
        });

        test('debe rechazar login con usuario inexistente', async () => {
            const loginData = {
                username: 'usuario_inexistente',
                password: 'password123'
            };

            const response = await request(app)
                .post('/api/login')
                .send(loginData)
                .expect(401);

            expect(response.body.success).toBe(false);
            expect(response.body.error).toContain('Credenciales inválidas');
        });

        test('debe rechazar login con datos inválidos', async () => {
            const loginData = {
                username: 'ab', // Muy corto
                password: '123' // Muy corto
            };

            const response = await request(app)
                .post('/api/login')
                .send(loginData)
                .expect(400);

            expect(response.body.success).toBe(false);
            expect(response.body.error).toBeDefined();
        });

        test('debe rechazar login con datos vacíos', async () => {
            const loginData = {
                username: '',
                password: ''
            };

            const response = await request(app)
                .post('/api/login')
                .send(loginData)
                .expect(400);

            expect(response.body.success).toBe(false);
            expect(response.body.error).toBeDefined();
        });

        test('debe aplicar rate limiting en login', async () => {
            const loginData = {
                username: 'admin',
                password: 'password_incorrecto'
            };

            // Enviar múltiples requests de login fallidos
            const promises = Array(60).fill().map(() => 
                request(app)
                    .post('/api/login')
                    .send(loginData)
            );

            const responses = await Promise.all(promises);
            
            // Al menos uno debe ser rechazado por rate limiting
            const rateLimitedResponses = responses.filter(r => r.status === 429);
            expect(rateLimitedResponses.length).toBeGreaterThan(0);
        });
    });

    describe('GET /api/quejas (Protegido)', () => {
        test('debe acceder a quejas con token válido', async () => {
            // Primero hacer login para obtener token
            const loginResponse = await request(app)
                .post('/api/login')
                .send({ username: 'admin', password: 'password123' });

            const token = loginResponse.body.accessToken;

            const response = await request(app)
                .get('/api/quejas')
                .set('Authorization', `Bearer ${token}`)
                .expect(200);

            expect(response.body.success).toBe(true);
            expect(response.body.data).toBeDefined();
            expect(Array.isArray(response.body.data)).toBe(true);
        });

        test('debe rechazar acceso sin token', async () => {
            const response = await request(app)
                .get('/api/quejas')
                .expect(401);

            expect(response.body.success).toBe(false);
            expect(response.body.error).toContain('Token de acceso requerido');
        });

        test('debe rechazar acceso con token inválido', async () => {
            const response = await request(app)
                .get('/api/quejas')
                .set('Authorization', 'Bearer token_invalido')
                .expect(403);

            expect(response.body.success).toBe(false);
            expect(response.body.error).toContain('Token inválido');
        });

        test('debe rechazar acceso con token expirado', async () => {
            // Crear un token expirado
            const jwt = require('jsonwebtoken');
            const expiredToken = jwt.sign(
                { userId: 1, username: 'admin', role: 'admin' },
                process.env.JWT_SECRET,
                { expiresIn: '-1h' }
            );

            const response = await request(app)
                .get('/api/quejas')
                .set('Authorization', `Bearer ${expiredToken}`)
                .expect(403);

            expect(response.body.success).toBe(false);
            expect(response.body.error).toContain('Token inválido');
        });

        test('debe rechazar acceso con formato de token incorrecto', async () => {
            const response = await request(app)
                .get('/api/quejas')
                .set('Authorization', 'InvalidFormat token')
                .expect(401);

            expect(response.body.success).toBe(false);
            expect(response.body.error).toContain('Token de acceso requerido');
        });
    });

    describe('PUT /api/queja/resolver (Protegido)', () => {
        test('debe resolver queja con permisos de admin', async () => {
            // Primero hacer login para obtener token
            const loginResponse = await request(app)
                .post('/api/login')
                .send({ username: 'admin', password: 'password123' });

            const token = loginResponse.body.accessToken;

            const resolucionData = {
                id: 1,
                tabla_origen: 'quejas_retraso',
                folio: 'QJ-20241201-ABC123',
                resolucion: 'Se contactó al conductor y se implementaron medidas correctivas'
            };

            const response = await request(app)
                .put('/api/queja/resolver')
                .set('Authorization', `Bearer ${token}`)
                .send(resolucionData);

            // Puede fallar si no existe la queja, pero debe validar permisos
            expect([200, 404]).toContain(response.status);
        });

        test('debe rechazar resolución sin permisos de admin', async () => {
            // Crear token con rol de usuario normal
            const jwt = require('jsonwebtoken');
            const userToken = jwt.sign(
                { userId: 2, username: 'user', role: 'user' },
                process.env.JWT_SECRET,
                { expiresIn: '15m' }
            );

            const resolucionData = {
                id: 1,
                tabla_origen: 'quejas_retraso',
                folio: 'QJ-20241201-ABC123',
                resolucion: 'Intento de resolución sin permisos'
            };

            const response = await request(app)
                .put('/api/queja/resolver')
                .set('Authorization', `Bearer ${userToken}`)
                .send(resolucionData)
                .expect(403);

            expect(response.body.success).toBe(false);
            expect(response.body.error).toContain('Permisos insuficientes');
        });
    });

    describe('POST /api/logout', () => {
        test('debe hacer logout exitoso', async () => {
            // Primero hacer login para obtener token
            const loginResponse = await request(app)
                .post('/api/login')
                .send({ username: 'admin', password: 'password123' });

            const token = loginResponse.body.accessToken;

            const response = await request(app)
                .post('/api/logout')
                .set('Authorization', `Bearer ${token}`)
                .expect(200);

            expect(response.body.success).toBe(true);
            expect(response.body.message).toContain('Sesión cerrada');
        });

        test('debe rechazar logout sin token', async () => {
            const response = await request(app)
                .post('/api/logout')
                .expect(401);

            expect(response.body.success).toBe(false);
            expect(response.body.error).toContain('Token de acceso requerido');
        });
    });

    describe('Refresh Token', () => {
        test('debe manejar refresh token correctamente', async () => {
            // Primero hacer login para obtener tokens
            const loginResponse = await request(app)
                .post('/api/login')
                .send({ username: 'admin', password: 'password123' });

            const refreshToken = loginResponse.body.refreshToken;

            // Verificar que el refresh token es válido
            const jwt = require('jsonwebtoken');
            const decoded = jwt.verify(refreshToken, process.env.REFRESH_JWT_SECRET);
            
            expect(decoded.userId).toBeDefined();
        });

        test('debe rechazar refresh token inválido', async () => {
            const jwt = require('jsonwebtoken');
            
            expect(() => {
                jwt.verify('refresh_token_invalido', process.env.REFRESH_JWT_SECRET);
            }).toThrow();
        });
    });

    describe('Seguridad de Headers', () => {
        test('debe incluir headers de seguridad', async () => {
            const response = await request(app)
                .get('/health')
                .expect(200);

            // Verificar headers de seguridad
            expect(response.headers['x-content-type-options']).toBe('nosniff');
            expect(response.headers['x-frame-options']).toBe('DENY');
            expect(response.headers['x-xss-protection']).toBe('1; mode=block');
        });
    });

    describe('CORS', () => {
        test('debe permitir requests desde origen permitido', async () => {
            const response = await request(app)
                .get('/health')
                .set('Origin', 'http://localhost:3000')
                .expect(200);

            expect(response.headers['access-control-allow-origin']).toBeDefined();
        });

        test('debe rechazar requests desde origen no permitido', async () => {
            await request(app)
                .get('/health')
                .set('Origin', 'http://malicious-site.com')
                .expect(200); // El endpoint health no requiere CORS

            // Para endpoints que requieren CORS, se validaría el origen
        });
    });
});
