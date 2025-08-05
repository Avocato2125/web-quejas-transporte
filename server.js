// server.js (Versión para PostgreSQL)

// Carga las variables de entorno del archivo .env.
// Esto es para uso local. En Railway, las variables se configuran en el panel.
require('dotenv').config();

const express = require('express');
const path = require('path');
const { Pool } = require('pg'); // Importa el cliente de PostgreSQL

const app = express();

// --- Middlewares ---
// Middleware para parsear el cuerpo de las solicitudes con formato JSON (enviadas desde el frontend)
app.use(express.json({ limit: '10mb' })); // Límite de tamaño para el cuerpo de la solicitud

// Middleware para servir archivos estáticos (asegúrate de que tu index.html y otros assets estén en la carpeta 'public')
app.use(express.static(path.join(__dirname, 'public')));

// --- NUEVAS MEJORAS DE SEGURIDAD ---
// Rate limiting básico: Limita la cantidad de solicitudes que una IP puede hacer en un período.
const rateLimit = {};
const RATE_LIMIT_WINDOW = 15 * 60 * 1000; // Ventana de 15 minutos en milisegundos
const MAX_REQUESTS = 10; // Máximo 10 quejas por IP cada 15 minutos

function checkRateLimit(ip) {
    const now = Date.now();
    if (!rateLimit[ip]) {
        rateLimit[ip] = { count: 1, resetTime: now + RATE_LIMIT_WINDOW };
        return true;
    }
    
    if (now > rateLimit[ip].resetTime) { // Si la ventana de tiempo ha pasado, resetear
        rateLimit[ip] = { count: 1, resetTime: now + RATE_LIMIT_WINDOW };
        return true;
    }
    
    if (rateLimit[ip].count >= MAX_REQUESTS) { // Si el contador excede el máximo
        return false;
    }
    
    rateLimit[ip].count++; // Incrementar el contador
    return true;
}

// CORS básico: Permite o restringe solicitudes de otros dominios.
// `process.env.CORS_ORIGIN` debería ser la URL de tu frontend si está en un dominio diferente.
app.use((req, res, next) => {
    // Es buena práctica usar una variable para la URL de Railway para no repetirla
    // Usamos RAILWAY_PUBLIC_DOMAIN que Railway inyecta en producción, o tu dominio si lo configuras
    const railwayAppDomain = process.env.RAILWAY_STATIC_URL || process.env.RAILWAY_PUBLIC_DOMAIN; 
    const railwayAppUrl = railwayAppDomain ? `https://${railwayAppDomain}` : null;

    // Permitir localhost para desarrollo, y la URL de Railway en producción
    const allowedOrigins = ['http://localhost:3000'];
    if (process.env.CORS_ORIGIN) {
        allowedOrigins.push(process.env.CORS_ORIGIN);
    }
    if (railwayAppUrl) {
        allowedOrigins.push(railwayAppUrl);
    }

    const origin = req.headers.origin;

    // Si el origen de la solicitud está en la lista de orígenes permitidos
    if (origin && allowedOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
    }
    // Asegurarse de que las cabeceras OPTIONS se manejen correctamente para CORS preflight
    if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization'); // Incluir Authorization si vas a usar tokens
        return res.sendStatus(204); // No Content
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST'); // Métodos HTTP permitidos
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type'); // Cabeceras permitidas
    next();
});

// --- CONFIGURACIÓN Y VERIFICACIÓN DE VARIABLES DE ENTORNO CRÍTICAS ---
const NODE_ENV = process.env.NODE_ENV || 'development'; // Define el entorno (development/production)

// Verificación de la URL de la base de datos
if (!process.env.DATABASE_URL) {
    console.error('❌ ERROR CRÍTICO: La variable de entorno DATABASE_URL no está definida.');
    console.error('Asegúrate de configurar la base de datos en Railway o en tu archivo .env local.');
    process.exit(1); // Sale de la aplicación si falta la variable crucial
}

// --- CONFIGURACIÓN DE LA BASE DE DATOS POSTGRESQL ---
// Railway inyecta la variable DATABASE_URL automáticamente
// Y la usaremos directamente desde process.env
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false } // Acepta certificados autofirmados, necesario en Railway
});

// Verificación de conexión a la base de datos al inicio
pool.query('SELECT NOW()', (err, res) => {
    if (err) {
        console.error('❌ ERROR: No se pudo conectar a la base de datos PostgreSQL.', err);
        process.exit(1);
    }
    console.log('✅ Conexión a la base de datos PostgreSQL exitosa.');
});

// --- FUNCIONES AUXILIARES ---
/**
 * Obtiene el timestamp actual en formato legible (YYYY-MM-DD HH:MM:SS)
 * para la zona horaria de la Ciudad de México.
 */
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

/**
 * Función de sanitización de datos para prevenir XSS.
 * @param {string|any} input - El valor a sanitizar.
 * @returns {string|any} El valor sanitizado o el original si no es string.
 */
function sanitizeInput(input) {
    if (typeof input !== 'string') return input;
    return input.trim()
        .replace(/[<>"'&]/g, (char) => {
            switch (char) {
                case '<': return '&lt;';
                case '>': return '&gt;';
                case '&': return '&amp;';
                case "'": return '&#x27;';
                case '"': return '&quot;';
                default: return char;
            }
        })
        .substring(0, 1000);
}

/**
 * Valida que los campos requeridos básicos estén presentes y no vacíos.
 * @param {object} data - Los datos recibidos del formulario.
 * @returns {string|null} - Mensaje de error si la validación falla, o null si es exitosa.
 */
function validarCamposRequeridos(data) {
    const camposPrincipales = ['numero_empleado', 'empresa', 'ruta', 'colonia', 'turno', 'tipo'];
    
    for (const campo of camposPrincipales) {
        if (!data[campo] || String(data[campo]).trim() === '') {
            return `El campo '${campo}' es requerido.`;
        }
        data[campo] = sanitizeInput(data[campo]);
    }
    
    if (data.numero_empleado.length < 4) {
        return 'El número de empleado debe tener al menos 4 caracteres.';
    }
    if (!/^\d+$/.test(data.numero_empleado)) {
        return 'El número de empleado debe contener solo números.';
    }
    
    const tiposValidos = ['Retraso', 'Mal trato', 'Inseguridad', 'Unidad en mal estado', 'Otro'];
    if (!tiposValidos.includes(data.tipo)) {
        return 'Tipo de queja no válido.';
    }
    
    const turnosValidos = ['Primero', 'Segundo', 'Tercero', 'Mixto'];
    if (!turnosValidos.includes(data.turno)) {
        return 'Turno no válido.';
    }
    
    return null;
}

// --- RUTAS DEL SERVIDOR ---

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// RUTA POST: Enviar quejas
app.post('/enviar-queja', async (req, res) => {
    try {
        const clientIP = req.ip || req.connection.remoteAddress || 'unknown';
        if (!checkRateLimit(clientIP)) {
            return res.status(429).json({ error: 'Demasiadas quejas.' });
        }
        
        const validationError = validarCamposRequeridos(req.body);
        if (validationError) {
            return res.status(400).json({ error: validationError });
        }

        const {
            numero_empleado, empresa, ruta, colonia, turno, tipo,
            latitud, longitud,
            direccion_subida, hora_programada, hora_llegada, detalles_retraso,
            nombre_conductor_maltrato, detalles_maltrato,
            detalles_inseguridad, ubicacion_inseguridad,
            numero_unidad_malestado, tipo_falla, detalles_malestado,
            detalles_otro
        } = req.body;

        const latitudStr = latitud ? String(latitud) : null;
        const longitudStr = longitud ? String(longitud) : null;

        const query = `
            INSERT INTO quejas (
                numero_empleado, empresa, ruta, colonia, turno, tipo, latitud, longitud,
                detalles_retraso, direccion_subida, hora_programada, hora_llegada,
                nombre_conductor_maltrato, detalles_maltrato,
                detalles_inseguridad, ubicacion_inseguridad,
                numero_unidad_malestado, tipo_falla, detalles_malestado, detalles_otro
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
            RETURNING *
        `;

        const values = [
            numero_empleado, empresa, ruta, colonia, turno, tipo, latitudStr, longitudStr,
            detalles_retraso || null, direccion_subida || null, hora_programada || null, hora_llegada || null,
            nombre_conductor_maltrato || null, detalles_maltrato || null,
            detalles_inseguridad || null, ubicacion_inseguridad || null,
            numero_unidad_malestado || null, tipo_falla || null, detalles_malestado || null,
            detalles_otro || null
        ];

        const resDb = await pool.query(query, values);
        
        console.log(`✅ Queja registrada en BD con ID: ${resDb.rows[0].id}`);

        res.status(200).json({
            success: true,
            message: "¡Queja registrada con éxito en la base de datos! Gracias por tu retroalimentación."
        });

    } catch (error) {
        console.error('❌ Error al procesar queja:', error);
        res.status(500).json({ error: 'Error interno del servidor.' });
    }
});

// NUEVA RUTA: Obtener todas las quejas (para el dashboard)
app.get('/api/quejas', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM quejas ORDER BY fecha_creacion DESC');
        res.status(200).json(result.rows);
    } catch (error) {
        console.error('❌ Error al obtener quejas:', error);
        res.status(500).json({ error: 'Error al consultar la base de datos.' });
    }
});

// NUEVA RUTA: Actualizar estado y resolución de una queja (para el dashboard)
app.put('/api/quejas/:id/resolver', async (req, res) => {
    try {
        const { id } = req.params;
        const { resolucion, estado = 'Revisada' } = req.body;

        if (!resolucion) {
            return res.status(400).json({ error: 'La resolución es un campo requerido.' });
        }

        const query = `
            UPDATE quejas
            SET estado_queja = $1, resolucion = $2, fecha_resolucion = NOW()
            WHERE id = $3
            RETURNING *
        `;
        const values = [estado, resolucion, id];
        const result = await pool.query(query, values);

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Queja no encontrada.' });
        }

        console.log(`✅ Queja ${id} actualizada con resolución.`);
        res.status(200).json({ success: true, queja: result.rows[0] });

    } catch (error) {
        console.error('❌ Error al resolver queja:', error);
        res.status(500).json({ error: 'Error interno del servidor.' });
    }
});

// Ruta para verificar el estado del servidor (health check)
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'ok',
        timestamp: obtenerTimestamp(),
        service: 'Servidor de Quejas Transporte',
        version: '3.0.0' // Versión actualizada para base de datos
    });
});

// Manejo de rutas no encontradas (404)
app.use('*', (req, res) => {
    res.status(404).json({
        success: false,
        error: 'Ruta no encontrada',
        availableRoutes: [
            'GET /',
            'POST /enviar-queja',
            'GET /health',
            'GET /stats',
            'GET /api/quejas',
            'PUT /api/quejas/:id/resolver'
        ]
    });
});

// Manejo global de errores (último middleware)
app.use((error, req, res, next) => {
    console.error('❌ ERROR NO MANEJADO:', error);
    res.status(500).json({
        success: false,
        error: 'Error interno del servidor. Por favor, inténtalo de nuevo más tarde.',
        timestamp: obtenerTimestamp()
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log('🚀 ====================================');
    console.log(`📋 Servidor de Quejas Transporte v3.0`);
    console.log(`🌐 Corriendo en: http://localhost:${PORT}`);
    console.log(`🔒 Ambiente: ${NODE_ENV}`);
    console.log(`✅ Conexión a la base de datos PostgreSQL exitosa.`);
    console.log(`⏰ Iniciado: ${obtenerTimestamp()}`);
    console.log('🚀 ====================================');
    console.log('\n📝 Rutas disponibles:');
    console.log(`   GET  / - Formulario principal`);
    console.log(`   POST /enviar-queja - Enviar queja`);
    console.log(`   GET  /health - Estado del servidor`);
    console.log(`   GET  /stats - Estadísticas de rate limiting`);
    console.log(`   GET  /api/quejas - Obtener todas las quejas (para el dashboard)`);
    console.log(`   PUT  /api/quejas/:id/resolver - Marcar como resuelta`);
    console.log('\n✅ Servidor listo y conectado a la base de datos!');
});