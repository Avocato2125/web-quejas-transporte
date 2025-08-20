// server.js - DIAGNÓSTICO TEMPORAL
require('dotenv').config();

console.log('🚀 Iniciando servidor de diagnóstico...');

const express = require('express');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

console.log('✅ Express cargado');
console.log('✅ Variables de entorno:', {
    DATABASE_URL: process.env.DATABASE_URL ? '✅ Existe' : '❌ Falta',
    JWT_SECRET: process.env.JWT_SECRET ? '✅ Existe' : '❌ Falta',
    REFRESH_JWT_SECRET: process.env.REFRESH_JWT_SECRET ? '✅ Existe' : '❌ Falta',
    NODE_ENV: process.env.NODE_ENV || 'No definido'
});

// Configuración de la base de datos
console.log('🔄 Configurando pool de PostgreSQL...');
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 5,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 5000
});

console.log('✅ Pool configurado');

// Middlewares básicos
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

console.log('✅ Middlewares configurados');

// Rutas de diagnóstico
app.get('/health', (req, res) => {
    console.log('📡 Health check solicitado');
    res.status(200).json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        version: 'diagnostic',
        message: 'Servidor funcionando correctamente'
    });
});

app.get('/test-db', async (req, res) => {
    console.log('📊 Test de base de datos solicitado');
    try {
        console.log('🔄 Ejecutando SELECT NOW()...');
        const result = await pool.query('SELECT NOW()');
        console.log('✅ Consulta exitosa:', result.rows[0]);
        
        console.log('🔄 Probando tabla users...');
        const usersResult = await pool.query('SELECT COUNT(*) FROM users');
        console.log('✅ Usuarios encontrados:', usersResult.rows[0].count);
        
        res.status(200).json({ 
            success: true, 
            database: 'connected',
            time: result.rows[0].now,
            users_count: usersResult.rows[0].count
        });
    } catch (error) {
        console.error('❌ Error en base de datos:', error.message);
        res.status(500).json({ 
            success: false, 
            error: error.message,
            code: error.code
        });
    }
});

app.get('/test-tables', async (req, res) => {
    console.log('📋 Test de tablas solicitado');
    try {
        const tables = [
            'quejas_retraso',
            'quejas_mal_trato',
            'quejas_inseguridad',
            'quejas_unidad_mal_estado',
            'quejas_otro',
            'users',
            'refresh_tokens',
            'resoluciones'
        ];
        
        const results = {};
        
        for (const table of tables) {
            try {
                console.log(`🔄 Probando tabla ${table}...`);
                const result = await pool.query(`SELECT COUNT(*) FROM ${table}`);
                results[table] = { status: 'ok', count: result.rows[0].count };
                console.log(`✅ ${table}: ${result.rows[0].count} registros`);
            } catch (error) {
                console.error(`❌ Error en ${table}:`, error.message);
                results[table] = { status: 'error', error: error.message };
            }
        }
        
        res.status(200).json({ success: true, tables: results });
    } catch (error) {
        console.error('❌ Error general en test de tablas:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/', (req, res) => {
    console.log('🏠 Página principal solicitada');
    res.send(`
        <h1>🔧 Servidor de Diagnóstico</h1>
        <p>Servidor funcionando correctamente</p>
        <ul>
            <li><a href="/health">Health Check</a></li>
            <li><a href="/test-db">Test Base de Datos</a></li>
            <li><a href="/test-tables">Test Todas las Tablas</a></li>
        </ul>
        <p>Timestamp: ${new Date().toISOString()}</p>
    `);
});

// Test inicial de conexión
console.log('🔄 Probando conexión inicial a PostgreSQL...');
pool.query('SELECT NOW()')
    .then((result) => {
        console.log('✅ Conexión a PostgreSQL exitosa:', result.rows[0].now);
    })
    .catch((err) => {
        console.error('❌ Error conectando a PostgreSQL:', err.message);
        console.error('❌ Código de error:', err.code);
        console.error('❌ Stack completo:', err.stack);
    });

// Iniciar servidor
console.log('🔄 Iniciando servidor en puerto', PORT);
const server = app.listen(PORT, () => {
    console.log(`🚀 Servidor de diagnóstico corriendo en puerto ${PORT}`);
    console.log(`📡 Health check: http://localhost:${PORT}/health`);
    console.log(`📊 Test DB: http://localhost:${PORT}/test-db`);
    console.log(`📋 Test Tables: http://localhost:${PORT}/test-tables`);
});

// Manejo de errores del servidor
server.on('error', (error) => {
    console.error('❌ Error del servidor:', error.message);
});

// Manejo de señales de cierre
process.on('SIGTERM', () => {
    console.log('📴 Recibida señal SIGTERM, cerrando servidor...');
    server.close(() => {
        console.log('📴 Servidor cerrado');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('📴 Recibida señal SIGINT, cerrando servidor...');
    server.close(() => {
        console.log('📴 Servidor cerrado');
        process.exit(0);
    });
});

console.log('✅ Configuración completa, esperando solicitudes...');