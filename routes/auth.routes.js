// routes/auth.routes.js
const express = require('express');
const router = express.Router();
const Joi = require('joi');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');

// Wrapper function to pass dependencies
module.exports = (pool, logger, loginLimiter, authenticateToken, verifyRefreshToken) => {

    // LOGIN
    router.post('/login', loginLimiter, async (req, res) => {
        const schema = Joi.object({
            username: Joi.string().alphanum().min(3).max(30).trim().required(),
            password: Joi.string().min(8).max(128).trim().required()
        });

        const { error } = schema.validate(req.body);
        if (error) {
            return res.status(400).json({
                success: false,
                error: error.details.map(d => d.message).join(', ')
            });
        }

        const { username, password } = req.body;

        try {
            const result = await pool.query(
                'SELECT id, username, password_hash, role, active FROM users WHERE username = $1 AND active = true',
                [username]
            );

            if (result.rows.length === 0) {
                logger.warn(`Intento de login fallido para usuario: ${username}`);
                return res.status(401).json({ success: false, error: 'Credenciales inválidas' });
            }

            const user = result.rows[0];
            const validPassword = await bcrypt.compare(password, user.password_hash);

            if (!validPassword) {
                logger.warn(`Contraseña incorrecta para usuario: ${username}`);
                return res.status(401).json({ success: false, error: 'Credenciales inválidas' });
            }

            const accessToken = jwt.sign(
                { userId: user.id, username: user.username, role: user.role },
                process.env.JWT_SECRET,
                { expiresIn: '15m' }
            );

            const refreshToken = jwt.sign(
                { userId: user.id },
                process.env.REFRESH_JWT_SECRET,
                { expiresIn: '7d' }
            );

            const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
            await pool.query(
                'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
                [user.id, refreshToken, expiresAt]
            );

            logger.info(`Login exitoso para usuario: ${username}`);
            res.json({
                success: true,
                accessToken,
                refreshToken,
                user: { username: user.username, role: user.role }
            });

        } catch (error) {
            logger.error('Error en login:', { error: error.message, username });
            res.status(500).json({ success: false, error: 'Error interno del servidor' });
        }
    });

    // LOGOUT
    router.post('/logout', authenticateToken, async (req, res) => {
        try {
            await pool.query('DELETE FROM refresh_tokens WHERE user_id = $1', [req.user.userId]);
            logger.info(`Usuario ${req.user.username} cerró sesión desde IP: ${req.ip}`);
            res.json({ success: true, message: 'Sesión cerrada exitosamente' });
        } catch (error) {
            logger.error('Error en logout:', error);
            res.status(500).json({ success: false, error: 'Error interno del servidor' });
        }
    });

    // REFRESH TOKEN
    router.post('/refresh-token', verifyRefreshToken, async (req, res) => {
        // verifyRefreshToken has already validated the refresh token and attached the user to req.user
        const user = req.user;

        const newAccessToken = jwt.sign(
            { userId: user.id, username: user.username, role: user.role },
            process.env.JWT_SECRET,
            { expiresIn: '15m' }
        );

        logger.info(`Token de acceso renovado para usuario: ${user.username}`);
        
        res.json({
            success: true,
            accessToken: newAccessToken
        });
    });

    return router;
};