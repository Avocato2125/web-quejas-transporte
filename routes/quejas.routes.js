// routes/quejas.routes.js
const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

module.exports = (pool, logger, quejaLimiter, authenticateToken, requireRole, quejaSchemas, QUEJAS_CONFIG, ALLOWED_TABLES, generarFolio, sanitizeForFrontend) => {

    // ============================================
    // MAPEO DE TIPOS (formulario → base de datos)
    // ============================================
    const TIPO_MAPPING = {
        'Retraso': 'retraso',
        'Mal trato': 'mal_trato',
        'Inseguridad': 'inseguridad',
        'Unidad en mal estado': 'unidad_mal_estado',
        'Otro': 'otro'
    };

    const TIPOS_PERMITIDOS = ['retraso', 'mal_trato', 'inseguridad', 'unidad_mal_estado', 'otro'];

    // ============================================
    // ENVÍO DE QUEJA - ESTRUCTURA NORMALIZADA
    // ============================================
    router.post('/enviar-queja', quejaLimiter, async (req, res) => {
        logger.debug('Recibiendo queja:', req.body);
        
        const client = await pool.connect();
        
        try {
            let { tipo } = req.body;
            
            // Guardar tipo original para logs
            const tipoOriginal = tipo;
            
            // Convertir tipo del formulario al tipo de BD
            tipo = TIPO_MAPPING[tipo] || tipo;
            
            logger.debug('Tipo original:', tipoOriginal);
            logger.debug('Tipo convertido:', tipo);
            
            // Validar tipo de queja
            if (!tipo || !TIPOS_PERMITIDOS.includes(tipo)) {
                return res.status(400).json({ 
                    success: false, 
                    error: 'Tipo de queja no válido. Tipos permitidos: ' + Object.keys(TIPO_MAPPING).join(', ')
                });
            }

            // Actualizar el tipo en req.body para la validación
            req.body.tipo = tipo;

            // Validar con esquema Joi
            const schema = quejaSchemas[tipoOriginal] || quejaSchemas[tipo];
            
            if (schema) {
                const { error } = schema.validate(req.body, { allowUnknown: true });
                if (error) {
                    const errores = error.details.map(d => d.message).join(', ');
                    logger.debug('Error de validación:', errores);
                    return res.status(400).json({ 
                        success: false, 
                        error: `Datos inválidos: ${errores}` 
                    });
                }
            }

            const { numero_empleado, empresa, ruta, colonia, turno, latitud, longitud, numero_unidad, ...detalles } = req.body;
            
            const nuevoFolio = generarFolio();
            logger.debug('Folio generado:', nuevoFolio);

            // Conversión de horas a timestamps (solo para retraso)
            if (tipo === 'retraso') {
                const today = new Date().toISOString().split('T')[0];
                const horaFields = ['hora_programada', 'hora_llegada', 'hora_llegada_planta'];
                
                horaFields.forEach(field => {
                    if (detalles[field] && detalles[field] !== '') {
                        if (detalles[field].match(/^\d{1,2}:\d{2}$/)) {
                            detalles[field] = `${today} ${detalles[field]}:00`;
                            logger.debug(`Convertido ${field}: ${detalles[field]}`);
                        }
                    }
                });
            }

            // INICIAR TRANSACCIÓN
            await client.query('BEGIN');

            // INSERT 1: Tabla principal "quejas"
            const queryQuejas = `
                INSERT INTO quejas (
                    folio, numero_empleado, empresa, ruta, colonia, turno,
                    tipo, latitud, longitud, numero_unidad, ip_address, user_agent
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                RETURNING id
            `;
            
            const valuesQuejas = [
                nuevoFolio,
                numero_empleado,
                empresa,
                ruta || null,
                colonia || null,
                turno || null,
                tipo,
                latitud || null,
                longitud || null,
                numero_unidad || null,
                req.ip || null,
                req.get('User-Agent') || null
            ];

            logger.debug('Query quejas:', queryQuejas);
            logger.debug('Values quejas:', valuesQuejas);

            const resultQuejas = await client.query(queryQuejas, valuesQuejas);
            const quejaId = resultQuejas.rows[0].id;

            logger.debug('Queja insertada con ID:', quejaId);

            // INSERT 2: Tabla de detalles según el tipo
            let queryDetalles;
            let valuesDetalles;

            switch (tipo) {
                case 'retraso':
                    queryDetalles = `
                        INSERT INTO detalles_retraso (
                            queja_id, direccion_subida, hora_programada, hora_llegada,
                            hora_llegada_planta, detalles_retraso, metodo_transporte_alterno, monto_gastado
                        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                    `;
                    valuesDetalles = [
                        quejaId,
                        detalles.direccion_subida || null,
                        detalles.hora_programada || null,
                        detalles.hora_llegada || null,
                        detalles.hora_llegada_planta || null,
                        detalles.detalles_retraso || null,
                        detalles.metodo_transporte_alterno || null,
                        detalles.monto_gastado || null
                    ];
                    break;

                case 'inseguridad':
                    queryDetalles = `
                        INSERT INTO detalles_inseguridad (
                            queja_id, ubicacion_inseguridad, detalles_inseguridad
                        ) VALUES ($1, $2, $3)
                    `;
                    valuesDetalles = [
                        quejaId,
                        detalles.ubicacion_inseguridad || null,
                        detalles.detalles_inseguridad || null
                    ];
                    break;

                case 'mal_trato':
                    queryDetalles = `
                        INSERT INTO detalles_mal_trato (
                            queja_id, nombre_conductor_maltrato, detalles_maltrato
                        ) VALUES ($1, $2, $3)
                    `;
                    valuesDetalles = [
                        quejaId,
                        detalles.nombre_conductor_maltrato || null,
                        detalles.detalles_maltrato || null
                    ];
                    break;

                case 'unidad_mal_estado':
                    queryDetalles = `
                        INSERT INTO detalles_unidad_mal_estado (
                            queja_id, numero_unidad_malestado, tipo_falla, detalles_malestado
                        ) VALUES ($1, $2, $3, $4)
                    `;
                    valuesDetalles = [
                        quejaId,
                        detalles.numero_unidad_malestado || null,
                        detalles.tipo_falla || null,
                        detalles.detalles_malestado || null
                    ];
                    break;

                case 'otro':
                    queryDetalles = `
                        INSERT INTO detalles_otro (
                            queja_id, detalles_otro
                        ) VALUES ($1, $2)
                    `;
                    valuesDetalles = [
                        quejaId,
                        detalles.detalles_otro || null
                    ];
                    break;
                
                default:
                    throw new Error(`Tipo de queja no soportado: ${tipo}`);
            }

            logger.debug('Query detalles:', queryDetalles);
            logger.debug('Values detalles:', valuesDetalles);

            await client.query(queryDetalles, valuesDetalles);

            // CONFIRMAR TRANSACCIÓN
            await client.query('COMMIT');
            
            logger.info('Queja registrada exitosamente', { 
                folio: nuevoFolio, 
                tipo: tipo,
                id: quejaId,
                ip: req.ip
            });
            
            res.status(201).json({ 
                success: true, 
                message: '¡Queja registrada con éxito!', 
                folio: nuevoFolio 
            });
            
        } catch (error) {
            await client.query('ROLLBACK');
            
            logger.error('Error completo:', error);
            logger.error('Error al procesar la queja:', { 
                error: error.message, 
                stack: error.stack,
                body: req.body,
                ip: req.ip
            });
            
            res.status(500).json({ 
                success: false, 
                error: 'Error interno del servidor: ' + error.message 
            });
        } finally {
            client.release();
        }
    });

    // ============================================
    // FUNCIÓN AUXILIAR: Obtener queja con detalles
    // ============================================
    async function obtenerQuejaCompleta(folio) {
        const query = `
            SELECT 
                q.*,
                dr.direccion_subida, dr.hora_programada, dr.hora_llegada, 
                dr.hora_llegada_planta, dr.detalles_retraso, 
                dr.metodo_transporte_alterno, dr.monto_gastado,
                di.ubicacion_inseguridad, di.detalles_inseguridad,
                dmt.nombre_conductor_maltrato, dmt.detalles_maltrato,
                dume.numero_unidad_malestado, dume.tipo_falla, dume.detalles_malestado,
                dot.detalles_otro
            FROM quejas q
            LEFT JOIN detalles_retraso dr ON q.id = dr.queja_id
            LEFT JOIN detalles_inseguridad di ON q.id = di.queja_id
            LEFT JOIN detalles_mal_trato dmt ON q.id = dmt.queja_id
            LEFT JOIN detalles_unidad_mal_estado dume ON q.id = dume.queja_id
            LEFT JOIN detalles_otro dot ON q.id = dot.queja_id
            WHERE q.folio = $1
        `;
        const result = await pool.query(query, [folio]);
        return result.rows[0] || null;
    }

    // ============================================
    // FUNCIÓN AUXILIAR: Obtener queja por ID
    // ============================================
    async function obtenerQuejaPorId(id) {
        const query = `
            SELECT 
                q.*,
                dr.direccion_subida, dr.hora_programada, dr.hora_llegada, 
                dr.hora_llegada_planta, dr.detalles_retraso, 
                dr.metodo_transporte_alterno, dr.monto_gastado,
                di.ubicacion_inseguridad, di.detalles_inseguridad,
                dmt.nombre_conductor_maltrato, dmt.detalles_maltrato,
                dume.numero_unidad_malestado, dume.tipo_falla, dume.detalles_malestado,
                dot.detalles_otro
            FROM quejas q
            LEFT JOIN detalles_retraso dr ON q.id = dr.queja_id
            LEFT JOIN detalles_inseguridad di ON q.id = di.queja_id
            LEFT JOIN detalles_mal_trato dmt ON q.id = dmt.queja_id
            LEFT JOIN detalles_unidad_mal_estado dume ON q.id = dume.queja_id
            LEFT JOIN detalles_otro dot ON q.id = dot.queja_id
            WHERE q.id = $1
        `;
        const result = await pool.query(query, [id]);
        return result.rows[0] || null;
    }

    // ============================================
    // OBTENER QUEJAS (lista)
    // ============================================
    router.get('/quejas', authenticateToken, async (req, res) => {
        try {
            const { page = 1, limit = 50, estado } = req.query;
            const pageNum = parseInt(page, 10);
            const limitNum = Math.min(parseInt(limit, 10), 100);
            const offset = (pageNum - 1) * limitNum;

            let query;
            let countQuery;
            let params;
            
            if (estado) {
                query = `
                    SELECT 
                        q.*,
                        dr.direccion_subida, dr.hora_programada, dr.hora_llegada, 
                        dr.detalles_retraso, dr.metodo_transporte_alterno, dr.monto_gastado,
                        di.ubicacion_inseguridad, di.detalles_inseguridad,
                        dmt.nombre_conductor_maltrato, dmt.detalles_maltrato,
                        dume.numero_unidad_malestado, dume.tipo_falla, dume.detalles_malestado,
                        dot.detalles_otro
                    FROM quejas q
                    LEFT JOIN detalles_retraso dr ON q.id = dr.queja_id
                    LEFT JOIN detalles_inseguridad di ON q.id = di.queja_id
                    LEFT JOIN detalles_mal_trato dmt ON q.id = dmt.queja_id
                    LEFT JOIN detalles_unidad_mal_estado dume ON q.id = dume.queja_id
                    LEFT JOIN detalles_otro dot ON q.id = dot.queja_id
                    WHERE q.estado_queja = $1
                    ORDER BY q.fecha_creacion DESC
                    LIMIT $2 OFFSET $3
                `;
                countQuery = `SELECT COUNT(*) FROM quejas WHERE estado_queja = $1`;
                params = [estado, limitNum, offset];
            } else {
                query = `
                    SELECT 
                        q.*,
                        dr.direccion_subida, dr.hora_programada, dr.hora_llegada, 
                        dr.detalles_retraso, dr.metodo_transporte_alterno, dr.monto_gastado,
                        di.ubicacion_inseguridad, di.detalles_inseguridad,
                        dmt.nombre_conductor_maltrato, dmt.detalles_maltrato,
                        dume.numero_unidad_malestado, dume.tipo_falla, dume.detalles_malestado,
                        dot.detalles_otro
                    FROM quejas q
                    LEFT JOIN detalles_retraso dr ON q.id = dr.queja_id
                    LEFT JOIN detalles_inseguridad di ON q.id = di.queja_id
                    LEFT JOIN detalles_mal_trato dmt ON q.id = dmt.queja_id
                    LEFT JOIN detalles_unidad_mal_estado dume ON q.id = dume.queja_id
                    LEFT JOIN detalles_otro dot ON q.id = dot.queja_id
                    ORDER BY q.fecha_creacion DESC
                    LIMIT $1 OFFSET $2
                `;
                countQuery = `SELECT COUNT(*) FROM quejas`;
                params = [limitNum, offset];
            }

            const result = await pool.query(query, params);
            const countResult = await pool.query(countQuery, estado ? [estado] : []);
            const total = parseInt(countResult.rows[0].count, 10);

            res.status(200).json({
                success: true,
                data: sanitizeForFrontend(result.rows),
                pagination: { 
                    page: pageNum, 
                    limit: limitNum, 
                    total: total,
                    totalPages: Math.ceil(total / limitNum)
                }
            });

        } catch (error) {
            logger.error('Error al obtener las quejas:', { error: error.message });
            res.status(500).json({ success: false, error: 'Error al consultar la base de datos.' });
        }
    });

    // Alias para compatibilidad con frontend
    router.get('/api/quejas', authenticateToken, async (req, res) => {
        try {
            const { page = 1, limit = 50, estado } = req.query;
            const pageNum = parseInt(page, 10);
            const limitNum = Math.min(parseInt(limit, 10), 100);
            const offset = (pageNum - 1) * limitNum;

            let query;
            let countQuery;
            let params;
            
            if (estado) {
                query = `
                    SELECT 
                        q.*,
                        dr.direccion_subida, dr.hora_programada, dr.hora_llegada, 
                        dr.detalles_retraso, dr.metodo_transporte_alterno, dr.monto_gastado,
                        di.ubicacion_inseguridad, di.detalles_inseguridad,
                        dmt.nombre_conductor_maltrato, dmt.detalles_maltrato,
                        dume.numero_unidad_malestado, dume.tipo_falla, dume.detalles_malestado,
                        dot.detalles_otro
                    FROM quejas q
                    LEFT JOIN detalles_retraso dr ON q.id = dr.queja_id
                    LEFT JOIN detalles_inseguridad di ON q.id = di.queja_id
                    LEFT JOIN detalles_mal_trato dmt ON q.id = dmt.queja_id
                    LEFT JOIN detalles_unidad_mal_estado dume ON q.id = dume.queja_id
                    LEFT JOIN detalles_otro dot ON q.id = dot.queja_id
                    WHERE q.estado_queja = $1
                    ORDER BY q.fecha_creacion DESC
                    LIMIT $2 OFFSET $3
                `;
                countQuery = `SELECT COUNT(*) FROM quejas WHERE estado_queja = $1`;
                params = [estado, limitNum, offset];
            } else {
                query = `
                    SELECT 
                        q.*,
                        dr.direccion_subida, dr.hora_programada, dr.hora_llegada, 
                        dr.detalles_retraso, dr.metodo_transporte_alterno, dr.monto_gastado,
                        di.ubicacion_inseguridad, di.detalles_inseguridad,
                        dmt.nombre_conductor_maltrato, dmt.detalles_maltrato,
                        dume.numero_unidad_malestado, dume.tipo_falla, dume.detalles_malestado,
                        dot.detalles_otro
                    FROM quejas q
                    LEFT JOIN detalles_retraso dr ON q.id = dr.queja_id
                    LEFT JOIN detalles_inseguridad di ON q.id = di.queja_id
                    LEFT JOIN detalles_mal_trato dmt ON q.id = dmt.queja_id
                    LEFT JOIN detalles_unidad_mal_estado dume ON q.id = dume.queja_id
                    LEFT JOIN detalles_otro dot ON q.id = dot.queja_id
                    ORDER BY q.fecha_creacion DESC
                    LIMIT $1 OFFSET $2
                `;
                countQuery = `SELECT COUNT(*) FROM quejas`;
                params = [limitNum, offset];
            }

            const result = await pool.query(query, params);
            const countResult = await pool.query(countQuery, estado ? [estado] : []);
            const total = parseInt(countResult.rows[0].count, 10);

            res.status(200).json({
                success: true,
                data: sanitizeForFrontend(result.rows),
                pagination: { 
                    page: pageNum, 
                    limit: limitNum, 
                    total: total,
                    totalPages: Math.ceil(total / limitNum)
                }
            });

        } catch (error) {
            logger.error('Error al obtener las quejas (alias /api/quejas):', { error: error.message });
            res.status(500).json({ success: false, error: 'Error al consultar la base de datos.' });
        }
    });

    // ============================================
    // OBTENER UNA QUEJA POR FOLIO
    // ============================================
    router.get('/queja/:folio', authenticateToken, async (req, res) => {
        try {
            const { folio } = req.params;
            const queja = await obtenerQuejaCompleta(folio);
            
            if (!queja) {
                return res.status(404).json({ success: false, error: 'Queja no encontrada' });
            }
            
            res.status(200).json({
                success: true,
                data: sanitizeForFrontend(queja)
            });
            
        } catch (error) {
            logger.error('Error al obtener queja:', { error: error.message });
            res.status(500).json({ success: false, error: 'Error al consultar la base de datos.' });
        }
    });

    // ============================================
    // GENERAR PDF DE QUEJA
    // ============================================
    router.get(['/queja/pdf/:folio', '/api/queja/pdf/:folio'], authenticateToken, requireRole(['admin', 'supervisor']), async (req, res) => {
        const { folio } = req.params;
        let browser;
        
        try {
            // Buscar la queja
            const queja = await obtenerQuejaCompleta(folio);
            
            if (!queja) {
                return res.status(404).json({ success: false, error: 'Queja no encontrada' });
            }
            
            // Buscar la resolución (nueva estructura usa queja_id)
            const resolucionResult = await pool.query(
                'SELECT * FROM resoluciones WHERE queja_id = $1 ORDER BY fecha_resolucion DESC LIMIT 1',
                [queja.id]
            );
            
            const resolucion = resolucionResult.rows[0];
            if (!resolucion) {
                logger.warn('Intento de generar PDF sin resolución', { folio, ip: req.ip });
                return res.status(404).json({ success: false, error: 'No se encontró resolución para esta queja' });
            }

            // Obtener nombre del responsable
            let responsableNombre = 'Desconocido';
            if (resolucion.responsable_id) {
                const userResult = await pool.query('SELECT username FROM users WHERE id = $1', [resolucion.responsable_id]);
                if (userResult.rows[0]) {
                    responsableNombre = userResult.rows[0].username;
                }
            }
            
            // Preparar datos para el template
            const templateData = {
                folio: queja.folio,
                numero_empleado: queja.numero_empleado,
                empresa: queja.empresa,
                tipo: queja.tipo,
                fecha_creacion: new Date(queja.fecha_creacion).toLocaleDateString('es-MX', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                    timeZone: 'America/Mexico_City'
                }),
                fechaReporte: new Date().toLocaleDateString('es-MX', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                    timeZone: 'America/Mexico_City'
                }),
                responsable: responsableNombre,
                estado: queja.estado_queja,
                procedencia: resolucion.procedencia || '',
                procedencia_class: resolucion.procedencia === 'Procedió' ? 'procedio' : 'no-procedio',
                resolucion: resolucion.texto_resolucion,
                ruta: queja.ruta || null,
                numero_unidad: queja.numero_unidad || null,
                colonia: queja.colonia || null,
                turno: queja.turno || null,
                detalles_retraso: queja.detalles_retraso || null,
                detalles_maltrato: queja.detalles_maltrato || null,
                detalles_inseguridad: queja.detalles_inseguridad || null,
                detalles_malestado: queja.detalles_malestado || null,
                detalles_otro: queja.detalles_otro || null
            };
            
            // Leer el template HTML
            const templatePath = path.join(__dirname, '..', 'public', 'templates', 'reporte-queja.html');
            let htmlTemplate = fs.readFileSync(templatePath, 'utf8');
            
            // Reemplazar variables en el template
            for (const [key, value] of Object.entries(templateData)) {
                const regex = new RegExp(`{{${key}}}`, 'g');
                htmlTemplate = htmlTemplate.replace(regex, value || '');
            }
            
            // Manejar condicionales {{#if}}
            htmlTemplate = htmlTemplate.replace(/\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (match, condition, content) => {
                return templateData[condition] ? content : '';
            });
            
            // Generar PDF con Puppeteer
            browser = await puppeteer.launch({
                headless: true,
                executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-gpu'
                ],
                timeout: 30000
            });
            
            const page = await browser.newPage();
            await page.setViewport({ width: 1200, height: 800 });
            await page.setContent(htmlTemplate, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            const pdfBuffer = await page.pdf({
                format: 'A4',
                printBackground: true,
                margin: { top: '20mm', right: '15mm', bottom: '20mm', left: '15mm' },
                scale: 0.8
            });
            
            await browser.close();

            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename="reporte-queja-${folio}.pdf"`);
            res.setHeader('Content-Length', pdfBuffer.length);
            res.send(Buffer.from(pdfBuffer));
            
            logger.info('PDF generado exitosamente', { folio, responsable: req.user.username, ip: req.ip });
            
        } catch (error) {
            logger.error('Error al generar PDF:', { error: error.message, folio, ip: req.ip });
            
            if (browser) {
                try { await browser.close(); } catch (e) {}
            }
            
            res.status(500).json({ success: false, error: 'Error al generar el reporte PDF' });
        }
    });

    // ============================================
    // VISUALIZAR PDF (HTML)
    // ============================================
    router.get(['/queja/view/:folio', '/api/queja/view/:folio'], authenticateToken, requireRole(['admin', 'supervisor']), async (req, res) => {
        const { folio } = req.params;
        
        try {
            const queja = await obtenerQuejaCompleta(folio);
            
            if (!queja) {
                return res.status(404).json({ success: false, error: 'Queja no encontrada' });
            }
            
            const resolucionResult = await pool.query(
                'SELECT * FROM resoluciones WHERE queja_id = $1 ORDER BY fecha_resolucion DESC LIMIT 1',
                [queja.id]
            );
            
            const resolucion = resolucionResult.rows[0];
            if (!resolucion) {
                return res.status(404).json({ success: false, error: 'No se encontró resolución para esta queja' });
            }

            let responsableNombre = 'Desconocido';
            if (resolucion.responsable_id) {
                const userResult = await pool.query('SELECT username FROM users WHERE id = $1', [resolucion.responsable_id]);
                if (userResult.rows[0]) {
                    responsableNombre = userResult.rows[0].username;
                }
            }
            
            const templateData = {
                folio: queja.folio,
                numero_empleado: queja.numero_empleado,
                empresa: queja.empresa,
                tipo: queja.tipo,
                fecha_creacion: new Date(queja.fecha_creacion).toLocaleDateString('es-MX', {
                    year: 'numeric', month: 'long', day: 'numeric',
                    hour: '2-digit', minute: '2-digit', timeZone: 'America/Mexico_City'
                }),
                fechaReporte: new Date().toLocaleDateString('es-MX', {
                    year: 'numeric', month: 'long', day: 'numeric', timeZone: 'America/Mexico_City'
                }),
                responsable: responsableNombre,
                estado: queja.estado_queja,
                procedencia: resolucion.procedencia || '',
                procedencia_class: resolucion.procedencia === 'Procedió' ? 'procedio' : 'no-procedio',
                resolucion: resolucion.texto_resolucion,
                ruta: queja.ruta || null,
                numero_unidad: queja.numero_unidad || null,
                colonia: queja.colonia || null,
                turno: queja.turno || null,
                detalles_retraso: queja.detalles_retraso || null,
                detalles_maltrato: queja.detalles_maltrato || null,
                detalles_inseguridad: queja.detalles_inseguridad || null,
                detalles_malestado: queja.detalles_malestado || null,
                detalles_otro: queja.detalles_otro || null
            };
            
            const templatePath = path.join(__dirname, '..', 'public', 'templates', 'reporte-queja.html');
            let htmlTemplate = fs.readFileSync(templatePath, 'utf8');
            
            for (const [key, value] of Object.entries(templateData)) {
                const regex = new RegExp(`{{${key}}}`, 'g');
                htmlTemplate = htmlTemplate.replace(regex, value || '');
            }
            
            htmlTemplate = htmlTemplate.replace(/\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (match, condition, content) => {
                return templateData[condition] ? content : '';
            });
            
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.send(htmlTemplate);
            
        } catch (error) {
            logger.error('Error al generar HTML:', { error: error.message, folio });
            res.status(500).json({ success: false, error: 'Error al generar el reporte HTML' });
        }
    });

    // ============================================
    // RESOLVER QUEJA (nueva estructura)
    // ============================================
    router.put('/queja/resolver', authenticateToken, requireRole(['admin', 'supervisor']), async (req, res) => {
        const client = await pool.connect();
        
        try {
            const { id, folio, resolucion, procedencia, estado = 'Revisada' } = req.body;
            const responsable_id = req.user.id;

            // Validar datos requeridos
            if (!id || !folio || !resolucion || !procedencia) {
                return res.status(400).json({ 
                    success: false, 
                    error: 'Faltan datos requeridos: id, folio, resolucion, procedencia' 
                });
            }

            // Validar procedencia
            const procedenciasValidas = ['Procedio', 'No Procedio', 'Procedió', 'No Procedió'];
            if (!procedenciasValidas.includes(procedencia)) {
                return res.status(400).json({ 
                    success: false, 
                    error: 'Procedencia debe ser "Procedió" o "No Procedió"' 
                });
            }
            
            const procedenciaNormalizada = procedencia.includes('Procedio') ? 'Procedió' : 'No Procedió';

            await client.query('BEGIN');

            // Verificar que la queja existe y está pendiente
            const checkResult = await client.query(
                'SELECT id, folio, estado_queja FROM quejas WHERE id = $1 AND folio = $2',
                [id, folio]
            );
            
            if (checkResult.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ success: false, error: 'Queja no encontrada.' });
            }
            
            if (checkResult.rows[0].estado_queja !== 'Pendiente') {
                await client.query('ROLLBACK');
                return res.status(400).json({ 
                    success: false, 
                    error: `La queja ya ha sido procesada. Estado actual: ${checkResult.rows[0].estado_queja}` 
                });
            }

            // Actualizar estado de la queja
            await client.query(
                'UPDATE quejas SET estado_queja = $1 WHERE id = $2',
                [estado, id]
            );

            // Insertar resolución (nueva estructura con queja_id y responsable_id)
            await client.query(
                'INSERT INTO resoluciones (queja_id, texto_resolucion, responsable_id, procedencia) VALUES ($1, $2, $3, $4)',
                [id, resolucion, responsable_id, procedenciaNormalizada]
            );

            await client.query('COMMIT');
            
            logger.info('Queja resuelta exitosamente', { 
                folio, 
                responsable: req.user.username, 
                estado, 
                procedencia: procedenciaNormalizada,
                ip: req.ip 
            });
            
            res.status(200).json({ 
                success: true, 
                message: 'Queja resuelta y registrada exitosamente.' 
            });

        } catch (error) {
            await client.query('ROLLBACK');
            logger.error('Error en resolución:', { error: error.message });
            res.status(500).json({ success: false, error: 'Error interno del servidor.' });
        } finally {
            client.release();
        }
    });

    // ============================================
    // ESTADÍSTICAS DE QUEJAS
    // ============================================
    router.get('/quejas/stats', authenticateToken, async (req, res) => {
        try {
            const stats = await pool.query(`
                SELECT 
                    tipo,
                    estado_queja,
                    COUNT(*) as total
                FROM quejas
                GROUP BY tipo, estado_queja
                ORDER BY tipo, estado_queja
            `);

            const totales = await pool.query(`
                SELECT 
                    COUNT(*) as total,
                    COUNT(*) FILTER (WHERE estado_queja = 'Pendiente') as pendientes,
                    COUNT(*) FILTER (WHERE estado_queja = 'Revisada') as revisadas
                FROM quejas
            `);

            res.status(200).json({
                success: true,
                data: {
                    porTipoYEstado: stats.rows,
                    totales: totales.rows[0]
                }
            });

        } catch (error) {
            logger.error('Error al obtener estadísticas:', { error: error.message });
            res.status(500).json({ success: false, error: 'Error al obtener estadísticas.' });
        }
    });

    return router;
};