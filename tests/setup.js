// ===========================================
// CONFIGURACIÓN DE JEST PARA TESTS
// ===========================================

// Configurar variables de entorno para testing
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test_jwt_secret_for_testing_only';
process.env.REFRESH_JWT_SECRET = 'test_refresh_jwt_secret_for_testing_only';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/quejas_test';
process.env.PORT = '3001';

// Configurar timeout global
jest.setTimeout(10000);

// Mock de Winston para evitar logs en tests
jest.mock('winston', () => ({
    createLogger: jest.fn(() => ({
        info: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
        debug: jest.fn(),
        add: jest.fn()
    })),
    format: {
        combine: jest.fn(),
        timestamp: jest.fn(),
        errors: jest.fn(),
        json: jest.fn(),
        colorize: jest.fn(),
        simple: jest.fn()
    },
    transports: {
        File: jest.fn(),
        Console: jest.fn()
    }
}));

// Mock de bcrypt para tests más rápidos
jest.mock('bcrypt', () => ({
    compare: jest.fn((password, _hash) => {
        return Promise.resolve(password === 'password123');
    }),
    hash: jest.fn((_password, _saltRounds) => {
        return Promise.resolve('hashed_password');
    })
}));

// Configurar console para tests
const originalConsole = global.console;
global.console = {
    ...originalConsole,
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn()
};

// Limpiar mocks después de cada test
afterEach(() => {
    jest.clearAllMocks();
});

// Limpiar variables de entorno después de cada test
afterEach(() => {
    delete process.env.TEST_VAR;
});

// Configurar cleanup global
afterAll(() => {
    global.console = originalConsole;
});
