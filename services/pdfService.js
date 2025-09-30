const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs').promises;
const { mainLogger: logger } = require('../config/logger');

class PDFService {
    constructor() {
        this.browser = null;
        this.initPromise = null;
    }

    async initialize() {
        if (!this.initPromise) {
            this.initPromise = (async () => {
                try {
                    this.browser = await puppeteer.launch({
                        headless: 'new',
                        args: [
                            '--no-sandbox',
                            '--disable-setuid-sandbox',
                            '--disable-dev-shm-usage'
                        ]
                    });
                    logger.info('Servicio PDF inicializado');
                } catch (error) {
                    logger.error('Error al inicializar el servicio PDF:', error);
                    throw error;
                }
            })();
        }
        return this.initPromise;
    }

    async generatePDF(htmlContent, options = {}) {
        try {
            if (!this.browser) {
                await this.initialize();
            }

            const page = await this.browser.newPage();
            
            try {
                // Configurar página
                await page.setContent(htmlContent, {
                    waitUntil: 'networkidle0',
                    timeout: 30000
                });

                // Configurar opciones de PDF
                const pdfOptions = {
                    format: 'A4',
                    margin: { top: '1cm', right: '1cm', bottom: '1cm', left: '1cm' },
                    printBackground: true,
                    ...options
                };

                // Generar PDF
                const buffer = await page.pdf(pdfOptions);
                return buffer;

            } finally {
                await page.close();
            }

        } catch (error) {
            logger.error('Error al generar PDF:', error);
            throw new Error('Error al generar el PDF');
        }
    }

    async generatePDFFromTemplate(templatePath, data, outputPath) {
        try {
            // Validar rutas
            const absoluteTemplatePath = path.resolve(templatePath);
            const absoluteOutputPath = path.resolve(outputPath);

            // Verificar que la carpeta de salida existe
            await fs.mkdir(path.dirname(absoluteOutputPath), { recursive: true });

            // Leer template
            const template = await fs.readFile(absoluteTemplatePath, 'utf-8');

            // Reemplazar variables en el template
            const htmlContent = template.replace(/\${(\w+)}/g, (match, key) => {
                return data[key] || '';
            });

            // Generar PDF
            const pdfBuffer = await this.generatePDF(htmlContent);

            // Guardar PDF
            await fs.writeFile(absoluteOutputPath, pdfBuffer);

            return absoluteOutputPath;

        } catch (error) {
            logger.error('Error al generar PDF desde template:', error);
            throw new Error('Error al generar el documento PDF');
        }
    }

    async cleanup() {
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
            this.initPromise = null;
        }
    }
}

// Singleton instance
const pdfService = new PDFService();

module.exports = pdfService;