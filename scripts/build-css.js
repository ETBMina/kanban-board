const fs = require('fs');
const path = require('path');

const stylesDir = path.join(process.cwd(), 'styles');
const outputFile = path.join(process.cwd(), 'styles.css');

// Order of directories for 7-1 pattern
const order = [
    'abstracts',
    'vendors',
    'base',
    'layout',
    'components',
    'pages',
    'themes'
];

let cssContent = '/* Built with 7-1 Pattern */\n\n';

try {
    order.forEach(folder => {
        const folderPath = path.join(stylesDir, folder);
        if (fs.existsSync(folderPath)) {
            const files = fs.readdirSync(folderPath).filter(file => file.endsWith('.css'));
            // Sort files to ensure deterministic order (optional, but good practice)
            files.sort();

            if (files.length > 0) {
                cssContent += `/* --- ${folder.toUpperCase()} --- */\n`;
                files.forEach(file => {
                    const filePath = path.join(folderPath, file);
                    const content = fs.readFileSync(filePath, 'utf8');
                    cssContent += `/* ${file} */\n${content}\n\n`;
                });
            }
        }
    });

    fs.writeFileSync(outputFile, cssContent);
    console.log(`Successfully built ${outputFile}`);
} catch (err) {
    console.error('Error building CSS:', err);
    process.exit(1);
}
