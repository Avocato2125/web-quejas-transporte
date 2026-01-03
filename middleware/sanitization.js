/**
 * Middleware de Sanitización Profesional
 * Previene vulnerabilidades XSS y ataques de inyección
 */

const createDOMPurify = require('dompurify');
const { JSDOM } = require('jsdom');

// Crear instancia de DOMPurify para el servidor
const window = new JSDOM('').window;
const DOMPurify = createDOMPurify(window);

/**
 * Configuración de sanitización estricta
 */
const SANITIZE_CONFIG = {
    ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'p', 'br', 'span'],
    ALLOWED_ATTR: ['class'],
    KEEP_CONTENT: true,
    RETURN_DOM: false,
    RETURN_DOM_FRAGMENT: false,
    RETURN_DOM_IMPORT: false,
    SANITIZE_DOM: true,
    FORBID_TAGS: ['script', 'object', 'embed', 'link', 'style', 'meta', 'iframe'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'onblur', 'onchange', 'onsubmit']
};

/**
 * Sanitiza texto HTML para prevenir XSS
 * @param {string} dirty - Texto HTML a sanitizar
 * @returns {string} - Texto HTML sanitizado
 */
function sanitizeHTML(dirty) {
    if (!dirty || typeof dirty !== 'string') {
        return '';
    }
    
    try {
        return DOMPurify.sanitize(dirty, SANITIZE_CONFIG);
    } catch (error) {
        console.error('Error sanitizando HTML:', error);
        return dirty.replace(/<[^>]*>/g, '');
    }
}

/**
 * Sanitiza texto plano (elimina HTML completamente)
 * @param {string} text - Texto a sanitizar
 * @returns {string} - Texto plano sanitizado
 */
function sanitizeText(text) {
    if (!text || typeof text !== 'string') {
        return '';
    }
    
    return text.replace(/<[^>]*>/g, '')
               .replace(/&lt;/g, '<')
               .replace(/&gt;/g, '>')
               .replace(/&amp;/g, '&')
               .replace(/&quot;/g, '"')
               .replace(/&#x27;/g, "'")
               .replace(/&#x2F;/g, '/')
               .trim();
}

/**
 * Sanitiza un objeto completo recursivamente
 * @param {any} obj - Objeto a sanitizar
 * @returns {any} - Objeto sanitizado
 */
function sanitizeObject(obj) {
    // Valores nulos o undefined
    if (obj === null || obj === undefined) {
        return obj;
    }
    
    // Strings - sanitizar
    if (typeof obj === 'string') {
        return sanitizeText(obj);
    }
    
    // Números - devolver tal cual
    if (typeof obj === 'number') {
        return obj;
    }
    
    // Booleanos - devolver tal cual
    if (typeof obj === 'boolean') {
        return obj;
    }
    
    // Fechas - convertir a ISO string
    if (obj instanceof Date) {
        return obj.toISOString();
    }
    
    // Arrays - sanitizar cada elemento
    if (Array.isArray(obj)) {
        return obj.map(item => sanitizeObject(item));
    }
    
    // Objetos
    if (typeof obj === 'object') {
        // Verificar si es un objeto Date-like (de PostgreSQL)
        // pg puede devolver fechas como objetos con métodos toISOString
        if (typeof obj.toISOString === 'function') {
            try {
                return obj.toISOString();
            } catch (e) {
                // Si falla, intentar convertir a string
                return String(obj);
            }
        }
        
        // Verificar si es un objeto Date de PostgreSQL (tiene getTime)
        if (typeof obj.getTime === 'function') {
            try {
                return new Date(obj.getTime()).toISOString();
            } catch (e) {
                return String(obj);
            }
        }
        
        // Verificar si tiene la estructura de un timestamp de pg
        // Algunos drivers devuelven { value: '...', ... }
        if (obj.value !== undefined && Object.keys(obj).length <= 3) {
            return obj.value;
        }
        
        // Objeto normal - sanitizar recursivamente
        const sanitized = {};
        for (const [key, value] of Object.entries(obj)) {
            const cleanKey = sanitizeText(key);
            sanitized[cleanKey] = sanitizeObject(value);
        }
        return sanitized;
    }
    
    // Cualquier otro tipo - devolver tal cual
    return obj;
}

/**
 * Middleware para sanitizar el body de las requests
 */
function sanitizeRequestBody(req, res, next) {
    if (req.body && typeof req.body === 'object') {
        req.body = sanitizeObject(req.body);
    }
    next();
}

/**
 * Middleware para sanitizar query parameters
 */
function sanitizeQueryParams(req, res, next) {
    if (req.query && typeof req.query === 'object') {
        req.query = sanitizeObject(req.query);
    }
    next();
}

/**
 * Función helper para sanitizar datos antes de mostrar en frontend
 * @param {any} data - Datos a sanitizar
 * @param {boolean} allowHTML - Si permitir HTML básico (default: false)
 * @returns {any} - Datos sanitizados
 */
function sanitizeForFrontend(data, allowHTML = false) {
    if (allowHTML) {
        return sanitizeObject(data);
    } else {
        return sanitizeObject(data);
    }
}

module.exports = {
    sanitizeHTML,
    sanitizeText,
    sanitizeObject,
    sanitizeRequestBody,
    sanitizeQueryParams,
    sanitizeForFrontend,
    DOMPurify
};