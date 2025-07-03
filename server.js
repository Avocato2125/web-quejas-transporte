// server.js

// Carga las variables de entorno del archivo .env
require('dotenv').config();

const express = require('express');
const path = require('path');
const { google } = require('googleapis'); // Importa googleapis para interactuar con Google Sheets

const app = express();

// --- Middlewares ---
// Middleware para parsear el cuerpo de las solicitudes con formato JSON (enviadas desde el frontend)
app.use(express.json());

// Middleware para servir archivos estáticos (asegúrate de que tu index.html y otros assets estén en la carpeta 'public')
app.use(express.static(path.join(__dirname, 'public')));

// --- Configuración de Google Sheets API ---
// Ruta al archivo JSON de tu cuenta de servicio de Google Cloud.
// ¡IMPORTANTE!: Asegúrate de que esta ruta y nombre de archivo sean correctos
// y que el archivo JSON (con tus credenciales) NO esté en tu repositorio público (.gitignore).
const KEYFILEPATH = path.join(__dirname, 'credentials', 'tecsa-462215-0801a94cf603.json'); // <<-- ¡VERIFICA ESTA RUTA Y NOMBRE DE ARCHIVO!
const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID; // ID de tu hoja de cálculo (definido en el archivo .env)

// Verificación de variables de entorno críticas al inicio del servidor
if (!SPREADSHEET_ID) {
    console.error('❌ ERROR CRÍTICO: GOOGLE_SHEET_ID no está definido en el archivo .env');
    console.error('Asegúrate de tener un archivo .env en la raíz del proyecto con GOOGLE_SHEET_ID=TU_ID_DE_HOJA');
    process.exit(1); // Sale de la aplicación si falta una variable esencial
}

// Configuración de la autenticación JWT (JSON Web Token) para la cuenta de servicio.
// Concede los permisos necesarios para escribir en hojas de cálculo.
const auth = new google.auth.GoogleAuth({
    keyFile: KEYFILEPATH,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

// --- Funciones Auxiliares ---
/**
 * Obtiene el timestamp actual en formato legible (YYYY-MM-DD HH:MM:SS)
 * para la zona horaria de la Ciudad de México.
 * Este formato es más robusto para la interpretación de Google Sheets.
 */
function obtenerTimestamp() {
    const now = new Date();
    // Usa toLocaleString para obtener la fecha/hora en la zona horaria deseada
    // y luego construye el formato YYYY-MM-DD HH:MM:SS
    const options = {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false, // Formato 24 horas
        timeZone: 'America/Mexico_City'
    };
    // Formato ejemplo: 07/02/2025 09:00:00
    const parts = new Date(now).toLocaleString('es-MX', options).split(/[./\s:]+/);
    // Asumiendo formato DD/MM/YYYY HH:MM:SS
    const day = parts[0];
    const month = parts[1];
    const year = parts[2];
    const hour = parts[3];
    const minute = parts[4];
    const second = parts[5];

    return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}


/**
 * Valida que los campos requeridos básicos estén presentes y no vacíos.
 * @param {object} data - Los datos recibidos del formulario.
 * @returns {string|null} - Mensaje de error si la validación falla, o null si es exitosa.
 */
function validarCamposRequeridos(data) {
    const { nombre_usuario, empresa, tipo } = data;

    if (!nombre_usuario || String(nombre_usuario).trim() === '') {
        return 'El nombre del usuario es requerido.';
    }

    if (!empresa || String(empresa).trim() === '') {
        return 'La empresa es requerida.';
    }

    if (!tipo || String(tipo).trim() === '') {
        return 'El tipo de queja es requerido.';
    }

    return null; // No hay errores
}

/**
 * Construye los datos de la fila y determina el nombre de la pestaña
 * según el tipo de queja.
 * @param {string} tipo - El tipo de queja seleccionado.
 * @param {object} data - Todos los datos del formulario.
 * @returns {object|null} - Objeto con 'tabName' y 'rowValues', o null si el tipo no es reconocido.
 */
function construirDatosFila(tipo, data) {
    const timestamp = obtenerTimestamp();
    const { nombre_usuario, empresa } = data;

    // Se asume que 'nombre_usuario' y 'empresa' son comunes a todas las quejas y siempre van después del timestamp.
    // El orden de los elementos en 'rowValues' DEBE coincidir EXACTAMENTE
    // con el orden de los encabezados en la primera fila de la pestaña de Google Sheets.
    const configuraciones = {
        'Retraso': {
            tabName: 'RetrasoUnidad', // Nombre exacto de tu pestaña en Google Sheets
            rowValues: [
                timestamp,
                nombre_usuario,
                empresa,
                tipo,
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
                nombre_usuario,
                empresa,
                tipo,
                data.nombre_conductor_maltrato || '',
                data.detalles_maltrato || ''
            ]
        },
        'Inseguridad': {
            tabName: 'Inseguridad', // Nombre exacto de tu pestaña en Google Sheets
            rowValues: [
                timestamp,
                nombre_usuario,
                empresa,
                tipo,
                data.detalles_inseguridad || '',
                data.ubicacion_inseguridad || ''
            ]
        },
        'Unidad en mal estado': {
            tabName: 'UnidadMalEstado', // Nombre exacto de tu pestaña en Google Sheets
            rowValues: [
                timestamp,
                nombre_usuario,
                empresa,
                tipo,
                data.numero_unidad_malestado || '',
                data.tipo_falla || '',
                data.detalles_malestado || ''
            ]
        },
        'Otro': {
            tabName: 'Otros', // Nombre exacto de tu pestaña en Google Sheets
            rowValues: [
                timestamp,
                nombre_usuario,
                empresa,
                tipo,
                data.detalles_otro || ''
            ]
        }
    };

    return configuraciones[tipo] || null; // Devuelve la configuración o null si el tipo no existe
}

// --- Rutas del Servidor ---

// Ruta GET para servir el formulario principal (index.html)
// Esto asegura que al acceder a la URL base, se muestre tu formulario.
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Ruta POST para manejar el envío de quejas desde el formulario HTML
app.post('/enviar-queja', async (req, res) => {
    try {
        // Validación de datos de entrada usando la función auxiliar
        const validationError = validarCamposRequeridos(req.body);
        if (validationError) {
            console.warn(`⚠️ Validación fallida de campos requeridos: ${validationError}`);
            return res.status(400).json({
                error: validationError,
                success: false
            });
        }

        const { tipo } = req.body;

        // Construir datos para la fila usando la función auxiliar
        const configuracionFila = construirDatosFila(tipo, req.body);
        if (!configuracionFila) {
            console.warn(`⚠️ Tipo de queja no reconocido o no configurado en el backend: ${tipo}`);
            return res.status(400).json({
                error: "Tipo de queja no válido o no configurado en el servidor.",
                success: false
            });
        }

        const { tabName, rowValues } = configuracionFila; // <<-- ¡CORRECCIÓN AQUÍ: configuracionFila!

        // Autentica con Google y obtiene el cliente de Google Sheets API
        const authClient = await auth.getClient();
        const sheets = google.sheets({ version: 'v4', auth: authClient });

        // --- Realizar la Solicitud para Añadir Fila a Google Sheets ---
        const request = {
            spreadsheetId: SPREADSHEET_ID,
            // El rango dinámico para insertar la fila en la pestaña correcta
            range: `${tabName}!A:Z`,
            valueInputOption: 'USER_ENTERED', // Permite que Google interprete los valores (ej. fechas, horas)
            insertDataOption: 'INSERT_ROWS', // Inserta una nueva fila al final de los datos existentes
            resource: {
                values: [rowValues], // El array de valores que representa la nueva fila
            },
        };

        const response = await sheets.spreadsheets.values.append(request);

        // Log de éxito en la consola del servidor
        console.log(`✅ Queja registrada exitosamente en Google Sheets:`);
        console.log(`   - Usuario: ${req.body.nombre_usuario}`);
        console.log(`   - Empresa: ${req.body.empresa}`);
        console.log(`   - Tipo: ${tipo}`);
        console.log(`   - Pestaña de Hoja: ${tabName}`);
        console.log(`   - Respuesta API:`, response.data);

        // Respuesta de éxito al frontend (al navegador)
        res.status(200).json({
            success: true,
            message: "¡Queja registrada con éxito en la hoja de cálculo! Gracias por tu retroalimentación.",
            data: { // Datos útiles que podrías enviar de vuelta al frontend si los necesitas
                timestamp: rowValues[0],
                usuario: req.body.nombre_usuario,
                empresa: req.body.empresa,
                tipo: tipo
            }
        });

    } catch (error) {
        // Manejo de errores más detallado en la consola del servidor y respuesta al frontend
        console.error('❌ Error general al procesar la queja:', error);

        let errorMessage = "Hubo un problema al registrar la queja. Inténtalo de nuevo.";
        // Determina el código de estado HTTP (por defecto 500 para errores del servidor)
        let statusCode = 500;

        // Errores específicos de la API de Google Sheets o configuración
        if (error.code === 403) { // Permisos insuficientes para la cuenta de servicio
            errorMessage = "Error de permisos con la API de Google Sheets. Asegúrate de que la cuenta de servicio tenga acceso de 'Editor' a la hoja.";
            console.error('🔒 ERROR DE PERMISOS: Verificar que la cuenta de servicio tenga acceso como Editor a la hoja.');
            // statusCode se mantiene en 500 ya que es un problema del servidor/configuración
        } else if (error.message && error.message.includes('Unable to parse range')) { // Nombre de pestaña incorrecto o inexistente
            errorMessage = `Error de configuración: No se encontró la pestaña '${tabName || 'desconocida'}'. Asegúrate de que existe y el nombre es exacto.`;
            console.error(`📋 ERROR DE PESTAÑA: Verificar el nombre de la pestaña para el tipo de queja.`);
            // statusCode se mantiene en 500
        } else if (error.code === 'ENOENT') { // Archivo de clave de servicio no encontrado
            errorMessage = "Error de configuración del servidor: Archivo de credenciales no encontrado. Contacta al administrador.";
            console.error('📁 ERROR DE ARCHIVO: Verificar que la ruta y el nombre del archivo de credenciales son correctos.');
            // statusCode se mantiene en 500
        } else if (error.code === 400) { // Bad Request de la API (ej. formato de datos inválido)
            errorMessage = `Error de la API de Google Sheets: ${error.message}.`;
            statusCode = 400; // Si es un error de cliente (Bad Request), podemos devolver 400
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
            'GET /health'
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
// Define el puerto en el que el servidor escuchará. Usa 3000 por defecto o el valor de la variable de entorno PORT.
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log('🚀 ====================================');
    console.log(`📋 Servidor de Quejas Transporte v2.0`);
    console.log(`🌐 Corriendo en: http://localhost:${PORT}`);
    console.log(`📊 Google Sheet ID: ${SPREADSHEET_ID}`);
    console.log(`⏰ Iniciado: ${obtenerTimestamp()}`);
    console.log('🚀 ====================================');
    console.log('\n📝 Rutas disponibles:');
    console.log(`   GET  / - Formulario principal`);
    console.log(`   POST /enviar-queja - Enviar queja`);
    console.log(`   GET  /health - Estado del servidor`);
    console.log('\n✅ Servidor listo para recibir quejas!');
});