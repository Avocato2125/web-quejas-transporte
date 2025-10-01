// routes/quejas.routes.js
const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

module.exports = (pool, logger, quejaLimiter, authenticateToken, requireRole, quejaSchemas, QUEJAS_CONFIG, ALLOWED_TABLES, generarFolio, sanitizeForFrontend) => {

    // ENVÍO DE QUEJA CORREGIDO
    router.post('/enviar-queja', quejaLimiter, async (req, res) => {
        logger.debug('Recibiendo queja:', req.body);
        
        try {
            const { tipo } = req.body;
            
            // Validar tipo de queja
            if (!tipo || !QUEJAS_CONFIG[tipo]) {
                return res.status(400).json({ 
                    success: false, 
                    error: 'Tipo de queja no válido. Tipos permitidos: ' + Object.keys(QUEJAS_CONFIG).join(', ')
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
            const config = QUEJAS_CONFIG[tipo];
            
            // Validar tabla permitida
            if (!ALLOWED_TABLES[config.tableName]) {
                throw new Error(`Tabla no permitida: ${config.tableName}`);
            }

            const nuevoFolio = generarFolio();
            logger.debug('Folio generado:', nuevoFolio);

            // Conversión de horas a timestamps
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

            // Preparar datos para insertar
            const commonFields = ['numero_empleado', 'empresa', 'ruta', 'colonia', 'turno', 'tipo', 'latitud', 'longitud', 'numero_unidad', 'folio'];
            const specificFields = config.fields;
            const allFieldNames = [...commonFields, ...specificFields];
            
            const allValues = [
                numero_empleado, 
                empresa, 
                ruta || null, 
                colonia || null, 
                turno || null, 
                tipo,
                latitud || null, 
                longitud || null, 
                numero_unidad || null, 
                nuevoFolio,
                ...specificFields.map(field => detalles[field] || null)
            ];

            logger.debug('Campos:', allFieldNames);
            logger.debug('Valores:', allValues);

            const queryFields = allFieldNames.join(', ');
            const queryValuePlaceholders = allFieldNames.map((_, i) => `$${i + 1}`).join(', ');
            const query = `INSERT INTO ${config.tableName} (${queryFields}) VALUES (${queryValuePlaceholders}) RETURNING id;`;
            
            logger.debug('Query SQL:', query);
            
            const result = await pool.query(query, allValues);
            
            logger.info('Queja registrada exitosamente', { 
                folio: nuevoFolio, 
                tabla: config.tableName, 
                id: result.rows[0].id,
                ip: req.ip
            });
            
            res.status(201).json({ 
                success: true, 
                message: '¡Queja registrada con éxito!', 
                folio: nuevoFolio 
            });
            
        } catch (error) {
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
        }
    });

    // OBTENER QUEJAS
    router.get('/quejas', authenticateToken, async (req, res) => {
        try {
            const { page = 1, limit = 50, estado } = req.query;
            const pageNum = parseInt(page, 10);
            const limitNum = Math.min(parseInt(limit, 10), 100);
            const offset = (pageNum - 1) * limitNum;

            // Usar consulta directa a las tablas
            const tableNames = Object.values(QUEJAS_CONFIG).map(c => c.tableName);
            
            let queries;
            if (estado) {
                // Filtrar por estado específico
                queries = tableNames.map(tableName => 
                    pool.query(`SELECT *, '${tableName}' as tabla_origen FROM ${tableName} WHERE estado_queja = $1 ORDER BY fecha_creacion DESC LIMIT $2 OFFSET $3`,
                    [estado, limitNum, offset])
                );
            } else {
                // Obtener todas las quejas sin filtrar por estado
                queries = tableNames.map(tableName => 
                    pool.query(`SELECT *, '${tableName}' as tabla_origen FROM ${tableName} ORDER BY fecha_creacion DESC LIMIT $1 OFFSET $2`,
                    [limitNum, offset])
                );
            }

            const results = await Promise.all(queries);
            const allQuejas = results.flatMap(result => result.rows);
            
            allQuejas.sort((a, b) => new Date(b.fecha_creacion) - new Date(a.fecha_creacion));

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

            let queries;
            if (estado) {
                queries = tableNames.map(tableName => 
                    pool.query(`SELECT *, '${tableName}' as tabla_origen FROM ${tableName} WHERE estado_queja = $1 ORDER BY fecha_creacion DESC LIMIT $2 OFFSET $3`,
                    [estado, limitNum, offset])
                );
            } else {
                queries = tableNames.map(tableName => 
                    pool.query(`SELECT *, '${tableName}' as tabla_origen FROM ${tableName} ORDER BY fecha_creacion DESC LIMIT $1 OFFSET $2`,
                    [limitNum, offset])
                );
            }

            const results = await Promise.all(queries);
            const allQuejas = results.flatMap(result => result.rows);

            allQuejas.sort((a, b) => new Date(b.fecha_creacion) - new Date(a.fecha_creacion));

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

    // GENERAR PDF DE QUEJA
    router.get('/queja/pdf/:folio', authenticateToken, requireRole(['admin', 'supervisor']), async (req, res) => {
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

    // VISUALIZAR PDF DE QUEJA (sin descarga)
    router.get('/queja/view/:folio', authenticateToken, requireRole(['admin', 'supervisor']), async (req, res) => {
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
