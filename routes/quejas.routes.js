// routes/quejas.routes.js
const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

module.exports = (pool, logger, quejaLimiter, authenticateToken, requireRole, quejaSchemas, QUEJAS_CONFIG, ALLOWED_TABLES, generarFolio, sanitizeForFrontend) => {

    // ENVÍO DE QUEJA - NUEVA ESTRUCTURA NORMALIZADA
    router.post('/enviar-queja', quejaLimiter, async (req, res) => {
        logger.debug('Recibiendo queja:', req.body);
        
        // Iniciar cliente para transacción
        const client = await pool.connect();
        
        try {
            const { tipo } = req.body;
            
            // Validar tipo de queja
            const tiposPermitidos = ['retraso', 'mal_trato', 'inseguridad', 'unidad_mal_estado', 'otro'];
            if (!tipo || !tiposPermitidos.includes(tipo)) {
                return res.status(400).json({ 
                    success: false, 
                    error: 'Tipo de queja no válido. Tipos permitidos: ' + tiposPermitidos.join(', ')
                });
            }

            // Validar con esquema
            const schema = quejaSchemas[tipo];
            const { error } = schema.validate(req.body, { allowUnknown: true });
            
            if (error) {
                const errores = error.details.map(d => d.message).join(', ');
                logger.debug('Error de validación:', errores);
                return res.status(400).json({ 
                    success: false, 
                    error: `Datos inválidos: ${errores}` 
                });
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

            // ============================================
            // INICIAR TRANSACCIÓN
            // ============================================
            await client.query('BEGIN');

            // ============================================
            // INSERT 1: Tabla principal "quejas"
            // ============================================
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

            // ============================================
            // INSERT 2: Tabla de detalles según el tipo
            // ============================================
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
            }

            logger.debug('Query detalles:', queryDetalles);
            logger.debug('Values detalles:', valuesDetalles);

            await client.query(queryDetalles, valuesDetalles);

            // ============================================
            // CONFIRMAR TRANSACCIÓN
            // ============================================
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
            // ============================================
            // REVERTIR SI HAY ERROR
            // ============================================
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
            // ============================================
            // LIBERAR CONEXIÓN
            // ============================================
            client.release();
        }
    });

    // OBTENER QUEJAS
    router.get('/quejas', authenticateToken, async (req, res) => {
        try {
            const { page = 1, limit = 50, estado } = req.query;
            const pageNum = parseInt(page, 10);
            const limitNum = Math.min(parseInt(limit, 10), 100);
            const offset = (pageNum - 1) * limitNum;

            // Usar consulta con JOIN a las nuevas tablas
            let query;
            let params;
            
            if (estado) {
                query = `
                    SELECT q.*, dr.*, di.*, dmt.*, dume.*, dot.*
                    FROM quejas q
                    LEFT JOIN detalles_retraso dr ON q.id = dr.queja_id
                    LEFT JOIN detalles_inseguridad di ON q.id = di.queja_id
                    LEFT JOIN detalles_mal_trato dmt ON q.id = dmt.queja_id
                    LEFT JOIN detalles_unidad_mal_estado dume ON q.id = dume.queja_id
                    LEFT JOIN detalles_otro dot ON q.id = dot.queja_id
                    WHERE q.estado = $1
                    ORDER BY q.fecha_creacion DESC
                    LIMIT $2 OFFSET $3
                `;
                params = [estado, limitNum, offset];
            } else {
                query = `
                    SELECT q.*, dr.*, di.*, dmt.*, dume.*, dot.*
                    FROM quejas q
                    LEFT JOIN detalles_retraso dr ON q.id = dr.queja_id
                    LEFT JOIN detalles_inseguridad di ON q.id = di.queja_id
                    LEFT JOIN detalles_mal_trato dmt ON q.id = dmt.queja_id
                    LEFT JOIN detalles_unidad_mal_estado dume ON q.id = dume.queja_id
                    LEFT JOIN detalles_otro dot ON q.id = dot.queja_id
                    ORDER BY q.fecha_creacion DESC
                    LIMIT $1 OFFSET $2
                `;
                params = [limitNum, offset];
            }

            const result = await pool.query(query, params);
            const allQuejas = result.rows;

            res.status(200).json({
                success: true,
                data: sanitizeForFrontend(allQuejas),
                pagination: { page: pageNum, limit: limitNum, total: allQuejas.length }
            });

        } catch (error) {
            logger.error('Error al obtener las quejas:', { error: error.message });
            res.status(500).json({ success: false, error: 'Error al consultar la base de datos.' });
        }
    });

    // Alias para compatibilidad con frontend: /api/quejas
    router.get('/api/quejas', authenticateToken, async (req, res) => {
        try {
            const { page = 1, limit = 50, estado } = req.query;
            const pageNum = parseInt(page, 10);
            const limitNum = Math.min(parseInt(limit, 10), 100);
            const offset = (pageNum - 1) * limitNum;

            const tableNames = Object.values(QUEJAS_CONFIG).map(c => c.tableName);

            let query;
            let params;
            
            if (estado) {
                query = `
                    SELECT q.*, dr.*, di.*, dmt.*, dume.*, dot.*
                    FROM quejas q
                    LEFT JOIN detalles_retraso dr ON q.id = dr.queja_id
                    LEFT JOIN detalles_inseguridad di ON q.id = di.queja_id
                    LEFT JOIN detalles_mal_trato dmt ON q.id = dmt.queja_id
                    LEFT JOIN detalles_unidad_mal_estado dume ON q.id = dume.queja_id
                    LEFT JOIN detalles_otro dot ON q.id = dot.queja_id
                    WHERE q.estado = $1
                    ORDER BY q.fecha_creacion DESC
                    LIMIT $2 OFFSET $3
                `;
                params = [estado, limitNum, offset];
            } else {
                query = `
                    SELECT q.*, dr.*, di.*, dmt.*, dume.*, dot.*
                    FROM quejas q
                    LEFT JOIN detalles_retraso dr ON q.id = dr.queja_id
                    LEFT JOIN detalles_inseguridad di ON q.id = di.queja_id
                    LEFT JOIN detalles_mal_trato dmt ON q.id = dmt.queja_id
                    LEFT JOIN detalles_unidad_mal_estado dume ON q.id = dume.queja_id
                    LEFT JOIN detalles_otro dot ON q.id = dot.queja_id
                    ORDER BY q.fecha_creacion DESC
                    LIMIT $1 OFFSET $2
                `;
                params = [limitNum, offset];
            }

            const result = await pool.query(query, params);
            const allQuejas = result.rows;

            res.status(200).json({
                success: true,
                data: sanitizeForFrontend(allQuejas),
                pagination: { page: pageNum, limit: limitNum, total: allQuejas.length }
            });

        } catch (error) {
            logger.error('Error al obtener las quejas (alias /api/quejas):', { error: error.message });
            res.status(500).json({ success: false, error: 'Error al consultar la base de datos.' });
        }
    });

    // GENERAR PDF DE QUEJA (y alias /api/queja/pdf/:folio)
    router.get(['/queja/pdf/:folio', '/api/queja/pdf/:folio'], authenticateToken, requireRole(['admin', 'supervisor']), async (req, res) => {
        const { folio } = req.params;
        
        try {
            // Buscar la queja en la nueva estructura
            const query = `
                SELECT q.*, dr.*, di.*, dmt.*, dume.*, dot.*
                FROM quejas q
                LEFT JOIN detalles_retraso dr ON q.id = dr.queja_id
                LEFT JOIN detalles_inseguridad di ON q.id = di.queja_id
                LEFT JOIN detalles_mal_trato dmt ON q.id = dmt.queja_id
                LEFT JOIN detalles_unidad_mal_estado dume ON q.id = dume.queja_id
                LEFT JOIN detalles_otro dot ON q.id = dot.queja_id
                WHERE q.folio = $1
            `;
            const result = await pool.query(query, [folio]);
            const queja = result.rows[0];
            const tablaOrigen = queja ? `quejas_${queja.tipo}` : null;
            
            if (!queja) {
                return res.status(404).json({ success: false, error: 'Queja no encontrada' });
            }
            
            // Buscar la resolución
            const resolucionResult = await pool.query(
                'SELECT * FROM resoluciones WHERE folio_queja = $1 ORDER BY fecha_resolucion DESC LIMIT 1',
                [folio]
            );
            
            const resolucion = resolucionResult.rows[0];
            if (!resolucion) {
                logger.warn('Intento de generar PDF sin resolución', { folio, ip: req.ip });
                return res.status(404).json({ success: false, error: 'No se encontró resolución para esta queja' });
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
                responsable: resolucion.responsable,
                estado: queja.estado_queja,
                procedencia: resolucion.procedencia,
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
            
            // Log de datos para debugging
            logger.info('Datos del template:', { 
                folio: templateData.folio,
                responsable: templateData.responsable,
                procedencia: templateData.procedencia,
                procedencia_class: templateData.procedencia_class,
                hasResolucion: !!templateData.resolucion,
                hasDetalles: {
                    retraso: !!templateData.detalles_retraso,
                    maltrato: !!templateData.detalles_maltrato,
                    inseguridad: !!templateData.detalles_inseguridad,
                    malestado: !!templateData.detalles_malestado,
                    otro: !!templateData.detalles_otro
                }
            });
            
            // Leer el template HTML
            const templatePath = path.join(__dirname, '..', 'public', 'templates', 'reporte-queja.html');
                
            let htmlTemplate = fs.readFileSync(templatePath, 'utf8');
            
            // Reemplazar variables en el template (simple template engine)
            logger.info('Iniciando procesamiento del template...');
            for (const [key, value] of Object.entries(templateData)) {
                const regex = new RegExp(`{{${key}}}`, 'g');
                const originalLength = htmlTemplate.length;
                htmlTemplate = htmlTemplate.replace(regex, value || '');
                const replaced = originalLength !== htmlTemplate.length;
                if (replaced) {
                    logger.info(`Variable ${key} reemplazada:`, { value: value || 'null/undefined' });
                }
            }
            
            // Manejar condicionales {{#if}}
            logger.info('Procesando condicionales...');
            htmlTemplate = htmlTemplate.replace(/\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (match, condition, content) => {
                const hasCondition = !!templateData[condition];
                logger.info(`Condicional ${condition}:`, { hasCondition, contentLength: content.length });
                return hasCondition ? content : '';
            });
            
            // Verificar que no queden variables sin reemplazar
            const remainingVariables = htmlTemplate.match(/\{\{[^}]+\}\} /g);
            if (remainingVariables) {
                logger.warn('Variables sin reemplazar:', remainingVariables);
            } else {
                logger.info('Todas las variables fueron reemplazadas correctamente');
            }
            
            // Generar PDF con Puppeteer (configuración simplificada)
            logger.info('Iniciando Puppeteer...');
            const browser = await puppeteer.launch({
                headless: true,
                executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--no-first-run',
                    '--no-zygote',
                    '--single-process',
                    '--disable-gpu',
                    '--disable-background-timer-throttling',
                    '--disable-backgrounding-occluded-windows',
                    '--disable-renderer-backgrounding',
                    '--disable-features=TranslateUI',
                    '--disable-ipc-flooding-protection',
                    '--memory-pressure-off',
                    '--max_old_space_size=4096'
                ],
                timeout: 30000,
                protocolTimeout: 30000
            });
            
            logger.info('Creando nueva página...');
            const page = await browser.newPage();
            
            // Configurar viewport para consistencia
            logger.info('Configurando viewport...');
            await page.setViewport({ 
                width: 1200, 
                height: 800,
                deviceScaleFactor: 1
            });
            
            // Configurar cache y recursos
            await page.setCacheEnabled(false);
            await page.setJavaScriptEnabled(true);
            
            // Cargar contenido y esperar a que todo esté listo
            logger.info('Cargando contenido HTML...');
            await page.setContent(htmlTemplate, { 
                waitUntil: 'domcontentloaded',
                timeout: 30000
            });
            
            // Esperar un poco más para asegurar que todo se renderice
            logger.info('Esperando renderizado adicional...');
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            logger.info('Generando PDF...');
            const pdfBuffer = await page.pdf({
                format: 'A4',
                printBackground: true,
                preferCSSPageSize: false,
                margin: {
                    top: '20mm',
                    right: '15mm',
                    bottom: '20mm',
                    left: '15mm'
                },
                timeout: 30000,
                displayHeaderFooter: false,
                scale: 0.8
            });
            
            logger.info('PDF generado exitosamente', { 
                bufferSize: pdfBuffer.length,
                bufferSizeKB: Math.round(pdfBuffer.length / 1024),
                isBuffer: Buffer.isBuffer(pdfBuffer),
                bufferType: typeof pdfBuffer,
                firstBytes: pdfBuffer.slice(0, 10).toString('hex')
            });
            
            await browser.close();

            // Enviar PDF como respuesta con headers optimizados
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename="reporte-queja-${folio}.pdf"`);
            res.setHeader('Content-Length', pdfBuffer.length);
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
            res.setHeader('Accept-Ranges', 'bytes');
            res.setHeader('Content-Transfer-Encoding', 'binary');
            
            // Asegurar que sea un Buffer válido
            const buffer = Buffer.isBuffer(pdfBuffer) ? pdfBuffer : Buffer.from(pdfBuffer);
            res.send(buffer);
            
            logger.info('PDF generado exitosamente', { folio, responsable: req.user.username, ip: req.ip });
            
        } catch (error) {
            logger.error('Error al generar PDF:', { 
                error: error.message, 
                stack: error.stack,
                folio, 
                ip: req.ip 
            });
            
            // Cerrar browser si está abierto
            try {
                if (browser) {
                    await browser.close();
                }
            } catch (closeError) {
                logger.warn('Error al cerrar browser:', closeError.message);
            }
            
            res.status(500).json({ 
                success: false, 
                error: 'Error al generar el reporte PDF',
                details: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    });

    // VISUALIZAR PDF DE QUEJA (sin descarga) y alias /api/queja/view/:folio
    router.get(['/queja/view/:folio', '/api/queja/view/:folio'], authenticateToken, requireRole(['admin', 'supervisor']), async (req, res) => {
        const { folio } = req.params;
        
        try {
            // Buscar la queja en todas las tablas
            const tableNames = Object.values(QUEJAS_CONFIG).map(c => c.tableName);
            let queja = null;
            let tablaOrigen = null;
            
            for (const tableName of tableNames) {
                const result = await pool.query(`SELECT * FROM ${tableName} WHERE folio = $1`, [folio]);
                if (result.rows.length > 0) {
                    queja = result.rows[0];
                    tablaOrigen = tableName;
                    break;
                }
            }
            
            if (!queja) {
                logger.warn('Intento de visualizar PDF para queja no encontrada', { folio, ip: req.ip });
                return res.status(404).json({ success: false, error: 'Queja no encontrada' });
            }
            
            // Buscar la resolución
            const resolucionResult = await pool.query(
                'SELECT * FROM resoluciones WHERE folio_queja = $1 ORDER BY fecha_resolucion DESC LIMIT 1',
                [folio]
            );
            
            const resolucion = resolucionResult.rows[0];
            if (!resolucion) {
                logger.warn('Intento de visualizar PDF sin resolución', { folio, ip: req.ip });
                return res.status(404).json({ success: false, error: 'No se encontró resolución para esta queja' });
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
                responsable: resolucion.responsable,
                estado: queja.estado_queja,
                procedencia: resolucion.procedencia,
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
            
            // Enviar HTML para visualización
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.send(htmlTemplate);
            
            logger.info('HTML de queja enviado para visualización', { folio, responsable: req.user.username, ip: req.ip });
            
        } catch (error) {
            logger.error('Error al generar HTML de queja:', { 
                error: error.message, 
                stack: error.stack,
                folio, 
                ip: req.ip 
            });
            
            res.status(500).json({ 
                success: false, 
                error: 'Error al generar el reporte HTML',
                details: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    });

    // RESOLVER QUEJA
    router.put('/queja/resolver', authenticateToken, requireRole(['admin', 'supervisor']), async (req, res) => {
        const client = await pool.connect();
        
        try {
            const { id, tabla_origen, folio, resolucion, procedencia, estado = 'Revisada' } = req.body;
            const responsable = req.user.username;

            if (!id || !tabla_origen || !folio || !resolucion || !procedencia) {
                return res.status(400).json({ 
                    success: false, 
                    error: 'Faltan datos requeridos: id, tabla_origen, folio, resolucion, procedencia' 
                });
            }

            // Validar que procedencia sea válida
            if (!['Procedio', 'No Procedio', 'Procedió', 'No Procedió'].includes(procedencia)) {
                return res.status(400).json({ 
                    success: false, 
                    error: 'Procedencia debe ser "Procedio" o "No Procedio"' 
                });
            }
            
            // Normalizar procedencia para la base de datos
            const procedenciaNormalizada = procedencia.includes('Procedio') ? 'Procedió' : 'No Procedió';

            if (!ALLOWED_TABLES[tabla_origen]) {
                return res.status(400).json({ 
                    success: false, 
                    error: 'Nombre de tabla no válido.' 
                });
            }

            await client.query('BEGIN');

            const checkQuery = `SELECT id, folio, estado_queja FROM ${tabla_origen} WHERE id = $1 AND folio = $2`;
            const checkResult = await client.query(checkQuery, [id, folio]);
            
            if (checkResult.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ 
                    success: false, 
                    error: 'Queja no encontrada.' 
                });
            }
            
            // Verificar que la queja esté pendiente
            if (checkResult.rows[0].estado_queja !== 'Pendiente') {
                await client.query('ROLLBACK');
                return res.status(400).json({ 
                    success: false, 
                    error: `La queja ya ha sido procesada. Estado actual: ${checkResult.rows[0].estado_queja}` 
                });
            }

            const updateQuery = `UPDATE ${tabla_origen} SET estado_queja = $1 WHERE id = $2`;
            await client.query(updateQuery, [estado, id]);

            const insertQuery = 'INSERT INTO resoluciones (folio_queja, texto_resolucion, responsable, procedencia) VALUES ($1, $2, $3, $4)';
            await client.query(insertQuery, [folio, resolucion, responsable, procedenciaNormalizada]);

            await client.query('COMMIT');
            
            logger.info('Queja resuelta exitosamente', { folio, responsable, estado, procedencia, ip: req.ip });
            res.status(200).json({ 
                success: true, 
                message: 'Queja resuelta y registrada exitosamente.' 
            });

        } catch (error) {
            await client.query('ROLLBACK');
            logger.error('Error en la transacción de resolución:', { error: error.message });
            res.status(500).json({ success: false, error: 'Error interno del servidor al procesar la resolución.' });
        } finally {
            client.release();
        }
    });

    return router;
};
