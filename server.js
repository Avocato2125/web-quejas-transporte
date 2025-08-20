// server.js - SIN BASE DE DATOS
console.log('🚀 Iniciando servidor sin BD...');

const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

console.log('✅ Express cargado');

// Solo middlewares básicos
app.use(express.json());

app.get('/', (req, res) => {
    console.log('📡 GET / - Enviando respuesta');
    res.send(`
        <h1>✅ SERVIDOR SIN BD FUNCIONANDO</h1>
        <p>Timestamp: ${new Date().toISOString()}</p>
        <p>NODE_ENV: ${process.env.NODE_ENV}</p>
        <ul>
            <li><a href="/health">Health Check</a></li>
            <li><a href="/info">Server Info</a></li>
        </ul>
    `);
});

app.get('/health', (req, res) => {
    console.log('📡 GET /health - Enviando respuesta');
    res.status(200).json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        message: 'Servidor sin BD funcionando',
        env: process.env.NODE_ENV
    });
});

app.get('/info', (req, res) => {
    console.log('📡 GET /info - Enviando respuesta');
    res.status(200).json({
        server: 'Express básico',
        port: PORT,
        env: process.env.NODE_ENV,
        timestamp: new Date().toISOString(),
        headers: req.headers
    });
});

// Manejo de errores
app.use((err, req, res, next) => {
    console.error('❌ Error en middleware:', err);
    res.status(500).json({ error: 'Error interno' });
});

console.log('🔄 Iniciando servidor...');

const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 ✅ SERVIDOR INICIADO EN 0.0.0.0:${PORT}`);
    console.log('📡 Listo para requests');
});

server.on('error', (error) => {
    console.error('❌ ERROR SERVER:', error);
});

server.on('listening', () => {
    console.log('✅ Servidor escuchando correctamente');
});

console.log('✅ Script completo ejecutado');