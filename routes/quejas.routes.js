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
            const tipoOriginal = tipo;
            tipo = TIPO_MAPPING[tipo] || tipo;
            
            logger.debug('Tipo original:', tipoOriginal);
            logger.debug('Tipo convertido:', tipo);
            
            if (!tipo || !TIPOS_PERMITIDOS.includes(tipo)) {
                return res.status(400).json({ 
                    success: false, 
                    error: 'Tipo de queja no válido. Tipos permitidos: ' + Object.keys(TIPO_MAPPING).join(', ')
                });
            }

            req.body.tipo = tipo;
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

            await client.query('BEGIN');

            // Crear fecha en zona horaria de Saltillo, Coahuila (America/Monterrey)
            const ahora = new Date();
            const fechaMexico = new Date(ahora.toLocaleString("en-US", { timeZone: "America/Monterrey" }));
            logger.debug('Fecha Saltillo/Monterrey generada:', fechaMexico.toISOString());

            const queryQuejas = `
                INSERT INTO quejas (
                    folio, numero_empleado, empresa, ruta, colonia, turno,
                    tipo, latitud, longitud, numero_unidad, ip_address, user_agent, fecha_creacion
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
                RETURNING id
            `;
            
            const valuesQuejas = [
                nuevoFolio, numero_empleado, empresa, ruta || null, colonia || null, turno || null,
                tipo, latitud || null, longitud || null, numero_unidad || null, req.ip || null, req.get('User-Agent') || null,
                fechaMexico
            ];

            const resultQuejas = await client.query(queryQuejas, valuesQuejas);
            const quejaId = resultQuejas.rows[0].id;

            let queryDetalles;
            let valuesDetalles;

            switch (tipo) {
                case 'retraso':
                    queryDetalles = `INSERT INTO detalles_retraso (queja_id, direccion_subida, hora_programada, hora_llegada, hora_llegada_planta, detalles_retraso, metodo_transporte_alterno, monto_gastado) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`;
                    valuesDetalles = [quejaId, detalles.direccion_subida || null, detalles.hora_programada || null, detalles.hora_llegada || null, detalles.hora_llegada_planta || null, detalles.detalles_retraso || null, detalles.metodo_transporte_alterno || null, detalles.monto_gastado || null];
                    break;
                case 'inseguridad':
                    queryDetalles = `INSERT INTO detalles_inseguridad (queja_id, ubicacion_inseguridad, detalles_inseguridad) VALUES ($1, $2, $3)`;
                    valuesDetalles = [quejaId, detalles.ubicacion_inseguridad || null, detalles.detalles_inseguridad || null];
                    break;
                case 'mal_trato':
                    queryDetalles = `INSERT INTO detalles_mal_trato (queja_id, nombre_conductor_maltrato, detalles_maltrato) VALUES ($1, $2, $3)`;
                    valuesDetalles = [quejaId, detalles.nombre_conductor_maltrato || null, detalles.detalles_maltrato || null];
                    break;
                case 'unidad_mal_estado':
                    queryDetalles = `INSERT INTO detalles_unidad_mal_estado (queja_id, numero_unidad_malestado, tipo_falla, detalles_malestado) VALUES ($1, $2, $3, $4)`;
                    valuesDetalles = [quejaId, detalles.numero_unidad_malestado || null, detalles.tipo_falla || null, detalles.detalles_malestado || null];
                    break;
                case 'otro':
                    queryDetalles = `INSERT INTO detalles_otro (queja_id, detalles_otro) VALUES ($1, $2)`;
                    valuesDetalles = [quejaId, detalles.detalles_otro || null];
                    break;
            }

            await client.query(queryDetalles, valuesDetalles);
            await client.query('COMMIT');
            
            logger.info('Queja registrada exitosamente', { folio: nuevoFolio, tipo: tipo, id: quejaId });
            res.status(201).json({ success: true, message: '¡Queja registrada con éxito!', folio: nuevoFolio });
            
        } catch (error) {
            await client.query('ROLLBACK');
            logger.error('Error al procesar la queja:', { error: error.message });
            res.status(500).json({ success: false, error: 'Error interno del servidor: ' + error.message });
        } finally {
            client.release();
        }
    });

    // ============================================
    // FUNCIÓN AUXILIAR: Obtener queja con detalles
    // ============================================
    async function obtenerQuejaCompleta(folio) {
        // Usamos la misma lógica de formateo aquí también
        const query = `
            SELECT 
                q.id, q.folio, q.numero_empleado, q.empresa, q.ruta, q.colonia, q.turno, 
                q.tipo, q.latitud, q.longitud, q.numero_unidad, q.estado_queja,
                TO_CHAR(q.fecha_creacion, 'DD/MM/YYYY HH12:MI AM') as fecha_texto,
                
                dr.direccion_subida, 
                TO_CHAR(dr.hora_programada, 'HH12:MI AM') as hora_programada_texto,
                TO_CHAR(dr.hora_llegada, 'HH12:MI AM') as hora_llegada_texto,
                TO_CHAR(dr.hora_llegada_planta, 'HH12:MI AM') as hora_planta_texto,
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
            WHERE q.folio = $1
        `;
        const result = await pool.query(query, [folio]);
        return result.rows[0] || null;
    }

    // ============================================
    // OBTENER QUEJAS (lista) - Y ALIAS /API/QUEJAS
    // ============================================
    const handleGetQuejas = async (req, res) => {
        try {
            const { page = 1, limit = 50, estado } = req.query;
            const pageNum = parseInt(page, 10);
            const limitNum = Math.min(parseInt(limit, 10), 100);
            const offset = (pageNum - 1) * limitNum;

            // CONSULTA COMPLETA Y FORMATEADA (SOLUCIÓN DEFINITIVA)
            const querySelect = `
                SELECT 
                    q.id, q.folio, q.numero_empleado, q.empresa, q.ruta, q.colonia, q.turno, 
                    q.tipo, q.latitud, q.longitud, q.numero_unidad, q.estado_queja,
                    
                    -- Fechas formateadas como texto (Nombres nuevos)
                    TO_CHAR(q.fecha_creacion, 'DD/MM/YYYY HH12:MI AM') as fecha_texto,
                    
                    dr.direccion_subida, 
                    -- Horas formateadas como texto (Nombres nuevos)
                    TO_CHAR(dr.hora_programada, 'HH12:MI AM') as hora_programada_texto,
                    TO_CHAR(dr.hora_llegada, 'HH12:MI AM') as hora_llegada_texto,
                    TO_CHAR(dr.hora_llegada_planta, 'HH12:MI AM') as hora_planta_texto,
                    
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
            `;

            let query;
            let countQuery;
            let params;
            
            if (estado) {
                query = `${querySelect} WHERE q.estado_queja = $1 ORDER BY q.fecha_creacion DESC LIMIT $2 OFFSET $3`;
                countQuery = `SELECT COUNT(*) FROM quejas WHERE estado_queja = $1`;
                params = [estado, limitNum, offset];
            } else {
                query = `${querySelect} ORDER BY q.fecha_creacion DESC LIMIT $1 OFFSET $2`;
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
    };

    // Usamos la misma función para ambas rutas (DRY)
    router.get('/quejas', authenticateToken, handleGetQuejas);
    router.get('/api/quejas', authenticateToken, handleGetQuejas);

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
            const queja = await obtenerQuejaCompleta(folio);
            if (!queja) return res.status(404).json({ success: false, error: 'Queja no encontrada' });
            
            const resolucionResult = await pool.query('SELECT * FROM resoluciones WHERE queja_id = $1 ORDER BY fecha_resolucion DESC LIMIT 1', [queja.id]);
            const resolucion = resolucionResult.rows[0];
            if (!resolucion) return res.status(404).json({ success: false, error: 'No se encontró resolución' });

            let responsableNombre = 'Desconocido';
            if (resolucion.responsable_id) {
                const userResult = await pool.query('SELECT username FROM users WHERE id = $1', [resolucion.responsable_id]);
                if (userResult.rows[0]) responsableNombre = userResult.rows[0].username;
            }
            
            const templateData = {
                folio: queja.folio,
                numero_empleado: queja.numero_empleado,
                empresa: queja.empresa,
                tipo: queja.tipo,
                fecha_creacion: queja.fecha_texto || 'Fecha no disponible', // USAMOS EL TEXTO FORMATEADO
                fechaReporte: new Date().toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'America/Mexico_City' }),
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
            
            browser = await puppeteer.launch({ headless: true, executablePath: process.env.PUPPETEER_EXECUTABLE_PATH, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });
            const page = await browser.newPage();
            await page.setViewport({ width: 1200, height: 800 });
            await page.setContent(htmlTemplate, { waitUntil: 'domcontentloaded', timeout: 30000 });
            const pdfBuffer = await page.pdf({ format: 'A4', printBackground: true, margin: { top: '20mm', right: '15mm', bottom: '20mm', left: '15mm' }, scale: 0.8 });
            await browser.close();

            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename="reporte-queja-${folio}.pdf"`);
            res.setHeader('Content-Length', pdfBuffer.length);
            res.send(Buffer.from(pdfBuffer));
            
        } catch (error) {
            logger.error('Error al generar PDF:', { error: error.message });
            if (browser) try { await browser.close(); } catch (e) {}
            res.status(500).json({ success: false, error: 'Error al generar el reporte PDF' });
        }
    });

    // ============================================
    // VISUALIZAR PDF (HTML) - (Misma lógica simplificada)
    // ============================================
    router.get(['/queja/view/:folio', '/api/queja/view/:folio'], authenticateToken, requireRole(['admin', 'supervisor']), async (req, res) => {
        // ... (misma lógica que PDF pero devolviendo HTML) ...
        // Para brevedad, usa la misma estructura que tenías pero asegurándote de usar 'queja.fecha_texto'
        // Si necesitas este bloque completo también, dímelo.
        // Por ahora lo dejo resumido asumiendo que es idéntico al PDF pero con res.send(htmlTemplate)
        const { folio } = req.params;
        try {
            const queja = await obtenerQuejaCompleta(folio);
            if (!queja) return res.status(404).json({ success: false, error: 'Queja no encontrada' });
            
            const resolucionResult = await pool.query('SELECT * FROM resoluciones WHERE queja_id = $1 ORDER BY fecha_resolucion DESC LIMIT 1', [queja.id]);
            const resolucion = resolucionResult.rows[0];
            if (!resolucion) return res.status(404).json({ success: false, error: 'No se encontró resolución' });

            let responsableNombre = 'Desconocido';
            if (resolucion.responsable_id) {
                const userResult = await pool.query('SELECT username FROM users WHERE id = $1', [resolucion.responsable_id]);
                if (userResult.rows[0]) responsableNombre = userResult.rows[0].username;
            }
            
            const templateData = {
                folio: queja.folio,
                numero_empleado: queja.numero_empleado,
                empresa: queja.empresa,
                tipo: queja.tipo,
                fecha_creacion: queja.fecha_texto || 'Fecha no disponible',
                fechaReporte: new Date().toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'America/Mexico_City' }),
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
            htmlTemplate = htmlTemplate.replace(/\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (match, condition, content) => { return templateData[condition] ? content : ''; });
            
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.send(htmlTemplate);
        } catch (error) {
            logger.error('Error al generar HTML:', { error: error.message });
            res.status(500).json({ success: false, error: 'Error al generar reporte' });
        }
    });

    // ... (Rutas de resolver y stats quedan igual) ...
    router.put('/queja/resolver', authenticateToken, requireRole(['admin', 'supervisor']), async (req, res) => {
        // (Código original de resolver)
        const client = await pool.connect();
        try {
            const { id, folio, resolucion, procedencia, estado = 'Revisada' } = req.body;
            const responsable_id = req.user.id;
            if (!id || !folio || !resolucion || !procedencia) return res.status(400).json({ success: false, error: 'Faltan datos' });
            if (!['Procedio', 'No Procedio', 'Procedió', 'No Procedió'].includes(procedencia)) return res.status(400).json({ success: false, error: 'Procedencia inválida' });
            const procedenciaNormalizada = procedencia.includes('Procedio') ? 'Procedió' : 'No Procedió';
            await client.query('BEGIN');
            const checkResult = await client.query('SELECT id, estado_queja FROM quejas WHERE id = $1 AND folio = $2', [id, folio]);
            if (checkResult.rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ success: false, error: 'Queja no encontrada' }); }
            if (checkResult.rows[0].estado_queja !== 'Pendiente') { await client.query('ROLLBACK'); return res.status(400).json({ success: false, error: 'Ya procesada' }); }
            await client.query('UPDATE quejas SET estado_queja = $1 WHERE id = $2', [estado, id]);
            await client.query('INSERT INTO resoluciones (queja_id, texto_resolucion, responsable_id, procedencia) VALUES ($1, $2, $3, $4)', [id, resolucion, responsable_id, procedenciaNormalizada]);
            await client.query('COMMIT');
            logger.info('Queja resuelta', { folio, responsable: req.user.username });
            res.status(200).json({ success: true, message: 'Resuelta' });
        } catch (error) {
            await client.query('ROLLBACK');
            logger.error('Error resolver:', error);
            res.status(500).json({ success: false, error: 'Error servidor' });
        } finally { client.release(); }
    });

    router.get('/quejas/stats', authenticateToken, async (req, res) => {
        // (Código original de stats)
        try {
            const stats = await pool.query('SELECT tipo, estado_queja, COUNT(*) as total FROM quejas GROUP BY tipo, estado_queja');
            const totales = await pool.query("SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE estado_queja = 'Pendiente') as pendientes, COUNT(*) FILTER (WHERE estado_queja = 'Revisada') as revisadas FROM quejas");
            res.status(200).json({ success: true, data: { porTipoYEstado: stats.rows, totales: totales.rows[0] } });
        } catch (error) {
            res.status(500).json({ success: false, error: 'Error stats' });
        }
    });

    return router;
};