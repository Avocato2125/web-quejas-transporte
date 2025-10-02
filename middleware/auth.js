// ===========================================
// MIDDLEWARE DE AUTENTICACIÓN MEJORADO
// ===========================================

const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const winston = require('winston');

// Configurar logger para autenticación
const authLogger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        new winston.transports.File({ filename: 'logs/auth.log' })
    ]
});

// ===========================================
// CONFIGURACIÓN DE BASE DE DATOS
// ===========================================

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// ===========================================
// MIDDLEWARE DE AUTENTICACIÓN PRINCIPAL
// ===========================================

const authenticateToken = async (req, res, next) => {
    try {
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1];
        
        if (!token) {
            authLogger.warn('Intento de acceso sin token', {
                ip: req.ip,
                userAgent: req.get('User-Agent'),
                endpoint: req.originalUrl,
                timestamp: new Date().toISOString()
            });
            
            return res.status(401).json({ 
                success: false, 
                error: 'Token de acceso requerido' 
            });
        }
        
        // Verificar token
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        // Verificar si el usuario existe y está activo
        const userResult = await pool.query(
            'SELECT id, username, role, active FROM users WHERE id = $1 AND active = true',
            [decoded.userId]
        );
        
        if (userResult.rows.length === 0) {
            authLogger.warn('Token válido pero usuario inactivo o inexistente', {
                userId: decoded.userId,
                ip: req.ip,
                endpoint: req.originalUrl,
                timestamp: new Date().toISOString()
            });
            
            return res.status(403).json({ 
                success: false, 
                error: 'Usuario inactivo o inexistente' 
            });
        }
        
        const user = userResult.rows[0];
        
        // Agregar información del usuario a la request
        req.user = {
            userId: user.id,
            username: user.username,
            role: user.role,
            lastLogin: user.last_login
        };
        
        // Log de acceso exitoso
        authLogger.info('Acceso autorizado', {
            userId: user.id,
            username: user.username,
            role: user.role,
            ip: req.ip,
            endpoint: req.originalUrl,
            timestamp: new Date().toISOString()
        });
        
        next();
        
    } catch (error) {
        if (error.name === 'JsonWebTokenError') {
            authLogger.warn('Token inválido', {
                error: error.message,
                ip: req.ip,
                endpoint: req.originalUrl,
                timestamp: new Date().toISOString()
            });
            
            return res.status(403).json({ 
                success: false, 
                error: 'Token inválido' 
            });
        }
        
        if (error.name === 'TokenExpiredError') {
            authLogger.warn('Token expirado', {
                error: error.message,
                ip: req.ip,
                endpoint: req.originalUrl,
                timestamp: new Date().toISOString()
            });
            
            return res.status(403).json({ 
                success: false, 
                error: 'Token expirado' 
            });
        }
        
        authLogger.error('Error en autenticación', {
            error: error.message,
            stack: error.stack,
            ip: req.ip,
            endpoint: req.originalUrl,
            timestamp: new Date().toISOString()
        });
        
        return res.status(500).json({ 
            success: false, 
            error: 'Error interno del servidor' 
        });
    }
};

// ===========================================
// MIDDLEWARE DE AUTORIZACIÓN POR ROLES
// ===========================================

const requireRole = (roles) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ 
                success: false, 
                error: 'Usuario no autenticado' 
            });
        }
        
        if (!roles.includes(req.user.role)) {
            authLogger.warn('Acceso denegado por permisos insuficientes', {
                userId: req.user.userId,
                username: req.user.username,
                userRole: req.user.role,
                requiredRoles: roles,
                ip: req.ip,
                endpoint: req.originalUrl,
                timestamp: new Date().toISOString()
            });
            
            return res.status(403).json({ 
                success: false, 
                error: 'Permisos insuficientes' 
            });
        }
        
        next();
    };
};

// ===========================================
// MIDDLEWARE DE VERIFICACIÓN DE REFRESH TOKEN
// ===========================================

const verifyRefreshToken = async (req, res, next) => {
    try {
        const { refreshToken } = req.body;
        
        if (!refreshToken) {
            return res.status(401).json({ 
                success: false, 
                error: 'Refresh token requerido' 
            });
        }
        
        // Verificar refresh token
        const decoded = jwt.verify(refreshToken, process.env.REFRESH_JWT_SECRET);
        
        // Verificar si el refresh token existe en la base de datos
        const tokenResult = await pool.query(
            'SELECT id, user_id, expires_at, revoked FROM refresh_tokens WHERE token_hash = $1 AND revoked = false',
            [refreshToken]
        );
        
        if (tokenResult.rows.length === 0) {
            authLogger.warn('Refresh token no encontrado o revocado', {
                userId: decoded.userId,
                ip: req.ip,
                timestamp: new Date().toISOString()
            });
            
            return res.status(403).json({ 
                success: false, 
                error: 'Refresh token inválido' 
            });
        }
        
        const tokenData = tokenResult.rows[0];
        
        // Verificar si el token ha expirado
        if (new Date() > new Date(tokenData.expires_at)) {
            authLogger.warn('Refresh token expirado', {
                userId: decoded.userId,
                ip: req.ip,
                timestamp: new Date().toISOString()
            });
            
            return res.status(403).json({ 
                success: false, 
                error: 'Refresh token expirado' 
            });
        }
        
        // Verificar si el usuario existe y está activo
        const userResult = await pool.query(
            'SELECT id, username, role, active FROM users WHERE id = $1 AND active = true',
            [decoded.userId]
        );
        
        if (userResult.rows.length === 0) {
            return res.status(403).json({ 
                success: false, 
                error: 'Usuario inactivo o inexistente' 
            });
        }
        
        req.user = userResult.rows[0];
        req.refreshTokenId = tokenData.id;
        
        next();
        
    } catch (error) {
        if (error.name === 'JsonWebTokenError') {
            return res.status(403).json({ 
                success: false, 
                error: 'Refresh token inválido' 
            });
        }
        
        if (error.name === 'TokenExpiredError') {
            return res.status(403).json({ 
                success: false, 
                error: 'Refresh token expirado' 
            });
        }
        
        authLogger.error('Error en verificación de refresh token', {
            error: error.message,
            stack: error.stack,
            ip: req.ip,
            timestamp: new Date().toISOString()
        });
        
        return res.status(500).json({ 
            success: false, 
            error: 'Error interno del servidor' 
        });
    }
};

// ===========================================
// MIDDLEWARE DE ACTUALIZACIÓN DE ÚLTIMO LOGIN
// ===========================================

const updateLastLogin = async (req, res, next) => {
    try {
        if (req.user && req.user.userId) {
            await pool.query(
                'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1',
                [req.user.userId]
            );
        }
        next();
    } catch (error) {
        authLogger.error('Error actualizando último login', {
            error: error.message,
            userId: req.user?.userId,
            timestamp: new Date().toISOString()
        });
        next(); // No fallar la request por este error
    }
};

// ===========================================
// MIDDLEWARE DE DETECCIÓN DE SESIONES MÚLTIPLES
// ===========================================

const detectMultipleSessions = async (req, res, next) => {
    try {
        if (req.user && req.user.userId) {
            // Verificar si hay múltiples sesiones activas
            const activeSessionsResult = await pool.query(
                'SELECT COUNT(*) as count FROM refresh_tokens WHERE user_id = $1 AND revoked = false AND expires_at > CURRENT_TIMESTAMP',
                [req.user.userId]
            );
            
            const activeSessions = parseInt(activeSessionsResult.rows[0].count);
            
            if (activeSessions > 3) { // Límite de 3 sesiones activas
                authLogger.warn('Múltiples sesiones detectadas', {
                    userId: req.user.userId,
                    username: req.user.username,
                    activeSessions: activeSessions,
                    ip: req.ip,
                    timestamp: new Date().toISOString()
                });
                
                // Opcional: revocar sesiones más antiguas
                await pool.query(
                    'UPDATE refresh_tokens SET revoked = true WHERE user_id = $1 AND revoked = false AND expires_at > CURRENT_TIMESTAMP AND id NOT IN (SELECT id FROM refresh_tokens WHERE user_id = $1 AND revoked = false ORDER BY created_at DESC LIMIT 3)',
                    [req.user.userId]
                );
            }
        }
        
        next();
    } catch (error) {
        authLogger.error('Error detectando sesiones múltiples', {
            error: error.message,
            userId: req.user?.userId,
            timestamp: new Date().toISOString()
        });
        next(); // No fallar la request por este error
    }
};

// ===========================================
// MIDDLEWARE DE VALIDACIÓN DE PERMISOS ESPECÍFICOS
// ===========================================

const requirePermission = (permission) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ 
                success: false, 
                error: 'Usuario no autenticado' 
            });
        }
        
        // Mapeo de permisos por rol
        const rolePermissions = {
            'admin': ['read', 'write', 'delete', 'manage_users', 'view_analytics'],
            'supervisor': ['read', 'write', 'view_analytics'],
            'user': ['read']
        };
        
        const userPermissions = rolePermissions[req.user.role] || [];
        
        if (!userPermissions.includes(permission)) {
            authLogger.warn('Acceso denegado por falta de permiso específico', {
                userId: req.user.userId,
                username: req.user.username,
                userRole: req.user.role,
                requiredPermission: permission,
                userPermissions: userPermissions,
                ip: req.ip,
                endpoint: req.originalUrl,
                timestamp: new Date().toISOString()
            });
            
            return res.status(403).json({ 
                success: false, 
                error: `Permiso requerido: ${permission}` 
            });
        }
        
        next();
    };
};

// ===========================================
// MIDDLEWARE DE AUDITORÍA DE AUTENTICACIÓN
// ===========================================

const authAuditMiddleware = (action) => {
    return (req, res, next) => {
        const originalSend = res.send;
        
        res.send = function(data) {
            // Log de auditoría
            authLogger.info('Auth action audit', {
                action: action,
                userId: req.user?.userId || null,
                username: req.user?.username || null,
                ip: req.ip,
                userAgent: req.get('User-Agent'),
                endpoint: req.originalUrl,
                statusCode: res.statusCode,
                timestamp: new Date().toISOString()
            });
            
            originalSend.call(this, data);
        };
        
        next();
    };
};

// ===========================================
// EXPORTAR MIDDLEWARES
// ===========================================

module.exports = {
    authenticateToken,
    requireRole,
    verifyRefreshToken,
    updateLastLogin,
    detectMultipleSessions,
    requirePermission,
    authAuditMiddleware,
    authLogger
};
