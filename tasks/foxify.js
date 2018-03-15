const fs = require('fs-extra');
const {getDestDir} = require('./paths');

function replace(str, find, replace) {
    return str.split(find).join(replace);
}

async function editFile(path, edit) {
    const content = await fs.readFile(path, 'utf8');
    await fs.outputFile(path, edit(content));
}

module.exports = function createFoxifyTask(gulp) {
    gulp.task('foxify', async () => {
        const buildDir = getDestDir({production: true});
        const firefoxDir = getDestDir({production: true, firefox: true});

        // Copy files
        await fs.copy(buildDir, firefoxDir);

        // Patch manifest with Firefox values
        const manifest = await fs.readJson('src/manifest.json');
        const patch = await fs.readJson('src/manifest-firefox.json');
        const patched = {...manifest, ...patch};
        await fs.writeJson(`${firefoxDir}/manifest.json`, patched, {spaces: 4});

        // Prevent Firefox warnings for unsupported API
        await editFile(`${firefoxDir}/background/index.js`, (content) => {
            content = replace(content, 'chrome.fontSettings.getFontList', `chrome['font' + 'Settings']['get' + 'Font' + 'List']`);
            content = replace(content, 'chrome.fontSettings', `chrome['font' + 'Settings']`);
            return content;
        });

        // Enable Firefox-specific CSS
        await editFile(`${firefoxDir}/ui/popup/index.html`, (content) => {
            return replace(content, '<html>', '<html class="firefox">');
        });
    });
};
