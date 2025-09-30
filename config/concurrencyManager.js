const { mainLogger: logger } = require('./logger');

class ConcurrencyManager {
    constructor() {
        this.locks = new Map();
    }

    async acquireLock(resourceId, timeout = 5000) {
        const startTime = Date.now();
        
        while (this.locks.has(resourceId)) {
            if (Date.now() - startTime > timeout) {
                throw new Error('Timeout al esperar el lock');
            }
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        this.locks.set(resourceId, Date.now());
        return true;
    }

    releaseLock(resourceId) {
        this.locks.delete(resourceId);
    }

    async withLock(resourceId, callback) {
        try {
            await this.acquireLock(resourceId);
            return await callback();
        } finally {
            this.releaseLock(resourceId);
        }
    }
}

// Singleton instance
const concurrencyManager = new ConcurrencyManager();

module.exports = concurrencyManager;