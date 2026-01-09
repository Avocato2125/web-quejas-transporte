const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
const { Parser } = require('json2csv');
const { authenticateToken, requirePermission } = require('../middleware/auth');
const { mainLogger: logger } = require('../config/logger');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Exportar audit logs de los últimos 3 meses como CSV
router.get('/audit-logs/export', authenticateToken, requirePermission('manage_users'), async (req, res) => {
    try {
        const threeMonthsAgo = new Date();
        threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

        const query = `
            SELECT id, user_id, action, table_name, record_id, old_values, new_values, ip_address, user_agent, created_at
            FROM audit_log
            WHERE created_at >= $1
            ORDER BY created_at DESC
        `;
        
        const result = await pool.query(query, [threeMonthsAgo]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'No hay logs de auditoría en los últimos 3 meses' });
        }

        // Convertir a CSV
        const fields = ['id', 'user_id', 'action', 'table_name', 'record_id', 'old_values', 'new_values', 'ip_address', 'user_agent', 'created_at'];
        const opts = { fields };
        const parser = new Parser(opts);
        const csv = parser.parse(result.rows);

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="audit-logs-ultimos-3-meses.csv"');
        res.send(csv);

        logger.info('Audit logs exportados', { userId: req.user.userId, count: result.rows.length });
    } catch (error) {
        logger.error('Error exportando audit logs:', error);
        res.status(500).json({ success: false, error: 'Error interno del servidor' });
    }
});

// Borrar audit logs de los últimos 3 meses (requiere credenciales de admin)
router.delete('/audit-logs/delete', authenticateToken, requirePermission('manage_users'), async (req, res) => {
    try {
        const { adminUsername, adminPassword } = req.body;

        if (!adminUsername || !adminPassword) {
            return res.status(400).json({ success: false, error: 'Usuario y contraseña de admin requeridos' });
        }

        // Verificar credenciales de admin
        const userQuery = 'SELECT id, password_hash, role FROM users WHERE username = $1';
        const userResult = await pool.query(userQuery, [adminUsername]);

        if (userResult.rows.length === 0) {
            return res.status(401).json({ success: false, error: 'Usuario no encontrado' });
        }

        const adminUser = userResult.rows[0];

        if (adminUser.role !== 'admin') {
            return res.status(403).json({ success: false, error: 'El usuario no tiene permisos de administrador' });
        }

        // Verificar contraseña (asumiendo bcrypt)
        const bcrypt = require('bcrypt');
        const isValidPassword = await bcrypt.compare(adminPassword, adminUser.password_hash);

        if (!isValidPassword) {
            return res.status(401).json({ success: false, error: 'Contraseña incorrecta' });
        }

        // Borrar logs de los últimos 3 meses
        const threeMonthsAgo = new Date();
        threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

        const deleteQuery = 'DELETE FROM audit_log WHERE created_at >= $1';
        const deleteResult = await pool.query(deleteQuery, [threeMonthsAgo]);

        res.json({ 
            success: true, 
            message: `Se borraron ${deleteResult.rowCount} registros de audit log` 
        });

        logger.info('Audit logs borrados', { 
            userId: req.user.userId, 
            adminUserId: adminUser.id, 
            deletedCount: deleteResult.rowCount 
        });
    } catch (error) {
        logger.error('Error borrando audit logs:', error);
        res.status(500).json({ success: false, error: 'Error interno del servidor' });
    }
});

module.exports = router;