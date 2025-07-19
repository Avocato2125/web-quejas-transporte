// server.js

// Carga las variables de entorno del archivo .env.
// Esto es para uso local. En Railway, las variables se configuran en el panel.
require('dotenv').config();

const express = require('express');
const path = require('path');
const { google } = require('googleapis'); // Importa googleapis para interactuar con Google Sheets

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
    const railwayAppUrl = `https://${process.env.RAILWAY_STATIC_URL || 'your-default-railway-domain.up.railway.app'}`; // Reemplaza con tu URL real o una variable de env de Railway
    const allowedOrigins = process.env.CORS_ORIGIN ? [process.env.CORS_ORIGIN, railwayAppUrl] : ['http://localhost:3000', railwayAppUrl];
    const origin = req.headers.origin;

    // Si el origen de la solicitud está en la lista de orígenes permitidos
    if (allowedOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST'); // Métodos HTTP permitidos
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type'); // Cabeceras permitidas
    next();
});

// --- CONFIGURACIÓN Y VERIFICACIÓN DE VARIABLES DE ENTORNO CRÍTICAS ---
const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;
const GOOGLE_CREDENTIALS_JSON = process.env.GOOGLE_CREDENTIALS;
const NODE_ENV = process.env.NODE_ENV || 'development'; // Define el entorno (development/production)

// Validación robusta al inicio: Asegura que las variables esenciales estén definidas.
const requiredEnvVars = {
    GOOGLE_SHEET_ID: SPREADSHEET_ID,
    GOOGLE_CREDENTIALS: GOOGLE_CREDENTIALS_JSON
};

for (const [name, value] of Object.entries(requiredEnvVars)) {
    if (!value) {
        console.error(`❌ ERROR CRÍTICO: La variable de entorno ${name} no está definida.`);
        console.error(`Asegúrate de configurarla en tu archivo .env local o en el panel de Railway.`);
        process.exit(1); // Sale de la aplicación si falta la variable crucial
    }
}

// --- Configuración de Google Sheets API ---
let parsedCredentials;
try {
    parsedCredentials = JSON.parse(GOOGLE_CREDENTIALS_JSON);
} catch (e) {
    console.error('❌ ERROR CRÍTICO: La variable GOOGLE_CREDENTIALS no es un JSON válido.');
    console.error('Asegúrate de haber copiado todo el contenido JSON de tu archivo de credenciales.');
    process.exit(1);
}

const auth = new google.auth.GoogleAuth({
    credentials: parsedCredentials, // Las credenciales se leen desde la variable de entorno
    scopes: ['https://www.googleapis.com/auth/spreadsheets'], // Alcance para acceder a hojas de cálculo
});

// --- Funciones Auxiliares ---
/**
 * Obtiene el timestamp actual en formato legible (YYYY-MM-DD HH:MM:SS)
 * para la zona horaria de la Ciudad de México.
 * Este formato es robusto para la interpretación de Google Sheets.
 */
function obtenerTimestamp() {
    const now = new Date();
    const options = {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false, // Formato de 24 horas
        timeZone: 'America/Mexico_City'
    };
    
    const formattedDate = new Date(now).toLocaleString('es-MX', options);
    // Transforma el formato de toLocaleString ('DD/MM/YYYY HH:MM:SS') a 'YYYY-MM-DD HH:MM:SS'
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
    if (typeof input !== 'string') return input; // No sanitizar si no es string (ej. números, booleanos)
    return input.trim()
        // Reemplaza caracteres HTML especiales por sus entidades para prevenir XSS
        .replace(/[<>"'&]/g, (char) => {
            switch (char) {
                case '<': return '&lt;';
                case '>': return '&gt;';
                case '&': return '&amp;';
                case "'": return '&#x27;';
                case '"': return '&quot;';
                default: return char; // Devolver el carácter original si no coincide con ninguno
            }
        })
        .substring(0, 1000); // Limita la longitud de la cadena a 1000 caracteres
}

/**
 * Valida que los campos requeridos básicos estén presentes y no vacíos.
 * Modifica `data` in-place para aplicar sanitización a los campos básicos.
 * @param {object} data - Los datos recibidos del formulario (se modifican para sanitización).
 * @returns {string|null} - Mensaje de error si la validación falla, o null si es exitosa.
 */
function validarCamposRequeridos(data) {
    // CAMBIO: Ahora espera 'numero_empleado' en lugar de 'nombre_usuario'
    const camposPrincipales = ['numero_empleado', 'empresa', 'tipo'];
    
    for (const campo of camposPrincipales) {
        // Validación: campo no vacío o solo espacios
        if (!data[campo] || String(data[campo]).trim() === '') {
            return `El campo '${campo}' es requerido.`;
        }
        // Sanitización in-place para los campos principales
        data[campo] = sanitizeInput(data[campo]);
    }
    
    // Validaciones específicas adicionales para 'numero_empleado'
    if (data.numero_empleado.length < 4) { // Ajusta el mínimo de caracteres para número de empleado (4 en HTML)
        return 'El número de empleado debe tener al menos 4 caracteres.';
    }
    // ¡Esta es la validación que estaba fallando!
    if (!/^\d+$/.test(data.numero_empleado)) { // Regex para verificar que solo contenga dígitos
        return 'El número de empleado debe contener solo números.';
    }
    
    const tiposValidos = ['Retraso', 'Mal trato', 'Inseguridad', 'Unidad en mal estado', 'Otro'];
    if (!tiposValidos.includes(data.tipo)) {
        return 'Tipo de queja no válido.';
    }
    
    return null; // No hay errores de validación
}

/**
 * Construye los datos de la fila y determina el nombre de la pestaña
 * según el tipo de queja, incluyendo geolocalización.
 * @param {string} tipo - El tipo de queja seleccionado.
 * @param {object} data - Todos los datos del formulario (ya sanitizados).
 * @returns {object|null} - Objeto con 'tabName' y 'rowValues', o null si el tipo no es reconocido.
 */
function construirDatosFila(tipo, data) {
    const timestamp = obtenerTimestamp();
    // CAMBIO: Extrae 'numero_empleado' en lugar de 'nombre_usuario'
    const { numero_empleado, empresa, latitud, longitud } = data; 

    // Convertir latitud/longitud a string o dejar 'N/D' si no están presentes o son inválidas
    const latitudStr = (latitud !== null && latitud !== undefined && latitud !== '') ? String(latitud) : 'N/D';
    const longitudStr = (longitud !== null && longitud !== undefined && longitud !== '') ? String(longitud) : 'N/D';

    // El orden de los elementos en 'rowValues' DEBE coincidir EXACTAMENTE
    // con el orden de los encabezados en la primera fila de la pestaña de Google Sheets.
    const configuraciones = {
        'Retraso': {
            tabName: 'RetrasoUnidad', // Nombre exacto de tu pestaña en Google Sheets
            rowValues: [
                timestamp,
                numero_empleado, // Campo 'Número de Empleado'
                empresa,
                tipo,
                latitudStr,  // Columna Latitud
                longitudStr, // Columna Longitud
                data.direccion_subida || '',
                data.hora_programada || '',
                data.hora_llegada || '',
                data.detalles_retraso || ''
            ]
        },
        'Mal trato': {
            tabName: 'MalTrato', // Nombre exacto de tu pestaña en Google Sheets
            rowValues: [
                timestamp,
                numero_empleado, // Campo 'Número de Empleado'
                empresa,
                tipo,
                latitudStr,  // Columna Latitud
                longitudStr, // Columna Longitud
                data.nombre_conductor_maltrato || '',
                data.detalles_maltrato || ''
            ]
        },
        'Inseguridad': {
            tabName: 'Inseguridad', // Nombre exacto de tu pestaña en Google Sheets
            rowValues: [
                timestamp,
                numero_empleado, // Campo 'Número de Empleado'
                empresa,
                tipo,
                latitudStr,  // Columna Latitud
                longitudStr, // Columna Longitud
                data.detalles_inseguridad || '',
                data.ubicacion_inseguridad || ''
            ]
        },
        'Unidad en mal estado': {
            tabName: 'UnidadMalEstado', // Nombre exacto de tu pestaña en Google Sheets
            rowValues: [
                timestamp,
                numero_empleado, // Campo 'Número de Empleado'
                empresa,
                tipo,
                latitudStr,  // Columna Latitud
                longitudStr, // Columna Longitud
                data.numero_unidad_malestado || '',
                data.tipo_falla || '',
                data.detalles_malestado || ''
            ]
        },
        'Otro': {
            tabName: 'Otros', // Nombre exacto de tu pestaña en Google Sheets
            rowValues: [
                timestamp,
                numero_empleado, // Campo 'Número de Empleado'
                empresa,
                tipo,
                latitudStr,  // Columna Latitud
                longitudStr, // Columna Longitud
                data.detalles_otro || ''
            ]
        }
    };

    return configuraciones[tipo] || null; // Devuelve la configuración o null si el tipo no existe
}

// --- CONFIGURACIÓN DE GOOGLE SHEETS API ---
let parsedCredentials;
try {
    parsedCredentials = JSON.parse(GOOGLE_CREDENTIALS_JSON);
} catch (e) {
    console.error('❌ ERROR CRÍTICO: GOOGLE_CREDENTIALS no es un JSON válido.');
    process.exit(1);
}

const auth = new google.auth.GoogleAuth({
    credentials: parsedCredentials, // Las credenciales se leen desde la variable de entorno
    scopes: ['https://www.googleapis.com/auth/spreadsheets'], // Alcance para acceder a hojas de cálculo
});

// --- RUTAS DEL SERVIDOR ---

// Ruta GET para servir el formulario principal (index.html)
// Esto asegura que al acceder a la URL base, se muestre tu formulario.
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Ruta POST para manejar el envío de quejas desde el formulario HTML
app.post('/enviar-queja', async (req, res) => {
    try {
        // Rate limiting: Obtiene la IP del cliente y la verifica
        const clientIP = req.ip || req.connection.remoteAddress || 'unknown';
        if (!checkRateLimit(clientIP)) {
            console.warn(`⚠️ Rate limit excedido para IP: ${clientIP}`);
            return res.status(429).json({
                error: 'Demasiadas quejas enviadas. Intenta de nuevo en 15 minutos.',
                success: false
            });
        }

        // Validación de datos de entrada. req.body se modifica in-place por validarCamposRequeridos
        const validationError = validarCamposRequeridos(req.body); 
        if (validationError) {
            console.warn(`⚠️ Validación fallida: ${validationError}`);
            return res.status(400).json({ // Detiene la ejecución y devuelve 400
                error: validationError,
                success: false
            });
        }

        const { tipo } = req.body; // 'tipo' ya está sanitizado a este punto

        // Construir datos para la fila usando la función auxiliar (req.body ya está validado y sanitizado)
        const configuracionFila = construirDatosFila(tipo, req.body);
        
        if (!configuracionFila) {
            console.warn(`⚠️ Tipo de queja no reconocido: ${tipo}`);
            return res.status(400).json({
                error: "Tipo de queja no válido o no configurado en el servidor.",
                success: false
            });
        }

        const { tabName, rowValues } = configuracionFila; // Desestructura la configuración de la fila

        // Autentica con Google y obtiene el cliente de Google Sheets API
        const authClient = await auth.getClient();
        const sheets = google.sheets({ version: 'v4', auth: authClient });

        // --- Realizar la Solicitud para Añadir Fila a Google Sheets ---
        const request = {
            spreadsheetId: SPREADSHEET_ID,
            range: `${tabName}!A:Z`, // El rango dinámico para insertar la fila en la pestaña correcta
            valueInputOption: 'USER_ENTERED', // Interpreta los valores como si un usuario los ingresara
            insertDataOption: 'INSERT_ROWS', // Inserta una nueva fila al final de los datos existentes
            resource: {
                values: [rowValues], // El array de valores que representa la nueva fila
            },
        };

        const response = await sheets.spreadsheets.values.append(request); // <<-- CORRECCIÓN: sheets.spreadsheets.values.append

        // Log de éxito en la consola del servidor
        console.log(`✅ Queja registrada exitosamente en Google Sheets:`);
        console.log(`   - IP: ${clientIP}`);
        console.log(`   - Número de Empleado: ${req.body.numero_empleado}`); // <<-- CAMBIO: Log de numero_empleado
        console.log(`   - Empresa: ${req.body.empresa}`);
        console.log(`   - Tipo: ${tipo}`);
        console.log(`   - Ubicación: ${req.body.latitud || 'N/D'}, ${req.body.longitud || 'N/D'}`); // Log de ubicación
        console.log(`   - Timestamp: ${obtenerTimestamp()}`);

        // Respuesta de éxito al frontend (al navegador)
        res.status(200).json({
            success: true,
            message: "¡Queja registrada con éxito en la hoja de cálculo! Gracias por tu retroalimentación.",
            data: { // Datos útiles que podrías enviar de vuelta al frontend si los necesitas
                timestamp: rowValues[0],
                numero_empleado: req.body.numero_empleado, // <<-- CAMBIO: En la respuesta
                empresa: req.body.empresa,
                tipo: tipo,
                latitud: req.body.latitud || null,
                longitud: req.body.longitud || null
            }
        });

    } catch (error) {
        // Manejo de errores más detallado en la consola del servidor y respuesta al frontend
        console.error('❌ Error al procesar queja:', error);

        let errorMessage = "Hubo un problema al registrar la queja. Inténtalo de nuevo.";
        let statusCode = 500; // Por defecto, error interno del servidor

        // Errores específicos de la API de Google Sheets o configuración
        if (error.code === 403) { // Permisos insuficientes para la cuenta de servicio (Forbidden)
            errorMessage = "Error de permisos con Google Sheets. Asegúrate de que la cuenta de servicio tenga acceso de 'Editor' a la hoja.";
            console.error('🔒 ERROR DE PERMISOS: Verificar que la cuenta de servicio tenga acceso como Editor a la hoja.');
        } else if (error.message && error.message.includes('Unable to parse range')) { // Nombre de pestaña incorrecto o inexistente
            // Nota: req.body.tipo podría no estar definido si el error ocurrió antes de construir configuracionFila
            errorMessage = `Error de configuración: No se encontró la pestaña '${req.body.tipo || 'desconocida'}'. Asegúrate de que existe y el nombre es exacto.`;
            console.error(`📋 ERROR DE PESTAÑA: Verificar el nombre de la pestaña para el tipo de queja.`);
        } else if (error.code === 'ENOENT') { // Archivo de clave de servicio no encontrado
            errorMessage = "Error de configuración del servidor.";
            console.error('📁 ERROR DE ARCHIVO: Verificar que la ruta y el nombre del archivo de credenciales son correctos.');
        } else if (error.code === 400) { // Bad Request de la API (ej. formato de datos inválido enviado a Google Sheets)
            errorMessage = `Error de la API de Google Sheets: ${error.message}.`;
            statusCode = 400; // Si es un error de cliente (Bad Request), devolvemos 400
            console.error('📊 ERROR DE API: La API de Google Sheets rechazó la solicitud.');
        }

        // Envía la respuesta de error al frontend
        res.status(statusCode).json({
            success: false,
            error: errorMessage,
            timestamp: obtenerTimestamp() // Incluye un timestamp para el error
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

// Ruta para verificar el estado del servidor (health check)
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'ok',
        timestamp: obtenerTimestamp(),
        service: 'Servidor de Quejas Transporte',
        version: '2.0.0'
    });
});

// Manejo de rutas no encontradas (404)
// Captura cualquier solicitud a una ruta que no ha sido definida anteriormente.
app.use('*', (req, res) => {
    res.status(404).json({
        success: false,
        error: 'Ruta no encontrada',
        availableRoutes: [ // Información útil para el cliente
            'GET /',
            'POST /enviar-queja',
            'GET /health',
            'GET /stats'
        ]
    });
});

// Manejo global de errores (último middleware)
// Captura cualquier error que ocurra en los middlewares o rutas y no haya sido manejado.
app.use((error, req, res, next) => {
    console.error('❌ ERROR NO MANEJADO EN EL SERVIDOR:', error);
    res.status(500).json({
        success: false,
        error: 'Error interno del servidor. Por favor, inténtalo de nuevo más tarde.',
        timestamp: obtenerTimestamp()
    });
});

// --- Inicio del Servidor ---
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log('🚀 ====================================');
    console.log(`📋 Servidor de Quejas Transporte v2.2`); // Versión actualizada
    console.log(`🌐 Corriendo en: http://localhost:${PORT}`);
    console.log(`🔒 Ambiente: ${NODE_ENV}`);
    console.log(`⏰ Iniciado: ${obtenerTimestamp()}`);
    console.log('🚀 ====================================');
    console.log('\n📝 Rutas disponibles:');
    console.log(`   GET  / - Formulario principal`);
    console.log(`   POST /enviar-queja - Enviar queja`);
    console.log(`   GET  /health - Estado del servidor`);
    console.log(`   GET  /stats - Estadísticas de rate limiting`);
    console.log('\n✅ Servidor listo para recibir quejas!');
});