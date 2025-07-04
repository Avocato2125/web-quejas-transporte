// server.js - Mejoras sugeridas

require('dotenv').config();
const express = require('express');
const path = require('path');
const { google } = require('googleapis');

const app = express();

// --- NUEVAS MEJORAS DE SEGURIDAD ---
// Rate limiting básico
const rateLimit = {};
const RATE_LIMIT_WINDOW = 15 * 60 * 1000; // 15 minutos
const MAX_REQUESTS = 10; // máximo 10 quejas por IP cada 15 minutos

function checkRateLimit(ip) {
    const now = Date.now();
    if (!rateLimit[ip]) {
        rateLimit[ip] = { count: 1, resetTime: now + RATE_LIMIT_WINDOW };
        return true;
    }
    
    if (now > rateLimit[ip].resetTime) {
        rateLimit[ip] = { count: 1, resetTime: now + RATE_LIMIT_WINDOW };
        return true;
    }
    
    if (rateLimit[ip].count >= MAX_REQUESTS) {
        return false;
    }
    
    rateLimit[ip].count++;
    return true;
}

// CORS básico si necesitas acceso desde otros dominios
app.use((req, res, next) => {
    const allowedOrigins = process.env.CORS_ORIGIN ? [process.env.CORS_ORIGIN] : ['http://localhost:3000'];
    const origin = req.headers.origin;
    if (allowedOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    next();
});

// --- MIDDLEWARES EXISTENTES ---
app.use(express.json({ limit: '10mb' })); // Límite de tamaño
app.use(express.static(path.join(__dirname, 'public')));

// --- CONFIGURACIÓN MEJORADA DE VARIABLES ---
const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;
const GOOGLE_CREDENTIALS_JSON = process.env.GOOGLE_CREDENTIALS;
const NODE_ENV = process.env.NODE_ENV || 'development';

// Validación mejorada de variables de entorno
const requiredEnvVars = {
    GOOGLE_SHEET_ID: SPREADSHEET_ID,
    GOOGLE_CREDENTIALS: GOOGLE_CREDENTIALS_JSON
};

for (const [name, value] of Object.entries(requiredEnvVars)) {
    if (!value) {
        console.error(`❌ ERROR CRÍTICO: Variable de entorno ${name} no definida.`);
        process.exit(1);
    }
}

// --- FUNCIONES AUXILIARES MEJORADAS ---
function obtenerTimestamp() {
    const now = new Date();
    const options = {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false,
        timeZone: 'America/Mexico_City'
    };
    
    const formattedDate = new Date(now).toLocaleString('es-MX', options);
    const [datePart, timePart] = formattedDate.split(' ');
    const [day, month, year] = datePart.split('/');
    return `${year}-${month}-${day} ${timePart}`;
}

// NUEVA: Función de sanitización de datos
function sanitizeInput(input) {
    if (typeof input !== 'string') return input;
    return input.trim()
        .replace(/[<>]/g, '') // Elimina caracteres potencialmente peligrosos
        .substring(0, 1000); // Limita longitud
}

// NUEVA: Validación mejorada con sanitización
function validarCamposRequeridos(data) {
    const campos = ['nombre_usuario', 'empresa', 'tipo'];
    
    for (const campo of campos) {
        if (!data[campo] || String(data[campo]).trim() === '') {
            return `El campo '${campo}' es requerido.`;
        }
        // Sanitizar datos de entrada
        data[campo] = sanitizeInput(data[campo]);
    }
    
    // Validaciones específicas adicionales
    if (data.nombre_usuario.length < 2) {
        return 'El nombre debe tener al menos 2 caracteres.';
    }
    
    const tiposValidos = ['Retraso', 'Mal trato', 'Inseguridad', 'Unidad en mal estado', 'Otro'];
    if (!tiposValidos.includes(data.tipo)) {
        return 'Tipo de queja no válido.';
    }
    
    return null;
}

// --- CONFIGURACIÓN DE GOOGLE SHEETS (SIN CAMBIOS) ---
let parsedCredentials;
try {
    parsedCredentials = JSON.parse(GOOGLE_CREDENTIALS_JSON);
} catch (e) {
    console.error('❌ ERROR CRÍTICO: GOOGLE_CREDENTIALS no es JSON válido.');
    process.exit(1);
}

const auth = new google.auth.GoogleAuth({
    credentials: parsedCredentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

// --- RUTAS MEJORADAS ---
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// RUTA MEJORADA: Envío de quejas con rate limiting
app.post('/enviar-queja', async (req, res) => {
    try {
        // Rate limiting
        const clientIP = req.ip || req.connection.remoteAddress || 'unknown';
        if (!checkRateLimit(clientIP)) {
            console.warn(`⚠️ Rate limit excedido para IP: ${clientIP}`);
            return res.status(429).json({
                error: 'Demasiadas quejas enviadas. Intenta de nuevo en 15 minutos.',
                success: false
            });
        }

        // Validación con sanitización
        const validationError = validarCamposRequeridos(req.body);
        if (validationError) {
            console.warn(`⚠️ Validación fallida: ${validationError}`);
            return res.status(400).json({
                error: validationError,
                success: false
            });
        }

        // Sanitizar todos los campos de texto
        const sanitizedData = {};
        for (const [key, value] of Object.entries(req.body)) {
            sanitizedData[key] = typeof value === 'string' ? sanitizeInput(value) : value;
        }

        const { tipo } = sanitizedData;
        const configuracionFila = construirDatosFila(tipo, sanitizedData);
        
        if (!configuracionFila) {
            console.warn(`⚠️ Tipo de queja no reconocido: ${tipo}`);
            return res.status(400).json({
                error: "Tipo de queja no válido.",
                success: false
            });
        }

        // Resto del código de Google Sheets permanece igual...
        const { tabName, rowValues } = configuracionFila;
        const authClient = await auth.getClient();
        const sheets = google.sheets({ version: 'v4', auth: authClient });

        const request = {
            spreadsheetId: SPREADSHEET_ID,
            range: `${tabName}!A:Z`,
            valueInputOption: 'USER_ENTERED',
            insertDataOption: 'INSERT_ROWS',
            resource: { values: [rowValues] },
        };

        const response = await sheets.spreadsheets.values.append(request);

        // Log mejorado
        console.log(`✅ Queja registrada exitosamente:`);
        console.log(`   - IP: ${clientIP}`);
        console.log(`   - Usuario: ${sanitizedData.nombre_usuario}`);
        console.log(`   - Empresa: ${sanitizedData.empresa}`);
        console.log(`   - Tipo: ${tipo}`);
        console.log(`   - Timestamp: ${obtenerTimestamp()}`);

        res.status(200).json({
            success: true,
            message: "¡Queja registrada con éxito!",
            data: {
                timestamp: rowValues[0],
                usuario: sanitizedData.nombre_usuario,
                empresa: sanitizedData.empresa,
                tipo: tipo
            }
        });

    } catch (error) {
        console.error('❌ Error al procesar queja:', error);
        
        let errorMessage = "Error interno del servidor.";
        let statusCode = 500;

        if (error.code === 403) {
            errorMessage = "Error de permisos con Google Sheets.";
        } else if (error.message && error.message.includes('Unable to parse range')) {
            errorMessage = "Error de configuración de hoja de cálculo.";
        }

        res.status(statusCode).json({
            success: false,
            error: errorMessage,
            timestamp: obtenerTimestamp()
        });
    }
});

// NUEVA RUTA: Estadísticas básicas (opcional)
app.get('/stats', (req, res) => {
    const totalIPs = Object.keys(rateLimit).length;
    const activeIPs = Object.values(rateLimit).filter(data => Date.now() < data.resetTime).length;
    
    res.json({
        success: true,
        stats: {
            totalIPsRecorded: totalIPs,
            activeIPs: activeIPs,
            timestamp: obtenerTimestamp(),
            environment: NODE_ENV
        }
    });
});

// Resto de rutas existentes (health, 404, error handler) permanecen igual...

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log('🚀 ====================================');
    console.log(`📋 Servidor de Quejas Transporte v2.1`);
    console.log(`🌐 Corriendo en: http://localhost:${PORT}`);
    console.log(`🔒 Ambiente: ${NODE_ENV}`);
    console.log(`⏰ Iniciado: ${obtenerTimestamp()}`);
    console.log('🚀 ====================================');
});