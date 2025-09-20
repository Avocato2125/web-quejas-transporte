/**
 * Sanitización del lado del cliente
 * Previene XSS en el frontend
 */

/**
 * Sanitiza texto para prevenir XSS
 * @param {string} text - Texto a sanitizar
 * @returns {string} - Texto sanitizado
 */
function sanitizeText(text) {
    if (!text || typeof text !== 'string') {
        return '';
    }
    
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Sanitiza HTML permitiendo solo etiquetas seguras
 * @param {string} html - HTML a sanitizar
 * @returns {string} - HTML sanitizado
 */
function sanitizeHTML(html) {
    if (!html || typeof html !== 'string') {
        return '';
    }
    
    // Lista de etiquetas permitidas
    const allowedTags = ['b', 'i', 'em', 'strong', 'p', 'br', 'span'];
    
    // Crear elemento temporal
    const temp = document.createElement('div');
    temp.innerHTML = html;
    
    // Remover todas las etiquetas no permitidas
    const allElements = temp.querySelectorAll('*');
    allElements.forEach(element => {
        if (!allowedTags.includes(element.tagName.toLowerCase())) {
            // Reemplazar con su contenido de texto
            const textNode = document.createTextNode(element.textContent);
            element.parentNode.replaceChild(textNode, element);
        } else {
            // Remover atributos peligrosos
            const attributes = Array.from(element.attributes);
            attributes.forEach(attr => {
                if (attr.name.startsWith('on') || 
                    attr.name === 'href' || 
                    attr.name === 'src' || 
                    attr.name === 'style') {
                    element.removeAttribute(attr.name);
                }
            });
        }
    });
    
    return temp.innerHTML;
}

/**
 * Función segura para establecer contenido HTML
 * @param {Element} element - Elemento DOM
 * @param {string} content - Contenido a establecer
 * @param {boolean} allowHTML - Si permitir HTML básico
 */
function setSafeContent(element, content, allowHTML = false) {
    if (!element || !content) return;
    
    if (allowHTML) {
        element.innerHTML = sanitizeHTML(content);
    } else {
        element.textContent = content;
    }
}

/**
 * Función segura para crear elementos con contenido
 * @param {string} tagName - Nombre de la etiqueta
 * @param {string} content - Contenido del elemento
 * @param {Object} attributes - Atributos del elemento
 * @returns {Element} - Elemento creado
 */
function createSafeElement(tagName, content, attributes = {}) {
    const element = document.createElement(tagName);
    
    // Establecer contenido de forma segura
    if (content) {
        setSafeContent(element, content);
    }
    
    // Establecer atributos seguros
    Object.entries(attributes).forEach(([key, value]) => {
        if (key === 'class' || key === 'id' || key.startsWith('data-')) {
            element.setAttribute(key, sanitizeText(value));
        }
    });
    
    return element;
}

// Exportar funciones para uso global
window.sanitizeText = sanitizeText;
window.sanitizeHTML = sanitizeHTML;
window.setSafeContent = setSafeContent;
window.createSafeElement = createSafeElement;
